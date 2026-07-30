package SpamGuard::Engines;
#
# Fan-out message scanning across enabled engines.
# Each engine returns a numeric score contribution; the total is compared
# against the low/high thresholds from /etc/mailshield/policy.json.
#

use strict;
use warnings;
use IPC::Run3;
use JSON::XS;

sub run {
    my ($class, $cfg, $msg) = @_;

    my %scores;
    my $policy = _load_policy();
    my $body_head = substr($msg->{body}, 0, 65_536);
    my $rfc = join("\n", @{ $msg->{headers} }) . "\n\n" . $body_head;

    if ($cfg->engine_enabled('spamassassin')) {
        my ($out, $err);
        run3(['spamc', '-c'], \$rfc, \$out, \$err);
        my ($score) = ($out // '') =~ m{^([\d.\-]+)/};
        $scores{spamassassin} = $score // 0;
    }
    if ($cfg->engine_enabled('clamav')) {
        my ($out, $err);
        run3(['clamdscan', '--stream', '--no-summary', '-'], \$rfc, \$out, \$err);
        $scores{clamav} = ($out // '') =~ /FOUND/ ? 15.0 : 0.0;
    }
    if ($cfg->engine_enabled('dcc')) {
        my ($out, $err);
        run3(['dccif', '-h', '/var/dcc'], \$rfc, \$out, \$err);
        $scores{dcc} = ($out // '') =~ /bulk|reject/i ? 6.0 : 0.0;
    }
    if ($cfg->engine_enabled('razor')) {
        my ($out, $err);
        run3(['razor-check'], \$rfc, \$out, \$err);
        $scores{razor} = $? == 0 ? 5.0 : 0.0;
    }
    if ($cfg->engine_enabled('ai')) {
        $scores{ai} = _ai_classify($rfc, $cfg);
    }

    my $total = 0; $total += $_ for values %scores;
    my $verdict = 'clean';
    my $action  = 'accept';
    if ($total >= $policy->{spam_threshold_high}) {
        $verdict = 'high_spam'; $action = 'quarantine';
    } elsif ($total >= $policy->{spam_threshold_low}) {
        $verdict = 'spam'; $action = 'quarantine';
    }
    $verdict = 'virus' if ($scores{clamav} // 0) > 10;

    return {
        scores       => \%scores,
        total_score  => $total,
        verdict      => $verdict,
        final_action => $action,
    };
}

sub _load_policy {
    open my $fh, '<', '/etc/mailshield/policy.json' or return {
        spam_threshold_low  => 5.0,
        spam_threshold_high => 8.5,
    };
    local $/;
    return JSON::XS::decode_json(<$fh>);
}

sub _ai_classify {
    my ($rfc, $cfg) = @_;
    my $key = $cfg->{emergent_llm_key} // $ENV{EMERGENT_LLM_KEY};
    return 0.0 unless $key;
    my $req = HTTP::Request->new(POST => 'http://127.0.0.1:8001/api/scan/ai');
    $req->header('Content-Type' => 'application/json');
    $req->content(JSON::XS::encode_json({ raw => $rfc }));
    my $ua = LWP::UserAgent->new(timeout => 8);
    my $res = $ua->request($req);
    return 0.0 unless $res->is_success;
    my $data = eval { JSON::XS::decode_json($res->content) } // {};
    return $data->{score} // 0.0;
}

1;
