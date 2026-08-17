"""
Bounce Digest — her gün 09:00 UTC son 24 saatteki bounced/failed outbound
maillerin özetini generate eder ve panelde gösterir (ve opsiyonel webhook/SMTP
ile bildirim yapar).

Koleksiyonlar:
  db.bounce_digests           : üretilen digest'ler (per license, per date)
  db.settings                 : { _key: bounce_digest_config:<lic>, ... }
"""
from __future__ import annotations
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, Field
from deps import db


router = APIRouter(prefix="/bounce-digest", tags=["bounce-digest"])


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slack_text_for_digest(digest: dict) -> str:
    """Digest → Slack MRKDWN mesaj template."""
    lk = digest.get("license_key", "")[:12]
    tb = digest.get("total_bounces", 0)
    top_users = digest.get("top_users") or []
    top_domains = digest.get("top_domains") or []
    top_reasons = digest.get("top_reasons") or []
    hours = digest.get("hours", 24)
    lines = [
        f":envelope_with_arrow: *GökyüzüWebSpam Bounce Özeti* · Son {hours}s · `{lk}…`",
        f"> Toplam Bounce/Defer/Reject: *{tb}*",
    ]
    if not tb:
        lines.append(":white_check_mark: Bu dönemde bounce yok — mail sağlığı iyi.")
    else:
        if top_users:
            u_lines = "\n".join(f"• `{u[:40]}` — *{n}*" for u, n in top_users[:5])
            lines.append(f"\n*En Çok Etkilenen Kullanıcılar*\n{u_lines}")
        if top_domains:
            d_lines = "\n".join(f"• `{d[:40]}` — *{n}*" for d, n in top_domains[:5])
            lines.append(f"\n*En Çok Bounce Yiyen Alıcı Domainler*\n{d_lines}")
        if top_reasons:
            r_lines = "\n".join(f"• {r[:60]} — *{n}*" for r, n in top_reasons[:3])
            lines.append(f"\n*En Sık Bounce Sebepleri*\n{r_lines}")
    return "\n".join(lines)


def _discord_embed_for_digest(digest: dict) -> dict:
    """Digest → Discord webhook payload (embed rich card)."""
    lk = digest.get("license_key", "")[:12]
    tb = int(digest.get("total_bounces") or 0)
    hours = digest.get("hours", 24)
    top_users = digest.get("top_users") or []
    top_domains = digest.get("top_domains") or []
    top_reasons = digest.get("top_reasons") or []

    # Color: green if 0, orange if <20, red if >=20
    color = 0x22C55E if tb == 0 else (0xF59E0B if tb < 20 else 0xEF4444)
    fields: list = []
    if top_users:
        fields.append({
            "name": "En Çok Etkilenen Kullanıcılar",
            "value": "\n".join(f"`{u[:40]}` — **{n}**" for u, n in top_users[:5]) or "-",
            "inline": True,
        })
    if top_domains:
        fields.append({
            "name": "Alıcı Domainler",
            "value": "\n".join(f"`{d[:40]}` — **{n}**" for d, n in top_domains[:5]) or "-",
            "inline": True,
        })
    if top_reasons:
        fields.append({
            "name": "En Sık Sebepler",
            "value": "\n".join(f"• {r[:80]} — **{n}**" for r, n in top_reasons[:3]) or "-",
            "inline": False,
        })

    return {
        "username": "GökyüzüWebSpam",
        "embeds": [{
            "title": "📨 Bounce Özeti — Son {}s".format(hours),
            "description": f"Lisans: `{lk}…`\n**Toplam Bounce/Defer/Reject:** `{tb}`"
                           + ("" if tb else "\n:white_check_mark: Bu dönemde bounce yok."),
            "color": color,
            "fields": fields,
            "footer": {"text": "GökyüzüWebSpam · Bounce Digest v43.82"},
            "timestamp": digest.get("generated_at"),
        }],
    }


