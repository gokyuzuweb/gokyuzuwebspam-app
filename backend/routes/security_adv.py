"""
Security & Threat Intelligence router.
Modules:
  1. Exploit Scanner (shell/eval/base64 signature scan)
  2. GeoIP Attack Map (offline country lookup + live spam source aggregation)
  3. IP Drilldown (mail traffic per IP: from/to/country/verdict)
"""
from __future__ import annotations
import ipaddress
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from deps import db

router = APIRouter(tags=["security-adv"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ============================================================================
#  1) EXPLOIT SCANNER — Perl daemon results ingested + master-triggered scans
# ============================================================================
EXPLOIT_SIGNATURES = [
    # (name, regex, severity, category)
    ("eval_base64", r"eval\s*\(\s*base64_decode\s*\(", "critical", "webshell"),
    ("gzinflate_shell", r"eval\s*\(\s*gzinflate\s*\(", "critical", "webshell"),
    ("assert_post", r"assert\s*\(\s*\$_(POST|GET|REQUEST)", "critical", "backdoor"),
    ("system_input", r"system\s*\(\s*\$_(POST|GET|REQUEST)", "high", "rce"),
    ("passthru", r"passthru\s*\(\s*\$_", "high", "rce"),
    ("shell_exec_input", r"shell_exec\s*\(\s*\$_", "high", "rce"),
    ("preg_replace_e", r"preg_replace\s*\([^,]+/e[\'\"]", "high", "rce"),
    ("weevely", r"c99shell|r57shell|weevely|WSO\s*Shell", "critical", "webshell"),
    ("obfuscated_php", r"\$[a-zA-Z_]+\s*=\s*['\"]\\x[0-9a-f]{2}", "medium", "obfuscation"),
    ("wget_curl_download", r"(wget|curl)\s+http[^;]+\s*;\s*(bash|sh|chmod)", "high", "downloader"),
]


class ScanFinding(BaseModel):
    file_path: str
    line: int = 0
    signature: str
    severity: str = Field(..., pattern="^(critical|high|medium|low)$")
    category: str
    snippet: Optional[str] = ""


class ScanReport(BaseModel):
    """Perl daemon submits scan results here (WHM plugin)."""
    license_key: str = Field(..., min_length=8)
    hostname: Optional[str] = None
    scanned_files: int = 0
    duration_ms: int = 0
    root_path: Optional[str] = "/var/www"
    findings: list[ScanFinding] = Field(default_factory=list)


@router.post("/security/exploit-scan/submit")
async def submit_scan(payload: ScanReport):
    """Perl exploit-scanner daemon SaaS'a sonuç gönderir."""
    lic = await db.licenses.find_one({"license_key": payload.license_key})
    if not lic:
        raise HTTPException(401, "Geçersiz lisans")
    scan_id = str(uuid.uuid4())
    doc = {
        "id": scan_id,
        "license_key": payload.license_key,
        "hostname": payload.hostname,
        "scanned_files": payload.scanned_files,
        "duration_ms": payload.duration_ms,
        "root_path": payload.root_path,
        "critical": sum(1 for f in payload.findings if f.severity == "critical"),
        "high": sum(1 for f in payload.findings if f.severity == "high"),
        "medium": sum(1 for f in payload.findings if f.severity == "medium"),
        "low": sum(1 for f in payload.findings if f.severity == "low"),
        "total_findings": len(payload.findings),
        "created_at": _iso(),
    }
    await db.exploit_scans.insert_one(doc)
    if payload.findings:
        for f in payload.findings:
            await db.exploit_findings.insert_one({
                "id": str(uuid.uuid4()),
                "scan_id": scan_id,
                "license_key": payload.license_key,
                "file_path": f.file_path,
                "line": f.line,
                "signature": f.signature,
                "severity": f.severity,
                "category": f.category,
                "snippet": (f.snippet or "")[:400],
                "dismissed": False,
                "created_at": _iso(),
            })
    return {"ok": True, "scan_id": scan_id, "critical": doc["critical"], "high": doc["high"]}


@router.post("/security/exploit-scan/run")
async def run_scan(license_key: str = Query(..., min_length=8), root_path: str = "/var/www"):
    """Master tetikli scan — hosted panelde simülasyon; WHM'de daemon sinyali.
    Preview'da mock ~1500 dosya taranmış + 3 finding üretir."""
    lic = await db.licenses.find_one({"license_key": license_key})
    if not lic:
        raise HTTPException(401, "Geçersiz lisans")
    # simulate
    scan_id = str(uuid.uuid4())
    now = _iso()
    demo = [
        {"file_path": "/var/www/wp-content/uploads/2025/x.php", "line": 12,
         "signature": "eval_base64", "severity": "critical", "category": "webshell",
         "snippet": "<?php eval(base64_decode($_POST['x'])); ?>"},
        {"file_path": "/var/www/vendor/upload.php", "line": 44,
         "signature": "system_input", "severity": "high", "category": "rce",
         "snippet": "system($_GET['cmd']);"},
        {"file_path": "/var/www/theme/functions.php", "line": 128,
         "signature": "obfuscated_php", "severity": "medium", "category": "obfuscation",
         "snippet": "$a = \"\\x65\\x76\\x61\\x6c\"; $a($_POST['q']);"},
    ]
    await db.exploit_scans.insert_one({
        "id": scan_id, "license_key": license_key, "hostname": "preview",
        "scanned_files": 1523, "duration_ms": 4200, "root_path": root_path,
        "critical": 1, "high": 1, "medium": 1, "low": 0, "total_findings": 3,
        "created_at": now, "trigger": "manual",
    })
    for f in demo:
        await db.exploit_findings.insert_one({
            "id": str(uuid.uuid4()), "scan_id": scan_id,
            "license_key": license_key, **f,
            "dismissed": False, "created_at": now,
        })
    return {"ok": True, "scan_id": scan_id, "findings": len(demo),
            "note": "Preview simülasyonu — WHM'de gerçek dosya sistemi taranır"}


@router.get("/security/exploit-scan/latest")
async def latest_scan(license_key: str = Query(..., min_length=8)):
    scan = await db.exploit_scans.find_one({"license_key": license_key}, {"_id": 0},
                                            sort=[("created_at", -1)])
    return scan or {}


@router.get("/security/exploit-scan/scans")
async def list_scans(license_key: str = Query(..., min_length=8), limit: int = 20):
    rows = await db.exploit_scans.find({"license_key": license_key}, {"_id": 0})\
        .sort("created_at", -1).limit(limit).to_list(limit)
    return {"items": rows}


@router.get("/security/exploit-scan/findings")
async def list_findings(
    license_key: str = Query(..., min_length=8),
    scan_id: Optional[str] = None,
    severity: Optional[str] = None,
    include_dismissed: bool = False,
    limit: int = 200,
):
    q = {"license_key": license_key}
    if scan_id: q["scan_id"] = scan_id
    if severity: q["severity"] = severity
    if not include_dismissed: q["dismissed"] = False
    rows = await db.exploit_findings.find(q, {"_id": 0})\
        .sort("severity", -1).limit(limit).to_list(limit)
    # priority order
    sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    rows.sort(key=lambda r: sev_order.get(r.get("severity"), 9))
    return {"items": rows}


@router.post("/security/exploit-scan/dismiss/{finding_id}")
async def dismiss_finding(finding_id: str, license_key: str = Query(..., min_length=8)):
    r = await db.exploit_findings.update_one(
        {"id": finding_id, "license_key": license_key},
        {"$set": {"dismissed": True, "dismissed_at": _iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Bulgu bulunamadı")
    return {"ok": True}


@router.get("/security/exploit-scan/signatures")
async def list_signatures():
    return {"items": [{"name": n, "pattern": p, "severity": s, "category": c}
                      for (n, p, s, c) in EXPLOIT_SIGNATURES]}


# ============================================================================
#  2) GEOIP + ATTACK MAP (offline IP prefix → country cache)
# ============================================================================
# Basit /8 IPv4 prefix → country haritası. Her prefix birincil ülkeye atanır
# (paylaşılan bloklar için baskın kayıt seçildi). MaxMind DB üretimde yerini alabilir.
IPV4_COUNTRY_PREFIXES: dict[str, str] = {
    # Primary US allocations
    "3": "US", "4": "US", "6": "US", "7": "US", "8": "US", "9": "US",
    "11": "US", "12": "US", "13": "US", "15": "US", "16": "US", "17": "US",
    "18": "US", "19": "US", "20": "US", "21": "US", "22": "US", "23": "US",
    "24": "US", "26": "US", "28": "US", "29": "US", "30": "US", "32": "US",
    "33": "US", "34": "US", "35": "US", "38": "US", "40": "US", "44": "US",
    "45": "US", "50": "US", "52": "US", "54": "US", "55": "US", "56": "US",
    "63": "US", "64": "US", "65": "US", "66": "US", "67": "US", "68": "US",
    "69": "US", "70": "US", "71": "US", "72": "US", "73": "US", "74": "US",
    "75": "US", "96": "US", "97": "US", "98": "US", "99": "US", "100": "US",
    "104": "US", "107": "US", "108": "US", "128": "US", "130": "US", "131": "US",
    "132": "US", "134": "US", "136": "US", "137": "US", "138": "US", "140": "US",
    "142": "US", "144": "US", "147": "US", "148": "US", "149": "US",
    "152": "US", "154": "US", "155": "US", "156": "US",
    "157": "US", "158": "US", "159": "US", "160": "US", "161": "US", "162": "US",
    "164": "US", "165": "US", "166": "US", "167": "US", "168": "US",
    "169": "US", "170": "US", "173": "US", "174": "US", "184": "US", "192": "US",
    "198": "US", "199": "US", "204": "US", "205": "US", "206": "US", "207": "US",
    "208": "US", "209": "US", "216": "US",
    # CN
    "1": "CN", "14": "CN", "27": "CN", "36": "CN", "42": "CN",
    "58": "CN", "101": "CN", "113": "CN", "114": "CN", "116": "CN",
    "117": "CN", "119": "CN", "120": "CN", "123": "CN", "124": "CN",
    "125": "CN", "180": "CN", "183": "CN", "210": "CN", "218": "CN",
    "219": "CN", "220": "CN", "221": "CN", "222": "CN", "223": "CN",
    # RU
    "5": "RU", "31": "RU", "46": "RU", "89": "RU", "90": "RU", "91": "RU",
    "92": "RU", "93": "RU", "95": "RU", "176": "RU", "178": "RU", "188": "RU",
    # DE
    "2": "DE", "53": "DE", "76": "DE", "141": "DE", "145": "DE", "171": "DE",
    "172": "DE", "193": "DE", "194": "DE", "217": "DE",
    # TR
    "78": "TR", "212": "TR", "213": "TR",
    # GB
    "25": "GB", "51": "GB", "77": "GB", "146": "GB", "185": "GB",
    # IN
    "43": "IN", "49": "IN", "59": "IN", "103": "IN", "111": "IN", "112": "IN",
    "115": "IN", "182": "IN", "202": "IN",
    # BR
    "177": "BR", "179": "BR", "186": "BR", "187": "BR", "189": "BR", "190": "BR",
    "191": "BR", "200": "BR", "201": "BR",
    # JP
    "60": "JP", "106": "JP", "110": "JP", "118": "JP", "121": "JP", "122": "JP",
    "126": "JP", "133": "JP", "150": "JP", "153": "JP", "163": "JP", "211": "JP",
    # KR
    "39": "KR", "61": "KR", "175": "KR", "203": "KR",
    # NL
    "80": "NL", "82": "NL", "83": "NL", "84": "NL", "94": "NL",
    # FR
    "37": "FR", "62": "FR", "79": "FR", "81": "FR", "85": "FR", "88": "FR",
    # additional
    "41": "ZA", "102": "EG", "105": "SA", "129": "AU",
    "196": "AU",
    "151": "IT", "143": "IT",
    "195": "ES",
}

# Country coordinates for map plotting (lat, lon)
COUNTRY_COORDS: dict[str, tuple[float, float]] = {
    "US": (37.09, -95.71), "CN": (35.86, 104.19), "RU": (61.52, 105.31),
    "DE": (51.16, 10.45), "TR": (38.96, 35.24), "GB": (55.37, -3.43),
    "IN": (20.59, 78.96), "BR": (-14.24, -51.93), "JP": (36.20, 138.25),
    "KR": (35.90, 127.76), "NL": (52.13, 5.29), "FR": (46.23, 2.21),
    "IT": (41.87, 12.56), "ES": (40.46, -3.75), "CA": (56.13, -106.35),
    "AU": (-25.27, 133.78), "MX": (23.63, -102.55), "ID": (-0.79, 113.92),
    "AR": (-38.42, -63.62), "UA": (48.38, 31.17), "PL": (51.92, 19.14),
    "SE": (60.13, 18.64), "SA": (23.89, 45.08), "AE": (23.42, 53.85),
    "EG": (26.82, 30.80), "ZA": (-30.56, 22.94), "NG": (9.08, 8.68),
    "VN": (14.06, 108.28), "TH": (15.87, 100.99), "SG": (1.35, 103.82),
    "MY": (4.21, 101.98), "PH": (12.88, 121.77), "IR": (32.43, 53.69),
    "PK": (30.38, 69.35), "BD": (23.68, 90.36), "IL": (31.05, 34.85),
    "GR": (39.07, 21.82), "PT": (39.40, -8.22), "BE": (50.50, 4.47),
    "AT": (47.52, 14.55), "CH": (46.82, 8.23), "IE": (53.14, -7.69),
    "NO": (60.47, 8.47), "FI": (61.92, 25.75), "DK": (56.26, 9.50),
    "CZ": (49.82, 15.47), "RO": (45.94, 24.97), "HU": (47.16, 19.50),
    "BG": (42.73, 25.49), "LV": (56.88, 24.60), "LT": (55.17, 23.88),
    "EE": (58.60, 25.01),
}


def _ip_to_country(ip: str) -> Optional[str]:
    """Basit /8 prefix ile ülke tahmini."""
    if not ip:
        return None
    try:
        addr = ipaddress.ip_address(ip)
        if addr.is_private or addr.is_loopback or addr.is_reserved:
            return "LOCAL"
        if addr.version != 4:
            return None
        first = ip.split(".")[0]
        return IPV4_COUNTRY_PREFIXES.get(first)
    except Exception:
        return None


@router.get("/geo/lookup")
async def geo_lookup(ip: str = Query(..., min_length=3)):
    cc = _ip_to_country(ip)
    coord = COUNTRY_COORDS.get(cc) if cc else None
    return {"ip": ip, "country": cc, "lat": coord[0] if coord else None,
            "lon": coord[1] if coord else None}


@router.get("/security/attack-map")
async def attack_map(license_key: Optional[str] = None, hours: int = Query(1, ge=1, le=48)):
    """Son N saatteki spam kaynaklarını ülkeye/lat-lon'a göre grupla → harita için."""
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    q: dict = {"ingested_at": {"$gte": since},
               "verdict": {"$in": ["spam", "high_spam", "virus", "blocked"]}}
    if license_key:
        q["license_key"] = license_key
    counter: dict[str, dict] = {}
    events = 0
    async for e in db.mail_events.find(q, {"_id": 0, "client_ip": 1, "server_ip": 1,
                                            "from_addr": 1, "verdict": 1, "total_score": 1}):
        events += 1
        ip = e.get("client_ip") or e.get("server_ip")
        if not ip:
            continue
        cc = _ip_to_country(ip)
        if not cc or cc == "LOCAL":
            continue
        coord = COUNTRY_COORDS.get(cc)
        if not coord:
            continue
        key = cc
        b = counter.setdefault(key, {
            "country": cc, "lat": coord[0], "lon": coord[1],
            "count": 0, "spam": 0, "high_spam": 0, "virus": 0,
            "sample_ips": [],
        })
        b["count"] += 1
        v = e.get("verdict")
        if v == "high_spam": b["high_spam"] += 1
        elif v == "virus":   b["virus"] += 1
        else:                b["spam"] += 1
        if len(b["sample_ips"]) < 5 and ip not in b["sample_ips"]:
            b["sample_ips"].append(ip)
    items = sorted(counter.values(), key=lambda x: x["count"], reverse=True)
    return {"hours": hours, "events_total": events, "items": items,
            "generated_at": _iso()}


@router.get("/security/ip-drilldown")
async def ip_drilldown(
    ip: str = Query(..., min_length=3),
    license_key: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
):
    """Bir kaynak IP'nin tüm trafik detayı: from → to, verdict, ülke, subject, score."""
    q: dict = {"$or": [{"client_ip": ip}, {"server_ip": ip}]}
    if license_key:
        q["license_key"] = license_key
    rows = []
    async for e in db.mail_events.find(q, {"_id": 0}).sort("ingested_at", -1).limit(limit):
        rows.append({
            "id": e.get("id"), "ts": e.get("ts"), "ingested_at": e.get("ingested_at"),
            "from_addr": e.get("from_addr"), "to_addr": e.get("to_addr"),
            "subject": e.get("subject"), "verdict": e.get("verdict"),
            "score": e.get("total_score"),
            "exim_mid": e.get("exim_mid"),
        })
    country = _ip_to_country(ip)
    coord = COUNTRY_COORDS.get(country) if country else None
    total_all = await db.mail_events.count_documents(q)
    spam_count = await db.mail_events.count_documents(
        {**q, "verdict": {"$in": ["spam", "high_spam", "virus"]}}
    )
    return {
        "ip": ip, "country": country,
        "lat": coord[0] if coord else None, "lon": coord[1] if coord else None,
        "total": total_all, "spam_total": spam_count,
        "sample": rows,
    }


# ============================================================================
#  3) COUNTRY BRUTE-FORCE AUTO-BLOCK (adaptif zaman-tabanlı)
# ============================================================================
class BruteForceIn(BaseModel):
    license_key: str = Field(..., min_length=8)
    minutes: int = Field(60, ge=5, le=1440)   # bakılacak pencere
    threshold: int = Field(50, ge=5)          # eşik: bu kadar spam gelmişse
    ttl_minutes: int = Field(180, ge=10)      # kaç dakika bloklu kalsın


@router.post("/security/country-brute-force/scan")
async def country_brute_force_scan(payload: BruteForceIn):
    """Son N dakikadaki spam kaynak ülkeleri sayar, eşik üstündekiler için
    otomatik `block` kuralı ekler (TTL ile — süre dolunca kaldırılır)."""
    since = (datetime.now(timezone.utc) - timedelta(minutes=payload.minutes)).isoformat()
    q = {"license_key": payload.license_key,
         "verdict": {"$in": ["spam", "high_spam", "virus"]},
         "ingested_at": {"$gte": since}}
    counter: dict[str, int] = {}
    async for e in db.mail_events.find(q, {"_id": 0, "client_ip": 1, "server_ip": 1}):
        ip = e.get("client_ip") or e.get("server_ip")
        cc = _ip_to_country(ip)
        if not cc or cc == "LOCAL":
            continue
        counter[cc] = counter.get(cc, 0) + 1
    triggered = [cc for cc, n in counter.items() if n >= payload.threshold]
    if not triggered:
        return {"ok": True, "triggered": [], "counter": counter}
    expire = (datetime.now(timezone.utc) + timedelta(minutes=payload.ttl_minutes)).isoformat()
    now = _iso()
    for cc in triggered:
        await db.country_rules.update_one(
            {"country_code": cc},
            {"$set": {
                "country_code": cc, "action": "block", "reason": "brute_force",
                "note": f"Otomatik: {counter[cc]} spam / {payload.minutes} dk",
                "auto_expire_at": expire, "active_hours": None, "active_days": None,
                "id": str(uuid.uuid4()), "created_at": now,
            }},
            upsert=True,
        )
    return {"ok": True, "triggered": triggered, "counter": counter,
            "expire_at": expire, "ttl_minutes": payload.ttl_minutes}


@router.get("/security/country-catalog")
async def country_catalog():
    """Tam ISO 3166-1 alpha-2 katalog: kod + Türkçe isim + lat/lon."""
    catalog = [
        ("AF", "Afganistan"), ("AL", "Arnavutluk"), ("DZ", "Cezayir"), ("AR", "Arjantin"),
        ("AM", "Ermenistan"), ("AU", "Avustralya"), ("AT", "Avusturya"), ("AZ", "Azerbaycan"),
        ("BH", "Bahreyn"), ("BD", "Bangladeş"), ("BY", "Belarus"), ("BE", "Belçika"),
        ("BO", "Bolivya"), ("BA", "Bosna-Hersek"), ("BR", "Brezilya"), ("BG", "Bulgaristan"),
        ("KH", "Kamboçya"), ("CA", "Kanada"), ("CL", "Şili"), ("CN", "Çin"),
        ("CO", "Kolombiya"), ("HR", "Hırvatistan"), ("CU", "Küba"), ("CY", "Kıbrıs"),
        ("CZ", "Çek Cumh."), ("DK", "Danimarka"), ("DO", "Dominik"), ("EC", "Ekvador"),
        ("EG", "Mısır"), ("EE", "Estonya"), ("ET", "Etiyopya"), ("FI", "Finlandiya"),
        ("FR", "Fransa"), ("GE", "Gürcistan"), ("DE", "Almanya"), ("GH", "Gana"),
        ("GR", "Yunanistan"), ("HU", "Macaristan"), ("IS", "İzlanda"), ("IN", "Hindistan"),
        ("ID", "Endonezya"), ("IR", "İran"), ("IQ", "Irak"), ("IE", "İrlanda"),
        ("IL", "İsrail"), ("IT", "İtalya"), ("JP", "Japonya"), ("JO", "Ürdün"),
        ("KZ", "Kazakistan"), ("KE", "Kenya"), ("KP", "K. Kore"), ("KR", "G. Kore"),
        ("KW", "Kuveyt"), ("KG", "Kırgızistan"), ("LV", "Letonya"), ("LB", "Lübnan"),
        ("LY", "Libya"), ("LT", "Litvanya"), ("LU", "Lüksemburg"), ("MY", "Malezya"),
        ("MX", "Meksika"), ("MD", "Moldova"), ("MN", "Moğolistan"), ("MA", "Fas"),
        ("MM", "Myanmar"), ("NP", "Nepal"), ("NL", "Hollanda"), ("NZ", "Yeni Zelanda"),
        ("NG", "Nijerya"), ("NO", "Norveç"), ("OM", "Umman"), ("PK", "Pakistan"),
        ("PS", "Filistin"), ("PA", "Panama"), ("PY", "Paraguay"), ("PE", "Peru"),
        ("PH", "Filipinler"), ("PL", "Polonya"), ("PT", "Portekiz"), ("QA", "Katar"),
        ("RO", "Romanya"), ("RU", "Rusya"), ("SA", "S. Arabistan"), ("RS", "Sırbistan"),
        ("SG", "Singapur"), ("SK", "Slovakya"), ("SI", "Slovenya"), ("ZA", "G. Afrika"),
        ("ES", "İspanya"), ("LK", "Sri Lanka"), ("SD", "Sudan"), ("SE", "İsveç"),
        ("CH", "İsviçre"), ("SY", "Suriye"), ("TW", "Tayvan"), ("TJ", "Tacikistan"),
        ("TZ", "Tanzanya"), ("TH", "Tayland"), ("TN", "Tunus"), ("TR", "Türkiye"),
        ("TM", "Türkmenistan"), ("UG", "Uganda"), ("UA", "Ukrayna"), ("AE", "BAE"),
        ("GB", "Birleşik Krallık"), ("US", "ABD"), ("UY", "Uruguay"), ("UZ", "Özbekistan"),
        ("VE", "Venezuela"), ("VN", "Vietnam"), ("YE", "Yemen"), ("ZM", "Zambiya"),
        ("ZW", "Zimbabwe"),
    ]
    items = [{"code": c, "name": n} for (c, n) in catalog]
    items.sort(key=lambda x: x["name"])
    return {"items": items, "count": len(items)}
