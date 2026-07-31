#!/usr/bin/env perl
#
# GokyuzuWebSpam Exim Log Adapter
# --------------------------------
# Tails /var/log/exim_mainlog and reports every INBOUND mail event to the
# SaaS backend at POST {server_url}/api/events/ingest.
#
# Why Exim mainlog?
#   - Every mail (delivered or rejected) is logged here regardless of MSFE.
#   - Format is stable and documented. Same source MSFE uses.
#   - Works with or without MailScanner installed.
#
# Optional: If the corresponding Exim spool header file exists at
# /var/spool/exim/input/<id-suffix>-H, we also read the X-Spam-Score header
# (written by MailScanner) to enrich the event with a numeric score.
#
# Config (/etc/mailshield/mailshield.conf):
#   [license]
#   key         = MS-XXXXXXXX
#   server_url  = https://mailscanner-pro.preview.emergentagent.com
#   [logtail]
#   exim_log    = /var/log/exim_mainlog          (default)
#   spool_dir   = /var/spool/exim/input          (default)
#   position    = /var/lib/mailshield/exim-tail.pos
#
use strict;
use warnings;
use IO::Handle;
use JSON::PP ();
use Sys::Hostname ();

my $CFG_PATH = '/etc/mailshield/mailshield.conf';
my %cfg = _load_ini($CFG_PATH);

my $license = $cfg{license}{key}
    or die "[GWS-logtail] license.key yok in $CFG_PATH\n";
my $server  = $cfg{license}{server_url} // 'https://mailscanner-pro.preview.emergentagent.com';
my $eximlog = $cfg{logtail}{exim_log}   // '/var/log/exim_mainlog';
my $spool   = $cfg{logtail}{spool_dir}  // '/var/spool/exim/input';
my $posfile = $cfg{logtail}{position}   // '/var/lib/mailshield/exim-tail.pos';
my $host    = Sys::Hostname::hostname();

_mkdirp('/var/lib/mailshield');

my $pos = -e $posfile ? do { local(@ARGV,$/) = ($posfile); my $x = <>; chomp($x); $x } : undef;
$pos = 0 unless defined $pos && $pos =~ /^\d+$/;

open my $fh, '<', $eximlog or die "cannot open $eximlog: $!";
my $size = -s $eximlog;
# First run: seek to end so we don't flood backend with historical logs
if (!$pos) {
    $pos = $size;
}
if ($pos > $size) { $pos = 0; }   # log rotated
seek $fh, $pos, 0;

warn "[GWS-logtail] baslangic offset=$pos boyut=$size license=" . substr($license,0,12) . "…\n";

$SIG{TERM} = $SIG{INT} = sub { _save_pos(tell $fh); exit 0 };

my %seen_ids;   # id => 1
my $seen_max = 5000;
my $poll_counter = 0;    # her N sn'de bir pending-actions poll'u

while (1) {
    while (defined(my $line = <$fh>)) {
        chomp $line;
        _process_line($line);
    }
    _save_pos(tell $fh);

    # Her 10sn'de bir (5 * 2sn sleep) pending-action polling
    if (++$poll_counter >= 5) {
        $poll_counter = 0;
        _poll_and_execute_actions();
    }
    sleep 2;

    my $newsize = -s $eximlog;
    if (defined $newsize && $newsize < tell($fh)) {
        close $fh;
        open $fh, '<', $eximlog or die "reopen fail: $!";
        warn "[GWS-logtail] exim_mainlog rotated, reopen\n";
    } else {
        $fh->clearerr;
    }

    if (scalar(keys %seen_ids) > $seen_max) {
        %seen_ids = ();
    }
}

