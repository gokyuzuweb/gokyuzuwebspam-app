#!/usr/local/cpanel/3rdparty/bin/perl
#
# GokyuzuWebSpam - WHM CGI proxy + self-update + cluster badge
#

use strict;
use warnings;
use lib '/usr/local/cpanel';
use Whostmgr::ACLS          ();
use Whostmgr::HTMLInterface ();
use LWP::UserAgent          ();
use HTTP::Request           ();
use JSON::PP                ();

Whostmgr::ACLS::init_acls();
unless (Whostmgr::ACLS::hasroot()) {
    print "Content-type: text/html; charset=utf-8\r\n\r\n";
    print "<h1>Access denied</h1>";
    exit 0;
}

my $api    = $ENV{MAILSHIELD_API} // 'http://127.0.0.1:8001';
my $public = $ENV{MAILSHIELD_PUBLIC} // 'https://panel.gokyuzuhosting.com';

# Master license key — WHM'e sadece root erişebilir, iframe'e query parametre
# olarak geçilerek tarayıcı localStorage'ına yazılır (master otomatik tanıma).
my $master_key = $ENV{MAILSHIELD_MASTER_KEY} // '';
if (!$master_key) {
    # backend.env'den otomatik oku (fallback)
    my $env_file = '/opt/gokyuzuwebspam-app/deployment/backend.env';
    if (open my $fh, '<', $env_file) {
        while (my $line = <$fh>) {
            chomp $line;
            if ($line =~ /^MASTER_LICENSE_KEY\s*=\s*(.+?)\s*$/) {
                $master_key = $1;
                $master_key =~ s/^["']|["']$//g;
                last;
            }
        }
        close $fh;
    }
}
my $pinfo  = $ENV{PATH_INFO} // '';
my $qs     = $ENV{QUERY_STRING} // '';

# ---- Self-update endpoint (query string based - PATH_INFO daha az guvenilir) ----
# URL: /cgi/mailshield/index.cgi?action=self-update
# v43.18 — SIRA DEĞİŞTİ: Önce git pull + docker rebuild → SONRA taze tarball
# v43.19 — Tarball yapısı fallback: hem `gokyuzuwebspam/` prefix hem `backend/` prefix
#          hem prefix'siz düz layout destekleniyor. auto-update.sh her durumda çalışır
#          (extract fail olsa bile), böylece stale-tarball döngüsünden çıkılabilir.
if ($qs =~ /(?:^|&)action=self-update(?:&|$)/ || $pinfo eq '/self-update') {
    my @actions;
    my @errors;
    my $tmp_tgz = "/tmp/gws-selfupdate-$$.tar.gz";
    my $tmp_dir = "/tmp/gws-selfupdate-$$";

    # 1) FAZ-1: auto-update.sh (git pull + docker rebuild) — backend güncellenir
    # HER DURUMDA çalışsın (extract fail olsa bile). Sadece bu adım fail ederse skip.
    my $update_script = "/opt/gokyuzuwebspam-app/deployment/auto-update.sh";
    if (-x $update_script) {
        my $out = `bash $update_script 2>&1`;
        my $rc = $? >> 8;
        if ($rc == 0) {
            push @actions, "phase-1: git pull + docker rebuild OK (backend guncellendi)";
        } else {
            # Fail olsa bile @errors'a EKLEME — sadece uyarı ekle, tarball indirmeye devam
            push @actions, "phase-1: docker-update warning (rc=$rc): " . substr($out, 0, 200);
        }
        sleep(5);
    } else {
        push @actions, "phase-1: auto-update.sh bulunamadi (skip)";
    }

    # 2) FAZ-2: Artik TAZE backend'den tarball indir
    system("curl -sS --max-time 30 -o $tmp_tgz '$public/api/plugin/download'");
    unless (-s $tmp_tgz) {
        push @errors, "Tarball indirilemedi ($public/api/plugin/download)";
    }

    # 3) FAZ-3: Extract — birden fazla layout dene
    my $tarball_root = '';   # extracted plugin root (mailshield.cgi/whm alt dizinini içeriyor)
    unless (@errors) {
        mkdir $tmp_dir;
        # Önce --strip-components=1 dene (gokyuzuwebspam/... prefix)
        system("tar -xzf $tmp_tgz -C $tmp_dir --strip-components=1 2>/dev/null");
        if (-d "$tmp_dir/scripts" && -f "$tmp_dir/whm/mailshield.cgi") {
            $tarball_root = $tmp_dir;
            push @actions, "extract: layout=plugin-root (strip=1)";
        } else {
            # 2. deneme: prefix'siz (root'ta scripts/, whm/ direkt)
            system("rm -rf $tmp_dir && mkdir $tmp_dir");
            system("tar -xzf $tmp_tgz -C $tmp_dir 2>/dev/null");
            if (-d "$tmp_dir/scripts" && -f "$tmp_dir/whm/mailshield.cgi") {
                $tarball_root = $tmp_dir;
                push @actions, "extract: layout=flat";
            } else {
                # 3. deneme: whm-plugin/ prefix (yeni format)
                if (-d "$tmp_dir/whm-plugin/scripts" && -f "$tmp_dir/whm-plugin/whm/mailshield.cgi") {
                    $tarball_root = "$tmp_dir/whm-plugin";
                    push @actions, "extract: layout=whm-plugin-subdir";
                }
                # 4. deneme: whole-project prefix'li (backend/ vs) → whm-plugin/ alt dizinini ara
                elsif (-d "$tmp_dir/whm-plugin" || -d "$tmp_dir/plugin") {
                    my $sub = -d "$tmp_dir/whm-plugin" ? "$tmp_dir/whm-plugin" : "$tmp_dir/plugin";
                    if (-d "$sub/scripts" && -f "$sub/whm/mailshield.cgi") {
                        $tarball_root = $sub;
                        push @actions, "extract: layout=project-subdir";
                    }
                }
            }
        }
        unless ($tarball_root) {
            push @errors, "Tarball extract basarisiz veya beklenen icerik yok. Deneyin: docker container'lari yeniden baslatildi, taze tarball icin sayfayi yenileyip tekrar Guncelle basin.";
        }
    }

    # 4) FAZ-4: Refresh key files (only if extraction succeeded)
    if (@errors == 0 && $tarball_root) {
        my @files = (
            # [src_rel, dst_abs, mode]
            ['scripts/mailshield-logtail.pl', '/usr/local/mailshield/bin/mailshield-logtail.pl', '0755'],
            ['scripts/mailshield-milter.pl',  '/usr/local/mailshield/bin/mailshield-milter.pl',  '0755'],
            ['scripts/heartbeat.pl',          '/usr/local/mailshield/bin/heartbeat.pl',          '0755'],
            # v43.16 — Milter Perl kütüphaneleri (body ingest kodu bunlarda)
            ['lib/SpamGuard/Milter.pm',       '/usr/local/mailshield/lib/SpamGuard/Milter.pm',  '0644'],
            ['lib/SpamGuard/Engines.pm',      '/usr/local/mailshield/lib/SpamGuard/Engines.pm', '0644'],
            ['lib/SpamGuard/Config.pm',       '/usr/local/mailshield/lib/SpamGuard/Config.pm',  '0644'],
            ['whm/mailshield.cgi',            '/usr/local/cpanel/whostmgr/docroot/cgi/mailshield/index.cgi', '0755'],
            ['whm/mailshield.tmpl',           '/usr/local/cpanel/whostmgr/docroot/cgi/mailshield/mailshield.tmpl', '0644'],
            # v43.14 — appconfig'i de kopyala (target=_top gibi değişiklikleri yayınlar)
            ['appconfig/mailshield.conf',     '/var/cpanel/apps/mailshield.conf', '0644'],
        );
        for my $f (@files) {
            my ($rel, $dst, $mode) = @$f;
            my $src = "$tarball_root/$rel";
            next unless -f $src;
            my $r = system("install -m $mode -o root -g root '$src' '$dst'");
            if ($r == 0) { push @actions, "updated: $dst"; }
            else         { push @errors, "install failed: $dst"; }
        }
        # v43.14 — appconfig değiştiyse WHM'e re-register et (target=_top vb. yayınlansın)
        my $rc_reg = system("/usr/local/cpanel/bin/register_appconfig /var/cpanel/apps/mailshield.conf >/dev/null 2>&1");
        if (($rc_reg >> 8) == 0) {
            push @actions, "reregistered: mailshield appconfig (target=_top)";
        } else {
            push @errors, "register_appconfig failed (rc=" . ($rc_reg >> 8) . ")";
        }
        # Restart logtail so new Perl code takes effect
        if (system("systemctl is-active --quiet mailshield-logtail.service") == 0) {
            system("systemctl restart mailshield-logtail.service");
            push @actions, "restarted: mailshield-logtail.service";
        } else {
            system("systemctl enable --now mailshield-logtail.service 2>/dev/null");
            push @actions, "started: mailshield-logtail.service";
        }
        # v43.16 — mailshield-milter'i de yeniden başlat (yeni body ingest kodu için)
        if (system("systemctl is-active --quiet mailshield-milter.service") == 0) {
            system("systemctl restart mailshield-milter.service");
            push @actions, "restarted: mailshield-milter.service (body ingest active)";
        } elsif (-f "/etc/systemd/system/mailshield-milter.service") {
            system("systemctl enable --now mailshield-milter.service 2>/dev/null");
            push @actions, "started: mailshield-milter.service";
        }
    }

    # 5) Cleanup
    system("rm -rf $tmp_tgz $tmp_dir");

    print "Content-type: application/json; charset=utf-8\r\n\r\n";
    print JSON::PP::encode_json({
        ok      => (scalar(@errors) ? \0 : \1),
        actions => \@actions,
        errors  => \@errors,
    });
    exit 0;
}

# ---- Passthrough API routing (SPA -> local FastAPI, WHM auth validated) ----
if ($pinfo =~ m{^/api/}) {
    my $ua     = LWP::UserAgent->new(timeout => 20);
    my $method = $ENV{REQUEST_METHOD} // 'GET';
    my $body   = do { local $/; <STDIN> } // '';
    my $url    = $api . $pinfo;
    $url .= '?' . $ENV{QUERY_STRING} if $ENV{QUERY_STRING};
    my $req    = HTTP::Request->new($method => $url);
    $req->header('Content-Type' => $ENV{CONTENT_TYPE} // 'application/json');
    my $cp_lang = $ENV{HTTP_ACCEPT_LANGUAGE} // '';
    if ($cp_lang) {
        my ($primary) = $cp_lang =~ /^([a-zA-Z]{2})/;
        $req->header('X-Cpanel-Language' => $primary) if $primary;
    }
    $req->content($body) if length $body;
    my $res = $ua->request($req);
    print "Status: " . $res->code . "\r\n";
    print "Content-Type: " . ($res->content_type || 'application/json') . "; charset=utf-8\r\n\r\n";
    print $res->content;
    exit 0;
}

# ---- Cluster health probe (used to render live badge above iframe) ----
sub cluster_badge {
    my $url = "$public/api/license-server/health";
    my $json = qx(curl -sS --max-time 4 -H 'Accept: application/json' \Q$url\E 2>/dev/null);
    if (!$json) {
        eval {
            my $ua = LWP::UserAgent->new(timeout => 4, ssl_opts => { verify_hostname => 0 });
            my $r = $ua->get($url);
            $json = $r->decoded_content if $r->is_success;
        };
    }
    return _badge("Cluster Unreachable", "#fee2e2", "#991b1b") unless $json;
    my ($healthy) = $json =~ /"healthy_count"\s*:\s*(\d+)/;
    my ($total)   = $json =~ /"total_regions"\s*:\s*(\d+)/;
    my ($region)  = $json =~ /"region"\s*:\s*"([^"]+)"/;
    $healthy //= 0; $total //= 0; $region //= 'Region';
    if ($total > 0 && $healthy == $total) {
        return _badge("Cluster: $region ($healthy/$total)", "#d1fae5", "#065f46");
    } elsif ($healthy > 0) {
        return _badge("Cluster Degraded ($healthy/$total)", "#fef3c7", "#92400e");
    } else {
        return _badge("Cluster Offline", "#fee2e2", "#991b1b");
    }
}
sub _badge {
    my ($text, $bg, $fg) = @_;
    return qq{<span id="ms-badge" style="display:inline-block;padding:5px 12px;border-radius:14px;background:$bg;color:$fg;font-size:12px;font-weight:600;letter-spacing:.2px;">$text</span>};
}
my $badge_html = cluster_badge();

