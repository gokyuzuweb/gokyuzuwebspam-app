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
    # 2026-07-31 10:04:06 1wphHq-0000000BBIo-3bba <= sender@from H=(...) [1.2.3.4] ... T="Subject" for rcpt@to
    if ($line =~ m{
        ^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s     # date time
        (\S+)\s                                          # exim message id
        <=\s                                             # inbound marker
        (\S+)                                            # from address
        (.*?)                                            # middle (H=, IP, S=, T=, etc.)
        (?:\sfor\s(.+))?$                                # optional 'for rcpt'
    }x) {
        my ($date, $time, $mid, $from, $mid_part, $for_rcpt) = ($1,$2,$3,$4,$5,$6);
        return if $seen_ids{$mid}++;

        # Extract client IP (H=host [1.2.3.4])
        my ($client_ip) = $mid_part =~ /\[([\d.:a-f]+)\]/i;
        # Subject (T="...") — may contain escaped chars
        my ($subject)   = $mid_part =~ /\sT="((?:\\.|[^"\\])*)"/;
        $subject //= '';
        # Exim T="..." field'i escape sequence icerir: \nHH (Q-P benzeri).
        # Ornek: "F\335YAT" -> "FİYAT" (0xdd = 221 -> 'İ' in cp1254),
        #        "\304\260" -> "İ" (UTF-8 pairs).
        $subject =~ s/\\(\d{3})/chr(oct($1))/ge;   # \NNN octal escapes -> byte
        # Sonuc byte string; encoding olarak once UTF-8 dogrulayalim, degilse cp1254
        eval {
            require Encode;
            if (!Encode::is_utf8($subject) && $subject =~ /[\x80-\xff]/) {
                # Try UTF-8 decode first; fall back to cp1254 (Turkish Windows)
                my $decoded = eval { Encode::decode('UTF-8', $subject, Encode::FB_CROAK()) };
                if ($@ || !defined $decoded) {
                    $decoded = eval { Encode::decode('cp1254', $subject, Encode::FB_DEFAULT()) };
                }
                $subject = Encode::encode('UTF-8', $decoded) if defined $decoded;
            }
        };
        $subject = substr($subject, 0, 200);
        # Recipient (either 'for x@y' at end OR from later => line; we accept the first form now)
        my $to = $for_rcpt // '';
        $to =~ s/^\s+|\s+$//g;

        # Optional: sniff X-Spam-Score from Exim spool header file
        my ($spam_score, $spam_status) = _spam_from_spool($mid);

        my $verdict = 'clean';
        my $action  = 'accept';
        if (defined $spam_status && $spam_status =~ /yes/i) {
            if (defined $spam_score && $spam_score >= 8) { $verdict = 'high_spam'; $action = 'quarantine'; }
            else                                          { $verdict = 'spam';      $action = 'quarantine'; }
        }

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
            scores          => (defined $spam_score ? { spamassassin => $spam_score + 0 } : {}),
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
    # Exim stores headers in $spool/<split>/<id>-H  where <split> is a subdir
    # based on message id (0-9 split for split_spool_directory).
    my ($score, $status);
    for my $sub ('', map { "$_/" } 0..9, 'A'..'F') {
        my $path = "$spool/${sub}${mid}-H";
        if (-r $path) {
            open my $h, '<', $path or next;
            while (my $l = <$h>) {
                if ($l =~ /^\d+X-Spam-Score:\s*(-?\d+(?:\.\d+)?)/i) { $score = $1; }
                if ($l =~ /^\d+X-Spam-Status:\s*(\w+)/i)            { $status = $1; }
                last if defined $score && defined $status;
            }
            close $h;
            last;
        }
    }
    return ($score, $status);
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