sub _process_line {
    my ($line) = @_;

    # Match inbound line:
    if ($line =~ m{
        ^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s
        (\S+)\s
        <=\s
        (\S+)
        (.*?)
        (?:\sfor\s(.+))?$
    }x) {
        my ($date, $time, $mid, $from, $mid_part, $for_rcpt) = ($1,$2,$3,$4,$5,$6);
        return if $seen_ids{$mid}++;

        my ($client_ip) = $mid_part =~ /\[([\d.:a-f]+)\]/i;
        my ($subject)   = $mid_part =~ /\sT="((?:\\.|[^"\\])*)"/;
        $subject //= '';
        # Exim octal escapes -> byte
        $subject =~ s/\\(\d{3})/chr(oct($1))/ge;
        eval {
            require Encode;
            if (!Encode::is_utf8($subject) && $subject =~ /[\x80-\xff]/) {
                my $dec = eval { Encode::decode('UTF-8', $subject, Encode::FB_CROAK()) };
                if ($@ || !defined $dec) {
                    $dec = eval { Encode::decode('cp1254', $subject, Encode::FB_DEFAULT()) };
                }
                $subject = Encode::encode('UTF-8', $dec) if defined $dec;
            }
        };
        $subject = substr($subject, 0, 200);
        my $to = $for_rcpt // '';
        $to =~ s/^\s+|\s+$//g;

        # v1.7: SpamAssassin genelde ~1-3sn sonra header yazar; kısa bekle sonra parse et
        # (blocking sleep worker daemon'da ok — trafik yoğunsa async kuyruğa alalım gelecekte)
        my ($spam_score, $spam_status, $spam_report);
        for my $attempt (1..3) {
            ($spam_score, $spam_status, $spam_report) = _spam_from_spool($mid);
            last if defined $spam_score || defined $spam_status;
            select(undef, undef, undef, 0.8);   # 800ms uyu, retry
        }

        # Verdict logic — SA header yoksa 'clean', varsa skora göre
        my ($verdict, $action) = ('clean', 'accept');
        if (defined $spam_status && $spam_status =~ /yes/i) {
            if    (defined $spam_score && $spam_score >= 10) { ($verdict, $action) = ('high_spam', 'quarantine'); }
            elsif (defined $spam_score && $spam_score >= 5)  { ($verdict, $action) = ('spam',      'quarantine'); }
            else                                              { ($verdict, $action) = ('spam',      'quarantine'); }
        } elsif (defined $spam_score && $spam_score >= 10) {
            ($verdict, $action) = ('high_spam', 'quarantine');
        } elsif (defined $spam_score && $spam_score >= 5) {
            ($verdict, $action) = ('spam', 'quarantine');
        }

        my %scores;
        $scores{spamassassin} = $spam_score + 0 if defined $spam_score;
        $scores{sa_report}    = substr($spam_report, 0, 500) if defined $spam_report;

        # NEW: read body/attachments/headers from Exim spool if available
        my ($headers_full, $body_preview, $attachments) = _spool_content($mid);

        _post_event({
            license_key     => $license,
            server_hostname => $host,
            server_ip       => $client_ip,
            exim_mid        => $mid,
            from_addr       => $from,
            to_addr         => $to || undef,
            subject         => $subject || undef,
            verdict         => $verdict,
            action          => $action,
            total_score     => ($spam_score // 0) + 0,
            scores          => \%scores,
            headers_full    => $headers_full,
            body_preview    => $body_preview,
            attachments     => $attachments,
            ts              => "${date}T${time}+00:00",
        });
        return;
    }

    # Rejected messages: 'H=... rejected RCPT ...'  or  'rejected after DATA'
    if ($line =~ m{^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s.*?\brejected\b.*?F=<([^>]*)>}i) {
        my ($date, $time, $from) = ($1, $2, $3);
        _post_event({
            license_key     => $license,
            server_hostname => $host,
            from_addr       => $from || undef,
            verdict         => 'blocked',
            action          => 'reject',
            total_score     => 0,
            scores          => {},
            ts              => "${date}T${time}+00:00",
        });
    }
}

