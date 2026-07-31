#!/usr/local/cpanel/3rdparty/bin/perl
#
# GokyuzuWebSpam - WHM CGI proxy
#
# Renders WHM chrome + live cluster status badge + iframe to dashboard.
# Also exposes a passthrough API at /cgi/mailshield/index.cgi/api/*
# forwarding to the local FastAPI service (auth validated by WHM).
#

use strict;
use warnings;
use lib '/usr/local/cpanel';
use Whostmgr::ACLS          ();
use Whostmgr::HTMLInterface ();
use LWP::UserAgent          ();
use HTTP::Request           ();

Whostmgr::ACLS::init_acls();
unless (Whostmgr::ACLS::hasroot()) {
    print "Content-type: text/html; charset=utf-8\r\n\r\n";
    print "<h1>Access denied</h1>";
    exit 0;
}

my $api    = $ENV{MAILSHIELD_API} // 'http://127.0.0.1:8001';
my $public = $ENV{MAILSHIELD_PUBLIC} // 'https://mailscanner-pro.preview.emergentagent.com';
my $pinfo  = $ENV{PATH_INFO} // '';

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
# LWP::Protocol::https bazi cPanel Perl'lerinde eksik; sistemin curl'unu kullaniyoruz.
sub cluster_badge {
    my $url = "$public/api/license-server/health";
    my $json = qx(curl -sS --max-time 4 -H 'Accept: application/json' \Q$url\E 2>/dev/null);
    if (!$json) {
        # Curl basarisiz -> LWP dene (fallback)
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

# ---- HTML shell (WHM chrome + header + badge + iframe) ----
print "Content-type: text/html; charset=utf-8\r\n\r\n";
Whostmgr::HTMLInterface::defheader('GokyuzuWebSpam', '', '/cgi/mailshield');

my $panel_url = "$public/panel";

print <<"HTML";
<style>
  #ms-shell { position: relative; width: 100%; height: calc(100vh - 200px); border: 0; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
  .ms-hdr { padding: 14px 20px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .ms-hdr h1 { margin: 0; font-size: 22px; color: #1e3a8a; }
  .ms-hdr p { margin: 6px 0 0 0; color: #666; font-size: 13px; }
  .ms-hdr .ms-title { flex: 1; min-width: 240px; }
</style>
<div class="ms-hdr">
  <div class="ms-title">
    <h1>GokyuzuWebSpam &mdash; Mail Guvenlik Paneli</h1>
    <p>Modern spam &amp; virus koruma paneli. Canli lisans sunucusu kumesi ile senkronize.</p>
  </div>
  $badge_html
</div>
<div style="padding: 0 20px 20px 20px;">
  <iframe id="ms-shell" src="$panel_url" title="GokyuzuWebSpam"></iframe>
</div>
HTML

Whostmgr::HTMLInterface::deffooter();
exit 0;
