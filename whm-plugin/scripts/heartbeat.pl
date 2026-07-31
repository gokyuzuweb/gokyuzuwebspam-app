#!/usr/bin/env perl
#
# GokyuzuWebSpam — Lisans Heartbeat Daemon
#
# WHM sunucusunda systemd timer ile 15 dakikada bir çalışır. Merkez lisans
# sunucusuna aşağıdaki bilgileri gönderir:
#   { license_key, ip, hostname, version, cpanel_version, active_domains }
#
# Yanıtlar:
#   200 → normal çalışma
#   403 → lisans ihlali; plugin_state güncellenir ve gate aktifleşir
#
# Yerel plugin_state kayıtları /etc/mailshield/plugin_state.json'a düşer.
#

use strict;
use warnings;
use JSON::XS;
use LWP::UserAgent;
use Sys::Hostname;
use File::Slurp qw();

my $CONF   = '/etc/mailshield/mailshield.conf';
my $STATE  = '/etc/mailshield/plugin_state.json';
# License server URL — bayi (satıcı) tarafından /etc/mailshield/mailshield.conf'ta
# license.server_url ile override edilebilir. Prod'da:
#   https://license.gokyuzuwebspam.com
# Preview/self-hosted'da satıcının kendi backend'i port 8002'de:
my $CENTER = $ENV{MAILSHIELD_LICENSE_SERVER} // 'https://license.gokyuzuwebspam.com';
my $LOCAL  = 'http://127.0.0.1:8001';

