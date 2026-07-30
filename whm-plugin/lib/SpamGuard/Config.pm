package SpamGuard::Config;
#
# Loads /etc/mailshield/mailshield.conf (INI-style) and exposes helpers.
#

use strict;
use warnings;

sub load {
    my ($class, $path) = @_;
    my %conf;
    open my $fh, '<', $path or die "cannot read $path: $!";
    my $section = 'main';
    while (my $line = <$fh>) {
        $line =~ s/[\r\n#].*$//;
        $line =~ s/^\s+|\s+$//g;
        next unless length $line;
        if ($line =~ /^\[(.+)\]$/) { $section = $1; next; }
        if ($line =~ /^([\w.-]+)\s*=\s*(.*)$/) {
            $conf{$section}{$1} = $2;
        }
    }
    close $fh;
    return bless {
        raw              => \%conf,
        emergent_llm_key => $conf{ai}{emergent_llm_key} // $ENV{EMERGENT_LLM_KEY},
    }, $class;
}

sub engine_enabled {
    my ($self, $name) = @_;
    my $v = $self->{raw}{engines}{$name} // 'off';
    return lc($v) eq 'on' || lc($v) eq 'yes' || lc($v) eq '1';
}

sub get { my ($self, $sec, $key) = @_; return $self->{raw}{$sec}{$key}; }

1;
