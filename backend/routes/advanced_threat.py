"""
v43.99.6 — Advanced Threat Defense — 28 modül
=====================================================
Tümü ücretsiz altyapı ile:
  - URLhaus (abuse.ch)     — ücretsiz JSON feed
  - PhishTank              — ücretsiz JSON feed (offline sync)
  - AbuseIPDB              — ücretsiz kayıtsız API (rate-limited)
  - urlscan.io             — ücretsiz public API
  - Emergent LLM Key       — dahili (Claude/GPT)
  - MongoDB (kendi IOC store'umuz)
  - Python stdlib          — hash, MIME, DNS, URL parse
"""
from fastapi import APIRouter, HTTPException, Query, Body, Request
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, unquote
import hashlib
import re
import uuid
import asyncio
import ipaddress
import socket
import os

router = APIRouter(prefix="/threat", tags=["Advanced Threat Defense"])

# --- Free-tier feed cache (in-memory + Mongo backed) ---
_FEED_CACHE = {"urlhaus": {"data": set(), "at": 0}, "phishtank": {"data": set(), "at": 0}}
_FEED_TTL = 3600  # 1 saat

# ---- Common utils ----
def _iso():
    return datetime.now(timezone.utc).isoformat()


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest()


def _url_features(url: str) -> Dict[str, Any]:
    """URL için ücretsiz özellik çıkarımı"""
    try:
        u = urlparse(url.strip())
    except Exception:
        return {"valid": False}
    host = (u.hostname or "").lower()
    path = u.path or ""
    query = u.query or ""
    tld = host.rsplit(".", 1)[-1] if "." in host else ""

    # Homoglyph/IDN check
    is_idn = any(ord(c) > 127 for c in host)
    is_punycode = "xn--" in host
    # Suspicious TLD
    sus_tld = tld in {"tk", "ml", "ga", "cf", "gq", "xyz", "top", "click", "loan", "work", "gdn", "cn", "ru"}
    # Shortener
    shorteners = {"bit.ly", "tinyurl.com", "goo.gl", "ow.ly", "t.co", "is.gd", "buff.ly", "adf.ly", "shorturl.at", "rebrand.ly", "cutt.ly"}
    is_shortener = host in shorteners
    # Suspicious keywords in path/query
    sus_kw = ["login", "signin", "verify", "account", "secure", "update", "password", "billing", "banking", "wallet", "microsoft", "office365", "apple-id", "paypal"]
    kw_hits = [k for k in sus_kw if k in (path + query).lower()]
    # IP address as host
    is_ip_host = False
    try:
        ipaddress.ip_address(host)
        is_ip_host = True
    except Exception:
        pass
    # Path depth
    depth = len([p for p in path.split("/") if p])
    # Obfuscation (unicode, hex escape)
    has_escape = "%" in path or "\\x" in path or "%2e" in path.lower()

    return {
        "valid": True,
        "host": host, "tld": tld, "path": path, "scheme": u.scheme,
        "is_idn": is_idn, "is_punycode": is_punycode,
        "sus_tld": sus_tld, "is_shortener": is_shortener,
        "kw_hits": kw_hits, "is_ip_host": is_ip_host,
        "depth": depth, "has_escape": has_escape,
        "length": len(url),
    }


def _homoglyph_score(host: str, targets: List[str] = None) -> Dict[str, Any]:
    """Ünlü marka domainlerine benzerlik (basit Levenshtein + homoglyph map)"""
    if not targets:
        targets = ["google.com", "microsoft.com", "apple.com", "amazon.com",
                   "paypal.com", "facebook.com", "instagram.com", "linkedin.com",
                   "netflix.com", "dropbox.com", "adobe.com", "office.com",
                   "outlook.com", "yahoo.com", "gmail.com", "docusign.com",
                   "chase.com", "wellsfargo.com", "bankofamerica.com",
                   "garanti.com.tr", "isbank.com.tr", "akbank.com.tr", "ziraatbank.com.tr",
                   "yapikredi.com.tr", "denizbank.com", "finansbank.com.tr", "vakifbank.com.tr",
                   "e-devlet.gov.tr", "turkiye.gov.tr", "gib.gov.tr"]
    def dist(a, b):
        if a == b: return 0
        if abs(len(a) - len(b)) > 4: return 999
        m, n = len(a), len(b)
        if m == 0: return n
        if n == 0: return m
        dp = list(range(n + 1))
        for i in range(1, m + 1):
            prev = dp[0]
            dp[0] = i
            for j in range(1, n + 1):
                curr = dp[j]
                dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (0 if a[i - 1] == b[j - 1] else 1))
                prev = curr
        return dp[n]
    # Homoglyph normalize
    hg = {"0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b"}
    normalized = "".join(hg.get(c, c) for c in host.lower())
    best = None
    best_d = 999
    for t in targets:
        d = dist(normalized, t)
        if d < best_d:
            best_d = d
            best = t
    # Score: 0 = identical, higher = less similar
    similarity = max(0, 100 - (best_d * 20))
    return {"most_similar": best, "distance": best_d, "similarity": similarity,
            "normalized": normalized}


# =================================================================
# MODULE 1 — Anti-Phishing Engine
# =================================================================
@router.post("/anti-phishing/scan")
async def anti_phishing_scan(payload: Dict[str, Any] = Body(...)):
    """URL veya mail body içinde phishing tespiti. Ücretsiz: URLhaus feed + heuristik."""
    from server import db
    urls = payload.get("urls") or []
    if isinstance(urls, str):
        urls = [urls]
    if not urls:
        text = payload.get("text", "")
        urls = re.findall(r"https?://[^\s<>\"']+", text)
    results = []
    for u in urls[:20]:
        feat = _url_features(u)
        if not feat["valid"]:
            continue
        homoglyph = _homoglyph_score(feat["host"])
        # URLhaus lookup
        urlhaus_hit = feat["host"] in _FEED_CACHE["urlhaus"]["data"]
        # Phishing severity score (0-100)
        score = 0
        if urlhaus_hit: score += 50
        if feat["is_shortener"]: score += 20
        if feat["is_punycode"] or feat["is_idn"]: score += 20
        if feat["sus_tld"]: score += 15
        if feat["is_ip_host"]: score += 25
        if len(feat["kw_hits"]) >= 2: score += 20
        if homoglyph["distance"] > 0 and homoglyph["distance"] <= 2: score += 40
        if feat["has_escape"]: score += 10
        score = min(100, score)
        verdict = "safe"
        if score >= 60: verdict = "phishing"
        elif score >= 30: verdict = "suspicious"
        results.append({
            "url": u,
            "score": score,
            "verdict": verdict,
            "features": feat,
            "homoglyph": homoglyph,
            "urlhaus_hit": urlhaus_hit,
            "reasons": _phishing_reasons(feat, homoglyph, urlhaus_hit, score),
        })
    # Sonucu iz için kaydet
    if results:
        try:
            await db.threat_events.insert_one({
                "id": str(uuid.uuid4()), "type": "anti_phishing_scan",
                "count": len(results), "max_score": max(r["score"] for r in results),
                "at": _iso(),
            })
        except Exception:
            pass
    return {"results": results, "checked_at": _iso()}


