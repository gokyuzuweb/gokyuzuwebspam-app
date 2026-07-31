"""
Reseller invoice history + PDF export.

Endpoints (all under /api/reseller/invoices/*):
  GET /            — list all paid transactions for this reseller's license_key
  GET /{tx_id}     — get one transaction detail
  GET /{tx_id}/pdf — download a professionally-formatted PDF invoice

Invoices are reconstructed from the `payment_transactions` collection.
No separate invoice numbering table — we derive INV-YYYYMM-XXXXX deterministically.
"""
from __future__ import annotations
import io
import hashlib
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Header
from fastapi.responses import StreamingResponse
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak,
)
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from deps import db
from routes.reseller import current_reseller

router = APIRouter(prefix="/reseller/invoices", tags=["reseller-invoices"])

# ---------------- i18n dictionary for PDF ------------------------------------
INVOICE_I18N = {
    "tr": {
        "invoice": "FATURA", "seller": "SATICI", "buyer": "ALICI",
        "invoice_no": "Fatura No", "date": "Tarih", "payment_ref": "Ödeme Ref.",
        "plan": "Plan", "description": "Açıklama", "quantity": "Miktar",
        "unit_price": "Birim Fiyat", "total": "Toplam",
        "subtotal": "Ara Toplam", "tax": "KDV (%0)", "grand_total": "TOPLAM",
        "paid": "ÖDENDİ",
        "sub_desc": "Sunucu başına, sınırsız e-posta, IP tabanlı doğrulama",
        "footer_note": "Bu fatura elektronik ortamda üretilmiştir; imza gerektirmez.",
        "support": "Sorularınız için: <b>destek@gokyuzuwebspam.com</b> · Kurulum: <b>gokyuzuwebspam.com/panel/install</b>",
        "product_line": "GökyüzüWebSpam — WHM/cPanel için ticari mail güvenliği çözümü.",
        "license_prefix": "Lisans",
    },
    "en": {
        "invoice": "INVOICE", "seller": "SELLER", "buyer": "BUYER",
        "invoice_no": "Invoice No.", "date": "Date", "payment_ref": "Payment Ref.",
        "plan": "Plan", "description": "Description", "quantity": "Qty",
        "unit_price": "Unit Price", "total": "Total",
        "subtotal": "Subtotal", "tax": "VAT (0%)", "grand_total": "TOTAL",
        "paid": "PAID",
        "sub_desc": "Per server, unlimited emails, IP-based verification",
        "footer_note": "This invoice was generated electronically; no signature required.",
        "support": "Support: <b>support@gokyuzuwebspam.com</b> · Install: <b>gokyuzuwebspam.com/panel/install</b>",
        "product_line": "GökyüzüWebSpam — commercial mail security for WHM/cPanel.",
        "license_prefix": "License",
    },
    "de": {
        "invoice": "RECHNUNG", "seller": "VERKÄUFER", "buyer": "KÄUFER",
        "invoice_no": "Rechnungsnr.", "date": "Datum", "payment_ref": "Zahlungsref.",
        "plan": "Plan", "description": "Beschreibung", "quantity": "Menge",
        "unit_price": "Einzelpreis", "total": "Summe",
        "subtotal": "Zwischensumme", "tax": "MwSt. (0%)", "grand_total": "GESAMT",
        "paid": "BEZAHLT",
        "sub_desc": "Pro Server, unbegrenzte E-Mails, IP-basierte Prüfung",
        "footer_note": "Diese Rechnung wurde elektronisch erstellt; keine Unterschrift erforderlich.",
        "support": "Support: <b>support@gokyuzuwebspam.com</b> · Installation: <b>gokyuzuwebspam.com/panel/install</b>",
        "product_line": "GökyüzüWebSpam — kommerzielle Mail-Sicherheit für WHM/cPanel.",
        "license_prefix": "Lizenz",
    },
    "fr": {
        "invoice": "FACTURE", "seller": "VENDEUR", "buyer": "ACHETEUR",
        "invoice_no": "N° Facture", "date": "Date", "payment_ref": "Réf. paiement",
        "plan": "Formule", "description": "Description", "quantity": "Qté",
        "unit_price": "Prix unitaire", "total": "Total",
        "subtotal": "Sous-total", "tax": "TVA (0%)", "grand_total": "TOTAL",
        "paid": "PAYÉE",
        "sub_desc": "Par serveur, e-mails illimités, vérification par IP",
        "footer_note": "Cette facture a été générée électroniquement ; aucune signature requise.",
        "support": "Support : <b>support@gokyuzuwebspam.com</b> · Installation : <b>gokyuzuwebspam.com/panel/install</b>",
        "product_line": "GökyüzüWebSpam — sécurité e-mail commerciale pour WHM/cPanel.",
        "license_prefix": "Licence",
    },
    "es": {
        "invoice": "FACTURA", "seller": "VENDEDOR", "buyer": "COMPRADOR",
        "invoice_no": "N.º Factura", "date": "Fecha", "payment_ref": "Ref. pago",
        "plan": "Plan", "description": "Descripción", "quantity": "Cant.",
        "unit_price": "Precio unit.", "total": "Total",
        "subtotal": "Subtotal", "tax": "IVA (0%)", "grand_total": "TOTAL",
        "paid": "PAGADA",
        "sub_desc": "Por servidor, correos ilimitados, verificación por IP",
        "footer_note": "Esta factura se generó electrónicamente; no requiere firma.",
        "support": "Soporte: <b>support@gokyuzuwebspam.com</b> · Instalación: <b>gokyuzuwebspam.com/panel/install</b>",
        "product_line": "GökyüzüWebSpam — seguridad de correo comercial para WHM/cPanel.",
        "license_prefix": "Licencia",
    },
}


