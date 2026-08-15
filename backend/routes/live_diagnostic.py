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
         "activated_at": 1, "last_heartbeat_at": 1, "plugin_version": 1, "kind": 1}
    ).to_list(200)

    rows = []
    for lic in licenses:
        lic_key = lic["license_key"]
        # Son heartbeat plugin_state'ten (Perl heartbeat.pl kurulumları için)
        pstate = await db.plugin_state.find_one({"license_key": lic_key}, {"_id": 0}) or {}
        # Son 24s outbound event
        last_out = await db.mail_events.find_one(
            {"license_key": lic_key, "direction": "out"},
            {"_id": 0, "ts": 1, "source": 1, "server_hostname": 1}, sort=[("ts", -1)]
        )
        # Son push zamanı (bash script'in tetiklendiği en son "ingested_at")
        last_ingest = await db.mail_events.find_one(
            {"license_key": lic_key, "direction": "out",
             "source": {"$in": ["exim_logtail_heartbeat", "exim_logtail", "exim_bash"]}},
            {"_id": 0, "ingested_at": 1, "source": 1},
            sort=[("ingested_at", -1)]
        ) or {}
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

        # v43.49 — Kurulum tipini tespit et
        installation_type = "unknown"
        installation_label = "Bilinmiyor"
        if pstate.get("plugin_version"):
            installation_type = "perl_heartbeat"
            installation_label = f"WHM Perl Plugin v{pstate.get('plugin_version')}"
        elif ck.get("last_push_at") or (last_ingest.get("source") in ("exim_logtail_heartbeat", "exim_logtail")):
            installation_type = "bash_cron"
            installation_label = "Docker + Bash Cron (gws-exim-push)"
        elif lic.get("kind") == "master_self_hosted":
            installation_type = "master_self_hosted"
            installation_label = "Self-Hosted Master (henüz push yok)"

        checks = []
        # 1. Son push 2dk içinde mi? (bash cron her dakika çalıştığı için)
        last_push_dt = None
        push_source = ck.get("last_push_at") or last_ingest.get("ingested_at")
        push_fresh = False
        if push_source:
            try:
                dt = datetime.fromisoformat(push_source.replace("Z", "+00:00"))
                seconds_ago = (now - dt).total_seconds()
                push_fresh = seconds_ago < 180  # 3dk toleransı
                last_push_dt = push_source
            except Exception:
                pass
        checks.append({
            "id": "push_fresh",
            "label": "Son push 3 dakika içinde (cron çalışıyor)",
            "pass": push_fresh,
            "detail": f"Son push: {last_push_dt or 'yok'}",
            "hint": "SSH: crontab -l | grep gws · systemctl status crond · tail /var/log/gws-exim-push/push.log",
        })
        # 2. Kurulum tipi tespit edildi mi?
        checks.append({
            "id": "install_type",
            "label": "Kurulum tipi tespit edildi",
            "pass": installation_type not in ("unknown",),
            "detail": installation_label,
            "hint": "Bir kez /usr/local/bin/gws-exim-push elle çalıştırın; ilk başarılı push tipiyle otomatik anlaşılır.",
        })
        # 3. Checkpoint kaydı var mı?
        checks.append({
            "id": "checkpoint",
            "label": "Exim log checkpoint kayıtlı",
            "pass": bool(ck.get("last_push_at")),
            "detail": f"Pozisyon: {ck.get('last_position', 0)} bytes · son push: {ck.get('last_push_at') or 'yok'}",
            "hint": "Bash script hiç çalışmamış — SSH: /usr/local/bin/gws-exim-push",
        })
        # 4. Outbound data flowing?
        data_ok = out_1h > 0 or out_24h > 0
        checks.append({
            "id": "outbound_data",
            "label": "Son 24 saatte outbound event var",
            "pass": data_ok,
            "detail": f"1s: {out_1h} · 24s: {out_24h}",
            "hint": (
                "Sunucunuzda mail gitmiyor olabilir VEYA script çalıştıysa ama Exim log'unda "
                "outbound (U= / A=dovecot_login / userdomains eşleşen) yok. cat /var/log/gws-exim-push/push.log"
            ),
        })
        # 5. Backfill state
        bf_status = "hazır"
        if bf.get("requested_at") and not bf.get("handled"):
            bf_status = f"bekliyor (istek: {bf['requested_at']})"
        elif bf.get("handled") and bf.get("pushed") is not None:
            bf_status = f"tamamlandı"
        checks.append({
            "id": "backfill",
            "label": "24s Backfill sinyali",
            "pass": True,
            "detail": bf_status,
            "hint": "'⚡ Son 24s Exim Backfill' butonu ile tetiklenir · cron 1dk cycle'da işler",
        })

        passed = sum(1 for c in checks if c["pass"])
        rows.append({
            "license_key": lic_key,
            "license_masked": lic_key[:8] + "…" + lic_key[-4:],
            "hostname": lic.get("hostname") or pstate.get("hostname") or (last_out.get("server_hostname") if last_out else None),
            "server_ip": lic.get("server_ip") or pstate.get("server_ip"),
            "plugin_version": pstate.get("plugin_version") or "-",
            "installation_type": installation_type,
            "installation_label": installation_label,
            "last_heartbeat_at": pstate.get("last_heartbeat_at") or lic.get("last_heartbeat_at"),
            "last_push_at": ck.get("last_push_at") or last_ingest.get("ingested_at"),
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
    """Kullanıcının sunucuda çalıştırması gereken adım-adım komutlar (v43.49 — Docker/bash)."""
    return {
        "phases": [
            {
                "id": "1_check",
                "title": "1) MEVCUT DURUMU KONTROL ET",
                "commands": [
                    {"cmd": "gws-update",
                     "expects": "v43.48+ · en güncel sürüm",
                     "if_not": "Docker container'ı update edilemiyor — /var/log/gokyuzuwebspam/update.log"},
                    {"cmd": "which gws-exim-push && ls -la /usr/local/bin/gws-exim-push",
                     "expects": "/usr/local/bin/gws-exim-push · executable",
                     "if_not": "Bash tailer kurulmamış — 2. adıma geçin"},
                    {"cmd": "crontab -l | grep gws-exim-push",
                     "expects": "* * * * * /usr/local/bin/gws-exim-push …",
                     "if_not": "Cron kaydı yok — 2. adıma geçin"},
                ],
            },
            {
                "id": "2_install",
                "title": "2) KURULUM (tek komut)",
                "commands": [
                    {"cmd": ("curl -sSf \"https://panel.gokyuzuhosting.com/api/tools/gws-exim-push.sh\" "
                             "-o /usr/local/bin/gws-exim-push && chmod +x /usr/local/bin/gws-exim-push"),
                     "expects": "Sessiz başarı",
                     "if_not": "Panel URL erişilebilir mi? curl -I panel.gokyuzuhosting.com"},
                    {"cmd": ("(crontab -l 2>/dev/null | grep -v gws-exim-push; "
                             "echo '* * * * * /usr/local/bin/gws-exim-push >/dev/null 2>&1') | crontab -"),
                     "expects": "Cron kaydı eklendi",
                     "if_not": "Cron daemon aktif mi? systemctl status crond"},
                    {"cmd": "test -f /etc/gws-exim-push.conf && cat /etc/gws-exim-push.conf",
                     "expects": "LICENSE_KEY=MS-... satırı görünmeli",
                     "if_not": "Config yok: install-exim-push.sh oneliner'ını çalıştırın"},
                ],
            },
            {
                "id": "3_test",
                "title": "3) MANUEL TEST (log gerçek gelecek mi?)",
                "commands": [
                    {"cmd": "DEBUG=1 /usr/local/bin/gws-exim-push",
                     "expects": "Sessiz çıkar VEYA hata mesajı ekrana yazar",
                     "if_not": "Config veya panel bağlantı problemi — log dosyasını kontrol edin"},
                    {"cmd": "tail -10 /var/log/gws-exim-push/push.log",
                     "expects": "'OK · parsed=N · inserted=N · pos=…' satırı",
                     "if_not": "Parsed 0 çıkarsa: /etc/userdomains içeriğini kontrol edin (cPanel domain listesi)"},
                    {"cmd": "curl -s http://localhost:8001/api/outbound/stats -H \"X-Master-Key: $LICENSE_KEY\" 2>/dev/null | head -c 200",
                     "expects": "today_total > 0",
                     "if_not": "Panel'de master anahtarı aktif değil VEYA event push başarısız"},
                ],
            },
            {
                "id": "4_backfill",
                "title": "4) 24 SAATLİK BACKFILL",
                "commands": [
                    {"cmd": "Panelde '⚡ Son 24s Exim Backfill' butonuna tıklayın",
                     "expects": "'1 sunucuya sinyal + panel checkpoint sıfırlandı · 60sn içinde push' toast",
                     "if_not": "Master anahtarı aktif değil — sağ üstteki MASTER badge'e bakın"},
                    {"cmd": "sleep 65 && tail -5 /var/log/gws-exim-push/push.log",
                     "expects": "'Backfill signal → checkpoint sıfırlanıyor' + 'OK · parsed=N · inserted=N'",
                     "if_not": "Cron çalışmıyor OR Exim log çok küçük"},
                ],
            },
        ],
        "generated_at": _iso(),
    }
