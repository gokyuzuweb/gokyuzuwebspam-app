"""v44.00.50 — Version consistency guard.

Sorun: `/app/VERSION`, `/app/backend/VERSION`, `/app/whm-plugin/VERSION` ve
`server.py::_PACKAGE_VERSION` fallback'i drift olabilir. Bir tanesi eski
kalırsa bayi `gwsm-update` "zaten güncel" der ve gerçek surumu almaz.

Bu test hepsinin eşit olduğunu garanti eder — herhangi biri değişirse fail
verir, main agent 4'ünü de aynı anda bumplamak zorunda kalır.
"""
import re
from pathlib import Path


VERSIONS = {
    "root":    Path("/app/VERSION"),
    "backend": Path("/app/backend/VERSION"),
    "plugin":  Path("/app/whm-plugin/VERSION"),
}


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8").strip()


def test_all_version_files_equal():
    values = {k: _read(v) for k, v in VERSIONS.items()}
    unique = set(values.values())
    assert len(unique) == 1, (
        f"VERSION drift! Tum dosyalar ayni olmali:\n  " +
        "\n  ".join(f"{k}: {v}" for k, v in values.items())
    )


def test_server_py_package_version_matches():
    src = Path("/app/backend/server.py").read_text(encoding="utf-8")
    m = re.search(r'_PACKAGE_VERSION\s*=\s*"([^"]+)"', src)
    assert m, "_PACKAGE_VERSION tanimlanmamis"
    fallback = m.group(1)
    root = _read(VERSIONS["root"])
    assert fallback == root, (
        f"server.py::_PACKAGE_VERSION ({fallback}) != /app/VERSION ({root}). "
        "Ikisi bumplama sirasinda birlikte guncellenmeli."
    )


def test_version_format_valid():
    """vXX.YY.ZZ formatinda olmali."""
    for k, p in VERSIONS.items():
        v = _read(p)
        assert re.match(r"^v\d+\.\d+\.\d+$", v), f"{k}: gecersiz format '{v}'"
