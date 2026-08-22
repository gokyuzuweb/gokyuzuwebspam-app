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
# v44.00.01 — Plugin sürümü: önce /etc/mailshield/plugin.version, sonra local API'den, en son fallback
my $version = '44.00.01';
# 1) install.sh yazdıysa VERSION dosyasından oku
for my $vfile ('/etc/mailshield/plugin.version',
               '/usr/local/mailshield/api/VERSION',
               '/opt/mailshield/api/VERSION') {
    if (open my $fh, '<', $vfile) {
        my $v = <$fh>; chomp $v; close $fh;
        $v =~ s/^v//i; $v =~ s/^\s+|\s+$//g;
        if ($v =~ /^\d+\.\d+/) { $version = $v; last; }
    }
}
# 2) Local API'den doğrula (en güncel)
eval {
    my $ua_v = LWP::UserAgent->new(timeout => 3);
    my $r = $ua_v->get('http://127.0.0.1:8001/api/version/panel');
    if ($r->is_success && $r->content =~ /"version"\s*:\s*"v?([\d.]+)"/) {
        $version = $1;
    }
};

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

# --- cPanel quarantine sync (her heartbeat'te) - MailScanner/Exim quarantine
_sync_cpanel_quarantine();

exit 0;

# ---------------------------------------------------------------------------
# _sync_cpanel_accounts — WHM API'sinden liste alıp panele push eder. Böylece
# admin panelindeki "Kullanıcılar" ekranı gerçek cPanel hesaplarını gösterir.
# whmapi1 mevcut değilse (dev/preview) sessizce çıkar.
sub _sync_cpanel_accounts {
    # Panel URL — /etc/mailshield/mailshield.conf'ta panel.url ile override
    my $panel_url = $conf{panel}{url}
                 || $ENV{MAILSHIELD_PANEL_URL}
                 || 'https://panel.gokyuzuhosting.com';
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

# ---------------------------------------------------------------------------
# _sync_cpanel_quarantine — MailScanner/Exim quarantine dizinini tarar ve
# gerçek karantinada bulunan mailleri panele push eder. Sadece son 24 saatte
# değişen dosyaları push eder (yeni kayıtlar), ki sürekli aynı şeyleri iletmesin.
#
# Kaynak dizinler (mevcut olanlar taranır):
#   /var/spool/MailScanner/quarantine/YYYYMMDD/<user>/message
#   /var/cpanel/quarantine
sub _sync_cpanel_quarantine {
    my $panel_url = $conf{panel}{url}
                 || $ENV{MAILSHIELD_PANEL_URL}
                 || 'https://panel.gokyuzuhosting.com';

    my @dirs = (
        '/var/spool/MailScanner/quarantine',
        '/var/cpanel/quarantine',
    );
    my @items;
    my $now = time();
    my $cutoff = $now - 86400;  # son 24 saat

    for my $base (@dirs) {
        next unless -d $base;
        # Non-recursive scan of top-level day/user dirs to avoid runaway walks
        opendir(my $dh, $base) or next;
        my @top = grep { !/^\./ } readdir($dh);
        closedir($dh);
        for my $t (@top) {
            my $tp = "$base/$t";
            next unless -d $tp;
            opendir(my $dh2, $tp) or next;
            my @sub = grep { !/^\./ } readdir($dh2);
            closedir($dh2);
            for my $s (@sub) {
                my $sp = "$tp/$s";
                if (-f $sp) {
                    # direct file in day dir
                    _add_quarantine_item(\@items, $sp, $cutoff);
                } elsif (-d $sp) {
                    # per-user subdir
                    opendir(my $dh3, $sp) or next;
                    my @files = grep { !/^\./ } readdir($dh3);
                    closedir($dh3);
                    for my $f (@files) {
                        _add_quarantine_item(\@items, "$sp/$f", $cutoff);
                        last if scalar(@items) >= 50;
                    }
                }
                last if scalar(@items) >= 50;
            }
            last if scalar(@items) >= 50;
        }
    }
    return unless @items;

    my $qreq = HTTP::Request->new(POST => "$panel_url/api/events/ingest-batch");
    $qreq->header('Content-Type' => 'application/json');
    # ingest-batch expects a raw list; ensure each item has the license_key
    for my $it (@items) { $it->{license_key} = $license_key; }
    $qreq->content(encode_json(\@items));
    my $r = $ua->request($qreq);
    open my $lf, '>>', '/var/log/mailshield/quarantine-sync.log';
    if ($lf) {
        print $lf scalar(gmtime())." · pushed " . scalar(@items) .
                  " quarantine items · code=" . $r->code . "\n";
        close $lf;
    }
    return scalar @items;
}

sub _add_quarantine_item {
    my ($items, $path, $cutoff) = @_;
    my @stat = stat($path);
    return unless @stat;
    return if $stat[9] < $cutoff;   # older than 24h
    return if $stat[7] < 200;       # too small
    return if $stat[7] > 10 * 1024 * 1024;  # >10MB, skip

    # Parse first 8KB to extract headers + optional first-body part
    open my $fh, '<', $path or return;
    my $blob = '';
    read($fh, $blob, 8192);
    close $fh;
    return unless $blob;

    my ($from) = $blob =~ /^From:\s*([^\r\n]+)/mi;
    my ($to)   = $blob =~ /^To:\s*([^\r\n]+)/mi;
    my ($subj) = $blob =~ /^Subject:\s*([^\r\n]+)/mi;
    my ($mid)  = $blob =~ /^Message-Id:\s*<([^>\r\n]+)>/mi;
    my ($xspam)= $blob =~ /^X-Spam-Score:\s*(-?\d+(?:\.\d+)?)/mi;
    my ($xrep) = $blob =~ /^X-Spam-Report:\s*([^\r\n]+)/mi;
    my $verdict = ($xspam && $xspam >= 10) ? 'high_spam'
                : ($xspam && $xspam >= 5)  ? 'spam'
                : 'blocked';

    # naive body extraction: after first blank line
    my $body_preview;
    if ($blob =~ /\r?\n\r?\n(.{1,2048})/s) {
        $body_preview = $1;
        $body_preview =~ s/\r//g;
    }

    push @$items, {
        exim_mid        => $mid,
        from_addr       => $from,
        to_addr         => $to,
        subject         => $subj,
        verdict         => $verdict,
        total_score     => ($xspam // 0) + 0,
        scores          => { spamassassin => ($xspam // 0) + 0,
                             sa_report    => (substr($xrep // '', 0, 400)) },
        body_preview    => $body_preview,
        headers_full    => substr($blob, 0, 4096),
        ts              => _iso_time($stat[9]),
        server_hostname => hostname(),
        server_ip       => $ip,
        source          => 'quarantine-spool',
    };
    return 1;
}

sub _iso_time {
    my ($epoch) = @_;
    my @t = gmtime($epoch);
    return sprintf("%04d-%02d-%02dT%02d:%02d:%02d+00:00",
                   $t[5]+1900, $t[4]+1, $t[3], $t[2], $t[1], $t[0]);
}

# ============================================================================
# v43.32 — plugin_demand_sync Polling Loop
# ============================================================================
# Master panelde "cPanel Kullanıcıları Çağır" tıklandığında backend
# `plugin_demand_sync:<license_key>` sinyalini `settings` collection'ına yazar.
# Heartbeat her 15dk'da bu sinyali sorgular. Sinyal varsa `whmapi1 listaccts`
# çalıştırıp master'a `/api/users/sync` ile gerçek cPanel hesap listesini push
# eder. Sonrasında `handled=true` işaretler.
#
# Aynı loop 3 sinyal tipini destekler:
#   plugin_demand_sync           → listaccts + push
#   plugin_demand_update         → gws-update çalıştır (bash script)
#   plugin_demand_milter_restart → systemctl restart gws-milter
#
# Backend GET endpoint: /api/plugin/pending-signals?license_key=<lic>
# Backend POST endpoint: /api/users/sync (payload: license_key + accounts[])
# ============================================================================

sub poll_and_handle_signals {
    my ($license_key, $center) = @_;
    return unless $license_key;
    my $ua = LWP::UserAgent->new(timeout => 15);
    my $r = $ua->get("$center/api/plugin/pending-signals?license_key=$license_key");
    return unless $r->is_success;
    my $signals = eval { decode_json($r->decoded_content) };
    return unless ref($signals) eq 'HASH' && $signals->{items};

    for my $sig (@{$signals->{items}}) {
        my $type = $sig->{signal_type} // '';
        my $sig_key = $sig->{_key} // '';
        eval {
            if ($type eq 'demand_sync') {
                _handle_demand_sync($license_key, $center, $ua);
            } elsif ($type eq 'demand_update') {
                system("gws-update > /var/log/gokyuzuwebspam/update.log 2>&1 &");
            } elsif ($type eq 'demand_milter_restart') {
                system("systemctl restart gws-milter 2>/dev/null || systemctl restart gws-logtail 2>/dev/null");
            }
        };
        # Ack sinyali handled=true olarak işaretle (backend ack endpoint)
        $ua->post("$center/api/plugin/signal-ack", 'Content-Type' => 'application/json',
                  Content => encode_json({ _key => $sig_key }));
    }
}

sub _handle_demand_sync {
    my ($license_key, $center, $ua) = @_;
    # whmapi1 listaccts
    my $whm = '/usr/local/cpanel/bin/whmapi1';
    return unless -x $whm;
    my $out = `$whm --output=json listaccts 2>/dev/null`;
    return unless $out;
    my $data = eval { decode_json($out) };
    return unless ref($data) eq 'HASH';
    my $accts = $data->{data}{acct} || [];
    my @payload_accts;
    for my $a (@$accts) {
        my $user = $a->{user} // '';
        next unless $user;
        push @payload_accts, {
            username           => $user,
            domain             => $a->{domain}   // '',
            email_count_today  => 0,
            spam_caught_today  => 0,
            quarantine_size    => 0,
        };
    }
    $ua->post("$center/api/users/sync", 'Content-Type' => 'application/json',
              Content => encode_json({
                  license_key => $license_key,
                  accounts    => \@payload_accts,
              }));
}

# Sinyal polling'i heartbeat cycle'ının sonunda çalıştır (ana loop yoktan sonra
# çağrılmalı — bu dosyanın son satırından hemen önce main sub'a bir çağrı
# ekleyin, veya cron/timer 15dk'da bu script'i çalıştırırken __END__'te değil
# main flow'da tetiklensin).
poll_and_handle_signals($license_key, $CENTER);

# ============================================================================
# v43.36 — Live User Auto-Sync
# ============================================================================
# heartbeat.pl her cycle'da (15dk) son push zamanını kontrol eder. Master'a
# gönderilen son sync 60dk'dan eski ise otomatik yeni listaccts push yapar.
# Böylece kullanıcı "cPanel Kullanıcıları Çağır" butonuna basmasa da Master
# panelinde Users sayfası saatlik olarak güncel kalır.
#
# State: /var/lib/gokyuzuwebspam/last-user-sync.txt (epoch)
# ============================================================================

sub auto_sync_users_if_stale {
    my ($license_key, $center) = @_;
    return unless $license_key;
    return unless -x '/usr/local/cpanel/bin/whmapi1';

    my $state_file = '/var/lib/gokyuzuwebspam/last-user-sync.txt';
    my $stale_after = 3600;  # 60 dakika

    # Son push zamanını oku
    my $last = 0;
    if (open(my $fh, '<', $state_file)) {
        chomp(my $line = <$fh> // '');
        $last = int($line) if $line =~ /^\d+$/;
        close($fh);
    }
    my $now = time();
    my $age = $now - $last;
    return if $age < $stale_after;  # Fresh — atla

    # Stale → push
    my $ua = LWP::UserAgent->new(timeout => 25);
    eval {
        _handle_demand_sync($license_key, $center, $ua);
    };
    if ($@) {
        warn "[auto-sync-users] failed: $@";
        return;
    }

    # State güncelle
    mkdir '/var/lib/gokyuzuwebspam' unless -d '/var/lib/gokyuzuwebspam';
    if (open(my $fh, '>', $state_file)) {
        print $fh $now;
        close($fh);
    }
    return 1;
}

auto_sync_users_if_stale($license_key, $CENTER);




# ============================================================================
# v43.38 — EXIM LOG TAILER (no-milter outbound push)
# ---------------------------------------------------------------------------
# /var/log/exim_mainlog dosyasının son okunan pozisyonundan itibaren yeni
# satırları parse eder ve GökyüzüWebSpam panel'ine POST eder. Böylece bayi
# ayrıca mailshield-milter veya mailshield-logtail servisini kurmasa dahi
# heartbeat cycle'ında (15dk) outbound mail'ler master paneline yansır.
#
# Panel URL: settings.panel.url veya MAILSHIELD_PANEL_URL env veya default.
# Endpoint: POST /api/outbound/exim-log-push
# Checkpoint: GET /api/outbound/exim-log-checkpoint?license_key=<lic>
# ============================================================================

sub push_exim_log_delta {
    my ($license_key, $panel_url) = @_;
    return unless $license_key;
    my $LOG = '/var/log/exim_mainlog';
    return unless -r $LOG;
    my @stat = stat($LOG);
    return unless @stat;
    my $file_size = $stat[7];

    my $ua = LWP::UserAgent->new(timeout => 20);

    # 1) Son okunan pozisyonu master'dan öğren
    my $last_pos = 0;
    eval {
        my $r = $ua->get("$panel_url/api/outbound/exim-log-checkpoint?license_key=$license_key");
        if ($r->is_success) {
            my $d = decode_json($r->decoded_content);
            $last_pos = int($d->{last_position} // 0);
        }
    };

    # Dosya küçüldüyse (rotate) pozisyonu sıfırla
    $last_pos = 0 if $last_pos > $file_size;

    # 2) Yeni satırları oku
    open(my $fh, '<', $LOG) or return;
    seek($fh, $last_pos, 0) or return;
    my @new_events;
    my %in_flight;  # exim_mid → partial info
    my $bytes_read = 0;
    while (my $line = <$fh>) {
        $bytes_read = tell($fh) - $last_pos;
        last if @new_events >= 500;  # per-cycle üst sınır
        chomp $line;
        # Exim mainlog format:
        #   2026-08-15 14:34:56 1uHqCk-000123-A2 <= sender@x.com H=... U=user P=esmtp S=12345 T="Subject"
        #   2026-08-15 14:34:57 1uHqCk-000123-A2 => recipient@y.com R=dnslookup T=remote_smtp
        next unless $line =~ /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+([\w-]+)\s+(<=|=>|->|\*\*|==)\s+(.+)$/;
        my ($ts, $mid, $direction, $rest) = ($1, $2, $3, $4);
        $ts =~ s/ /T/; $ts .= "+00:00";

        if ($direction eq '<=') {
            # Inbound to Exim — capture sender + user
            my ($sender) = $rest =~ /^(\S+)/;
            my ($user)   = $rest =~ /U=(\S+)/;
            my ($size)   = $rest =~ /S=(\d+)/;
            my ($subj)   = $rest =~ /T="([^"]+)"/;
            $in_flight{$mid} = {
                ts => $ts, from_addr => $sender, from_user => $user // '',
                size_bytes => int($size // 0), subject => $subj // '',
            };
        } elsif ($direction eq '=>' || $direction eq '->') {
            # Delivered / forwarded
            my ($rcpt) = $rest =~ /^(\S+)/;
            next unless $rcpt;
            my $meta = $in_flight{$mid} || {};
            # Local user göndermişse OUTBOUND kabul et
            my $is_outbound = defined($meta->{from_user}) && length($meta->{from_user}) > 0;
            # Eğer U=user kaydı elimizde yoksa, sender'ı yerel domain listesiyle kontrol et
            if (!$is_outbound) {
                my $sender = $meta->{from_addr} || '';
                if ($sender && $sender ne '<>' && open(my $ud, '<', '/etc/userdomains')) {
                    while (my $l = <$ud>) {
                        if ($l =~ /^(\S+):/) {
                            my $d = $1;
                            if (index($sender, "\@$d") >= 0) { $is_outbound = 1; last; }
                        }
                    }
                    close($ud);
                }
            }
            next unless $is_outbound;
            # v43.40 — X-Spam-Score & X-Spam-Status enrichment (spool -H file)
            my ($score, $verdict, $sa_report) = _read_exim_spool_verdict($mid);
            push @new_events, {
                exim_mid   => $mid,
                ts         => $meta->{ts} || $ts,
                from_addr  => $meta->{from_addr} || '',
                from_user  => $meta->{from_user} || '',
                to_addr    => $rcpt,
                subject    => $meta->{subject} || '',
                size_bytes => $meta->{size_bytes} || 0,
                verdict    => $verdict,
                total_score=> $score,
                scores     => { spamassassin => $score },
                sa_report  => $sa_report,
                action     => ($verdict eq 'blocked' ? 'reject'
                              : $verdict eq 'high_spam' ? 'quarantine'
                              : $verdict eq 'spam' ? 'quarantine' : 'accept'),
            };
        } elsif ($direction eq '**' || $direction eq '==') {
            # Bounced / defer
            my ($rcpt) = $rest =~ /^(\S+)/;
            my $meta = $in_flight{$mid} || {};
            next unless $rcpt && $meta->{from_user};
            push @new_events, {
                exim_mid   => $mid,
                ts         => $meta->{ts} || $ts,
                from_addr  => $meta->{from_addr} || '',
                from_user  => $meta->{from_user} || '',
                to_addr    => $rcpt,
                subject    => $meta->{subject} || '',
                size_bytes => $meta->{size_bytes} || 0,
                verdict    => 'clean',
                total_score=> 0,
                action     => ($direction eq '**' ? 'bounce' : 'defer'),
            };
        }
    }
    my $new_pos = tell($fh);
    close($fh);
    return 0 unless @new_events;

    # 3) Panel'e push
    my $payload = encode_json({
        license_key         => $license_key,
        hostname            => hostname(),
        server_ip           => $ip,
        events              => \@new_events,
        checkpoint_position => $new_pos,
    });
    my $req = HTTP::Request->new(POST => "$panel_url/api/outbound/exim-log-push");
    $req->header('Content-Type' => 'application/json');
    $req->content($payload);
    my $r = $ua->request($req);
    open my $lf, '>>', '/var/log/mailshield/exim-tail.log';
    if ($lf) {
        print $lf scalar(gmtime()) . " · pushed " . scalar(@new_events)
                . " events · pos=$new_pos · code=" . $r->code . "\n";
        close $lf;
    }
    return scalar @new_events;
}

# Aktifleştir — panel_url conf veya default
my $panel_url = $conf{panel}{url}
             || $ENV{MAILSHIELD_PANEL_URL}
             || 'https://panel.gokyuzuhosting.com';
eval { push_exim_log_delta($license_key, $panel_url); };
warn "[exim-tail] failed: $@" if $@;

# ============================================================================
# v43.40 — Verdict Enrichment helper
# ---------------------------------------------------------------------------
# Exim spool içindeki -H başlık dosyasını okuyarak X-Spam-Score / X-Spam-Status
# / X-Spam-Report değerlerini çıkarır. Skor >= 5.0 → spam, >= 10 → high_spam.
# Dosya yolları:
#   /var/spool/exim/input/{split}/{mid}-H
#   /var/spool/mailscanner/input/{mid}-H (MailScanner spool'a taşıdıysa)
# Not: Mail gönderim tamamlanınca spool silinir. O yüzden bu fonksiyon sadece
# heartbeat cycle'ı sırasında hala işlemde olan (recent) mailler için değer
# döner; eski maillerde skor 0/clean kalır (o zaman zaten SA header'ı Exim
# main log'a düşmemiş olur).
# ============================================================================

sub _read_exim_spool_verdict {
    my ($mid) = @_;
    return (0, 'clean', '') unless $mid;
    my @candidates = (
        "/var/spool/exim/input/" . substr($mid, 5, 1) . "/$mid-H",
        "/var/spool/exim/input/$mid-H",
        "/var/spool/mailscanner/input/$mid-H",
        "/var/spool/mailscanner/incoming/$mid-H",
    );
    my $spool;
    for my $p (@candidates) {
        if (-r $p) { $spool = $p; last; }
    }
    return (0, 'clean', '') unless $spool;

    open(my $fh, '<', $spool) or return (0, 'clean', '');
    my $score = 0.0;
    my $status = '';
    my $report = '';
    my $capture_report = 0;
    while (my $l = <$fh>) {
        last if length($report) > 800;
        if ($l =~ /^X-Spam-Score:\s*(-?\d+(?:\.\d+)?)/i) {
            $score = $1 + 0;
        } elsif ($l =~ /^X-Spam-Status:\s*(.+)$/i) {
            $status = $1;
            $status =~ s/[\r\n]+$//;
            if ($status =~ /score=(-?\d+(?:\.\d+)?)/i) { $score = $1 + 0 if !$score; }
        } elsif ($l =~ /^X-Spam-Report:\s*(.+)$/i) {
            $report = $1;
            $capture_report = 1;
        } elsif ($capture_report && $l =~ /^\s+(\S.+)$/) {
            $report .= " " . $1;
        } elsif ($capture_report && $l !~ /^\s/) {
            $capture_report = 0;
        }
    }
    close($fh);

    my $verdict = 'clean';
    if ($score >= 15) { $verdict = 'blocked'; }
    elsif ($score >= 10) { $verdict = 'high_spam'; }
    elsif ($score >= 5) { $verdict = 'spam'; }
    elsif ($score >= 3) { $verdict = 'suspicious'; }
    return ($score, $verdict, substr($report, 0, 400));
}

# ============================================================================
# v43.40 — Backfill: son 24 saatlik Exim main log'u tara ve tüm outbound
# olayları panele push et. Master panel bir sinyal yazdığında (settings)
# heartbeat.pl bu fonksiyonu çağırır. checkpoint_position'ı sıfırlar.
# ============================================================================

sub run_exim_backfill_24h {
    my ($license_key, $panel_url) = @_;
    return unless $license_key;
    my $LOG = '/var/log/exim_mainlog';
    return unless -r $LOG;
    my $ua = LWP::UserAgent->new(timeout => 60);

    # Checkpoint sıfırla — panel side
    # (basitçe: push endpoint checkpoint_position=0 ile çağırdığımızda son
    # position bilgisi güncellenir; ancak upsert idempotent olduğu için
    # duplicate risk yok.)
    open(my $fh, '<', $LOG) or return;
    my $cutoff = time() - 86400;
    my @batch;
    my %in_flight;
    my $total_pushed = 0;
    while (my $line = <$fh>) {
        chomp $line;
        next unless $line =~ /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\s+([\w-]+)\s+(<=|=>|->|\*\*|==)\s+(.+)$/;
        my ($date, $time, $mid, $direction, $rest) = ($1, $2, $3, $4, $5);
        # Kaba zaman filtresi — GMT olarak varsayıyoruz
        my $ts = "${date}T${time}+00:00";
        # ISO'dan epoch'a
        my @dt = split(/[-T:+]/, $ts);
        my $epoch = eval {
            use Time::Local;
            timegm($dt[5], $dt[4], $dt[3], $dt[2], $dt[1]-1, $dt[0]);
        } // 0;
        next if $epoch && $epoch < $cutoff;

        if ($direction eq '<=') {
            my ($sender) = $rest =~ /^(\S+)/;
            my ($user)   = $rest =~ /U=(\S+)/;
            my ($size)   = $rest =~ /S=(\d+)/;
            my ($subj)   = $rest =~ /T="([^"]+)"/;
            $in_flight{$mid} = {
                ts => $ts, from_addr => $sender, from_user => $user // '',
                size_bytes => int($size // 0), subject => $subj // '',
            };
        } elsif ($direction eq '=>' || $direction eq '->') {
            my ($rcpt) = $rest =~ /^(\S+)/;
            my $meta = $in_flight{$mid} || {};
            next unless $rcpt && $meta->{from_user};
            my ($score, $verdict, $sa_report) = _read_exim_spool_verdict($mid);
            push @batch, {
                exim_mid   => $mid,
                ts         => $meta->{ts} || $ts,
                from_addr  => $meta->{from_addr} || '',
                from_user  => $meta->{from_user} || '',
                to_addr    => $rcpt,
                subject    => $meta->{subject} || '',
                size_bytes => $meta->{size_bytes} || 0,
                verdict    => $verdict,
                total_score=> $score,
                scores     => { spamassassin => $score },
                sa_report  => $sa_report,
                action     => ($verdict eq 'clean' ? 'accept' : 'quarantine'),
            };
            # 200'lük batch'lerle push
            if (scalar(@batch) >= 200) {
                _push_batch($ua, $panel_url, $license_key, \@batch);
                $total_pushed += scalar(@batch);
                @batch = ();
            }
        }
    }
    close($fh);
    if (@batch) {
        _push_batch($ua, $panel_url, $license_key, \@batch);
        $total_pushed += scalar(@batch);
    }
    open my $lf, '>>', '/var/log/mailshield/exim-tail.log';
    if ($lf) {
        print $lf scalar(gmtime()) . " · BACKFILL 24h pushed $total_pushed events\n";
        close $lf;
    }
    return $total_pushed;
}

sub _push_batch {
    my ($ua, $panel_url, $license_key, $events) = @_;
    return unless @$events;
    my $payload = encode_json({
        license_key => $license_key,
        hostname    => hostname(),
        server_ip   => $ip,
        events      => $events,
    });
    my $req = HTTP::Request->new(POST => "$panel_url/api/outbound/exim-log-push");
    $req->header('Content-Type' => 'application/json');
    $req->content($payload);
    return $ua->request($req);
}

# Backfill sinyali kontrol et (master panel butonundan tetiklenir)
eval {
    my $sig_ua = LWP::UserAgent->new(timeout => 10);
    my $sig_r = $sig_ua->get("$panel_url/api/outbound/backfill-signal?license_key=$license_key");
    if ($sig_r->is_success) {
        my $sig = decode_json($sig_r->decoded_content);
        if ($sig->{pending}) {
            warn "[backfill] running 24h backfill (requested at $sig->{requested_at})\n";
            my $total = run_exim_backfill_24h($license_key, $panel_url) || 0;
            # ACK
            $sig_ua->post("$panel_url/api/outbound/backfill-ack",
                'Content-Type' => 'application/json',
                Content => encode_json({ license_key => $license_key, pushed => $total }));
        }
    }
};
