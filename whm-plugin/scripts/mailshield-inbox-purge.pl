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
    # v44.00.51 — 3 action tipi: inbox_purge (BL), junk_to_inbox (WL), move_to_junk (proaktif spam)
    next unless $atype eq "inbox_purge" || $atype eq "junk_to_inbox" || $atype eq "move_to_junk";
    my $aid = $action->{id};
    my $m = $action->{match} or next;
    my $since_days = $m->{since_days} || 30;
    my $et = $m->{entry_type} || "";
    my $val = $m->{value} || "";
    # v44.00.51 — move_to_junk icin recipient + message_id kullanilir
    my $recipient = $m->{recipient} || "";
    my $message_id = $m->{message_id} || "";
    my $msg_from = $m->{from_addr} || "";
    my $msg_subj = $m->{subject} || "";

    log_msg("processing $aid: type=$atype " .
            ($atype eq "move_to_junk" ? "recipient=$recipient msgid=$message_id" : "$et=$val since ${since_days}d"));

    # doveadm search kriteri olustur
    my @search_args;
    if ($atype eq "move_to_junk") {
        # Tek mesaj hedef — Message-Id > exim_mid > from+subject fallback
        if ($message_id) {
            push @search_args, "HEADER", "Message-Id", $message_id;
        } elsif ($msg_from && $msg_subj) {
            push @search_args, "FROM", $msg_from, "SUBJECT", $msg_subj;
        } else {
            log_msg("skip $aid: no match criteria");
            next;
        }
    } elsif ($et eq "email") {
        push @search_args, "FROM", $val;
    } elsif ($et eq "domain") {
        push @search_args, "FROM", "\@$val";
    } elsif ($et eq "ip") {
        push @search_args, "HEADER", "Received", $val;
    }
    if ($atype ne "move_to_junk") {
        push @search_args, "SINCE", "${since_days}d";
    } else {
        # Son 1 gunde (yeni gelen mail)
        push @search_args, "SINCE", "1d";
    }

    my $result = "ok";
    my $message = "";
    my $affected = 0;

    unless (-x $doveadm) {
        $result = "error";
        $message = "doveadm bulunamadi";
    } else {
        my @cmd;
        my $args_str = join(" ", map { /\s/ ? "\"$_\"" : $_ } @search_args);
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
            @cmd = ($doveadm, "move", "-A", "INBOX", "mailbox", "Junk", @search_args);
            log_msg("cmd: " . join(" ", @cmd));
            my $out = `$doveadm move -A INBOX mailbox Junk $args_str 2>&1`;
            my $rc = $? >> 8;
            # Junk bulunamazsa Spam mailbox dene
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
        } elsif ($atype eq "move_to_junk") {
            # v44.00.51 — Proaktif: gelen SPAM verdict'li tek mesaji INBOX->Junk
            # -u ile spesifik kullanici (recipient), -A yerine (butun account'lari
            # taramamak icin performans).
            my @user_args = $recipient ? ("-u", $recipient) : ("-A");
            @cmd = ($doveadm, "move", @user_args, "Junk", "mailbox", "INBOX", @search_args);
            log_msg("cmd: " . join(" ", @cmd));
            my $user_flag = $recipient ? "-u \"$recipient\"" : "-A";
            my $out = `$doveadm move $user_flag Junk mailbox INBOX $args_str 2>&1`;
            my $rc = $? >> 8;
            # Bazi kurulumlarda hedef "Junk" yerine "Spam" — deneyip fail ederse
            if ($rc != 0 && $out =~ /No mailbox|does not exist/i) {
                log_msg("Junk mailbox not found for $recipient, trying Spam");
                $out = `$doveadm move $user_flag Spam mailbox INBOX $args_str 2>&1`;
                $rc = $? >> 8;
                # Yine yoksa Junk mailbox olustur
                if ($rc != 0 && $out =~ /No mailbox|does not exist/i) {
                    log_msg("Creating Junk mailbox for $recipient");
                    `$doveadm mailbox create $user_flag Junk 2>&1`;
                    $out = `$doveadm move $user_flag Junk mailbox INBOX $args_str 2>&1`;
                    $rc = $? >> 8;
                }
            }
            if ($rc == 0) {
                $message = "doveadm move INBOX->Junk ok";
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
