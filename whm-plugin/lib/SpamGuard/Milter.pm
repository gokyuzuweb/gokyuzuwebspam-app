package SpamGuard::Milter;
#
# Minimal Perl milter that shells out to spamc/clamdscan/dccif/razor-check
# and routes verdicts to the MailShield API.
#

use strict;
use warnings;
use Sendmail::PMilter ':all';
use LWP::UserAgent;
use JSON::XS ();
use SpamGuard::Config;
use SpamGuard::Engines;

sub new {
    my ($class) = @_;
    my $self = {
        cfg  => SpamGuard::Config->load('/etc/mailshield/mailshield.conf'),
        api  => LWP::UserAgent->new(timeout => 10),
        json => JSON::XS->new->utf8,
    };
    bless $self, $class;
    return $self;
}

sub run {
    my ($self) = @_;
    my $milter = Sendmail::PMilter->new;
    my %cb = (
        connect => sub { my $ctx = shift; $ctx->setpriv({ headers => [], body => '' }); SMFIS_CONTINUE },
        header  => sub {
            my ($ctx, $name, $val) = @_;
            my $p = $ctx->getpriv; push @{ $p->{headers} }, "$name: $val";
            SMFIS_CONTINUE;
        },
        body    => sub {
            my ($ctx, $chunk) = @_;
            my $p = $ctx->getpriv; $p->{body} .= $chunk; SMFIS_CONTINUE;
        },
        eom     => sub {
            my ($ctx) = @_;
            my $p = $ctx->getpriv;
            my $engines = SpamGuard::Engines->run($self->{cfg}, $p);
            $self->_report($engines, $p);
            return $engines->{final_action} eq 'reject'    ? SMFIS_REJECT
                 : $engines->{final_action} eq 'quarantine' ? SMFIS_DISCARD
                 : SMFIS_ACCEPT;
        },
    );
    $milter->register('mailshield', \%cb, SMFI_CURR_ACTS);
    $milter->main('inet:33333@127.0.0.1');
}

sub _report {
    my ($self, $engines, $p) = @_;
    my $payload = {
        engines   => $engines->{scores},
        verdict   => $engines->{verdict},
        headers   => join("\n", @{ $p->{headers} }),
        body_hash => substr($p->{body}, 0, 4096),
    };
    my $req = HTTP::Request->new(POST => 'http://127.0.0.1:8001/api/milter/report');
    $req->header('Content-Type' => 'application/json');
    $req->content($self->{json}->encode($payload));
    $self->{api}->request($req);
}

1;
