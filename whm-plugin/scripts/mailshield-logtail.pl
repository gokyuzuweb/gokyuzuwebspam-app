#!/usr/bin/env perl
#
# GokyuzuWebSpam MailScanner Log Adapter
# ----------------------------------------
# Reads MailScanner's own log (default: /var/log/maillog) in a tail -F style,
# parses spam decisions, and reports each mail event to the SaaS backend at
#   POST {server_url}/api/events/ingest
#
# Config (from /etc/mailshield/mailshield.conf):
#   [license]
#   key         = MS-XXXXXXXX
#   server_url  = https://mailscanner-pro.preview.emergentagent.com
#   [logtail]
#   maillog     = /var/log/maillog       (default)
#   position    = /var/lib/mailshield/logtail.pos  (byte offset persist)
#
# Why this over a raw milter?
#   - MailScanner is already the authoritative filter on this server.
#   - We don't want to duplicate its work; we just mirror its verdicts.
#   - Zero Exim config change required.
#
use strict;
use warnings;
use IO::Handle;
use JSON::PP ();
use Sys::Hostname ();
use Time::Local ();

my $CFG_PATH = '/etc/mailshield/mailshield.conf';
my %cfg = _load_ini($CFG_PATH);

my $license = $cfg{license}{key}        // die "license.key config yok\n";
my $server  = $cfg{license}{server_url} // 'https://mailscanner-pro.preview.emergentagent.com';
my $maillog = $cfg{logtail}{maillog}    // '/var/log/maillog';
my $posfile = $cfg{logtail}{position}   // '/var/lib/mailshield/logtail.pos';
my $host    = Sys::Hostname::hostname();

# Ensure state dir
_mkdirp('/var/lib/mailshield');

# Resume from saved offset (or seek to end on first run)
my $pos = -e $posfile ? do { local(@ARGV,$/) = ($posfile); <> } : 0;
$pos = 0 unless $pos =~ /^\d+$/;
chomp $pos;

open my $fh, '<', $maillog or die "cannot open $maillog: $!";
my $size = -s $maillog;
if ($pos > $size) { $pos = 0; }  # log rotated
seek $fh, $pos, 0;

warn "[GWS-logtail] baslangic offset=$pos boyut=$size license=" . substr($license,0,12) . "...\n";

# Group log lines by MailScanner message id, since MS emits multiple lines per mail:
#   MailScanner[pid]: Spam Checks: Found ... spam messages
#   MailScanner[pid]: Message xxxx from x.x.x.x (from@) to to@ is Definitely spam (SA score=15.2, ...)
my %partial;   # msgid -> hash of fields

$SIG{TERM} = $SIG{INT} = sub { _save_pos(tell $fh); exit 0 };

while (1) {
    while (defined(my $line = <$fh>)) {
        chomp $line;
        _process_line($line, \%partial);
    }
    # save position periodically
    _save_pos(tell $fh);
    sleep 2;
    # Detect rotation
    my $newsize = -s $maillog;
    if (defined $newsize && $newsize < tell($fh)) {
        close $fh;
        open $fh, '<', $maillog or die "reopen fail: $!";
        warn "[GWS-logtail] log rotated, reopen\n";
    } else {
        $fh->clearerr;
    }
}

