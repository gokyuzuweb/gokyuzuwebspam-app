#!/usr/local/cpanel/3rdparty/bin/perl
#
# MailShield Pro — WHM CGI proxy
#
# Renders the WHM chrome + iframes the MailShield API dashboard.
# Also exposes a passthrough API at /cgi/mailshield/api/* that authenticates
# via WHM session and forwards to the local FastAPI service.
#

use strict;
use warnings;
use lib '/usr/local/cpanel';
use Cpanel::Template   ();
use Whostmgr::ACLS     ();
use LWP::UserAgent     ();
use CGI                ();
use JSON::XS           ();

Whostmgr::ACLS::init_acls();
unless (Whostmgr::ACLS::hasroot()) {
    print "Content-type: text/plain\n\nAccess denied.\n";
    exit 0;
}

my $q       = CGI->new;
my $api     = $ENV{MAILSHIELD_API} // 'http://127.0.0.1:8001';
my $pinfo   = $ENV{PATH_INFO} // '';

# Passthrough API routing (from the SPA to FastAPI, with auth already validated).
if ($pinfo =~ m{^/api/}) {
    my $ua      = LWP::UserAgent->new(timeout => 20);
    my $method  = $ENV{REQUEST_METHOD} // 'GET';
    my $body    = do { local $/; <STDIN> } // '';
    my $url     = $api . $pinfo;
    $url .= '?' . $ENV{QUERY_STRING} if $ENV{QUERY_STRING};
    my $req     = HTTP::Request->new($method => $url);
    $req->header('Content-Type' => $ENV{CONTENT_TYPE} // 'application/json');
    $req->content($body) if length $body;
    my $res = $ua->request($req);
    print "Status: " . $res->code . "\n";
    print "Content-Type: " . ($res->content_type || 'application/json') . "\n\n";
    print $res->content;
    exit 0;
}

# HTML shell
Cpanel::Template::process_template(
    'whostmgr',
    {
        'template_file'    => '/usr/local/cpanel/whostmgr/docroot/cgi/mailshield/mailshield.tmpl',
        'print'            => 1,
        'app_title'        => 'MailShield Pro',
        'api_base'         => '/cgi/mailshield/api',
    },
);
