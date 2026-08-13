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
if ($qs =~ /(?:^|&)action=self-update(?:&|$)/ || $pinfo eq '/self-update') {
    my @actions;
    my @errors;
    my $tmp_tgz = "/tmp/gws-selfupdate-$$.tar.gz";
    my $tmp_dir = "/tmp/gws-selfupdate-$$";

    # 1) Download
    system("curl -sS --max-time 25 -o $tmp_tgz '$public/api/plugin/download'");
    unless (-s $tmp_tgz) {
        push @errors, "Tarball indirilemedi ($public/api/plugin/download)";
    }

    # 2) Extract
    unless (@errors) {
        mkdir $tmp_dir;
        system("tar -xzf $tmp_tgz -C $tmp_dir --strip-components=1 2>/dev/null");
        unless (-d "$tmp_dir/scripts") {
            push @errors, "Tarball extract basarisiz veya beklenen icerik yok";
        }
    }

    # 3) Refresh key files (only if extraction succeeded)
    unless (@errors) {
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
            my $src = "$tmp_dir/$rel";
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

        # 3b) Docker container'ları da güncelle (git pull + docker rebuild)
        # auto-update.sh script'i git pull + docker compose up --build yapar
        my $update_script = "/opt/gokyuzuwebspam-app/deployment/auto-update.sh";
        if (-x $update_script) {
            my $out = `bash $update_script 2>&1`;
            my $rc = $? >> 8;
            if ($rc == 0) {
                push @actions, "docker-update: OK (git pull + rebuild)";
            } else {
                push @errors, "docker-update failed (rc=$rc): " . substr($out, 0, 300);
            }
        }
    }

    # 4) Cleanup
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

# ---- HTML shell (STANDALONE — no WHM chrome, iframe fills 100vh) ----
print "Content-type: text/html; charset=utf-8\r\n\r\n";

my $panel_url = "$public/panel";
if ($master_key) {
    # WHM'e giren = root, master anahtarı iframe query parametresi olarak geçilir
    $panel_url .= "?master_key=$master_key";
}

print <<"HTML";
<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>GokyuzuWebSpam - Mail Guvenlik Paneli</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script>
// v43.14 Frame-break-out — WHM'in appconfig'inde hala target=_self varsa
// (eski kurulum) plugin küçük bir iframe içinde açılır. Bu durumda üst
// pencereye çıkıp gerçek fullscreen sağlarız. Yeni kurulumda target=_top
// zaten browser viewport'una atar; bu kod no-op'tur.
// v43.16: <head> içine taşındı ki flash olmadan hemen escape etsin.
(function ensureFullscreen() {
  try {
    if (window.top !== window.self) {
      window.top.location.replace(window.self.location.href);
      // Escape başarısız olursa parent WHM chrome'u sıkıştır (fallback)
      setTimeout(function() {
        try {
          var p = window.parent && window.parent.document;
          if (p) {
            ['contentContainer','pageContainer','wrapper','main-content'].forEach(function(id){
              var el = p.getElementById(id);
              if (el) { el.style.padding='0'; el.style.margin='0'; el.style.overflow='hidden'; el.style.maxWidth='none'; }
            });
            // WHM navbar'ı da gizle (fullscreen için)
            var nav = p.querySelector('#navigation, #topNav, .whm-navbar');
            if (nav) nav.style.display = 'none';
          }
        } catch (e) {}
      }, 100);
    }
  } catch (e) { /* cross-origin */ }
})();
</script>
<style>
  /* v43.9 Standalone WHM plugin — WHM chrome tamamen bypass, iframe 100vh gerçek fullscreen */
  * { box-sizing: border-box; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    max-width: 100vw !important;
    max-height: 100vh !important;
    overflow: hidden !important;
    background: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .ms-hdr {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 52px;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: nowrap;
    background: #f8fafc;
    border-bottom: 1px solid #e5e7eb;
    z-index: 10;
    overflow: hidden;
  }
  .ms-hdr .ms-title { flex: 1; min-width: 200px; overflow: hidden; }
  .ms-hdr h1 { margin: 0; font-size: 15px; color: #1e3a8a; line-height: 1.2; font-weight: 700; }
  .ms-hdr p { margin: 1px 0 0 0; color: #64748b; font-size: 10px; line-height: 1.2; }
  .ms-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px; border-radius: 20px;
    background: #2563eb; color: #fff; border: 0;
    font-size: 11px; font-weight: 600; cursor: pointer;
    transition: all .15s; white-space: nowrap;
    text-decoration: none;
  }
  .ms-btn:hover:not(:disabled) { background: #1d4ed8; transform: translateY(-1px); }
  .ms-btn:disabled { opacity: .6; cursor: wait; }
  .ms-btn.ms-btn-back { background: #64748b; }
  .ms-btn.ms-btn-back:hover { background: #475569; }
  .ms-btn.ms-btn-ok { background: #059669; }
  .ms-btn.ms-btn-err { background: #dc2626; }
  #ms-update-status { font-size: 10px; color: #64748b; margin-left: 6px; }
  #ms-badge { font-size: 11px !important; padding: 3px 8px !important; }
  #ms-shell {
    position: fixed;
    top: 52px;   /* header height */
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: calc(100vh - 52px);
    border: 0;
    display: block;
    margin: 0;
    padding: 0;
    background: #0f172a;
  }
</style>
</head>
<body>
<div class="ms-hdr">
  <div class="ms-title">
    <h1>GokyuzuWebSpam &mdash; Mail Guvenlik Paneli</h1>
    <p>Modern spam &amp; virus koruma paneli · Canli lisans sunucusu ile senkronize</p>
  </div>
  $badge_html
  <a href="/scripts2/main" class="ms-btn ms-btn-back" title="WHM Ana Sayfaya Don">
    &larr; WHM
  </a>
  <button id="ms-update-btn" class="ms-btn" onclick="msUpdate()" title="Plugin script'lerini son surumden guncelle">
    &#x21bb; Guncelle
  </button>
  <span id="ms-update-status"></span>
</div>
<iframe id="ms-shell" src="$panel_url" title="GokyuzuWebSpam" allow="fullscreen"></iframe>

<script>
async function msUpdate() {
  const btn = document.getElementById('ms-update-btn');
  const st  = document.getElementById('ms-update-status');
  if (!confirm('Plugin script\\'lerini son surumden yenilemek istiyor musunuz? Log-tail servisi yeniden baslatilir.')) return;
  btn.disabled = true;
  btn.classList.remove('ms-btn-ok','ms-btn-err');
  btn.innerHTML = '&#x21bb; Guncelleniyor...';
  st.textContent = '';
  try {
    // Query string based — PATH_INFO WHM cpsrvd icinde her zaman calismiyor
    const r = await fetch(window.location.pathname + '?action=self-update', {
      method: 'GET', credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    });
    const txt = await r.text();
    let d;
    try { d = JSON.parse(txt); }
    catch(_) {
      // HTML doner ise ilk 300 char kullaniciya goster
      throw new Error('Sunucu JSON donmedi (' + r.status + '): ' + txt.slice(0, 300));
    }
    if (d.ok) {
      btn.classList.add('ms-btn-ok');
      btn.innerHTML = '&check; Guncellendi';
      st.textContent = (d.actions || []).length + ' dosya guncellendi';
      setTimeout(() => {
        btn.classList.remove('ms-btn-ok');
        btn.innerHTML = '&#x21bb; Guncelle';
        btn.disabled = false;
        // Reload iframe to refresh SPA
        document.getElementById('ms-shell').src = document.getElementById('ms-shell').src;
      }, 2500);
      alert('Guncelleme basarili:\\n\\n' + (d.actions || []).join('\\n'));
    } else {
      btn.classList.add('ms-btn-err');
      btn.innerHTML = '&#x2717; Hata';
      st.textContent = (d.errors || ['bilinmiyor']).join(', ');
      alert('Guncelleme hatasi:\\n\\n' + (d.errors || []).join('\\n'));
      setTimeout(() => { btn.disabled = false; btn.classList.remove('ms-btn-err'); btn.innerHTML = '&#x21bb; Guncelle'; }, 3000);
    }
  } catch(e) {
    btn.classList.add('ms-btn-err');
    btn.innerHTML = '&#x2717; Baglanti';
    alert('Baglanti hatasi: ' + e.message);
    setTimeout(() => { btn.disabled = false; btn.classList.remove('ms-btn-err'); btn.innerHTML = '&#x21bb; Guncelle'; }, 3000);
  }
}
</script>
</body>
</html>
HTML

exit 0;
