"""
Live Diagnostic API — kullanıcının canlı WHM sunucusuyla ilgili tam teşhis.

Yaklaşımlar:
1. Master paneldeki tüm heartbeat.pl ping'lerini son 24 saatte tara
2. Her lisans için plugin_state / plugin_version / last_heartbeat gösterge
3. Exim log push aktivitesi son N saat
4. `gws-update` output'unun uzaktan kontrolü için upload endpoint
5. Adım adım "sizin sunucuda çalıştırmanız gereken komutlar" listesi
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from deps import db


router = APIRouter(prefix="/live-diagnostic", tags=["live-diagnostic"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/status")
async def diagnostic_status(request: Request):
    """Bayi lisans → plugin durum, son heartbeat, son Exim push."""
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    now = datetime.now(timezone.utc)
    since_24h = (now - timedelta(hours=24)).isoformat()
    since_1h = (now - timedelta(hours=1)).isoformat()

    licenses = await db.licenses.find(
        {"active": True, "$or": [
            {"license_key": master_key},
            {"master_license_key": master_key},
        ]},
        {"_id": 0, "license_key": 1, "hostname": 1, "server_ip": 1,
         "activated_at": 1, "last_heartbeat_at": 1, "plugin_version": 1}
    ).to_list(200)

    rows = []
    for lic in licenses:
        lic_key = lic["license_key"]
        # Son heartbeat plugin_state'ten
        pstate = await db.plugin_state.find_one({"license_key": lic_key}, {"_id": 0}) or {}
        # Son 24s outbound event
        last_out = await db.mail_events.find_one(
            {"license_key": lic_key, "direction": "out"},
            {"_id": 0, "ts": 1, "source": 1}, sort=[("ts", -1)]
        )
        out_24h = await db.mail_events.count_documents(
            {"license_key": lic_key, "direction": "out", "ts": {"$gte": since_24h}})
        out_1h = await db.mail_events.count_documents(
            {"license_key": lic_key, "direction": "out", "ts": {"$gte": since_1h}})
        # Exim log checkpoint
        ck = await db.settings.find_one(
            {"_key": f"exim_logtail_pos:{lic_key}"}, {"_id": 0}) or {}
        # Backfill signal
        bf = await db.settings.find_one(
            {"_key": f"exim_backfill_signal:{lic_key}"}, {"_id": 0}) or {}
        # Health assessment
        checks = []
        # 1. Heartbeat received in last 30min?
        last_hb = pstate.get("last_heartbeat_at") or lic.get("last_heartbeat_at")
        hb_fresh = False
        if last_hb:
            try:
                dt = datetime.fromisoformat(last_hb.replace("Z", "+00:00"))
                hb_fresh = (now - dt).total_seconds() < 1800
            except Exception:
                pass
        checks.append({
            "id": "heartbeat",
            "label": "heartbeat.pl daemon 30dk içinde ping attı",
            "pass": hb_fresh,
            "detail": f"Son ping: {last_hb or 'yok'}",
            "hint": "systemctl status gws-heartbeat && journalctl -u gws-heartbeat -n 20",
        })
        # 2. Plugin version >= 1.2.0?
        pv = pstate.get("plugin_version") or lic.get("plugin_version", "")
        v_ok = pv >= "1.2.0" if pv else False
        checks.append({
            "id": "plugin_version",
            "label": "heartbeat.pl v1.2.0+ (Exim log tailer içeriyor)",
            "pass": v_ok,
            "detail": f"Sürüm: {pv or 'bilinmiyor'}",
            "hint": "sudo gws-update  ← YENİ heartbeat.pl'i indirir",
        })
        # 3. Exim log push last 15min?
        push_ok = False
        if ck.get("last_push_at"):
            try:
                dt = datetime.fromisoformat(ck["last_push_at"].replace("Z", "+00:00"))
                push_ok = (now - dt).total_seconds() < 900
            except Exception:
                pass
        checks.append({
            "id": "exim_push",
            "label": "Exim log push son 15dk içinde",
            "pass": push_ok,
            "detail": f"Son push: {ck.get('last_push_at') or 'yok'} · pos: {ck.get('last_position', 0)}",
            "hint": "tail /var/log/mailshield/exim-tail.log · perl /usr/local/bin/heartbeat.pl (elle çalıştır)",
        })
        # 4. Outbound data flowing?
        data_ok = out_1h > 0 or out_24h > 0
        checks.append({
            "id": "outbound_data",
            "label": "Son 24 saatte outbound event var",
            "pass": data_ok,
            "detail": f"1s: {out_1h} · 24s: {out_24h}",
            "hint": (
                "Sunucunuzda mail hiç gitmiyor olabilir (Exim boşta) VEYA "
                "heartbeat.pl push yapmıyor (yukarıdaki 3 check'e bakın)"
            ),
        })
        # 5. Backfill status
        bf_status = "hazır"
        if bf.get("requested_at") and not bf.get("handled"):
            bf_status = f"bekliyor (istek: {bf['requested_at']})"
        elif bf.get("handled") and bf.get("pushed") is not None:
            bf_status = f"tamamlandı: {bf.get('pushed', 0)} event push edildi"
        checks.append({
            "id": "backfill",
            "label": "24s Backfill sinyali",
            "pass": True,
            "detail": bf_status,
            "hint": "'⚡ Son 24s Exim Backfill' butonu ile tetiklenebilir",
        })

        passed = sum(1 for c in checks if c["pass"])
        rows.append({
            "license_key": lic_key,
            "license_masked": lic_key[:8] + "…" + lic_key[-4:],
            "hostname": lic.get("hostname") or pstate.get("hostname"),
            "server_ip": lic.get("server_ip") or pstate.get("server_ip"),
            "plugin_version": pv or "bilinmiyor",
            "last_heartbeat_at": last_hb,
            "last_outbound_ts": (last_out.get("ts") if last_out else None),
            "last_outbound_source": (last_out.get("source") if last_out else None),
            "outbound_1h": out_1h,
            "outbound_24h": out_24h,
            "exim_push_pos": ck.get("last_position", 0),
            "exim_push_last": ck.get("last_push_at"),
            "checks": checks,
            "health_score": passed,
            "health_pct": round((passed / len(checks)) * 100),
            "overall": (
                "healthy" if passed == len(checks) else
                "degraded" if passed >= 3 else
                "critical"
            ),
        })
    return {
        "generated_at": _iso(),
        "licenses_count": len(rows),
        "rows": rows,
    }


class InstallReport(BaseModel):
    license_key: str
    gws_update_stdout: Optional[str] = ""
    gws_update_stderr: Optional[str] = ""
    heartbeat_manual_output: Optional[str] = ""
    exim_tail_log: Optional[str] = ""


@router.post("/report-install")
async def report_install(report: InstallReport, request: Request):
    """Bayi sunucusu install/update sonrası çıktısını buraya push eder.
    Master paneli 'sizin çalıştırdığınız gws-update ne dedi' görünür."""
    await db.install_reports.insert_one({
        **report.model_dump(),
        "reported_at": _iso(),
        "ip": request.client.host if request.client else None,
    })
    return {"ok": True}


@router.get("/install-reports")
async def install_reports(request: Request, limit: int = 10):
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    items = await db.install_reports.find({}, {"_id": 0}) \
        .sort("reported_at", -1).limit(min(limit, 50)).to_list(limit)
    return {"items": items}


@router.get("/commands")
async def commands():
    """Kullanıcının sunucuda çalıştırması gereken adım-adım komutlar."""
    return {
        "phases": [
            {
                "id": "1_check",
                "title": "1) MEVCUT DURUMU KONTROL ET",
                "commands": [
                    {"cmd": "cat /usr/local/bin/heartbeat.pl | grep '\\$version'",
                     "expects": "my $version = '1.2.0';",
                     "if_not": "heartbeat.pl eski sürüm — 2. adıma geçin"},
                    {"cmd": "systemctl status gws-heartbeat",
                     "expects": "Active: active (running) veya (waiting)",
                     "if_not": "Daemon çalışmıyor — 2. adım sonrası restart lazım"},
                    {"cmd": "ls -lh /var/log/exim_mainlog",
                     "expects": "en az birkaç MB boyut",
                     "if_not": "Exim log yoksa mail servisi çalışmıyor demektir"},
                ],
            },
            {
                "id": "2_update",
                "title": "2) SUNUCUYU GÜNCELLE (tek komut)",
                "commands": [
                    {"cmd": "sudo gws-update",
                     "expects": "'heartbeat.pl güncellendi' + 'systemctl reload' başarılı çıktısı",
                     "if_not": "İnternet erişimi veya panel URL problemi olabilir"},
                    {"cmd": "cat /usr/local/bin/heartbeat.pl | grep '\\$version'",
                     "expects": "my $version = '1.2.0'",
                     "if_not": "Güncelleme başarısız — /var/log/gokyuzuwebspam/update.log kontrol edin"},
                ],
            },
            {
                "id": "3_test",
                "title": "3) MANUEL TEST",
                "commands": [
                    {"cmd": "perl /usr/local/bin/heartbeat.pl",
                     "expects": "Sessiz çalışır ve çıkar; hata verirse ekrana yazar",
                     "if_not": "Perl modülü eksik olabilir — gws-update yeniden çalıştırın"},
                    {"cmd": "cat /var/log/mailshield/exim-tail.log",
                     "expects": "'pushed N events · pos=…' satırları görünmeli",
                     "if_not": "Exim log'undan hiç OUTBOUND satır bulunamadı (U= field'ı olmayan mailler)"},
                    {"cmd": "systemctl restart gws-heartbeat && journalctl -u gws-heartbeat -n 30",
                     "expects": "Restart başarılı, hata log'u yok",
                     "if_not": "Systemd hata mesajını okuyun, /etc/systemd/system/gws-heartbeat.service kontrol edin"},
                ],
            },
            {
                "id": "4_backfill",
                "title": "4) 24 SAATLİK BACKFILL",
                "commands": [
                    {"cmd": "Panelde '⚡ Son 24s Exim Backfill' butonuna tıklayın",
                     "expects": "'Sunucuya sinyal yazıldı' toast mesajı",
                     "if_not": "Master anahtarı aktif değil olabilir"},
                    {"cmd": "sleep 60 && perl /usr/local/bin/heartbeat.pl",
                     "expects": "Sinyal alınır, son 24s Exim mainlog 200'lük batch'lerle push edilir",
                     "if_not": "'/var/log/mailshield/exim-tail.log' kontrol edin, BACKFILL 24h pushed N events görünmeli"},
                ],
            },
        ],
        "generated_at": _iso(),
    }