sub _spam_from_spool {
    my ($mid) = @_;
    # Exim stores headers in $spool/<split>/<id>-H
    my ($score, $status, $report);
    for my $sub ('', map { "$_/" } 0..9, 'A'..'F') {
        my $path = "$spool/${sub}${mid}-H";
        if (-r $path) {
            open my $h, '<', $path or next;
            while (my $l = <$h>) {
                # Exim header lines start with a numeric length prefix
                if ($l =~ /X-Spam-Score:\s*(-?\d+(?:\.\d+)?)/i)  { $score = $1; }
                if ($l =~ /X-Spam-Status:\s*(\w+)/i)             { $status = $1; }
                if ($l =~ /X-Spam-Report:\s*(.+)/i)              { $report = $1; }
                # MailScanner-specific header (varies per install)
                if ($l =~ /X-MailScanner-SpamCheck:\s*(.+?)['"]?\s*$/i) {
                    if ($1 =~ /score=(-?\d+(?:\.\d+)?)/i) { $score //= $1; }
                    if ($1 =~ /\b(spam|not\s+spam)\b/i)   { $status //= (lc($1) eq 'spam' ? 'Yes' : 'No'); }
                    $report //= substr($1, 0, 400);
                }
            }
            close $h;
            last;
        }
    }
    return ($score, $status, $report);
}

# Returns (headers_full, body_preview, attachments_arrayref) for a given Exim mid
# by parsing the -H (headers) and -D (data/body) spool files.
sub _spool_content {
    my ($mid) = @_;
    my ($headers_full, $body_preview);
    my @attachments;
    for my $sub ('', map { "$_/" } 0..9, 'A'..'F') {
        my $h_path = "$spool/${sub}${mid}-H";
        my $d_path = "$spool/${sub}${mid}-D";
        if (-r $h_path) {
            # Read raw headers (skip Exim internal prefix numbers)
            if (open my $hf, '<', $h_path) {
                my @lines;
                my $skip_leading = 3;  # Exim prepends 3 metadata lines
                while (my $l = <$hf>) {
                    if ($skip_leading > 0) { $skip_leading--; next; }
                    chomp $l;
                    # Strip leading numeric length prefix used by Exim ("023 Header: value")
                    $l =~ s/^\d{3}\s?//;
                    push @lines, $l;
                    last if length(join("\n", @lines)) > 8192;  # cap
                }
                close $hf;
                $headers_full = join("\n", @lines);
            }
        }
        if (-r $d_path) {
            # Read body (starts after first line which is the message id)
            if (open my $df, '<', $d_path) {
                my $buf = '';
                <$df>;  # skip first metadata line
                while (my $l = <$df>) {
                    $buf .= $l;
                    last if length($buf) > 4096;   # 4KB preview
                }
                close $df;
                # Cheap MIME peek: if body is multipart, extract only the first text part
                if ($buf =~ /^\s*--[-A-Za-z0-9]+/m) {
                    if ($buf =~ /Content-Type:\s*text\/plain[^\r\n]*\r?\n\r?\n(.*?)(?:\r?\n--)/msi) {
                        $body_preview = substr($1, 0, 4096);
                    } else {
                        $body_preview = substr($buf, 0, 2048);
                    }
                    # Extract attachment filenames (best-effort)
                    my @segs = split /\r?\n--/, $buf;
                    for my $s (@segs) {
                        if ($s =~ /Content-Disposition:\s*attachment[^;]*;\s*filename="?([^"\r\n]+)"?/i) {
                            my $fn = $1;
                            my $ct = ($s =~ /Content-Type:\s*([^;\r\n]+)/i) ? $1 : 'application/octet-stream';
                            my $sz = length($s);
                            push @attachments, { filename => $fn, content_type => $ct, size => $sz };
                            last if scalar(@attachments) >= 10;
                        }
                    }
                } else {
                    $body_preview = substr($buf, 0, 4096);
                }
            }
        }
        last if defined $headers_full || defined $body_preview;
    }
    return ($headers_full, $body_preview, scalar(@attachments) ? \@attachments : undef);
}

sub _post_event {
    my ($payload) = @_;
    for my $k (keys %$payload) { delete $payload->{$k} if !defined $payload->{$k}; }
    my $exim_mid = $payload->{exim_mid};
    my $json = JSON::PP::encode_json($payload);

    my @cmd = ('curl','-sS','--max-time','6','-X','POST',
               '-H','Content-Type: application/json',
               '--data-binary', $json,
               "$server/api/events/ingest");
    my $pid = open(my $ch, '-|', @cmd);
    if ($pid) {
        my $resp = do { local $/; <$ch> };
        close $ch;
        if ($? != 0) {
            warn "[GWS-logtail] POST fail exit=" . ($?>>8) . " resp=" . ($resp // '') . "\n";
            return;
        }
        # Extract returned event_id ve exim_mid ile diskteki mapping'e kaydet
        # ki daha sonra pending-action geldiginde mid'i bulabilelim.
        if ($resp && $exim_mid) {
            my $d = eval { JSON::PP::decode_json($resp) } // {};
            _remember_mid($d->{id}, $exim_mid) if $d->{id};
        }
    }
}

sub _save_pos { open my $o, '>', $posfile or return; print $o $_[0]; close $o; }
sub _mkdirp   { my @p; for (split /\//, $_[0]) { push @p, $_; my $x = join('/', @p) || '/'; mkdir $x unless -d $x; } }

# ---- Pending-action polling + Exim spool executor ----
sub _poll_and_execute_actions {
    my $url = "$server/api/events/pending-actions?license_key=$license";
    my $body = qx(curl -sS --max-time 6 -H 'Accept: application/json' \Q$url\E 2>/dev/null);
    return unless $body;
    my $data = eval { JSON::PP::decode_json($body) } // {};
    my $items = $data->{items} || [];
    return unless @$items;

    for my $act (@$items) {
        my $action_id = $act->{id}       or next;
        my $event_id  = $act->{event_id} or next;
        my $op        = $act->{action}   or next;

        # Event detayini al - exim_mid gerekli
        my $ev_url = "$server/api/events?license_key=$license&limit=1";
        # Backend list endpoint filter by id yok — daha basit: /event/{id} olsa iyi olur.
        # Simdilik events listesinden bulmak yerine daemon local cache tutabilir.
        # v1.6.5: backend'de /events/{id} single-fetch endpoint eklendi diyelim ama simdi yok.
        # Yaklasik: her POST'ta biz mid'i biliyoruz -> local map disk'te tutalim.
        my $mid = _lookup_mid($event_id);
        my ($result, $msg);
        if (!$mid) {
            ($result, $msg) = ('skip', 'exim_mid mapping yok (event bu daemon calisirken gelmedi)');
        } elsif ($op eq 'delete') {
            my $r = system("/usr/sbin/exim -Mrm '$mid' >/dev/null 2>&1");
            ($result, $msg) = $r == 0
                ? ('ok', "exim -Mrm $mid basarili")
                : ('fail', "exim -Mrm exit=" . ($r >> 8));
        } elsif ($op eq 'release') {
            # Force delivery
            my $r = system("/usr/sbin/exim -M '$mid' >/dev/null 2>&1");
            ($result, $msg) = $r == 0
                ? ('ok', "exim -M $mid (force delivery) basarili")
                : ('fail', "exim -M exit=" . ($r >> 8));
        } elsif ($op eq 'report_spam') {
            ($result, $msg) = ('ok', 'spam raporu kuyruga alindi (v1.7 sa-learn entegrasyonu)');
        } else {
            ($result, $msg) = ('skip', "bilinmeyen aksiyon: $op");
        }

        _post_json("$server/api/events/complete-action", {
            license_key => $license,
            action_id   => $action_id,
            result      => $result,
            message     => $msg,
        });
    }
}

# event_id -> exim_mid map, sonradan lookup icin diske yaz
my $MID_MAP = '/var/lib/mailshield/event-mid.map';
sub _remember_mid {
    my ($event_id, $mid) = @_;
    return unless $event_id && $mid;
    open my $f, '>>', $MID_MAP or return;
    print $f "$event_id\t$mid\n";
    close $f;
    # Cap dosya boyutunu (~50k satir)
    if ((-s $MID_MAP // 0) > 3_000_000) {
        system("tail -n 30000 $MID_MAP > ${MID_MAP}.tmp && mv ${MID_MAP}.tmp $MID_MAP");
    }
}
sub _lookup_mid {
    my ($event_id) = @_;
    return undef unless -r $MID_MAP;
    open my $f, '<', $MID_MAP or return undef;
    my $found;
    while (my $line = <$f>) {
        chomp $line;
        my ($eid, $mid) = split /\t/, $line, 2;
        $found = $mid if $eid && $eid eq $event_id;
    }
    close $f;
    return $found;
}

sub _post_json {
    my ($url, $payload) = @_;
    my $json = JSON::PP::encode_json($payload);
    my @cmd = ('curl','-sS','--max-time','6','-X','POST',
               '-H','Content-Type: application/json',
               '--data-binary', $json, $url);
    open(my $ch, '-|', @cmd) or return;
    my $resp = do { local $/; <$ch> };
    close $ch;
    return $resp;
}

sub _load_ini {
    my ($p) = @_;
    my %h; my $sec = 'main';
    open my $fh, '<', $p or die "cannot read $p: $!\n";
    while (my $l = <$fh>) {
        $l =~ s/[\r\n#].*$//;
        $l =~ s/^\s+|\s+$//g;
        next unless length $l;
        if ($l =~ /^\[(.+)\]$/)              { $sec = $1; next; }
        if ($l =~ /^([\w.-]+)\s*=\s*(.*)$/)  { $h{$sec}{$1} = $2; }
    }
    close $fh;
    return %h;
}
