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

# Rate: keep in-memory recent id cache to avoid duplicate events across
# retries — this daemon POSTs at-most-once per Exim message id.
my %seen_ids;   # id => 1
my $seen_max = 5000;

while (1) {
    while (defined(my $line = <$fh>)) {
        chomp $line;
        _process_line($line);
    }
    _save_pos(tell $fh);
    sleep 2;

    # rotation
    my $newsize = -s $eximlog;
    if (defined $newsize && $newsize < tell($fh)) {
        close $fh;
        open $fh, '<', $eximlog or die "reopen fail: $!";
        warn "[GWS-logtail] exim_mainlog rotated, reopen\n";
    } else {
        $fh->clearerr;
    }

    # trim seen_ids cache
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

        _post_event({
            license_key     => $license,
            server_hostname => $host,
            server_ip       => $client_ip,
            from_addr       => $from,
            to_addr         => $to || undef,
            subject         => $subject || undef,
            verdict         => $verdict,
            action          => $action,
            total_score     => ($spam_score // 0) + 0,
            scores          => \%scores,
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

sub _post_event {
    my ($payload) = @_;
    # Drop empty subject/to/from to keep payload tidy
    for my $k (keys %$payload) { delete $payload->{$k} if !defined $payload->{$k}; }
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
        }
    }
}

sub _save_pos { open my $o, '>', $posfile or return; print $o $_[0]; close $o; }
sub _mkdirp   { my @p; for (split /\//, $_[0]) { push @p, $_; my $x = join('/', @p) || '/'; mkdir $x unless -d $x; } }

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