async def _deliver_bounce_digest(cfg: dict, digest: dict) -> dict:
    """Config'e göre digest'i webhook/slack/discord üzerinden ilet. Panel modu no-op."""
    method = (cfg.get("delivery_method") or "panel").lower()
    result = {"method": method, "delivered": False}
    try:
        import httpx
        if method == "webhook" and cfg.get("webhook_url"):
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(cfg["webhook_url"], json={
                    "kind": "bounce_digest",
                    "license_key": digest["license_key"],
                    "total_bounces": digest["total_bounces"],
                    "top_users": digest["top_users"],
                    "top_domains": digest["top_domains"],
                    "top_reasons": digest["top_reasons"],
                    "generated_at": digest["generated_at"],
                })
            result["delivered"] = True
        elif method == "slack" and cfg.get("slack_webhook_url"):
            payload = {"text": _slack_text_for_digest(digest), "mrkdwn": True}
            ch = (cfg.get("slack_channel") or "").strip()
            if ch:
                payload["channel"] = ch if ch.startswith("#") else f"#{ch}"
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(cfg["slack_webhook_url"], json=payload)
            result["delivered"] = True
        elif method == "discord" and cfg.get("discord_webhook_url"):
            payload = _discord_embed_for_digest(digest)
            # v43.83 — Mention role: <@&ROLE_ID> as content prefix
            mention_role = (cfg.get("discord_mention_role_id") or "").strip()
            if mention_role and mention_role.isdigit():
                payload["content"] = f"<@&{mention_role}>"
                payload["allowed_mentions"] = {"roles": [mention_role]}
            # Ana webhook + ekstra webhooks (satır/virgül ayraç)
            urls = [cfg["discord_webhook_url"].strip()]
            extras = (cfg.get("discord_extra_webhooks") or "").strip()
            if extras:
                for u in extras.replace(",", "\n").split("\n"):
                    u = u.strip()
                    if u and u not in urls:
                        urls.append(u)
            delivered_count = 0
            async with httpx.AsyncClient(timeout=8) as client:
                for u in urls[:5]:  # cap 5 webhook
                    try:
                        await client.post(u, json=payload)
                        delivered_count += 1
                    except Exception:
                        pass
            result["delivered"] = delivered_count > 0
            result["delivered_count"] = delivered_count
            result["webhook_count"] = len(urls)
    except Exception as ex:
        result["error"] = f"{type(ex).__name__}: {str(ex)[:120]}"
    return result


async def _generate_digest_for_license(license_key: str, hours: int = 24) -> dict:
    """Verilen lisans için son N saatlik bounce/defer özetini hesaplar."""
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    match = {
        "license_key": license_key,
        "direction": "out",
        "ts": {"$gte": since},
        "action": {"$in": ["bounce", "defer", "reject"]},
    }
    total_bounces = await db.mail_events.count_documents(match)
    per_user: dict[str, int] = {}
    per_domain: dict[str, int] = {}
    top_reasons: dict[str, int] = {}
    samples: list[dict] = []
    async for e in db.mail_events.find(
        match, {"_id": 0, "from_user": 1, "to_addr": 1, "subject": 1,
                "ts": 1, "action": 1, "sa_report": 1, "size_bytes": 1},
    ).sort("ts", -1).limit(500):
        u = e.get("from_user") or "(bilinmeyen)"
        per_user[u] = per_user.get(u, 0) + 1
        rcpt = e.get("to_addr") or ""
        if "@" in rcpt:
            d = rcpt.split("@", 1)[1].lower()
            per_domain[d] = per_domain.get(d, 0) + 1
        # basit reason grouping
        r = (e.get("sa_report") or "").strip() or e.get("action", "bounce")
        r_key = r[:60]
        top_reasons[r_key] = top_reasons.get(r_key, 0) + 1
        if len(samples) < 10:
            samples.append({
                "user": u, "to": rcpt, "subject": (e.get("subject") or "")[:80],
                "ts": e.get("ts"), "action": e.get("action"),
                "size_kb": round((e.get("size_bytes") or 0) / 1024, 1),
            })
    return {
        "license_key": license_key,
        "hours": hours,
        "period_start": since,
        "period_end": _iso(),
        "total_bounces": total_bounces,
        "top_users": sorted(per_user.items(), key=lambda x: -x[1])[:5],
        "top_domains": sorted(per_domain.items(), key=lambda x: -x[1])[:5],
        "top_reasons": sorted(top_reasons.items(), key=lambda x: -x[1])[:5],
        "samples": samples,
        "generated_at": _iso(),
    }