def _t(lang: str) -> dict:
    return INVOICE_I18N.get(lang, INVOICE_I18N["en"])


def _invoice_number(tx: dict) -> str:
    """Deterministic INV-YYYYMM-XXXXX from session_id + created_at."""
    d = tx.get("completed_at") or tx.get("created_at") or datetime.now(timezone.utc).isoformat()
    try:
        ym = datetime.fromisoformat(d.replace("Z", "+00:00")).strftime("%Y%m")
    except Exception:
        ym = datetime.now(timezone.utc).strftime("%Y%m")
    hh = hashlib.md5((tx.get("session_id") or tx.get("id") or "").encode()).hexdigest()[:5].upper()
    return f"INV-{ym}-{hh}"


def _fmt_money(amount: float, currency: str = "USD") -> str:
    symbol = {"USD": "$", "EUR": "€", "TRY": "₺", "GBP": "£"}.get(currency, currency + " ")
    return f"{symbol}{amount:,.2f}"


@router.get("")
async def list_invoices(reseller: dict = Depends(current_reseller)):
    """Return all paid transactions bound to this reseller's license."""
    txs = await db.payment_transactions.find(
        {"license_key": reseller["license_key"], "status": "paid"}, {"_id": 0}
    ).sort("completed_at", -1).to_list(200)

    invoices = []
    for tx in txs:
        invoices.append({
            "id": tx.get("id"),
            "session_id": tx.get("session_id"),
            "invoice_number": _invoice_number(tx),
            "plan_code": tx.get("plan_code"),
            "billing_period": tx.get("billing_period"),
            "amount": tx.get("amount"),
            "currency": tx.get("currency", "USD"),
            "issued_at": tx.get("completed_at") or tx.get("created_at"),
            "customer_email": tx.get("customer_email"),
            "customer_name": tx.get("customer_name") or reseller.get("company", ""),
            "license_key": tx.get("license_key"),
        })
    return {
        "invoices": invoices,
        "total_paid": round(sum(float(t.get("amount") or 0) for t in txs), 2),
        "currency": (txs[0].get("currency") if txs else "USD") or "USD",
        "count": len(invoices),
    }


@router.get("/{tx_id}")
async def get_invoice(tx_id: str, reseller: dict = Depends(current_reseller)):
    tx = await db.payment_transactions.find_one(
        {"id": tx_id, "license_key": reseller["license_key"], "status": "paid"}, {"_id": 0}
    )
    if not tx:
        raise HTTPException(404, "Fatura bulunamadı")
    tx["invoice_number"] = _invoice_number(tx)
    return tx


