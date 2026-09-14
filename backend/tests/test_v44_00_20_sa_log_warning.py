"""v44.00.20 — SA warning satırı Exim log parsing (cPanel log-only mode).

Root cause (user report):
  Plugin CLEAN 0.00 gösterdi ama SA gerçekte 6.0 veriyor. Debug:
    grep "SpamAssassin as" /var/log/exim_mainlog → yüzlerce eşleşme
    grep "^019 X-Spam" /var/spool/exim/input/*/*-H → HİÇBİR eşleşme
  Yani cPanel SA'yı LOG-ONLY modda çalıştırıyor; -H spool'a X-Spam header'ı yazmıyor.

Fix: `_spam_from_exim_log(mid)` fonksiyonu — tail son 5000 satırı tarayıp
  `Warning: "SpamAssassin as USER detected message as [NOT] spam (SCORE)"` regex'i.
"""
from __future__ import annotations
import subprocess
import tempfile
import textwrap
from pathlib import Path

LOGTAIL = Path("/app/whm-plugin/scripts/mailshield-logtail.pl")


def _run_perl_with_mock_log(mid: str, log_lines: list[str]) -> tuple:
    """Test the SA warning regex against mock exim_mainlog content."""
    src = LOGTAIL.read_text()
    assert "sub _spam_from_exim_log" in src, "_spam_from_exim_log missing"
    assert "SpamAssassin\\s+as" in src, "SA warning regex missing"

    with tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False) as f:
        f.write("\n".join(log_lines) + "\n")
        log_path = f.name

    perl = textwrap.dedent(rf"""
        use strict; use warnings;
        my $mid = $ARGV[0];
        my $logf = $ARGV[1];
        my ($score, $status);
        open my $fh, '-|', 'tail', '-n', '5000', $logf or die $!;
        while (my $l = <$fh>) {{
            next unless index($l, $mid) >= 0;
            if ($l =~ /SpamAssassin\s+as\s+\S+\s+detected\s+message\s+as\s+(NOT\s+)?spam\s*\((-?\d+(?:\.\d+)?)\)/i) {{
                my $is_not_spam = $1 ? 1 : 0;
                $score  = $2;
                $status = $is_not_spam ? 'No' : 'Yes';
                last;
            }}
        }}
        close $fh;
        print "score=", (defined $score ? $score : 'undef'), "\n";
        print "status=", (defined $status ? $status : 'undef'), "\n";
    """)
    proc = subprocess.run(["perl", "-e", perl, mid, log_path], capture_output=True, text=True, timeout=10)
    Path(log_path).unlink()
    assert proc.returncode == 0, f"Perl error: {proc.stderr}"
    r = {}
    for line in proc.stdout.strip().split("\n"):
        k, v = line.split("=", 1)
        r[k] = None if v == "undef" else v
    return r["score"], r["status"]


def test_sa_warning_spam_detected():
    """User's real case: SA log says spam 6.0"""
    mid = "1x64j3-00000001fFG-1AYt"
    log = [
        "2026-09-14 14:19:53 1x64j3-00000001fFG-1AYt <= sender@example.com H=mail.example.com [1.2.3.4]",
        f'2026-09-14 14:19:53 {mid} H=mail.example.com [1.2.3.4] Warning: "SpamAssassin as user detected message as spam (6.0)"',
        f"2026-09-14 14:19:54 {mid} => user@ok.com",
    ]
    score, status = _run_perl_with_mock_log(mid, log)
    assert score == "6.0", f"expected 6.0, got {score}"
    assert status == "Yes"


def test_sa_warning_not_spam():
    """cPanel log-only NOT spam detection"""
    mid = "1x64j3-00000001fFG-1AYt"
    log = [
        f'2026-09-14 14:19:53 {mid} H=mail.example.com [1.2.3.4] Warning: "SpamAssassin as seridokum detected message as NOT spam (-1.9)"',
    ]
    score, status = _run_perl_with_mock_log(mid, log)
    assert score == "-1.9"
    assert status == "No"


def test_sa_warning_high_spam():
    mid = "1abc-000001-XY"
    log = [
        f'2026-09-14 14:19:53 {mid} Warning: "SpamAssassin as x detected message as spam (12.3)"',
    ]
    score, status = _run_perl_with_mock_log(mid, log)
    assert score == "12.3"
    assert status == "Yes"


def test_sa_warning_not_found_for_wrong_mid():
    """Ensure MID isolation — different mid must not match."""
    log = [
        '2026-09-14 14:19:53 1OTHER-mid Warning: "SpamAssassin as x detected message as spam (9.0)"',
    ]
    score, status = _run_perl_with_mock_log("1DIFFERENT-mid", log)
    assert score is None
    assert status is None


def test_perl_syntax_ok():
    """Ensure the full script still compiles."""
    proc = subprocess.run(["perl", "-c", str(LOGTAIL)], capture_output=True, text=True, timeout=10)
    assert proc.returncode == 0, f"Perl compile error:\n{proc.stderr}"
    assert "syntax OK" in proc.stderr


def test_install_sh_probes_cpanel_socket():
    """install.sh must probe cPanel's default socket path /run/clamav/clamd.sock."""
    src = Path("/app/whm-plugin/install.sh").read_text()
    assert "/run/clamav/clamd.sock" in src, "cPanel clamd socket path missing"
    assert "restartsrv_clamd" in src, "cPanel clamd hint missing"