sub _process_line {
    my ($line, $partial) = @_;
    # Only MailScanner lines are interesting
    return unless $line =~ /MailScanner\[\d+\]:\s+(.+)$/;
    my $msg = $1;

    # Verdict form:
    #   Message xxxx.yyyy from 1.2.3.4 (sender@dom) to rcpt@dom is spam, SpamAssassin (score=8.4, ...) ClamAV(clean)
    if ($msg =~ /Message\s+(\S+)\s+from\s+\S+\s*\(([^)]+)\)\s+to\s+(\S+)\s+is\s+(clean|spam|highspam|definitely\s+spam|non-spam)\b(?:,\s*(.+))?/i) {
        my ($id, $from, $to, $verdict_raw, $rest) = ($1, $2, $3, lc $4, $5 // '');
        my $verdict = 'clean';
        if ($verdict_raw =~ /highspam|definitely\s+spam/) { $verdict = 'high_spam'; }
        elsif ($verdict_raw eq 'spam')                    { $verdict = 'spam'; }

        my ($score) = $rest =~ /score\s*=\s*(-?\d+(?:\.\d+)?)/i;
        my $entry = $partial->{$id} ||= {};
        $entry->{from_addr}    //= $from;
        $entry->{to_addr}      //= $to;
        $entry->{verdict}      = $verdict;
        $entry->{total_score}  = $score + 0 if defined $score;
        $entry->{ts}         ||= _now_iso();
        _flush($id, $entry);
        return;
    }

    # Subject capture (MailScanner logs it separately on some builds):
    #   Message xxxx.yyyy header 'Subject: ...' ...
    if ($msg =~ /Message\s+(\S+).*?Subject:\s+(.+?)['"]?\s*$/) {
        my ($id, $subject) = ($1, $2);
        $subject =~ s/^\s+|\s+$//g;
        my $entry = $partial->{$id} ||= {};
        $entry->{subject} //= substr($subject, 0, 200);
        return;
    }

    # Virus verdict:
    if ($msg =~ /Message\s+(\S+)\s+.*?(?:Virus|Infection|Malware).*?['"]?(\S[^'"]{0,80})['"]?/i) {
        my ($id, $threat) = ($1, $2);
        my $entry = $partial->{$id} ||= {};
        $entry->{verdict} = 'virus';
        $entry->{scores}{virus_name} = $threat;
        $entry->{total_score} //= 20.0;
        _flush($id, $entry);
    }
}

sub _flush {
    my ($id, $entry) = @_;
    return unless $entry->{verdict};
    my $payload = {
        license_key     => $license,
        server_hostname => $host,
        from_addr       => $entry->{from_addr},
        to_addr         => $entry->{to_addr},
        subject         => $entry->{subject},
        verdict         => $entry->{verdict},
        action          => ($entry->{verdict} =~ /virus|high_spam/) ? 'quarantine' : ($entry->{verdict} eq 'spam' ? 'quarantine' : 'accept'),
        total_score     => $entry->{total_score} // 0,
        scores          => $entry->{scores}      // {},
        ts              => $entry->{ts},
    };
    _post_event($payload);
    delete $entry->{sent};
}

sub _post_event {
    my ($payload) = @_;
    my $json = JSON::PP::encode_json($payload);
    # Use system curl to avoid Perl SSL surprises on cPanel Perl
    my @cmd = ('curl','-sS','--max-time','6','-X','POST',
               '-H','Content-Type: application/json',
               '-H','Accept: application/json',
               '--data-binary', $json,
               "$server/api/events/ingest");
    my $pid = open(my $ch, '-|', @cmd);
    if ($pid) {
        my $resp = do { local $/; <$ch> };
        close $ch;
        if ($? != 0) {
            warn "[GWS-logtail] curl exit=" . ($?>>8) . " resp=$resp\n";
        }
    }
}

sub _save_pos {
    my ($p) = @_;
    open my $out, '>', $posfile or return;
    print $out $p;
    close $out;
}

sub _mkdirp { my ($d) = @_; my @p; for my $s (split /\//, $d) { push @p, $s; my $x = join('/', @p) || '/'; mkdir $x unless -d $x; } }

sub _now_iso {
    my @t = gmtime;
    return sprintf("%04d-%02d-%02dT%02d:%02d:%02d+00:00",
                   $t[5]+1900, $t[4]+1, $t[3], $t[2], $t[1], $t[0]);
}

sub _load_ini {
    my ($p) = @_;
    my %h; my $sec = 'main';
    open my $fh, '<', $p or die "cannot read $p: $!";
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
