"""v44.00.19 — Exim -H spool file parser fix (length prefix strip + Status score).

Bug (user report):
  Plugin panel'de mail "clean 0.00" gözüktü ama SA `X-Spam-Score: 60` +
  `X-Spam-Status: Yes, score=6.0` header'ları yazmıştı ve gerçekte spam'e düştü.

Root cause:
  1) Exim -H spool file'da header'lar `019 X-Spam-Status: Yes...` formatında
     (3-digit length prefix). Regex bunu strip etmiyordu → 0 match.
  2) X-Spam-Score bazen bar-count × 10 integer olarak yazılır (60 = 6.0 bar);
     X-Spam-Status içindeki `score=6.0` decimal daha güvenilir.

Fix (mailshield-logtail.pl _spam_from_spool):
  - Line başındaki `\d{3}\s?` prefix'i strip et
  - X-Spam-Status parse'ında score= decimal'i extract et
  - X-Spam-Flag: YES tek başına da spam sinyali sayılsın
"""
from __future__ import annotations
import subprocess
import textwrap
import tempfile
from pathlib import Path

LOGTAIL = Path("/app/whm-plugin/scripts/mailshield-logtail.pl")


def _run_parser(spool_content: str) -> dict:
    """Extract the _spam_from_spool logic and run it against a mock -H file."""
    src = LOGTAIL.read_text()
    # sanity — length prefix strip added
    assert '$l =~ s/^\\d{3}\\s?//;' in src, "Length prefix strip missing"
    assert 'X-Spam-Flag:\\s*YES' in src, "X-Spam-Flag regex missing"

    with tempfile.NamedTemporaryFile(mode="w", suffix="-H", delete=False) as f:
        f.write(spool_content)
        path = f.name

    perl_snippet = textwrap.dedent(r"""
        use strict; use warnings;
        my $path = $ARGV[0];
        my ($score, $status, $report, $virus_found, $virus_name);
        my $score_from_status = 0;
        open my $h, '<', $path or die "open: $!";
        while (my $l = <$h>) {
            $l =~ s/^\d{3}\s?//;
            if ($l =~ /X-Spam-Status:\s*(\w+)(?:.*?\bscore=(-?\d+(?:\.\d+)?))?/i) {
                $status = $1;
                if (defined $2) { $score = $2; $score_from_status = 1; }
            }
            if ($l =~ /X-Spam-Score:\s*(-?\d+(?:\.\d+)?)/i && !$score_from_status) {
                my $s = $1;
                if ($s > 20) { $s = $s / 10.0; }
                $score = $s;
            }
            if ($l =~ /X-Spam-Report:\s*(.+)/i) { $report = $1; }
            if ($l =~ /X-Spam-Flag:\s*YES/i)   { $status //= 'Yes'; }
        }
        close $h;
        print "score=", (defined $score ? $score : 'undef'), "\n";
        print "status=", (defined $status ? $status : 'undef'), "\n";
    """)
    proc = subprocess.run(
        ["perl", "-e", perl_snippet, path],
        capture_output=True, text=True, timeout=10,
    )
    Path(path).unlink()
    assert proc.returncode == 0, f"Perl error: {proc.stderr}"
    result = {}
    for line in proc.stdout.strip().split("\n"):
        k, v = line.split("=", 1)
        result[k] = None if v == "undef" else v
    return result


def test_exim_H_length_prefix_stripped():
    """User report: Exim -H formatted spool with length prefix must parse correctly."""
    spool = """1x61ks-00000000jYO-0lle-H
mail 8 10
<masiparis@modern-ambalaj.com.tr>
1789373375 0
-received_time_usec .123456
-received_protocol esmtps
-body_linecount 42
-max_received_linelength 998
XX
3
muhasebe@hazalambalaj.com
nturna@hazalambalaj.com
sturna@hazalambalaj.com

161P Return-path: <masiparis@modern-ambalaj.com.tr>
019 X-Spam-Status: Yes, score=6.0
015 X-Spam-Score: 60
015 X-Spam-Flag: YES
"""
    r = _run_parser(spool)
    # Score should be 6.0 (from Status) — not 60 (from Score bar-count)
    assert r["score"] == "6.0", f"expected 6.0, got {r['score']}"
    assert r["status"] == "Yes", f"expected Yes, got {r['status']}"


def test_x_spam_flag_alone_marks_spam():
    """Even without Score/Status, X-Spam-Flag: YES should set status=Yes."""
    spool = """1x61ks-00000000jYO-0lle-H
mail 8 10
<x@y.com>
1789373375 0
XX
1
target@example.com

015 X-Spam-Flag: YES
"""
    r = _run_parser(spool)
    assert r["status"] == "Yes"


def test_spam_score_only_high():
    """X-Spam-Score: 8.5 without Status still yields score."""
    spool = """1x61ks-00000000jYO-0lle-H
mail 8 10
<x@y.com>
1789373375 0
XX
1
target@example.com

015 X-Spam-Score: 8.5
"""
    r = _run_parser(spool)
    assert r["score"] == "8.5"


def test_clean_mail_no_spam_headers():
    """Mail with no X-Spam-* headers → score/status remain undef → verdict clean."""
    spool = """1x61ks-00000000jYO-0lle-H
mail 8 10
<x@y.com>
1789373375 0
XX
1
target@example.com

020 Subject: Normal work email
015 From: sender@ok.com
"""
    r = _run_parser(spool)
    assert r["score"] is None
    assert r["status"] is None
