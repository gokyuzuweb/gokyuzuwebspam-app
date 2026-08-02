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
            ['scripts/heartbeat.pl',          '/usr/local/mailshield/bin/heartbeat.pl',          '0755'],
            ['whm/mailshield.cgi',            '/usr/local/cpanel/whostmgr/docroot/cgi/mailshield/index.cgi', '0755'],
            ['whm/mailshield.tmpl',           '/usr/local/cpanel/whostmgr/docroot/cgi/mailshield/mailshield.tmpl', '0644'],
        );
        for my $f (@files) {
            my ($rel, $dst, $mode) = @$f;
            my $src = "$tmp_dir/$rel";
            next unless -f $src;
            my $r = system("install -m $mode -o root -g root '$src' '$dst'");
            if ($r == 0) { push @actions, "updated: $dst"; }
            else         { push @errors, "install failed: $dst"; }
        }
        # Restart logtail so new Perl code takes effect
        if (system("systemctl is-active --quiet mailshield-logtail.service") == 0) {
            system("systemctl restart mailshield-logtail.service");
            push @actions, "restarted: mailshield-logtail.service";
        } else {
            system("systemctl enable --now mailshield-logtail.service 2>/dev/null");
            push @actions, "started: mailshield-logtail.service";
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

# ---- HTML shell (WHM chrome + header + badge + Update button + iframe) ----
print "Content-type: text/html; charset=utf-8\r\n\r\n";
Whostmgr::HTMLInterface::defheader('GokyuzuWebSpam', '', '/cgi/mailshield');

my $panel_url = "$public/panel";
if ($master_key) {
    # WHM'e giren = root, master anahtarı iframe query parametresi olarak geçilir
    $panel_url .= "?master_key=$master_key";
}

print <<"HTML";
<style>
  #ms-shell { position: relative; width: 100%; height: calc(100vh - 210px); border: 0; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
  .ms-hdr { padding: 14px 20px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .ms-hdr h1 { margin: 0; font-size: 22px; color: #1e3a8a; }
  .ms-hdr p { margin: 6px 0 0 0; color: #666; font-size: 13px; }
  .ms-hdr .ms-title { flex: 1; min-width: 240px; }
  .ms-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; background: #2563eb; color: #fff; border: 0; font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s; }
  .ms-btn:hover:not(:disabled) { background: #1d4ed8; transform: translateY(-1px); }
  .ms-btn:disabled { opacity: .6; cursor: wait; }
  .ms-btn.ms-btn-ok { background: #059669; }
  .ms-btn.ms-btn-err { background: #dc2626; }
  #ms-update-status { font-size: 11px; color: #666; margin-left: 8px; }
</style>
<div class="ms-hdr">
  <div class="ms-title">
    <h1>GokyuzuWebSpam &mdash; Mail Guvenlik Paneli</h1>
    <p>Modern spam &amp; virus koruma paneli. Canli lisans sunucusu kumesi ile senkronize.</p>
  </div>
  $badge_html
  <button id="ms-update-btn" class="ms-btn" onclick="msUpdate()" title="Plugin script'lerini son surumden guncelle">
    &#x21bb; Guncelle
  </button>
  <span id="ms-update-status"></span>
</div>
<div style="padding: 0 20px 20px 20px;">
  <iframe id="ms-shell" src="$panel_url" title="GokyuzuWebSpam"></iframe>
</div>

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
HTML

Whostmgr::HTMLInterface::deffooter();
exit 0;
