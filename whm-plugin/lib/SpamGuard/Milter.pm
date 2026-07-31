package SpamGuard::Milter;
#
# Minimal Perl milter that shells out to spamc/clamdscan/dccif/razor-check
# and reports each verdict to the GokyuzuWebSpam SaaS backend.
#
# Config (from /etc/mailshield/mailshield.conf):
#   [license]
#   key         = MS-XXXXXXXX
#   server_url  = https://mailscanner-pro.preview.emergentagent.com
#

use strict;
use warnings;
use Sendmail::PMilter ':all';
use LWP::UserAgent;
use HTTP::Request;
use JSON::XS ();
use SpamGuard::Config;
use SpamGuard::Engines;
use Sys::Hostname ();

sub new {
    my ($class) = @_;
    my $cfg = SpamGuard::Config->load('/etc/mailshield/mailshield.conf');
    my $self = {
        cfg         => $cfg,
        api         => LWP::UserAgent->new(timeout => 6, ssl_opts => { verify_hostname => 0 }),
        json        => JSON::XS->new->utf8,
        license_key => $cfg->get('license', 'key') // '',
        server_url  => $cfg->get('license', 'server_url') // 'https://mailscanner-pro.preview.emergentagent.com',
        hostname    => Sys::Hostname::hostname(),
    };
    bless $self, $class;
    return $self;
}

sub run {
    my ($self) = @_;
    my $milter = Sendmail::PMilter->new;
    my %cb = (
        connect => sub { my $ctx = shift; $ctx->setpriv({ headers => [], body => '', from => '', to => '' }); SMFIS_CONTINUE },
        envfrom => sub {
            my ($ctx, $from) = @_;
            my $p = $ctx->getpriv; $p->{from} = $from // ''; SMFIS_CONTINUE;
        },
        envrcpt => sub {
            my ($ctx, $to) = @_;
            my $p = $ctx->getpriv; $p->{to} = $to // ''; SMFIS_CONTINUE;
        },
        header  => sub {
            my ($ctx, $name, $val) = @_;
            my $p = $ctx->getpriv; push @{ $p->{headers} }, "$name: $val";
            $p->{subject} = $val if lc($name // '') eq 'subject';
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
            $self->_report_saas($engines, $p);
            return $engines->{final_action} eq 'reject'    ? SMFIS_REJECT
                 : $engines->{final_action} eq 'quarantine' ? SMFIS_DISCARD
                 : SMFIS_ACCEPT;
        },
    );
    $milter->register('mailshield', \%cb, SMFI_CURR_ACTS);
    $milter->main('inet:33333@127.0.0.1');
}

sub _report_saas {
    my ($self, $engines, $p) = @_;
    return unless length $self->{license_key};   # No license → sessizce gec

    my $payload = {
        license_key     => $self->{license_key},
        server_hostname => $self->{hostname},
        from_addr       => $p->{from},
        to_addr         => $p->{to},
        subject         => (substr($p->{subject} // '', 0, 256)),
        verdict         => $engines->{verdict}       // 'clean',
        action          => $engines->{final_action}  // 'accept',
        total_score     => $engines->{total_score}   // 0,
        scores          => $engines->{scores}        // {},
        headers_preview => substr(join("\n", @{ $p->{headers} }), 0, 2048),
    };

    my $url = $self->{server_url} . '/api/events/ingest';
    my $req = HTTP::Request->new(POST => $url);
    $req->header('Content-Type' => 'application/json');
    $req->content($self->{json}->encode($payload));

    my $res = $self->{api}->request($req);
    if (!$res->is_success) {
        # Sessizce offline cache (opsiyonel — su an sadece stderr'e yaz)
        warn "[GWS] event POST basarisiz: " . $res->status_line . "\n";
    }
}

1;