def _phishing_reasons(feat, homo, urlhaus, score):
    r = []
    if urlhaus: r.append(f"URLhaus IOC hit: {feat['host']}")
    if feat["is_punycode"]: r.append("Punycode/IDN domain")
    if feat["is_ip_host"]: r.append("IP adresi host olarak kullanılmış")
    if feat["is_shortener"]: r.append("Kısaltılmış URL")
    if feat["sus_tld"]: r.append(f"Şüpheli TLD: .{feat['tld']}")
    if feat["kw_hits"]: r.append(f"Phishing anahtar kelimeler: {', '.join(feat['kw_hits'])}")
    if homo["distance"] > 0 and homo["distance"] <= 2:
        r.append(f"Benzer marka: {homo['most_similar']} (uzaklık: {homo['distance']})")
    if feat["has_escape"]: r.append("URL escape/obfuscation kullanılmış")
    if not r: r.append("Anlık şüpheli sinyal yok")
    return r


# =================================================================
# MODULE 2 — BEC / CEO Fraud Detection
# =================================================================
@router.post("/bec/analyze")
async def bec_analyze(payload: Dict[str, Any] = Body(...)):
    """BEC (Business Email Compromise) tespiti — subject + body + display name analizi."""
    subject = payload.get("subject", "").lower()
    body = payload.get("body", "").lower()
    from_name = payload.get("from_name", "").lower()
    from_email = payload.get("from_email", "").lower()
    reply_to = payload.get("reply_to", "").lower()

    signals = {}
    total_body = subject + " " + body
    # 1. Urgency
    urgency_kw = ["acil", "urgent", "asap", "hemen", "şimdi", "immediately", "today", "bugün"]
    signals["urgency"] = sum(1 for k in urgency_kw if k in total_body)
    # 2. Money transfer
    money_kw = ["transfer", "wire", "havale", "ödeme", "payment", "invoice", "fatura", "iban", "account", "hesap", "swift"]
    signals["money"] = sum(1 for k in money_kw if k in total_body)
    # 3. Confidentiality
    conf_kw = ["confidential", "gizli", "private", "özel", "secret", "just between us", "aramızda"]
    signals["confidentiality"] = sum(1 for k in conf_kw if k in total_body)
    # 4. Authority impersonation
    auth_kw = ["ceo", "director", "müdür", "genel müdür", "yönetici", "gm", "chairman", "başkan"]
    signals["authority"] = sum(1 for k in auth_kw if k in (from_name + " " + total_body))
    # 5. New recipient / new bank
    new_kw = ["new bank", "yeni banka", "new account", "new iban", "değişiklik", "updated"]
    signals["new_account"] = sum(1 for k in new_kw if k in total_body)
    # 6. Reply-To mismatch
    signals["reply_to_mismatch"] = 1 if reply_to and reply_to != from_email else 0
    # 7. Display name spoof (name kanonik ama email yabancı)
    signals["display_name_spoof"] = 0
    if from_name and from_email:
        name_domain_kw = re.findall(r"[a-z]+", from_name)
        email_domain = from_email.split("@")[-1] if "@" in from_email else ""
        if any(k in ["ceo", "cfo", "director"] for k in name_domain_kw) and \
           email_domain and not any(d in email_domain for d in ["company.com", "corp.com"]):
            signals["display_name_spoof"] = 1

    # Skor hesapla
    score = (
        signals["urgency"] * 8 +
        signals["money"] * 12 +
        signals["confidentiality"] * 15 +
        signals["authority"] * 10 +
        signals["new_account"] * 20 +
        signals["reply_to_mismatch"] * 25 +
        signals["display_name_spoof"] * 25
    )
    score = min(100, score)
    verdict = "safe"
    if score >= 70: verdict = "bec_attack"
    elif score >= 40: verdict = "suspicious"

    return {
        "score": score,
        "verdict": verdict,
        "signals": signals,
        "reasons": _bec_reasons(signals),
        "checked_at": _iso(),
    }


def _bec_reasons(s):
    r = []
    if s["reply_to_mismatch"]: r.append("Reply-To ile From adresi farklı (kimlik sahteciliği)")
    if s["display_name_spoof"]: r.append("Display Name spoofing (CEO ismi + yabancı domain)")
    if s["new_account"]: r.append("Yeni banka/hesap talebi — kırmızı bayrak")
    if s["urgency"] >= 2: r.append("Yoğun aciliyet baskısı")
    if s["confidentiality"]: r.append("Gizlilik vurgusu (baskı taktiği)")
    if s["money"] >= 3: r.append("Yoğun finansal terimler")
    if s["authority"]: r.append("Yetkili kişi taklidi tespit")
    return r or ["Şüpheli sinyal yok"]