def _render_html(digest: dict) -> str:
    """Digest → basit HTML template (mail göndermek için de bu kullanılır)."""
    def rows(items):
        return "".join(
            f'<tr><td style="padding:4px 8px;border-bottom:1px solid #333">{k}</td>'
            f'<td style="padding:4px 8px;border-bottom:1px solid #333;text-align:right;color:#f43f5e">{v}</td></tr>'
            for k, v in items
        )
    return f"""<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:20px">
<h2 style="color:#818cf8;margin:0 0 8px">GökyüzüWebSpam · Bounce Özeti</h2>
<div style="color:#94a3b8;font-size:13px">Son {digest['hours']} saat · Lisans: <code>{digest['license_key'][:10]}…</code></div>
<div style="margin:16px 0;padding:12px;background:#1e293b;border-radius:8px;border-left:4px solid #f43f5e">
  <div style="font-size:11px;text-transform:uppercase;color:#94a3b8">Toplam Bounce/Defer/Reject</div>
  <div style="font-size:32px;font-weight:700;color:#f43f5e">{digest['total_bounces']}</div>
</div>
<h3 style="color:#a5b4fc;font-size:14px;margin:16px 0 4px">En Çok Etkilenen Kullanıcılar</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse">{rows(digest['top_users'])}</table>
<h3 style="color:#a5b4fc;font-size:14px;margin:16px 0 4px">En Çok Bounce Yiyen Alıcı Domainler</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse">{rows(digest['top_domains'])}</table>
<h3 style="color:#a5b4fc;font-size:14px;margin:16px 0 4px">En Sık Bounce Sebepleri</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse">{rows(digest['top_reasons'])}</table>
<p style="margin-top:24px;font-size:11px;color:#64748b">GökyüzüWebSpam · Otomatik bounce digest (her sabah 09:00 UTC)</p>
</body></html>"""


class DigestConfig(BaseModel):
    enabled: bool = True
    recipient_email: Optional[str] = None
    send_hour_utc: int = Field(9, ge=0, le=23)
    delivery_method: Literal["panel", "webhook", "slack", "discord"] = "panel"
    webhook_url: Optional[str] = None
    slack_webhook_url: Optional[str] = None
    slack_channel: Optional[str] = None   # opsiyonel; webhook zaten kanal tanımlı olabilir
    discord_webhook_url: Optional[str] = None
    # v43.83 — Discord: birden fazla webhook (satır/virgül) + mention role
    discord_extra_webhooks: Optional[str] = None
    discord_mention_role_id: Optional[str] = None   # örn: 12345 → @Rol pinglenir


@router.get("/config")
async def get_config(request: Request):
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    doc = await db.settings.find_one(
        {"_key": f"bounce_digest_config:{master_key}"}, {"_id": 0}) or {}
    return {
        "enabled": doc.get("enabled", True),
        "recipient_email": doc.get("recipient_email"),
        "send_hour_utc": doc.get("send_hour_utc", 9),
        "delivery_method": doc.get("delivery_method", "panel"),
        "webhook_url": doc.get("webhook_url"),
        "slack_webhook_url": doc.get("slack_webhook_url"),
        "slack_channel": doc.get("slack_channel"),
        "discord_webhook_url": doc.get("discord_webhook_url"),
        "discord_extra_webhooks": doc.get("discord_extra_webhooks"),
        "discord_mention_role_id": doc.get("discord_mention_role_id"),
        "last_run_at": doc.get("last_run_at"),
        "last_bounces": doc.get("last_bounces", 0),
    }