# ---- WHM chrome ile birlikte HTML shell (v43.22 — defheader/deffooter) ----
# `.tmpl` yaklaşımı çalışmadı (statik dosya olarak indi). Bu doğru yol:
# CGI içinde defheader() → WHM sidebar/header enjekte edilir → deffooter() ile kapatılır.
print "Content-type: text/html; charset=utf-8\r\n\r\n";
Whostmgr::HTMLInterface::defheader("GokyuzuWebSpam", "/cgi/mailshield/icon.png", "/cgi/mailshield/index.cgi");

my $panel_url = "$public/panel";
if ($master_key) {
    # WHM'e giren = root, master anahtarı iframe query parametresi olarak geçilir
    $panel_url .= "?master_key=$master_key";
}

print <<"HTML";
<style>
  .ms-wrap { margin: -10px -10px 0 -10px; background: #0f172a; }
  .ms-topbar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 8px 14px; background: #f8fafc; border-bottom: 1px solid #e5e7eb;
    font-size: 12px;
  }
  .ms-topbar .ms-title { flex: 1; font-weight: 700; color: #1e3a8a; }
  .ms-topbar .ms-btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 10px; border-radius: 14px; background: #2563eb; color: #fff;
    border: 0; font-size: 11px; font-weight: 600; cursor: pointer;
    text-decoration: none; transition: background .15s;
  }
  .ms-topbar .ms-btn:hover:not(:disabled) { background: #1d4ed8; }
  .ms-topbar .ms-btn:disabled { opacity: .6; cursor: wait; }
  .ms-topbar .ms-btn.ms-btn-ok  { background: #059669; }
  .ms-topbar .ms-btn.ms-btn-err { background: #dc2626; }
  .ms-topbar .ms-btn.ms-btn-alt { background: #0891b2; }
  #ms-badge { padding: 3px 10px !important; border-radius: 12px !important; font-size: 11px !important; }
  #ms-update-status { color: #64748b; font-size: 10px; margin-left: 4px; }
  #ms-shell {
    display: block; width: 100%; border: 0; background: #0f172a;
    height: 1800px;    /* baslangic — postMessage ile SPA icerik yuksekligine gore ayarlanir */
    min-height: 1200px;
    transition: height .3s ease;
  }
  \@keyframes msPulse {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239,68,68,.7); }
    50% { transform: scale(1.05); box-shadow: 0 0 0 8px rgba(239,68,68,0); }
  }
</style>

<div class="ms-wrap">
  <div class="ms-topbar">
    <span class="ms-title">GokyuzuWebSpam &mdash; Mail Guvenlik Paneli</span>
    $badge_html
    <a href="/cgi/mailshield/index.cgi?tam=1" target="_blank" rel="noopener" class="ms-btn ms-btn-alt" title="Yeni sekmede tam ekran ac">
      &#x1F517; Yeni Sekme
    </a>
    <button id="ms-update-btn" class="ms-btn" onclick="msUpdate()" title="Plugin script'lerini son surumden guncelle">
      &#x21bb; Guncelle
    </button>
    <span id="ms-update-status"></span>
  </div>
  <iframe id="ms-shell" src="$panel_url" title="GokyuzuWebSpam" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
</div>

<script>
async function msUpdate() {
  const btn = document.getElementById('ms-update-btn');
  const st  = document.getElementById('ms-update-status');
  btn.disabled = true;
  btn.innerHTML = '&#x21bb; Guncelleniyor...';
  st.textContent = '';
  let raw = '';
  try {
    const r = await fetch('/cgi/mailshield/index.cgi?action=self-update', { credentials:'same-origin', headers: { 'Accept': 'application/json' } });
    raw = await r.text();
    let d;
    try { d = JSON.parse(raw); }
    catch (parseErr) {
      // Sunucu HTML dondurdu — muhtemelen auth redirect veya Perl hatasi
      throw new Error('Yanit JSON degil. HTTP ' + r.status + '. Ilk 300 karakter:\\n\\n' + raw.substring(0, 300));
    }
    if (r.ok && d.ok) {
      btn.classList.add('ms-btn-ok');
      btn.innerHTML = '&check; Guncellendi';
      st.textContent = (d.actions || []).length + ' islem';
      setTimeout(() => location.reload(), 1500);
    } else {
      btn.classList.add('ms-btn-err');
      btn.innerHTML = '&#x2717; Hata';
      alert('Guncelleme hatasi:\\n\\n' + (d.errors || ['Bilinmeyen hata']).join('\\n'));
      setTimeout(() => { btn.disabled = false; btn.classList.remove('ms-btn-err'); btn.innerHTML = '&#x21bb; Guncelle'; }, 3000);
    }
  } catch (e) {
    btn.classList.add('ms-btn-err');
    btn.innerHTML = '&#x2717; Hata';
    alert('Guncelleme hatasi: ' + e.message);
    setTimeout(() => { btn.disabled = false; btn.classList.remove('ms-btn-err'); btn.innerHTML = '&#x21bb; Guncelle'; }, 5000);
  }
}
</script>
HTML

Whostmgr::HTMLInterface::deffooter();
exit 0;

