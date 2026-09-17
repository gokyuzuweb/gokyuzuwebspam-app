#!/usr/bin/env perl
# GokyuzuWebSpam — Retroaktif Inbox Purge & Junk-Reclaim Daemon (v44.00.44)
#
# Amac:
#   * Whitelist eklendiginde -> action=junk_to_inbox
#       `doveadm move -A INBOX mailbox Junk FROM @domain SINCE Nd`
#     Junk klasorunden Inbox'a geri getirir.
#   * Blacklist eklendiginde -> action=inbox_purge
#       `doveadm expunge -A mailbox INBOX FROM @domain SINCE Nd`
#     Inbox'tan siler (Junk'a tasimak yerine dogrudan sil).
#
# Nasil calisir:
#   1. /api/events/pending-actions'i poll'lar
#   2. Her action icin uygun doveadm komutunu calistirir
#   3. Sonucu /api/events/complete-action ile bildirir
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

# doveadm cPanel path
my $doveadm = "/usr/local/cpanel/3rdparty/bin/doveadm";
$doveadm = "/usr/bin/doveadm" unless -x $doveadm;

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
    my $atype = $action->{action} || "";
    # v44.00.44 — hem inbox_purge (blacklist) hem junk_to_inbox (whitelist) destegi
    next unless $atype eq "inbox_purge" || $atype eq "junk_to_inbox";
    my $aid = $action->{id};
    my $m = $action->{match} or next;
    my $since_days = $m->{since_days} || 30;
    my $et = $m->{entry_type} || "";
    my $val = $m->{value} || "";

    log_msg("processing $aid: type=$atype $et=$val since ${since_days}d");

    # doveadm search kriteri olustur
    my @search_args;
    if ($et eq "email") {
        push @search_args, "FROM", $val;
    } elsif ($et eq "domain") {
        push @search_args, "FROM", "\@$val";
    } elsif ($et eq "ip") {
        # Dovecot direkt IP arama desteklemez; Received header'i ile:
        push @search_args, "HEADER", "Received", $val;
    }
    push @search_args, "SINCE", "${since_days}d";

    my $result = "ok";
    my $message = "";
    my $affected = 0;

    unless (-x $doveadm) {
        $result = "error";
        $message = "doveadm bulunamadi";
    } else {
        my @cmd;
        my $args_str = join(" ", @search_args);
        if ($atype eq "inbox_purge") {
            # Blacklist -> INBOX'tan sil
            @cmd = ($doveadm, "expunge", "-A", "mailbox", "INBOX", @search_args);
            log_msg("cmd: " . join(" ", @cmd));
            my $out = `$doveadm expunge -A mailbox INBOX $args_str 2>&1`;
            my $rc = $? >> 8;
            if ($rc == 0) {
                $message = "doveadm expunge ok";
                $affected = () = $out =~ /expunged/gi;
            } else {
                $result = "error";
                $message = "doveadm rc=$rc: " . substr($out, 0, 200);
            }
        } elsif ($atype eq "junk_to_inbox") {
            # Whitelist -> Junk klasorunden INBOX'a tasi
            # doveadm move [-A] destination-mailbox search-query
            # -A: tum kullanicilar; move: INBOX'a; search: Junk mailbox + FROM ...
            @cmd = ($doveadm, "move", "-A", "INBOX", "mailbox", "Junk", @search_args);
            log_msg("cmd: " . join(" ", @cmd));
            my $out = `$doveadm move -A INBOX mailbox Junk $args_str 2>&1`;
            my $rc = $? >> 8;
            # Bazi kurulumlarda "Junk" yerine "Spam" kullanilir; ilkinde bulamazsa dene
            if ($rc != 0 && $out =~ /No mailbox/i) {
                log_msg("Junk not found, trying Spam mailbox");
                $out = `$doveadm move -A INBOX mailbox Spam $args_str 2>&1`;
                $rc = $? >> 8;
            }
            if ($rc == 0) {
                $message = "doveadm move Junk->INBOX ok";
                $affected = () = $out =~ /moved|move/gi;
            } else {
                $result = "error";
                $message = "doveadm rc=$rc: " . substr($out, 0, 200);
            }
        }
    }

    # 3) Sonucu bildir
    my $notify = {
        license_key => $LICENSE,
        action_id => $aid,
        result => $result,
        message => "$atype | $message | affected~$affected",
    };
    my $r = $ua->post(
        "$SERVER/api/events/complete-action",
        Content_Type => "application/json",
        Content => encode_json($notify),
    );
    log_msg("complete $aid: " . ($r->is_success ? "ok" : $r->status_line));
}

exit 0;
