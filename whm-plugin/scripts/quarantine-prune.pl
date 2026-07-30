#!/usr/bin/env perl
#
# Removes expired quarantine entries per the retention policy.
# Invoked hourly by mailshield-quarantine.timer.
#
use strict;
use warnings;
use JSON::XS;
use LWP::UserAgent;

my $days = 14;
if (open my $fh, '<', '/etc/mailshield/policy.json') {
    local $/;
    my $p = eval { JSON::XS::decode_json(<$fh>) } // {};
    $days = $p->{quarantine_days} // 14;
    close $fh;
}

my $ua  = LWP::UserAgent->new(timeout => 20);
my $res = $ua->post(
    "http://127.0.0.1:8001/api/quarantine/prune",
    Content_Type => 'application/json',
    Content      => JSON::XS::encode_json({ days => $days }),
);
warn "quarantine-prune: " . $res->status_line unless $res->is_success;
