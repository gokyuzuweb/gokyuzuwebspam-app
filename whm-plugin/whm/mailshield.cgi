#!/usr/local/cpanel/3rdparty/bin/perl
#
# GokyuzuWebSpam - WHM CGI proxy
#
# Renders the WHM chrome + iframes the GokyuzuWebSpam dashboard.
# Also exposes a passthrough API at /cgi/mailshield/index.cgi/api/*
# forwarding to the local FastAPI service (auth already validated by WHM).
#

use strict;
use warnings;
use lib '/usr/local/cpanel';
use Whostmgr::ACLS         ();
use Whostmgr::HTMLInterface ();
use LWP::UserAgent          ();
use HTTP::Request           ();

Whostmgr::ACLS::init_acls();
unless (Whostmgr::ACLS::hasroot()) {
    print "Content-type: text/html; charset=utf-8\r\n\r\n";
    print "<h1>Access denied</h1>";
    exit 0;
}

my $api   = $ENV{MAILSHIELD_API} // 'http://127.0.0.1:8001';
my $pinfo = $ENV{PATH_INFO} // '';

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

# ---- HTML shell (WHM header + iframe + WHM footer) ----
print "Content-type: text/html; charset=utf-8\r\n\r\n";

# WHM chrome header
Whostmgr::HTMLInterface::defheader('GokyuzuWebSpam', '', '/cgi/mailshield');

my $panel_url = 'https://mailscanner-pro.preview.emergentagent.com/panel';

print <<"HTML";
<style>
  #ms-shell { position: relative; width: 100%; height: calc(100vh - 180px); border: 0; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
  .ms-header { padding: 16px 20px; }
  .ms-header h1 { margin: 0 0 6px 0; font-size: 22px; color: #1e3a8a; }
  .ms-header p { margin: 0 0 14px 0; color: #666; font-size: 13px; }
</style>
<div class="ms-header">
  <h1>GokyuzuWebSpam - Mail Guvenlik Paneli</h1>
  <p>Modern spam &amp; virus koruma paneli. Panel canli backend'e baglidir; asagida gomulu olarak calisir.</p>
  <iframe id="ms-shell" src="$panel_url" title="GokyuzuWebSpam"></iframe>
</div>
HTML

Whostmgr::HTMLInterface::deffooter();
exit 0;
