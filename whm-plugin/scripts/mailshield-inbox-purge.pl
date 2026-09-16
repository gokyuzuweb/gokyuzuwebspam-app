#!/usr/bin/env perl
# GokyuzuWebSpam — Retroaktif Inbox Purge Daemon (v44.00.41)
#
# Amac: Master panelde bir gonderici blacklist'e eklendiginde, o gondericiden
# gelmis ve zaten INBOX'a dusmus mailleri Dovecot uzerinden expunge et.
#
# Nasil calisir:
#   1. /api/events/pending-actions endpoint'inden `action=inbox_purge` tipini poll'lar
#   2. Her action icin `doveadm expunge` calistirir (mail hesaplarini tarar)
#   3. Sonucu /api/events/complete-action ile master'a bildirir
#
# Kurulum: /usr/local/bin/mailshield-inbox-purge.pl (installer yerlestirir)
# Cron: her 2 dakikada bir (systemd timer ile)
use strict;
use warnings;
use JSON::XS;
use LWP::UserAgent;

my $CONF  = "/etc/mailshield/mailshield.conf";
my $LICENSE = ""; my $SERVER = "https://panel.gokyuzuhosting.com";

open(my $fh, "<", $CONF) or die "cannot read $CONF: $!";
while (my $l = <$fh>) {
    if ($l =~ /^\s*key\s*=\s*['"]?([^'"\s]+)/i)        { $LICENSE = $1; }
    if ($l =~ /^\s*server_url\s*=\s*['"]?([^'"\s]+)/i) { $SERVER  = $1; }
}
close $fh;
die "License key not found in $CONF\n" unless $LICENSE;

my $ua = LWP::UserAgent->new(timeout => 15);
$ua->ssl_opts(verify_hostname => 0);

sub log_msg { print STDERR "[inbox-purge] " . localtime() . " " . $_[0] . "\n"; }

# 1) Pending actions cek
my $resp = $ua->get("$SERVER/api/events/pending-actions?license_key=$LICENSE");
unless ($resp->is_success) {
    log_msg("poll failed: " . $resp->status_line);
    exit 0;
}
my $data;
eval { $data = decode_json($resp->decoded_content); };
if ($@ or !$data->{items}) { exit 0; }

foreach my $action (@{$data->{items}}) {
    next unless $action->{action} && $action->{action} eq "inbox_purge";
    my $aid = $action->{id};
    my $m = $action->{match} or next;
    my $since_days = $m->{since_days} || 30;
    my $et = $m->{entry_type} || "";
    my $val = $m->{value} || "";

    log_msg("processing $aid: $et=$val since ${since_days}d");

    # 2) doveadm search kriteri olustur
    my @search_args;
    if ($et eq "email") {
        push @search_args, "FROM", $val;
    } elsif ($et eq "domain") {
        push @search_args, "FROM", "\@$val";
    } elsif ($et eq "ip") {
        # Dovecot direkt IP arama desteklemez; header ile:
        push @search_args, "HEADER", "Received", $val;
    }
    push @search_args, "SINCE", "${since_days}d";

    my $result = "ok";
    my $message = "";
    my $expunged = 0;

    # doveadm cPanel path
    my $doveadm = "/usr/local/cpanel/3rdparty/bin/doveadm";
    $doveadm = "/usr/bin/doveadm" unless -x $doveadm;
    unless (-x $doveadm) {
        $result = "error";
        $message = "doveadm bulunamadi";
    } else {
        # Tum kullanicilar icin expunge (`-A`)
        my @cmd = ($doveadm, "expunge", "-A", "mailbox", "INBOX", @search_args);
        log_msg("cmd: " . join(" ", @cmd));
        my $out = `$doveadm expunge -A mailbox INBOX @search_args 2>&1`;
        my $rc = $? >> 8;
        if ($rc == 0) {
            $message = "doveadm ok";
            # Cikti ile silinen sayimlari say (basit heuristic)
            $expunged = () = $out =~ /expunged/gi;
        } else {
            $result = "error";
            $message = "doveadm rc=$rc: " . substr($out, 0, 200);
        }
    }

    # 3) Sonucu bildir
    my $notify = {
        license_key => $LICENSE,
        action_id => $aid,
        result => $result,
        message => "$message | expunged~$expunged",
    };
    my $r = $ua->post(
        "$SERVER/api/events/complete-action",
        Content_Type => "application/json",
        Content => encode_json($notify),
    );
    log_msg("complete $aid: " . ($r->is_success ? "ok" : $r->status_line));
}

exit 0;