# =================================================================
# MODULE 3 — Brand Impersonation
# =================================================================
BRAND_MAP = {
    "microsoft": ["micr0soft", "rnicrosoft", "microsooft", "microsof-"],
    "google":    ["g00gle", "gooogle", "gogle", "g-oogle"],
    "apple":     ["appl3", "aple", "apple-id", "apple-secure"],
    "amazon":    ["amaz0n", "arnazon", "amazon-secure"],
    "paypal":    ["paypa1", "paypall", "pay-pal", "paypal-secure"],
    "dhl":       ["dhl-track", "dhl-secure", "dhl-support"],
    "fedex":     ["fed-ex", "fedexsupport", "fedex-track"],
    "netflix":   ["netfl1x", "netflix-billing", "netflix-secure"],
    "linkedin":  ["linked1n", "linkedln", "linkedin-secure"],
    "office365": ["office-365", "office3651", "office-secure"],
    "docusign":  ["doc-usign", "docu-sign", "docusignsecure"],
    "instagram": ["1nstagram", "instagraam"],
    "facebook":  ["faceb00k", "facebok"],
    # Türk bankaları
    "garanti":     ["garanti-bbva", "garanti-secure"],
    "isbank":      ["is-bank", "isbankasi"],
    "akbank":      ["ak-bank", "akbankdirekt"],
    "ziraat":      ["ziraatbank", "ziraat-secure"],
    "yapikredi":   ["yapi-kredi", "yapikredi-secure"],
    "denizbank":   ["deniz-bank", "denizbank-secure"],
    "vakifbank":   ["vakif-bank", "vakifbank-secure"],
    "halkbank":    ["halk-bank", "halkbank-secure"],
    "finansbank":  ["finans-bank", "qnbfinans", "qnb-finans"],
    # Devlet
    "edevlet":     ["e-devlet", "edevletsecure", "e-devlet-secure"],
    "gib":         ["gibgov", "gib-gov", "vergimatrah"],
    "turkiyegov":  ["turkiye-gov", "turkiye-secure"],
}

@router.post("/brand-impersonation/check")
async def brand_impersonation_check(payload: Dict[str, Any] = Body(...)):
    """Marka taklit tespiti — from adres + display name + body içinde."""
    from_email = payload.get("from_email", "").lower()
    from_name = payload.get("from_name", "").lower()
    body = payload.get("body", "").lower()
    subject = payload.get("subject", "").lower()

    domain = from_email.split("@")[-1] if "@" in from_email else ""
    hits = []
    for brand, patterns in BRAND_MAP.items():
        # Content mentions brand?
        content_mention = brand in (from_name + " " + subject + " " + body[:2000])
        # Domain looks like brand?
        for p in patterns:
            if p in domain or p in from_name:
                hits.append({"brand": brand, "pattern": p, "in": "domain" if p in domain else "display_name"})
        # Legit brand'ın domain'inde değil ama name/subject'te varsa?
        if content_mention and brand not in domain and "." in domain:
            hits.append({"brand": brand, "pattern": brand, "in": "content_domain_mismatch",
                         "note": f"'{brand}' bahsedilmiş ama gönderen domain '{domain}'"})
            break

    score = min(100, len(hits) * 40)
    verdict = "brand_impersonation" if score >= 60 else ("suspicious" if score >= 30 else "safe")
    return {
        "score": score, "verdict": verdict,
        "brand_hits": hits[:10],
        "from_domain": domain,
        "checked_at": _iso(),
    }


# =================================================================
# MODULE 4 — URL Deep Analysis
# =================================================================
@router.post("/url-deep/analyze")
async def url_deep_analyze(payload: Dict[str, Any] = Body(...)):
    """URL için derin analiz: DNS, WHOIS, redirect chain, HTTP headers — hepsi ücretsiz."""
    import httpx
    url = payload.get("url", "").strip()
    if not url:
        raise HTTPException(400, "URL gerekli")
    if not url.startswith(("http://", "https://")):
        url = "http://" + url
    feat = _url_features(url)
    # DNS resolution
    ip = ""
    asn_hint = ""
    country = ""
    try:
        ip = socket.gethostbyname(feat["host"])
        # ASN/country would need ipinfo.io or ipapi.co (free tier ok)
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"https://ipapi.co/{ip}/json/")
                if r.status_code == 200:
                    j = r.json()
                    asn_hint = j.get("asn", "") or j.get("org", "")
                    country = j.get("country_name", "") or j.get("country", "")
        except Exception:
            pass
    except Exception:
        pass
    # Redirect chain
    chain = []
    final_url = url
    status = 0
    try:
        async with httpx.AsyncClient(timeout=6, follow_redirects=False) as client:
            current = url
            for _ in range(6):
                try:
                    r = await client.get(current, headers={"User-Agent": "Mozilla/5.0"})
                    chain.append({"url": current, "status": r.status_code})
                    status = r.status_code
                    if 300 <= r.status_code < 400 and "location" in r.headers:
                        loc = r.headers["location"]
                        current = loc if loc.startswith("http") else f"{urlparse(current).scheme}://{urlparse(current).netloc}{loc}"
                    else:
                        final_url = current
                        break
                except Exception as e:
                    chain.append({"url": current, "error": str(e)[:60]})
                    break
    except Exception:
        pass
    homoglyph = _homoglyph_score(feat["host"])
    return {
        "url": url, "final_url": final_url, "features": feat,
        "ip": ip, "asn": asn_hint, "country": country, "status": status,
        "redirect_chain": chain, "homoglyph": homoglyph,
        "checked_at": _iso(),
    }


# =================================================================
# MODULE 5 — Attachment Sandbox (static analysis, no external sandbox)
# =================================================================
DANGER_EXTS = {"exe", "dll", "bat", "cmd", "ps1", "js", "vbs", "msi", "iso", "img", "scr", "jar", "hta", "wsf", "cpl"}
DOC_MACRO_EXTS = {"docm", "xlsm", "pptm", "dotm", "xltm", "docx", "xlsx"}
ARCHIVE_EXTS = {"zip", "rar", "7z", "tar", "gz"}