@router.get("/{tx_id}/pdf")
async def invoice_pdf(
    tx_id: str,
    lang: str = "tr",
    reseller: dict = Depends(current_reseller),
):
    """Generate a professional A4 PDF invoice. Supports lang=tr|en|de|fr|es."""
    tx = await db.payment_transactions.find_one(
        {"id": tx_id, "license_key": reseller["license_key"], "status": "paid"}, {"_id": 0}
    )
    if not tx:
        raise HTTPException(404, "Fatura bulunamadı")

    L = _t((lang or "tr").lower())

    # Plan lookup
    pricing = await db.settings.find_one({"_key": "pricing"}, {"_id": 0}) or {}
    plan_name = tx.get("plan_code", "pro").capitalize()
    for p in (pricing.get("plans") or []):
        if p.get("code") == tx.get("plan_code"):
            plan_name = p.get("name", plan_name)
            break

    inv_no = _invoice_number(tx)
    issued = tx.get("completed_at") or tx.get("created_at") or ""
    try:
        issued_pretty = datetime.fromisoformat(issued.replace("Z", "+00:00")).strftime("%d %b %Y")
    except Exception:
        issued_pretty = issued[:10]
    amount = float(tx.get("amount") or 0)
    currency = tx.get("currency", "USD")

    # Build PDF ---------------------------------------------------------------
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            leftMargin=20 * mm, rightMargin=20 * mm,
                            topMargin=20 * mm, bottomMargin=20 * mm)
    styles = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=9, leading=12)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8, leading=10, textColor=colors.grey)
    h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontSize=22, textColor=colors.HexColor("#0f172a"), spaceAfter=4)
    h_seller = ParagraphStyle("h_seller", parent=styles["Normal"], fontSize=13, leading=15,
                              textColor=colors.HexColor("#4f46e5"), fontName="Helvetica-Bold")
    right = ParagraphStyle("right", parent=body, alignment=TA_RIGHT)
    right_s = ParagraphStyle("right_s", parent=small, alignment=TA_RIGHT)

    story = []

    # Header
    header_data = [[
        Paragraph("Gökyüzü<font color='#4f46e5'>WebSpam</font>", h_seller),
        Paragraph(f"<b>{L['invoice']}</b><br/>{inv_no}", right),
    ]]
    t = Table(header_data, colWidths=[100 * mm, 60 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(t)
    story.append(Paragraph("WHM / cPanel · gokyuzuwebspam.com", small))
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#cbd5e1")))
    story.append(Spacer(1, 6 * mm))

    # Parties
    parties = [[
        Paragraph(
            f"<b>{L['seller']}</b><br/>"
            "GökyüzüWebSpam<br/>"
            "support@gokyuzuwebspam.com<br/>"
            "https://gokyuzuwebspam.com",
            body,
        ),
        Paragraph(
            f"<b>{L['buyer']}</b><br/>"
            f"{tx.get('customer_name') or reseller.get('company', '')}<br/>"
            f"{tx.get('customer_email', '')}<br/>"
            f"{L['license_prefix']}: <font name='Courier'>{tx.get('license_key', '')[:24]}…</font>",
            body,
        ),
    ]]
    t = Table(parties, colWidths=[80 * mm, 80 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(t)
    story.append(Spacer(1, 8 * mm))

    # Meta
    meta = [
        [L["invoice_no"], inv_no],
        [L["date"], issued_pretty],
        [L["payment_ref"], (tx.get("session_id") or "-")[:44]],
        [L["plan"], f"{plan_name} ({tx.get('billing_period', '-')})"],
    ]
    t = Table(meta, colWidths=[36 * mm, 124 * mm])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 9),
        ("FONT", (1, 0), (1, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#64748b")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 8 * mm))

    # Line items
    line_items = [
        [L["description"], L["quantity"], L["unit_price"], L["total"]],
        [
            f"{plan_name} — GökyüzüWebSpam ({tx.get('billing_period', 'monthly')})\n"
            f"{L['sub_desc']}",
            "1",
            _fmt_money(amount, currency),
            _fmt_money(amount, currency),
        ],
    ]
    t = Table(line_items, colWidths=[92 * mm, 20 * mm, 24 * mm, 24 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef2ff")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#4338ca")),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 9),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
    ]))
    story.append(t)
    story.append(Spacer(1, 4 * mm))

    # Totals block (right-aligned)
    totals = [
        [L["subtotal"], _fmt_money(amount, currency)],
        [L["tax"], _fmt_money(0, currency)],
        [L["grand_total"], _fmt_money(amount, currency)],
    ]
    t = Table(totals, colWidths=[45 * mm, 30 * mm])
    t.hAlign = "RIGHT"
    t.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("FONT", (0, 0), (-1, -2), "Helvetica", 9),
        ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 11),
        ("TEXTCOLOR", (0, -1), (-1, -1), colors.HexColor("#4f46e5")),
        ("LINEABOVE", (0, -1), (-1, -1), 0.5, colors.HexColor("#4f46e5")),
        ("TOPPADDING", (0, -1), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t)
    story.append(Spacer(1, 12 * mm))

    # Status badge
    story.append(Paragraph(
        f"<font backColor='#dcfce7' color='#16a34a'> ● {L['paid']} </font>  &nbsp; "
        f"<font color='#64748b' size='8'>{L['footer_note']}</font>",
        body,
    ))
    story.append(Spacer(1, 12 * mm))

    # Footer
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e2e8f0")))
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(L["support"], small))
    story.append(Paragraph(L["product_line"], small))

    doc.build(story)
    buf.seek(0)
    filename = f"{inv_no}-{(lang or 'tr').lower()}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
