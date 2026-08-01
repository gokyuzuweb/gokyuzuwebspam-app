"""v25 batch tests — SmartPOS provider config + Havale statement match/upload."""
import os
import io
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback for local run
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---------------- payment config ----------------
def test_payments_config(s):
    r = s.get(f"{API}/payments/config", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "paytr_configured" in d
    assert "bank_iban" in d
    assert d["bank_iban"]
    assert d["bank_name"]
    assert d["bank_beneficiary"]


# ---------------- smart-pos providers ----------------
def test_smart_pos_providers_list(s):
    r = s.get(f"{API}/smart-pos/providers", timeout=20)
    assert r.status_code == 200
    d = r.json()
    provs = d["providers"]
    keys = {p["key"] for p in provs}
    # Must contain the core set required by the spec
    required = {"paytr", "iyzico", "param", "ipara", "havale",
                "garanti", "yapikredi", "akbank", "isbank", "ziraat",
                "halkbank", "vakifbank", "denizbank", "teb", "qnbfinansbank",
                "kuveytturk", "albaraka"}
    missing = required - keys
    assert not missing, f"Missing providers: {missing}"
    # Categories
    cats = {p["category"] for p in provs}
    assert {"gateway", "bank_pos", "manual"}.issubset(cats)
    # Print actual count for report
    print(f"Total providers: {len(provs)}  (gateway={sum(1 for p in provs if p['category']=='gateway')} "
          f"bank_pos={sum(1 for p in provs if p['category']=='bank_pos')} "
          f"manual={sum(1 for p in provs if p['category']=='manual')})")


# ---------------- provider config GET (masked) ----------------
def test_provider_config_get_paytr(s):
    r = s.get(f"{API}/smart-pos/provider/paytr/config", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["provider"] == "paytr"
    assert isinstance(d["fields"], list)
    field_names = {f["env_name"] for f in d["fields"]}
    assert {"PAYTR_MERCHANT_ID", "PAYTR_MERCHANT_KEY", "PAYTR_MERCHANT_SALT"}.issubset(field_names)
    for f in d["fields"]:
        assert "has_value" in f
        assert "sensitive" in f
        assert "value_masked" in f
    # KEY/SALT should be sensitive
    sensitive_map = {f["env_name"]: f["sensitive"] for f in d["fields"]}
    assert sensitive_map["PAYTR_MERCHANT_KEY"] is True
    assert sensitive_map["PAYTR_MERCHANT_SALT"] is True


def test_provider_config_get_unknown(s):
    r = s.get(f"{API}/smart-pos/provider/notarealprovider/config", timeout=15)
    assert r.status_code == 404


# ---------------- provider config POST + persistence + test ----------------
def test_provider_config_post_and_test_paytr(s):
    # Use garanti to avoid modifying PayTR env used elsewhere in tests
    payload = {
        "values": {
            "GARANTI_MERCHANT_ID": "TEST_MID_v25",
            "GARANTI_TERMINAL_ID": "TEST_TID_v25",
            "GARANTI_USERID": "TEST_USER_v25",
            "GARANTI_PROVISIONPWD": "TEST_PWD_v25",
        },
        "test_mode": True,
        "enabled": True,
    }
    r = s.post(f"{API}/smart-pos/provider/garanti/config", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is True
    assert d["configured_fields"] == 4
    assert d["total_fields"] == 4

    # Verify persistence via GET
    r2 = s.get(f"{API}/smart-pos/provider/garanti/config", timeout=15)
    assert r2.status_code == 200
    g = r2.json()
    for f in g["fields"]:
        assert f["has_value"] is True

    # Test endpoint: since all fields are set, should be ok=true
    r3 = s.post(f"{API}/smart-pos/provider/garanti/test", timeout=15)
    assert r3.status_code == 200
    t = r3.json()
    assert t["ok"] is True


def test_provider_test_missing_fields(s):
    # Pick a provider very unlikely to be configured
    r = s.post(f"{API}/smart-pos/provider/albaraka/test", timeout=15)
    assert r.status_code == 200
    d = r.json()
    # If not configured, ok=False + missing list
    if not d.get("ok"):
        assert "missing" in d and isinstance(d["missing"], list) and len(d["missing"]) > 0


# ---------------- statement match ----------------
def test_havale_statement_match_no_refs(s):
    r = s.post(f"{API}/payments/havale/statement-match",
               json={"raw_text": "some random text with no references at all!!", "auto_approve": False},
               timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] is False
    assert d["matches"] == []


def test_havale_statement_match_full_flow(s):
    # 1. Create a havale order
    email = f"TEST_v25_{uuid.uuid4().hex[:8]}@example.com"
    amount = 1499.00
    r = s.post(f"{API}/payments/havale/create",
               json={"email": email, "user_name": "V25 Test User",
                     "amount": amount, "plan": "premium"},
               timeout=15)
    assert r.status_code == 200, r.text
    order = r.json()
    ref = order["reference"]
    assert ref.startswith("TRF")

    # 2. Build a bank-statement text that includes the ref and TL amount
    # Turkish bank statement format: "1.499,00" (period=thousands, comma=decimal)
    tr_amount = f"{int(amount):,}".replace(",", ".") + ",00"  # "1.499,00"
    statement = (
        "TARIH        ACIKLAMA                                       TUTAR\n"
        f"15/03/2026   GELEN HAVALE {ref} - {tr_amount} TL\n"
        "16/03/2026   MUSTERI ODEMESI - baska bir islem              50,00 TL\n"
        "17/03/2026   TRFDEADBEEF00000000000DEADBEEF - 99,00 TL       (bilinmeyen)\n"
    )

    # 3. Match without auto_approve
    r2 = s.post(f"{API}/payments/havale/statement-match",
                json={"raw_text": statement, "auto_approve": False}, timeout=15)
    assert r2.status_code == 200, r2.text
    d = r2.json()
    assert d["ok"] is True
    assert d["refs_found"] >= 1
    m_refs = {m["merchant_oid"] for m in d["matches"]}
    assert ref in m_refs
    # Our ref should have detected amount
    row = next(m for m in d["matches"] if m["merchant_oid"] == ref)
    assert row["expected_amount"] == amount
    assert row["confidence"] == 100
    # unmatched should include the bogus ref
    assert "TRFDEADBEEF00000000000DEADBEEF"[:23] in " ".join(d["unmatched_refs"]) or len(d["unmatched_refs"]) >= 1

    # 4. Match with auto_approve=True → should mark paid
    r3 = s.post(f"{API}/payments/havale/statement-match",
                json={"raw_text": statement, "auto_approve": True}, timeout=15)
    assert r3.status_code == 200
    d3 = r3.json()
    assert ref in d3["auto_approved"]

    # 5. Verify persistence via /orders
    r4 = s.get(f"{API}/payments/order/{ref}", timeout=15)
    assert r4.status_code == 200
    o = r4.json()
    assert o["status"] == "paid"
    assert o.get("approved_by") == "auto_statement_match"


# ---------------- statement upload TXT / CSV / PDF ----------------
def test_havale_statement_upload_txt(s):
    content = b"15/03/2026 GELEN HAVALE TRFAAAAAAAAAAAAAAAAAAAA 100,00 TL\n"
    files = {"file": ("ekstre.txt", content, "text/plain")}
    r = s.post(f"{API}/payments/havale/statement-upload", files=files, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is True
    assert "TRFAAAAAAAAAAAAAAAAAAAA" in d["extracted_text"]


def test_havale_statement_upload_csv_turkish_encoding(s):
    # iso-8859-9 (Turkish) encoded content
    text = "Tarih,Aciklama,Tutar\n15/03/2026,GELEN HAVALE TRFBBBBBBBBBBBBBBBBBBBB Türkçe ğüşç,150,00\n"
    content = text.encode("iso-8859-9")
    files = {"file": ("ekstre.csv", content, "text/csv")}
    r = s.post(f"{API}/payments/havale/statement-upload", files=files, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is True
    assert "TRFBBBBBBBBBBBBBBBBBBBB" in d["extracted_text"]


def test_havale_statement_upload_pdf(s):
    # Build a tiny PDF using pypdf/reportlab if available; else skip
    try:
        from reportlab.pdfgen import canvas
    except ImportError:
        pytest.skip("reportlab not installed - PDF generation test skipped")
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(100, 750, "15/03/2026 GELEN HAVALE TRFCCCCCCCCCCCCCCCCCCCC 200,00 TL")
    c.showPage()
    c.save()
    pdf_bytes = buf.getvalue()
    files = {"file": ("ekstre.pdf", pdf_bytes, "application/pdf")}
    r = s.post(f"{API}/payments/havale/statement-upload", files=files, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is True
    assert d["pages"] >= 1
    assert "TRFCCCCCCCCCCCCCCCCCCCC" in d["extracted_text"]


def test_havale_statement_upload_empty(s):
    files = {"file": ("empty.txt", b"", "text/plain")}
    r = s.post(f"{API}/payments/havale/statement-upload", files=files, timeout=15)
    assert r.status_code == 400