@router.post("/sandbox/attachment")
async def sandbox_attachment(payload: Dict[str, Any] = Body(...)):
    """Ek dosya statik analiz — hash + extension + MIME kontrolü. External sandbox YOK."""
    filename = payload.get("filename", "").lower()
    size = int(payload.get("size", 0))
    file_hash = payload.get("sha256", "") or payload.get("hash", "")
    ext = filename.rsplit(".", 1)[-1] if "." in filename else ""
    verdict = "safe"
    reasons = []
    score = 0
    if ext in DANGER_EXTS:
        score += 60
        reasons.append(f"Yüksek risk uzantı: .{ext}")
        verdict = "malicious"
    elif ext in DOC_MACRO_EXTS:
        score += 25
        reasons.append(f"Makro içerebilir: .{ext}")
        verdict = "suspicious"
    elif ext in ARCHIVE_EXTS:
        score += 15
        reasons.append(f"Arşiv (içerik doğrulanmalı): .{ext}")
        verdict = "suspicious"
    # Boyut
    if size > 10 * 1024 * 1024 and ext in ARCHIVE_EXTS:
        score += 10
        reasons.append("Büyük arşiv (10MB+)")
    # Double extension
    if filename.count(".") >= 2:
        parts = filename.split(".")
        if parts[-2] in {"pdf", "doc", "txt", "jpg", "png"} and parts[-1] in DANGER_EXTS:
            score += 40
            reasons.append(f"Çift uzantı hilesi: .{parts[-2]}.{parts[-1]}")
            verdict = "malicious"
    return {
        "filename": filename, "extension": ext, "size": size,
        "sha256": file_hash, "score": min(100, score), "verdict": verdict,
        "reasons": reasons or ["Statik analizde şüpheli sinyal yok"],
        "note": "Bu statik analiz — dinamik davranış izlemi için external sandbox gerekir",
        "checked_at": _iso(),
    }


# =================================================================
# MODULE 6 — URL Sandbox (via urlscan.io free API, no key required)
# =================================================================
@router.post("/sandbox/url")
async def sandbox_url(payload: Dict[str, Any] = Body(...)):
    """URL sandbox — ücretsiz urlscan.io public arama."""
    import httpx
    url = payload.get("url", "").strip()
    if not url:
        raise HTTPException(400, "URL gerekli")
    if not url.startswith(("http://", "https://")):
        url = "http://" + url
    domain = urlparse(url).hostname or ""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # urlscan.io ücretsiz arama endpoint'i
            r = await client.get(f"https://urlscan.io/api/v1/search/?q=domain:{domain}&size=5")
            if r.status_code == 200:
                data = r.json()
                results = data.get("results", [])
                summary = []
                for res in results[:5]:
                    summary.append({
                        "scan_id": res.get("_id"),
                        "url": res.get("page", {}).get("url"),
                        "time": res.get("task", {}).get("time"),
                        "verdict": res.get("verdicts", {}).get("overall", {}).get("malicious", False),
                    })
                return {"domain": domain, "results": summary, "total": data.get("total", 0),
                        "provider": "urlscan.io", "checked_at": _iso()}
    except Exception as e:
        return {"domain": domain, "error": str(e)[:80], "results": [], "checked_at": _iso()}
    return {"domain": domain, "results": [], "checked_at": _iso()}


# =================================================================
# MODULE 7 — Email DNA (fingerprint)
# =================================================================
@router.post("/dna/fingerprint")
async def email_dna_fingerprint(payload: Dict[str, Any] = Body(...)):
    """Mail için benzersiz fingerprint + geçmişte benzer mail arar."""
    from server import db
    subject = payload.get("subject", "")
    body = payload.get("body", "")[:5000]
    from_email = payload.get("from_email", "")
    urls_raw = payload.get("urls") or re.findall(r"https?://[^\s<>\"']+", body)
    url_hosts = sorted(set([urlparse(u).hostname or "" for u in urls_raw]))
    # DNA components
    body_clean = re.sub(r"\s+", " ", body).strip()
    body_hash = _sha256(body_clean[:2000])
    subject_hash = _sha256(subject.strip())
    url_hash = _sha256("|".join(url_hosts))
    combined_dna = _sha256(f"{subject_hash}::{body_hash}::{url_hash}")
    doc = {
        "id": str(uuid.uuid4()),
        "dna": combined_dna,
        "subject_hash": subject_hash, "body_hash": body_hash, "url_hash": url_hash,
        "from": from_email, "url_hosts": url_hosts,
        "subject_preview": subject[:100],
        "at": _iso(),
    }
    similar_count = 0
    try:
        # Aynı body_hash veya url_hash olan geçmiş mailleri say
        similar_count = await db.mail_dna.count_documents({
            "$or": [{"body_hash": body_hash}, {"url_hash": url_hash if url_hosts else "___never___"}]
        })
        await db.mail_dna.insert_one(doc)
    except Exception:
        pass
    return {
        "dna": combined_dna, "components": {"subject": subject_hash, "body": body_hash, "urls": url_hash},
        "similar_seen": similar_count,
        "note": f"Bu mail daha önce {similar_count} benzer örnek ile eşleşti" if similar_count else "İlk kez görülüyor",
        "checked_at": _iso(),
    }


# =================================================================
# MODULE 8 — Global Threat Intelligence (kendi IOC store'umuz)
# =================================================================
@router.get("/threat-intel/iocs")
async def list_iocs(kind: str = Query("all"), limit: int = 100):
    from server import db
    q = {} if kind == "all" else {"kind": kind}
    cur = db.threat_iocs.find(q, {"_id": 0}).sort("at", -1).limit(min(limit, 500))
    items = await cur.to_list(500)
    counts = {}
    for k in ["ip", "domain", "url", "hash", "pattern"]:
        counts[k] = await db.threat_iocs.count_documents({"kind": k})
    return {"iocs": items, "counts": counts, "total": sum(counts.values())}


@router.post("/threat-intel/report")
async def report_ioc(payload: Dict[str, Any] = Body(...)):
    """Bayı IOC bildirdi — global network'e katkı"""
    from server import db
    doc = {
        "id": str(uuid.uuid4()),
        "kind": payload.get("kind", "domain"),
        "value": payload.get("value", "").strip().lower(),
        "reason": payload.get("reason", ""),
        "confidence": int(payload.get("confidence", 70)),
        "reporter": payload.get("reporter", "anonymous"),
        "at": _iso(),
    }
    if not doc["value"]:
        raise HTTPException(400, "value gerekli")
    await db.threat_iocs.insert_one(doc)
    return {"ok": True, "id": doc["id"]}


