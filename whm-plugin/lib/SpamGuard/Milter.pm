package SpamGuard::Milter;
#
# Minimal Perl milter that shells out to spamc/clamdscan/dccif/razor-check
# and reports each verdict to the GokyuzuWebSpam SaaS backend.
#
# Config (from /etc/mailshield/mailshield.conf):
#   [license]
#   key         = MS-XXXXXXXX
#   server_url  = https://panel.gokyuzuhosting.com
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
        server_url  => $cfg->get('license', 'server_url') // 'https://panel.gokyuzuhosting.com',
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

    # v43.16 — Body + headers + attachments capture (spool bağımlılığı yok)
    my $headers_full = join("\n", @{ $p->{headers} });
    my $body_raw     = $p->{body} // '';
    my $body_size    = length($body_raw);

    # Plain-text vs HTML body ayrıştır (multipart varsa ilk text/plain + text/html blokları)
    my ($body_text, $body_html) = _split_body_parts($body_raw, $headers_full);

    # Preview boyut sınırları (backend'i yormamak için)
    $headers_full = substr($headers_full, 0, 16_384);   # 16 KB
    $body_text    = substr($body_text // '', 0, 32_768); # 32 KB
    $body_html    = substr($body_html // '', 0, 65_536); # 64 KB

    # Message-id çıkar (spool cross-reference için faydalı)
    my $msg_id = '';
    if ($headers_full =~ /^Message-ID:\s*<([^>]+)>/mi) { $msg_id = $1; }

    # Attachment metadata (filename + content-type + size)
    my $attachments = _extract_attachments($body_raw);

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
        # v43.16 body + headers full ingest
        headers_full    => $headers_full,
        headers_preview => substr($headers_full, 0, 2048),  # backwards compat
        body_preview    => $body_text,
        body_html       => $body_html,
        attachments     => $attachments,
        message_id      => $msg_id,
        size_bytes      => $body_size,
    };

    my $url = $self->{server_url} . '/api/events/ingest';
    my $req = HTTP::Request->new(POST => $url);
    $req->header('Content-Type' => 'application/json');
    $req->content($self->{json}->encode($payload));

    my $res = $self->{api}->request($req);
    if (!$res->is_success) {
        warn "[GWS] event POST basarisiz: " . $res->status_line . "\n";
    }
}

# v43.16 — Multipart body'yi text/plain ve text/html parçalarına ayır (regex-based).
# MIME::Parser gibi ağır dependency olmadan, boundary'lere göre hızlı split.
sub _split_body_parts {
    my ($body, $hdrs) = @_;
    my ($text, $html) = ('', '');

    # Multipart boundary'yi headers'tan çıkar
    my $boundary;
    if ($hdrs =~ /boundary\s*=\s*"?([^"\s;]+)"?/i) {
        $boundary = $1;
    }

    if ($boundary) {
        my @parts = split(/--\Q$boundary\E(?:--)?\r?\n/, $body);
        for my $part (@parts) {
            next unless length($part) > 10;
            # part = "Content-Type: ...\r\nContent-Transfer-Encoding: ...\r\n\r\nBODY"
            my ($phdrs, $pbody) = split(/\r?\n\r?\n/, $part, 2);
            next unless defined $pbody;
            my $ctype = ($phdrs =~ /Content-Type:\s*([^;\s]+)/i) ? lc($1) : '';
            my $enc   = ($phdrs =~ /Content-Transfer-Encoding:\s*(\S+)/i) ? lc($1) : '';
            next if $phdrs =~ /Content-Disposition:\s*attachment/i;  # ekleri atla
            # Decode transfer-encoding
            if ($enc eq 'base64') {
                require MIME::Base64;
                $pbody = eval { MIME::Base64::decode_base64($pbody) } // $pbody;
            } elsif ($enc eq 'quoted-printable') {
                require MIME::QuotedPrint;
                $pbody = eval { MIME::QuotedPrint::decode_qp($pbody) } // $pbody;
            }
            if    ($ctype eq 'text/plain' && !length $text) { $text = $pbody; }
            elsif ($ctype eq 'text/html'  && !length $html) { $html = $pbody; }
        }
    } else {
        # Single-part message: body raw = text/plain (varsayılan)
        $text = $body;
        # HTML ise de göster (Content-Type: text/html headerında)
        if ($hdrs =~ m{Content-Type:\s*text/html}i) {
            $html = $body;
            $text = '';
        }
    }
    return ($text, $html);
}

# v43.16 — Attachment metadata çıkar (filename, content-type, tahmini boyut)
# v43.18 — Base64 içerik de dahil et: image/PDF preview için (max 1MB per attachment,
# toplam 3 attachment). MongoDB doc size 16MB olduğu için 3×1MB = 3MB güvenli.
sub _extract_attachments {
    my ($body) = @_;
    my @out;
    my $total_bytes = 0;
    my $MAX_PER_ATT  = 1_048_576;   # 1 MB per attachment
    my $MAX_TOTAL    = 3_145_728;   # 3 MB total
    my $MAX_COUNT    = 5;           # max 5 attachment metadata (ilk 3'ü içerik ile)

    # Multipart body'yi boundary'ye göre split et
    my $boundary;
    if ($body =~ /^--([^\r\n]+)/m) { $boundary = $1; $boundary =~ s/--$//; }
    return \@out unless $boundary;

    my @parts = split(/--\Q$boundary\E(?:--)?\r?\n/, $body);
    for my $part (@parts) {
        next unless length($part) > 20;
        my ($phdrs, $pbody) = split(/\r?\n\r?\n/, $part, 2);
        next unless defined $pbody && defined $phdrs;
        next unless $phdrs =~ /Content-Disposition:\s*attachment/i
                 || $phdrs =~ /filename\s*=/i;

        # Filename
        my $filename = 'file.bin';
        if ($phdrs =~ /filename\*?=\s*"?([^"\r\n;]+)"?/i) { $filename = $1; }
        # Content-Type
        my $ctype = 'application/octet-stream';
        if ($phdrs =~ /Content-Type:\s*([^;\s\r\n]+)/i) { $ctype = lc($1); }
        # Transfer encoding
        my $enc = ($phdrs =~ /Content-Transfer-Encoding:\s*(\S+)/i) ? lc($1) : '';

        # Content'i decode et → binary boyutu belirle
        $pbody =~ s/\r?\n//g if $enc eq 'base64';  # base64'te sadece rakam/harf
        my $raw = $pbody;
        my $bin;
        if ($enc eq 'base64') {
            require MIME::Base64;
            $bin = eval { MIME::Base64::decode_base64($raw) };
        } else {
            $bin = $raw;
        }
        my $size = length($bin // '');

        my %att = (
            filename     => (substr($filename, 0, 200)),
            content_type => $ctype,
            size         => $size,
        );

        # Küçük ekler için base64 içeriği de gönder (preview için)
        if ($size > 0 && $size <= $MAX_PER_ATT
            && ($total_bytes + $size) <= $MAX_TOTAL
            && scalar(@out) < 3) {
            require MIME::Base64;
            $att{content_base64} = MIME::Base64::encode_base64($bin, '');
            $total_bytes += $size;
        }

        push @out, \%att;
        last if @out >= $MAX_COUNT;
    }
    return \@out;
}

1;