@router.post("/config")
async def set_config(cfg: DigestConfig, request: Request):
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    await db.settings.update_one(
        {"_key": f"bounce_digest_config:{master_key}"},
        {"$set": {"_key": f"bounce_digest_config:{master_key}",
                  "license_key": master_key, **cfg.model_dump()}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/preview")
async def preview(request: Request, hours: int = 24, license_key: Optional[str] = None):
    """Şu anda gönderilseydi digest nasıl görünürdü?"""
    master_key = (request.headers.get("x-master-key") or "").strip()
    lk = license_key or master_key
    if not lk:
        raise HTTPException(400, "license_key gerekli veya X-Master-Key header")
    d = await _generate_digest_for_license(lk, hours)
    d["html_preview"] = _render_html(d)
    return d


@router.get("/history")
async def history(request: Request, limit: int = 30):
    master_key = (request.headers.get("x-master-key") or "").strip()
    q = {"license_key": master_key} if master_key.startswith("MS-") else {}
    items = await db.bounce_digests.find(q, {"_id": 0, "html_preview": 0}) \
        .sort("generated_at", -1).limit(min(limit, 100)).to_list(limit)
    return {"items": items, "count": len(items)}


@router.post("/run-now")
async def run_now(request: Request):
    """Master manuel tetikler — tüm aktif lisanslar için digest üretir + saklar.

    v43.53 — Master anahtarı her zaman iterasyon setine dahil edilir (db.licenses'ta
    bulunmasa bile). 0-bounce lisanslar için de skorlama yapılır ama kayıt eklenmez;
    kullanıcı per-license sonuç görebilsin diye response detaylandırıldı.
    """
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")

    # Master key'i her zaman aktif licenses setine dahil et
    license_keys: set[str] = {master_key}
    async for lic in db.licenses.find({"active": True}, {"license_key": 1}):
        if lic.get("license_key"):
            license_keys.add(lic["license_key"])

    generated = 0
    zero_bounce = 0
    per_license: list[dict] = []

    for lic_key in license_keys:
        d = await _generate_digest_for_license(lic_key, 24)
        tb = int(d.get("total_bounces") or 0)
        per_license.append({"license_key": lic_key, "total_bounces": tb})
        if tb == 0:
            zero_bounce += 1
            continue
        d["id"] = str(uuid.uuid4())
        d["html_preview"] = _render_html(d)
        await db.bounce_digests.insert_one(dict(d))
        generated += 1
        # Webhook/Slack opsiyonel
        cfg = await db.settings.find_one(
            {"_key": f"bounce_digest_config:{lic_key}"}, {"_id": 0}) or {}
        await _deliver_bounce_digest(cfg, d)
    return {
        "ok": True,
        "generated": generated,
        "zero_bounce_licenses": zero_bounce,
        "total_scanned": len(license_keys),
        "per_license": per_license,
    }


@router.post("/test-slack")
async def test_slack(request: Request):
    """Yapılandırılmış Slack webhook'una örnek digest'ı test amaçlı gönder."""
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    cfg = await db.settings.find_one(
        {"_key": f"bounce_digest_config:{master_key}"}, {"_id": 0}) or {}
    if (cfg.get("delivery_method") or "panel").lower() != "slack":
        raise HTTPException(400, "Delivery method 'slack' olarak seçilmemiş")
    if not (cfg.get("slack_webhook_url") or "").startswith("https://hooks.slack.com/"):
        raise HTTPException(400, "Geçerli bir Slack webhook URL'si gerekli (https://hooks.slack.com/services/...)")
    d = await _generate_digest_for_license(master_key, 24)
    result = await _deliver_bounce_digest(cfg, d)
    return {"ok": result.get("delivered"), "test_digest": {"total_bounces": d["total_bounces"]}, **result}


@router.post("/test-discord")
async def test_discord(request: Request):
    """Yapılandırılmış Discord webhook'una örnek digest embed'ini test amaçlı gönder."""
    master_key = (request.headers.get("x-master-key") or "").strip()
    if not master_key.startswith("MS-"):
        raise HTTPException(403, "Master anahtarı gerekli")
    cfg = await db.settings.find_one(
        {"_key": f"bounce_digest_config:{master_key}"}, {"_id": 0}) or {}
    if (cfg.get("delivery_method") or "panel").lower() != "discord":
        raise HTTPException(400, "Delivery method 'discord' olarak seçilmemiş")
    url = (cfg.get("discord_webhook_url") or "").strip()
    if not (url.startswith("https://discord.com/api/webhooks/")
            or url.startswith("https://discordapp.com/api/webhooks/")
            or url.startswith("https://ptb.discord.com/api/webhooks/")):
        raise HTTPException(400, "Geçerli bir Discord webhook URL'si gerekli (https://discord.com/api/webhooks/...)")
    d = await _generate_digest_for_license(master_key, 24)
    result = await _deliver_bounce_digest(cfg, d)
    return {"ok": result.get("delivered"), "test_digest": {"total_bounces": d["total_bounces"]}, **result}


async def _bounce_digest_daily_loop():
    """Her saat başı çalışır — configured send_hour_utc'a denk gelen lisanslar için
    o gün digest üretilmemişse üretir. server.py startup'ta başlatılır."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            hour = now.hour
            today = now.strftime("%Y-%m-%d")
            async for cfg in db.settings.find({"_key": {"$regex": "^bounce_digest_config:"}}, {"_id": 0}):
                if not cfg.get("enabled", True):
                    continue
                if cfg.get("send_hour_utc", 9) != hour:
                    continue
                lic_key = cfg.get("license_key", "")
                if not lic_key:
                    continue
                # Bugün için zaten üretildi mi?
                exists = await db.bounce_digests.find_one({
                    "license_key": lic_key,
                    "generated_at": {"$regex": f"^{today}"},
                }, {"_id": 0, "id": 1})
                if exists:
                    continue
                d = await _generate_digest_for_license(lic_key, 24)
                d["id"] = str(uuid.uuid4())
                d["html_preview"] = _render_html(d)
                await db.bounce_digests.insert_one(dict(d))
                await _deliver_bounce_digest(cfg, d)  # v43.81 — slack/webhook opsiyonel
                await db.settings.update_one(
                    {"_key": cfg["_key"]},
                    {"$set": {"last_run_at": _iso(), "last_bounces": d["total_bounces"]}},
                )
        except Exception:
            pass
        # Her 1 saatte bir tetiklen
        await asyncio.sleep(3600)


# ============================================================================
# v43.42 — Marketplace Leaderboard (haftalık ödül/rozet sistemi)
# ============================================================================
_leaderboard_router = APIRouter(prefix="/marketplace", tags=["marketplace-leaderboard"])


def _badge_for_installs(n: int) -> dict:
    if n >= 100:
        return {"tier": "diamond", "label": "💎 Elmas", "color": "#0ea5e9", "min": 100}
    if n >= 50:
        return {"tier": "gold", "label": "🥇 Altın", "color": "#eab308", "min": 50}
    if n >= 20:
        return {"tier": "silver", "label": "🥈 Gümüş", "color": "#94a3b8", "min": 20}
    if n >= 5:
        return {"tier": "bronze", "label": "🥉 Bronz", "color": "#d97706", "min": 5}
    return {"tier": "starter", "label": "🌱 Başlangıç", "color": "#64748b", "min": 0}


@_leaderboard_router.get("/leaderboard")
async def marketplace_leaderboard(period: Literal["week", "month", "all"] = "week"):
    """Marketplace haftalık/aylık/tüm zaman liderlik tablosu."""
    if period == "week":
        since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    elif period == "month":
        since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    else:
        since = None

    # 1) Publisher leaderboard — kimin imzaları en çok install edildi
    publishers: dict[str, dict] = {}
    async for sig in db.marketplace_signatures.find({"status": "active"},
            {"_id": 0, "publisher_license": 1, "publisher_masked": 1, "stats": 1}):
        pl = sig.get("publisher_license", "")
        if not pl:
            continue
        p = publishers.setdefault(pl, {
            "publisher_license": pl,
            "publisher_masked": sig.get("publisher_masked", pl[:8] + "…"),
            "signatures": 0, "total_installs": 0, "total_upvotes": 0,
        })
        p["signatures"] += 1
        p["total_installs"] += sig.get("stats", {}).get("installs", 0)
        p["total_upvotes"] += sig.get("stats", {}).get("upvotes", 0)

    # Period-scoped install count (from install_log)
    if since:
        install_match = {"ts": {"$gte": since}}
        period_installs: dict[str, int] = {}
        async for row in db.marketplace_install_log.aggregate([
            {"$match": install_match},
            {"$lookup": {"from": "marketplace_signatures",
                          "localField": "signature_id", "foreignField": "id",
                          "as": "sig"}},
            {"$unwind": "$sig"},
            {"$group": {"_id": "$sig.publisher_license", "count": {"$sum": 1}}},
        ]):
            period_installs[row["_id"]] = row["count"]
        for pl in publishers:
            publishers[pl]["period_installs"] = period_installs.get(pl, 0)
    else:
        for pl in publishers:
            publishers[pl]["period_installs"] = publishers[pl]["total_installs"]

    # Badge + sort
    ranked_pubs = list(publishers.values())
    for p in ranked_pubs:
        p["badge"] = _badge_for_installs(p["total_installs"])
    ranked_pubs.sort(key=lambda x: (x["period_installs"], x["total_installs"]), reverse=True)

    # 2) Top signatures (period scoped)
    if since:
        sig_installs: dict[str, int] = {}
        async for row in db.marketplace_install_log.aggregate([
            {"$match": {"ts": {"$gte": since}}},
            {"$group": {"_id": "$signature_id", "period_installs": {"$sum": 1}}},
            {"$sort": {"period_installs": -1}},
            {"$limit": 10},
        ]):
            sig_installs[row["_id"]] = row["period_installs"]
        top_sigs_ids = list(sig_installs.keys())
        top_sigs = await db.marketplace_signatures.find(
            {"id": {"$in": top_sigs_ids}},
            {"_id": 0, "publisher_license": 0, "pattern": 0}
        ).to_list(10)
        for s in top_sigs:
            s["period_installs"] = sig_installs.get(s["id"], 0)
        top_sigs.sort(key=lambda x: x["period_installs"], reverse=True)
    else:
        top_sigs = await db.marketplace_signatures.find(
            {"status": "active"},
            {"_id": 0, "publisher_license": 0, "pattern": 0}
        ).sort("stats.installs", -1).limit(10).to_list(10)
        for s in top_sigs:
            s["period_installs"] = s.get("stats", {}).get("installs", 0)

    return {
        "period": period,
        "generated_at": _iso(),
        "top_publishers": ranked_pubs[:10],
        "top_signatures": top_sigs,
        "badge_tiers": [
            _badge_for_installs(0),
            _badge_for_installs(5),
            _badge_for_installs(20),
            _badge_for_installs(50),
            _badge_for_installs(100),
        ],
    }