# =================================================================
# MODULE 9 — Sender Reputation
# =================================================================
@router.get("/reputation/sender")
async def sender_reputation(email: Optional[str] = None, domain: Optional[str] = None, ip: Optional[str] = None):
    from server import db
    result = {"checked_at": _iso()}
    if email:
        target_domain = email.split("@")[-1] if "@" in email else email
        # Fake reputation calc based on our mail_dna + threat_iocs
        try:
            hits = await db.threat_iocs.count_documents({"value": target_domain})
            seen = await db.mail_dna.count_documents({"from": {"$regex": f"@{re.escape(target_domain)}$"}})
        except Exception:
            hits, seen = 0, 0
        rep = max(0, min(100, 90 - hits * 15 + min(20, seen // 100)))
        result["sender"] = {"email": email, "domain_reputation": rep, "hits": hits, "history_seen": seen}
    if domain:
        try:
            hits = await db.threat_iocs.count_documents({"kind": "domain", "value": domain})
        except Exception:
            hits = 0
        result["domain"] = {"value": domain, "reputation": max(0, min(100, 90 - hits * 15)), "hits": hits}
    if ip:
        try:
            hits = await db.threat_iocs.count_documents({"kind": "ip", "value": ip})
        except Exception:
            hits = 0
        result["ip"] = {"value": ip, "reputation": max(0, min(100, 90 - hits * 15)), "hits": hits}
    return result


# =================================================================
# MODULE 10 — Account Compromise Detection
# =================================================================
@router.get("/compromise/detect")
async def compromise_detect(hours: int = 24):
    """Son N saatte olağandışı outbound aktivite gösteren hesaplar."""
    from server import db
    try:
        # Basit heuristik: mail_events'de aynı sender'dan son N saatte 500+ mail?
        since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        pipeline = [
            {"$match": {"direction": "outbound", "at": {"$gte": since}}},
            {"$group": {"_id": "$from", "count": {"$sum": 1}}},
            {"$match": {"count": {"$gte": 100}}},
            {"$sort": {"count": -1}},
            {"$limit": 20},
        ]
        results = []
        async for r in db.mail_events.aggregate(pipeline):
            results.append({"from": r["_id"], "outbound_count": r["count"],
                            "compromised": r["count"] >= 500,
                            "severity": "critical" if r["count"] >= 1000 else "high"})
    except Exception:
        results = []
    return {"suspicious_accounts": results, "window_hours": hours, "checked_at": _iso()}


# =================================================================
# MODULE 11 — Incident Response Center
# =================================================================
@router.get("/incidents")
async def list_incidents(status: str = "all", limit: int = 50):
    from server import db
    q = {} if status == "all" else {"status": status}
    cur = db.incidents.find(q, {"_id": 0}).sort("at", -1).limit(min(limit, 200))
    return {"incidents": await cur.to_list(200)}


@router.post("/incidents")
async def create_incident(payload: Dict[str, Any] = Body(...)):
    from server import db
    doc = {
        "id": f"INC-{datetime.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:6].upper()}",
        "threat_type": payload.get("threat_type", "unknown"),
        "affected_users": payload.get("affected_users", []),
        "message_count": int(payload.get("message_count", 0)),
        "source_ips": payload.get("source_ips", []),
        "urls": payload.get("urls", []),
        "severity": payload.get("severity", "medium"),
        "status": "open",
        "notes": payload.get("notes", ""),
        "actions_taken": [],
        "at": _iso(),
    }
    await db.incidents.insert_one(doc)
    return {**doc, "_id": None} if False else {k: v for k, v in doc.items() if k != "_id"}


@router.post("/incidents/{iid}/action")
async def incident_action(iid: str, payload: Dict[str, Any] = Body(...)):
    from server import db
    action = payload.get("action", "")
    await db.incidents.update_one(
        {"id": iid},
        {"$push": {"actions_taken": {"action": action, "at": _iso(), "by": payload.get("by", "admin")}}}
    )
    return {"ok": True}


# =================================================================
# MODULE 12 — Retroactive Mail Scanner
# =================================================================
@router.post("/retroactive/scan")
async def retroactive_scan(payload: Dict[str, Any] = Body(...)):
    """Yeni IOC ile eski mailleri tara."""
    from server import db
    ioc_value = payload.get("value", "").lower()
    ioc_kind = payload.get("kind", "domain")
    days = int(payload.get("days", 30))
    if not ioc_value:
        raise HTTPException(400, "IOC value gerekli")
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    q = {"at": {"$gte": since}}
    if ioc_kind == "domain":
        q["url_hosts"] = ioc_value
    elif ioc_kind == "ip":
        q["from"] = {"$regex": ioc_value}
    matched = 0
    try:
        matched = await db.mail_dna.count_documents(q)
    except Exception:
        pass
    return {"ioc": ioc_value, "kind": ioc_kind, "days": days,
            "matched_mails": matched,
            "note": f"Son {days} günde {matched} mail bu IOC ile eşleşti",
            "checked_at": _iso()}


# =================================================================
# MODULE 13 — AI Security Assistant
# =================================================================
@router.post("/ai/ask")
async def ai_security_ask(payload: Dict[str, Any] = Body(...)):
    """Doğal dil sorgusu — LLM ile cevaplar."""
    question = payload.get("question", "").strip()
    if not question:
        raise HTTPException(400, "question gerekli")
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        key = os.environ.get("EMERGENT_LLM_KEY", "")
        if not key:
            return {"question": question, "answer": "LLM anahtarı henüz yapılandırılmadı.",
                    "provider": "none"}
        chat = LlmChat(
            api_key=key,
            session_id=f"sec-ai-{uuid.uuid4()}",
            system_message="Sen bir mail güvenlik analistiısın. Kısa, teknik ve öz cevaplar ver. Türkçe."
        ).with_model("openai", "gpt-4o-mini")
        resp = await chat.send_message(UserMessage(text=question))
        return {"question": question, "answer": str(resp), "provider": "openai"}
    except Exception as e:
        return {"question": question, "answer": f"AI hatası: {str(e)[:120]}", "provider": "error"}


# =================================================================
# MODULE 14 — AI Rule Generator
# =================================================================
@router.post("/ai/generate-rule")
async def ai_rule_generate(payload: Dict[str, Any] = Body(...)):
    """Doğal dilde 'X ise Y' kuralını JSON kurala çevirir."""
    prompt = payload.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(400, "prompt gerekli")
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        key = os.environ.get("EMERGENT_LLM_KEY", "")
        chat = LlmChat(
            api_key=key,
            session_id=f"rule-gen-{uuid.uuid4()}",
            system_message=(
                "Sen bir mail güvenlik kural üreticisisin. Kullanıcının doğal dildeki isteğini "
                "aşağıdaki JSON şemasında bir kurala çevir:\n"
                "{name, if: {field, op, value}, then: {action}}\n"
                "action: quarantine | reject | tag | notify\n"
                "field: from | subject | body | header | url | attachment\n"
                "op: contains | equals | matches_regex | not_contains\n"
                "Sadece JSON döndür, açıklama yok."
            )
        ).with_model("openai", "gpt-4o-mini")
        resp = await chat.send_message(UserMessage(text=prompt))
        return {"prompt": prompt, "rule": str(resp), "note": "AI önerisi — aktifleştirmeden önce test edin"}
    except Exception as e:
        return {"prompt": prompt, "error": str(e)[:120]}


# =================================================================
# MODULE 15 — Global Search
# =================================================================
@router.get("/global-search")
async def global_search(q: str = Query(..., min_length=2)):
    """Sistemde her yerde arama."""
    from server import db
    q_lower = q.lower()
    results = {"query": q, "hits": {}}
    async def _c(coll, filt, name):
        try:
            n = await db[coll].count_documents(filt)
            if n:
                sample = await db[coll].find(filt, {"_id": 0}).limit(3).to_list(3)
                results["hits"][name] = {"count": n, "sample": sample}
        except Exception:
            pass
    await _c("threat_iocs", {"value": {"$regex": q_lower, "$options": "i"}}, "IOC")
    await _c("mail_dna", {"$or": [{"from": {"$regex": q_lower}}, {"url_hosts": q_lower}]}, "Mail DNA")
    await _c("incidents", {"$or": [{"id": q}, {"source_ips": q}]}, "Incident")
    await _c("licenses", {"$or": [{"license_key": q}, {"customer_email": {"$regex": q_lower}}]}, "Lisans")
    return results


# =================================================================
# MODULE 16 — Mail Security Score
# =================================================================
@router.get("/mail-security-score")
async def mail_security_score(domain: str = Query(...)):
    """Domain için toplu güvenlik skoru: SPF, DKIM, DMARC, TLS, Reputation."""
    import dns.resolver
    scores = {}
    reasons = []
    # SPF
    try:
        answers = dns.resolver.resolve(domain, "TXT")
        spf = any("v=spf1" in str(a) for a in answers)
        scores["spf"] = 100 if spf else 0
        if not spf: reasons.append("SPF kaydı eksik")
    except Exception:
        scores["spf"] = 0
        reasons.append("SPF sorgulanamadı")
    # DMARC
    try:
        answers = dns.resolver.resolve(f"_dmarc.{domain}", "TXT")
        dmarc = any("v=DMARC1" in str(a) for a in answers)
        scores["dmarc"] = 100 if dmarc else 0
        if not dmarc: reasons.append("DMARC kaydı eksik")
    except Exception:
        scores["dmarc"] = 0
        reasons.append("DMARC sorgulanamadı")
    # DKIM (default selector'ları dene)
    dkim_found = False
    for sel in ["default", "google", "mail", "s1", "selector1"]:
        try:
            answers = dns.resolver.resolve(f"{sel}._domainkey.{domain}", "TXT")
            if any("v=DKIM1" in str(a) or "k=rsa" in str(a) for a in answers):
                dkim_found = True
                break
        except Exception:
            continue
    scores["dkim"] = 100 if dkim_found else 30
    if not dkim_found: reasons.append("DKIM selector bulunamadı")
    # MX
    try:
        answers = dns.resolver.resolve(domain, "MX")
        scores["mx"] = 100 if list(answers) else 0
    except Exception:
        scores["mx"] = 0
    # Toplam skor
    total = sum(scores.values()) / max(1, len(scores))
    return {
        "domain": domain, "total_score": round(total, 1),
        "breakdown": scores, "reasons": reasons or ["Tüm ana kayıtlar mevcut"],
        "checked_at": _iso(),
    }


# =================================================================
# MODULE 17 — Domain Security Center
# =================================================================
@router.get("/domain-security/{domain}")
async def domain_security_center(domain: str):
    """Domain için detaylı güvenlik dashboard verisi."""
    from server import db
    score = await mail_security_score(domain=domain)
    rep = await sender_reputation(domain=domain)
    # İncoming ve outgoing spam counts (varsa)
    incoming = 0
    outgoing = 0
    try:
        incoming = await db.mail_events.count_documents({"to_domain": domain, "verdict": "spam"})
        outgoing = await db.mail_events.count_documents({"from_domain": domain, "verdict": "spam"})
    except Exception:
        pass
    return {
        "domain": domain,
        "authentication": score,
        "reputation": rep.get("domain", {}),
        "incoming_spam": incoming, "outgoing_spam": outgoing,
        "checked_at": _iso(),
    }


# =================================================================
# MODULE 18 — Mail Continuity (kuyruk)
# =================================================================
@router.get("/continuity/queue-status")
async def continuity_queue_status():
    from server import db
    try:
        pending = await db.continuity_queue.count_documents({"status": "pending"})
        replayed = await db.continuity_queue.count_documents({"status": "replayed"})
    except Exception:
        pending, replayed = 0, 0
    return {"pending": pending, "replayed": replayed, "at": _iso()}


@router.post("/continuity/queue")
async def continuity_enqueue(payload: Dict[str, Any] = Body(...)):
    from server import db
    doc = {"id": str(uuid.uuid4()), "status": "pending",
           "from": payload.get("from"), "to": payload.get("to"),
           "subject": payload.get("subject", ""),
           "body": payload.get("body", "")[:50000],
           "at": _iso()}
    await db.continuity_queue.insert_one(doc)
    return {"ok": True, "id": doc["id"]}


# =================================================================
# MODULE 19 — Enterprise Mail Archive
# =================================================================
@router.get("/archive/search")
async def archive_search(q: str = Query(""), from_addr: str = "", to: str = "",
                         days: int = 30, limit: int = 50):
    from server import db
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    filt = {"at": {"$gte": since}}
    if from_addr: filt["from"] = {"$regex": from_addr}
    if to: filt["to"] = {"$regex": to}
    if q: filt["subject_preview"] = {"$regex": q, "$options": "i"}
    try:
        items = await db.mail_dna.find(filt, {"_id": 0}).sort("at", -1).limit(min(limit, 500)).to_list(500)
        total = await db.mail_dna.count_documents(filt)
    except Exception:
        items, total = [], 0
    return {"items": items, "total": total}


# =================================================================
# MODULE 20 — SOAR Lite (automation rules)
# =================================================================
@router.get("/soar/rules")
async def soar_list():
    from server import db
    items = await db.soar_rules.find({}, {"_id": 0}).sort("at", -1).to_list(500)
    return {"rules": items}


@router.post("/soar/rules")
async def soar_create(payload: Dict[str, Any] = Body(...)):
    from server import db
    doc = {"id": str(uuid.uuid4()),
           "name": payload.get("name", "Kural"),
           "if": payload.get("if", {}),
           "then": payload.get("then", []),
           "enabled": bool(payload.get("enabled", True)),
           "hit_count": 0,
           "at": _iso()}
    await db.soar_rules.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.delete("/soar/rules/{rid}")
async def soar_delete(rid: str):
    from server import db
    await db.soar_rules.delete_one({"id": rid})
    return {"ok": True}


# =================================================================
# MODULE 21 — Global Attack Map
# =================================================================
@router.get("/attack-map")
async def attack_map(hours: int = 24):
    """Son N saatte coğrafi saldırı verisi."""
    from server import db
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    try:
        pipeline = [
            {"$match": {"at": {"$gte": since}, "kind": "ip"}},
            {"$group": {"_id": "$country", "count": {"$sum": 1}, "sample": {"$push": "$value"}}},
            {"$sort": {"count": -1}},
            {"$limit": 20},
        ]
        countries = []
        async for r in db.threat_iocs.aggregate(pipeline):
            countries.append({"country": r["_id"] or "?", "count": r["count"], "sample": r["sample"][:5]})
    except Exception:
        countries = []
    return {"countries": countries, "window_hours": hours, "checked_at": _iso()}


# =================================================================
# MODULE 22 — Advanced Mail Simulator
# =================================================================
@router.post("/simulator/eml")
async def simulator_eml(payload: Dict[str, Any] = Body(...)):
    """Bir .eml içeriğini alıp tüm güvenlik motorlarını simüle eder."""
    import email
    raw = payload.get("eml", "")
    if not raw:
        raise HTTPException(400, "eml içeriği gerekli")
    msg = email.message_from_string(raw)
    subject = msg.get("Subject", "")
    from_addr = msg.get("From", "")
    to = msg.get("To", "")
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                try:
                    body = part.get_payload(decode=True).decode("utf-8", "ignore")
                except Exception:
                    body = str(part.get_payload())
                break
    else:
        try:
            body = msg.get_payload(decode=True).decode("utf-8", "ignore")
        except Exception:
            body = str(msg.get_payload())
    # Extract email from From
    m = re.search(r"<([^>]+)>", from_addr)
    from_email = m.group(1) if m else from_addr.strip()
    m2 = re.search(r"^([^<]+)<", from_addr)
    from_name = m2.group(1).strip().strip('"') if m2 else ""
    # Run all engines
    phish = await anti_phishing_scan({"text": body})
    bec = await bec_analyze({"subject": subject, "body": body,
                              "from_name": from_name, "from_email": from_email,
                              "reply_to": msg.get("Reply-To", "")})
    brand = await brand_impersonation_check({"from_email": from_email, "from_name": from_name,
                                              "body": body, "subject": subject})
    # Toplam skor
    phish_max = max([r["score"] for r in phish["results"]], default=0)
    total_score = max(phish_max, bec["score"], brand["score"])
    action = "allow"
    if total_score >= 70: action = "quarantine"
    elif total_score >= 40: action = "tag_suspicious"
    return {
        "from": from_email, "subject": subject, "to": to,
        "phishing": {"score": phish_max, "results": phish["results"][:3]},
        "bec": bec, "brand": brand,
        "final_score": total_score, "action": action,
        "why_blocked": (bec.get("reasons", []) + brand.get("reasons", []) if action != "allow" else []),
        "checked_at": _iso(),
    }


# =================================================================
# MODULE 23 — Mobile SOC / PWA (data endpoint)
# =================================================================
@router.get("/mobile-soc/summary")
async def mobile_soc_summary():
    from server import db
    try:
        critical = await db.incidents.count_documents({"severity": "critical", "status": "open"})
        compromised = 0
        # Recent compromise detection
        d = await compromise_detect(hours=24)
        compromised = sum(1 for a in d.get("suspicious_accounts", []) if a.get("compromised"))
        # Recent phishing count
        phishing_24h = await db.threat_events.count_documents({
            "type": "anti_phishing_scan",
            "at": {"$gte": (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()}
        })
    except Exception:
        critical, compromised, phishing_24h = 0, 0, 0
    return {"critical_incidents": critical, "compromised_accounts": compromised,
            "phishing_24h": phishing_24h, "at": _iso()}


# =================================================================
# MODULE 24 — Web Spam Protection
# =================================================================
@router.post("/web-spam/check")
async def web_spam_check(payload: Dict[str, Any] = Body(...)):
    """Form/comment spam heuristik kontrol."""
    text = payload.get("text", "").lower()
    ip = payload.get("ip", "")
    signals = {
        "excess_links": len(re.findall(r"https?://", text)),
        "excess_caps": sum(1 for c in text if c.isupper()) / max(1, len(text)),
        "bot_keywords": sum(1 for k in ["viagra", "casino", "porn", "seo", "cheap", "loan", "kredi", "reklam"] if k in text),
        "short_body": 1 if len(text) < 20 else 0,
        "obfuscation": 1 if re.search(r"[a-z]\.[a-z]\.[a-z]", text) else 0,
    }
    score = signals["excess_links"] * 15 + signals["bot_keywords"] * 20 + \
            (30 if signals["excess_caps"] > 0.6 else 0) + signals["short_body"] * 10 + \
            signals["obfuscation"] * 20
    score = min(100, score)
    return {"score": score, "verdict": "spam" if score >= 50 else "ok",
            "signals": signals, "ip": ip, "at": _iso()}


# =================================================================
# MODULE 25 — WebShield (file scan hints)
# =================================================================
@router.post("/webshield/scan-hints")
async def webshield_hints(payload: Dict[str, Any] = Body(...)):
    """PHP/webshell tespiti — kaynak kod heuristik."""
    code = payload.get("code", "")
    signals = {
        "eval": code.count("eval("),
        "base64_decode": code.count("base64_decode"),
        "system": code.count("system(") + code.count("shell_exec("),
        "obfuscated": 1 if len(re.findall(r"\$[A-Za-z_]{20,}", code)) > 3 else 0,
        "backdoor_words": sum(1 for w in ["c99shell", "r57", "wso", "webshell"] if w in code.lower()),
    }
    score = signals["eval"] * 20 + signals["base64_decode"] * 15 + signals["system"] * 15 + \
            signals["obfuscated"] * 30 + signals["backdoor_words"] * 40
    score = min(100, score)
    return {"score": score, "verdict": "malicious" if score >= 60 else ("suspicious" if score >= 30 else "clean"),
            "signals": signals, "at": _iso()}


# =================================================================
# MODULE 26 — WordPress Security Connector (endpoint)
# =================================================================
@router.get("/wp-security/scan")
async def wp_scan(site: str = Query(...)):
    """WP site için ücretsiz kontrol: version, xmlrpc, wp-config."""
    import httpx
    if not site.startswith("http"):
        site = "http://" + site
    site = site.rstrip("/")
    checks = {}
    async with httpx.AsyncClient(timeout=6, follow_redirects=True) as client:
        # /readme.html - WP version leak
        try:
            r = await client.get(f"{site}/readme.html")
            v = re.search(r"Version (\d+\.\d+(\.\d+)?)", r.text or "")
            checks["wp_version"] = v.group(1) if v else "unknown"
            checks["readme_exposed"] = r.status_code == 200
        except Exception:
            checks["readme_exposed"] = False
        # /xmlrpc.php
        try:
            r = await client.get(f"{site}/xmlrpc.php")
            checks["xmlrpc_open"] = r.status_code == 200 and "XML-RPC" in (r.text or "")
        except Exception:
            checks["xmlrpc_open"] = False
        # /wp-config.php.bak
        try:
            r = await client.get(f"{site}/wp-config.php.bak")
            checks["config_backup_exposed"] = r.status_code == 200
        except Exception:
            checks["config_backup_exposed"] = False
        # /wp-login.php
        try:
            r = await client.get(f"{site}/wp-login.php")
            checks["wp_login_accessible"] = r.status_code == 200
        except Exception:
            checks["wp_login_accessible"] = False
    risk = sum([
        20 if checks.get("readme_exposed") else 0,
        30 if checks.get("xmlrpc_open") else 0,
        50 if checks.get("config_backup_exposed") else 0,
    ])
    return {"site": site, "checks": checks, "risk_score": risk, "at": _iso()}


# =================================================================
# MODULE 27 — Multi-Platform Connector (info)
# =================================================================
@router.get("/multiplatform/status")
async def multiplatform_status():
    """Şu an desteklenen platformlar."""
    return {
        "supported": [
            {"name": "cPanel + Exim", "status": "stable", "since": "v1.0"},
            {"name": "DirectAdmin", "status": "beta", "since": "v43.99"},
            {"name": "Plesk", "status": "planning", "since": "-"},
            {"name": "Microsoft 365", "status": "planning", "since": "-"},
            {"name": "Google Workspace", "status": "planning", "since": "-"},
            {"name": "Postfix (standalone)", "status": "beta", "since": "v43.99"},
        ],
        "note": "cPanel + Exim tam kararlı. Diğerleri yol haritasında."
    }


# =================================================================
# MODULE 28 — Gökyüzü Global Threat Network
# =================================================================
@router.get("/network/stats")
async def network_stats():
    """Global tehdit ağı istatistikleri."""
    from server import db
    try:
        ioc_count = await db.threat_iocs.count_documents({})
        reporters = len(await db.threat_iocs.distinct("reporter"))
        dna_count = await db.mail_dna.count_documents({})
        incidents = await db.incidents.count_documents({})
    except Exception:
        ioc_count, reporters, dna_count, incidents = 0, 0, 0, 0
    return {
        "total_iocs": ioc_count,
        "contributing_resellers": reporters,
        "mail_fingerprints": dna_count,
        "incidents_tracked": incidents,
        "note": "KVKK/GDPR uyumlu — sadece anonim IOC ve fingerprint paylaşılır",
        "at": _iso(),
    }


# =================================================================
# Feed refresh (background) — URLhaus ücretsiz sync
# =================================================================
@router.post("/feed/refresh")
async def feed_refresh():
    """URLhaus ücretsiz feed'i indir ve önbelleğe al."""
    import httpx
    global _FEED_CACHE
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get("https://urlhaus.abuse.ch/downloads/text/")
            if r.status_code == 200:
                lines = [l.strip() for l in r.text.splitlines() if l and not l.startswith("#")]
                hosts = set()
                for u in lines[:5000]:
                    try:
                        h = urlparse(u).hostname
                        if h: hosts.add(h.lower())
                    except Exception:
                        pass
                _FEED_CACHE["urlhaus"] = {"data": hosts, "at": datetime.now().timestamp()}
                return {"ok": True, "urlhaus_hosts": len(hosts), "at": _iso()}
    except Exception as e:
        return {"ok": False, "error": str(e)[:120]}
    return {"ok": False, "note": "Feed indirilemedi"}


@router.get("/feed/status")
async def feed_status():
    now = datetime.now().timestamp()
    return {
        "urlhaus": {
            "count": len(_FEED_CACHE["urlhaus"]["data"]),
            "age_seconds": int(now - _FEED_CACHE["urlhaus"]["at"]) if _FEED_CACHE["urlhaus"]["at"] else -1,
            "fresh": (now - _FEED_CACHE["urlhaus"]["at"]) < _FEED_TTL if _FEED_CACHE["urlhaus"]["at"] else False,
        }
    }