# --- config oku
my %conf;
if (open my $fh, '<', $CONF) {
    my $sec = 'main';
    while (my $l = <$fh>) {
        $l =~ s/[\r\n#].*$//; $l =~ s/^\s+|\s+$//g;
        next unless length $l;
        if ($l =~ /^\[(.+)\]$/) { $sec = $1; next; }
        if ($l =~ /^([\w.-]+)\s*=\s*(.*)$/) { $conf{$sec}{$1} = $2; }
    }
    close $fh;
}

my $license_key = $conf{license}{key} // '';
my $version     = '1.1.0';

# --- IP tespiti (birden çok kaynak)
sub detect_ip {
    for my $svc ("https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com") {
        my $ua = LWP::UserAgent->new(timeout => 5);
        my $r = $ua->get($svc);
        if ($r->is_success) {
            my $ip = $r->decoded_content;
            $ip =~ s/\s+//g;
            return $ip if $ip =~ /^\d+\.\d+\.\d+\.\d+$/;
        }
    }
    return '';
}

# --- Aktif domain sayısı
sub active_domains {
    my $count = 0;
    if (open my $fh, '<', '/etc/userdomains') {
        while (<$fh>) { $count++ if /^\S+:\s+\S+/; }
        close $fh;
    }
    return $count;
}

# --- cPanel sürümü
sub cpanel_version {
    if (open my $fh, '<', '/usr/local/cpanel/version') {
        my $v = <$fh>; chomp $v; close $fh;
        return $v;
    }
    return '';
}

# --- Config override for license server URL
$CENTER = $conf{license}{server_url} if $conf{license}{server_url};

my $ip = detect_ip();
my $payload = encode_json({
    license_key      => $license_key,
    server_ip        => $ip,
    hostname         => hostname(),
    plugin_version   => $version,
    engines_active   => [],
    scanned_last_hour => 0,
});

# --- Merkez heartbeat (v1: /v1/heartbeat)
my $ua  = LWP::UserAgent->new(timeout => 15);
my $req = HTTP::Request->new(POST => "$CENTER/v1/heartbeat");
$req->header('Content-Type' => 'application/json');
$req->content($payload);
my $res = $ua->request($req);

my $state = { last_heartbeat_at => scalar(gmtime()) . " UTC",
              last_ip => $ip, last_code => $res->code,
              license_server => $CENTER };

if ($res->is_success) {
    my $d = eval { decode_json($res->content) };
    if ($d && $d->{ok}) {
        $state->{ok}              = JSON::XS::true;
        $state->{status}          = $d->{status};
        $state->{valid_until}     = $d->{valid_until};
        $state->{latest_version}  = $d->{latest_version};
        # local API'ye de bildirelim
        my $lreq = HTTP::Request->new(POST => "$LOCAL/api/plugin/verify-license");
        $lreq->header('Content-Type' => 'application/json');
        $lreq->content(encode_json({ license_key => $license_key, ip => $ip }));
        $ua->request($lreq);
    } elsif ($d && !$d->{ok}) {
        $state->{ok}        = JSON::XS::false;
        $state->{status}    = $d->{status};
        $state->{violation} = { reason => $d->{status}, message => $d->{message} };
        warn "License violation: " . ($d->{message} // 'unknown') . "\n";
        open my $f, '>>', '/var/log/mailshield/violation.log' or last;
        print $f scalar(gmtime()) . " · " . encode_json($state->{violation}) . "\n";
        close $f;
    }
} else {
    $state->{error} = $res->status_line;
    warn "Heartbeat failed: " . $res->status_line . "\n";
}

# --- Local state dosyasına yaz
open my $sf, '>', $STATE or die "cannot write $STATE: $!";
print $sf encode_json($state);
close $sf;

# --- cPanel accounts sync (her heartbeat'te) - GERÇEK kullanıcıları push et
_sync_cpanel_accounts();

exit 0;

# ---------------------------------------------------------------------------
# _sync_cpanel_accounts — WHM API'sinden liste alıp panele push eder. Böylece
# admin panelindeki "Kullanıcılar" ekranı gerçek cPanel hesaplarını gösterir.
# whmapi1 mevcut değilse (dev/preview) sessizce çıkar.
sub _sync_cpanel_accounts {
    # Panel URL — /etc/mailshield/mailshield.conf'ta panel.url ile override
    my $panel_url = $conf{panel}{url}
                 || $ENV{MAILSHIELD_PANEL_URL}
                 || 'https://mailscanner-pro.preview.emergentagent.com';
    my $listaccts = '/usr/local/cpanel/bin/whmapi1';
    return unless -x $listaccts;

    my $json_out = `$listaccts --output=json listaccts 2>/dev/null`;
    return unless $json_out;
    my $data = eval { decode_json($json_out) };
    return unless $data && ref($data->{data}) eq 'HASH';
    my $accts = $data->{data}{acct} || [];
    return unless ref($accts) eq 'ARRAY' && @$accts;

    my @out;
    for my $a (@$accts) {
        my $user   = $a->{user} || next;
        my $domain = $a->{domain} || '';
        # Best-effort: mail count today via dovecot statistics (skip if unavailable)
        my $mail_today  = 0;
        my $spam_today  = 0;
        my $q_size      = 0;
        # dovecot: sadece varsa
        if (-x '/usr/sbin/dovecot' && $user) {
            my $stat = `/usr/sbin/dovecot who -1 2>/dev/null | grep -c "^$user"`;
            chomp $stat; $mail_today = ($stat =~ /^\d+$/) ? $stat + 0 : 0;
        }
        push @out, {
            username         => $user,
            domain           => $domain,
            email_count_today => $mail_today,
            spam_caught_today => $spam_today,
            quarantine_size   => $q_size,
            disk_used         => $a->{diskused},
            plan              => $a->{plan},
            suspended         => ($a->{suspended} ? \1 : \0),
        };
    }
    return unless @out;
    my $sync_req = HTTP::Request->new(POST => "$panel_url/api/users/sync");
    $sync_req->header('Content-Type' => 'application/json');
    $sync_req->content(encode_json({
        license_key => $license_key,
        accounts    => \@out,
    }));
    my $r = $ua->request($sync_req);
    if ($r->is_success) {
        open my $lf, '>>', '/var/log/mailshield/user-sync.log';
        if ($lf) { print $lf scalar(gmtime())." · pushed " . scalar(@out) . " accounts · " . $r->content . "\n"; close $lf; }
    } else {
        warn "user-sync failed: " . $r->status_line . "\n";
    }
    return scalar @out;
}
