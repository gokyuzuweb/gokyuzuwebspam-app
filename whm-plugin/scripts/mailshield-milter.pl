#!/usr/bin/env perl
#
# MailShield milter entry-point (invoked by systemd).
#
use strict;
use warnings;
use lib '/usr/local/mailshield/lib';
use SpamGuard::Milter;

my $milter = SpamGuard::Milter->new;
$milter->run;
