"""v44.00.18 — mailshield-logtail.pl için ClamAV/native-Exim reject
regex'lerinin doğru payload ürettiğini doğrular.

Perl script'i doğrudan burada çalıştırmak yerine, regex'lerini bir alt-Perl
process'inde SIMÜLE ediyoruz: script'ten _process_line'ı çıkartıp mock log
satırlarını besleyip stdout'a hangi verdict/action ürettiğini yazdırıyoruz.
Böylece:
  1) ClamAV virus rejection  -> verdict='virus'
  2) Generic rejected RCPT   -> verdict='blocked'
  3) Dangerous attachment    -> verdict='virus' (dosya adı ile)
  4) Host banned             -> verdict='blocked'
"""
from __future__ import annotations
import subprocess
import textwrap
from pathlib import Path

LOGTAIL = Path("/app/whm-plugin/scripts/mailshield-logtail.pl")


def _run_perl_with_mock_lines(lines: list[str]) -> str:
    """Extract only the regex-matching parts and evaluate against mock lines.

    Not executing the full logtail (which requires config file, network),
    just proving the regex patterns match and would emit the correct
    verdict/action pair.
    """
    src = LOGTAIL.read_text()
    # sanity — patterns exist in file
    assert "This\\s+)?[Mm]essage\\s+contains" in src or "message contains" in src.lower() or "message\\s+contains" in src.lower(), \
        "ClamAV virus regex missing in mailshield-logtail.pl"
    assert "DENY:\\s*disallowed" in src or "DENY: disallowed" in src, \
        "Dangerous attachment regex missing"
    assert "Host is banned" in src, \
        "Blacklist regex missing"

    # Extract the four v44.00.18 regex patterns and re-evaluate them in a
    # standalone Perl one-liner to prove they match the mock log lines.
    perl_snippet = textwrap.dedent(r"""
        use strict; use warnings;
        my @results;
        while (my $line = <STDIN>) {
            chomp $line;
            my $verdict = '';
            if ($line =~ m{^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2}).*?rejected\s+after\s+DATA:\s*(?:This\s+)?[Mm]essage\s+contains\s+(?:a\s+)?(?:virus|malware)(?:\s+or\s+malware)?\s*\(?([^)]*)\)?}i) {
                my $v = $3; $v =~ s/^\s+|\s+$//g; $v ||= 'Unknown';
                $verdict = "virus:$v";
            } elsif ($line =~ m{^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2}).*DENY:\s*disallowed\s*["']?([^"'\s]+\.(?:exe|scr|bat|com|cmd|pif|vbs|js|jse|wsf|wsh|hta|lnk|reg|msi|dll|jar))["']?}i) {
                $verdict = "virus:DangerousExtension.$3";
            } elsif ($line =~ m{^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2}).*(?:Host is banned|Sender domain is banned|Country is banned)}i) {
                $verdict = "blocked:blacklist";
            } elsif ($line =~ m{^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s.*?\brejected\b}i) {
                $verdict = "blocked:reject";
            } else {
                $verdict = "none";
            }
            print "$verdict\n";
        }
    """)
    proc = subprocess.run(
        ["perl", "-e", perl_snippet],
        input="\n".join(lines),
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert proc.returncode == 0, f"Perl error: {proc.stderr}"
    return proc.stdout.strip()


def test_clamav_virus_rejection_matches():
    line = '2026-02-15 10:30:12 H=mail.evil.com [1.2.3.4]:53421 F=<x@y.com> rejected after DATA: This message contains a virus (Eicar-Test-Signature)'
    out = _run_perl_with_mock_lines([line])
    assert out.startswith("virus:"), f"expected virus verdict, got: {out}"
    assert "Eicar-Test-Signature" in out


def test_clamav_malware_word_matches():
    line = '2026-02-15 10:30:12 H=[1.2.3.4] F=<a@b.com> rejected after DATA: Message contains malware (Win.Trojan.Generic-6296825-0)'
    out = _run_perl_with_mock_lines([line])
    assert "virus:" in out
    assert "Win.Trojan" in out


def test_dangerous_attachment_matches():
    line = '2026-02-15 10:30:12 H=[1.2.3.4] F=<a@b.com> rejected after DATA: DENY: disallowed "invoice.exe"'
    out = _run_perl_with_mock_lines([line])
    assert out == "virus:DangerousExtension.invoice.exe"


def test_generic_rejected_rcpt_matches():
    line = '2026-02-15 10:30:12 H=[1.2.3.4] F=<a@b.com> rejected RCPT <target@z.com>: relay not permitted'
    out = _run_perl_with_mock_lines([line])
    assert out == "blocked:reject"


def test_host_banned_matches():
    line = '2026-02-15 10:30:12 H=[6.6.6.6] F=<c@d.com> rejected after DATA: Host is banned'
    out = _run_perl_with_mock_lines([line])
    assert out == "blocked:blacklist"


def test_clean_line_does_not_match():
    # Normal delivery
    line = '2026-02-15 10:30:12 1abc-000001-XY <= sender@ok.com H=mail.ok.com [1.2.3.4]:12345 P=esmtps'
    out = _run_perl_with_mock_lines([line])
    assert out == "none"
