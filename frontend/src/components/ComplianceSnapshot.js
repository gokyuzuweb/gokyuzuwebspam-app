import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { FileDown, Shield, ShieldOff, Bug, Printer } from "lucide-react";
import { toast } from "sonner";

/**
 * ComplianceSnapshot — 30-day summary card for compliance reports (GDPR/KVKK).
 * Includes CSV download button that formats the snapshot for auditors.
 */
export default function ComplianceSnapshot({ licenseKey }) {
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["compliance", licenseKey, days],
    queryFn: () => api.complianceSnapshot(licenseKey, days),
    refetchInterval: 60000,
    enabled: !!licenseKey,
    retry: false,
  });
  const d = q.data || {};

  function downloadReport() {
    if (!q.data) return;
    const now = new Date().toISOString().slice(0, 10);
    const rows = [
      ["Metric", "Value"],
      ["Report Date", now],
      ["Period (days)", d.period_days],
      ["Since", d.since],
      ["Total Scanned", d.total_scanned],
      ["Spam Blocked", d.spam_blocked],
      ["Virus Blocked", d.virus_blocked],
      ["Clean Delivered", d.clean_delivered],
      ["Block Ratio (%)", d.block_ratio],
    ];
    const csv = "\uFEFF" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-${d.period_days}gun-${now}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Compliance raporu indirildi");
  }

  function downloadPdf() {
    if (!q.data) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString("tr-TR");
    const periodEnd = dateStr;
    const periodStart = new Date(now.getTime() - (d.period_days || 30) * 86400000).toLocaleDateString("tr-TR");
    const html = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>Compliance Raporu ${dateStr}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
         color: #0f172a; margin: 0; padding: 0; }
  .hdr { border-bottom: 2px solid #6366f1; padding-bottom: 12px; margin-bottom: 20px;
         display: flex; align-items: center; justify-content: space-between; }
  .brand { font-size: 22px; font-weight: 800; color: #4338ca; letter-spacing: -0.5px; }
  .brand small { color: #64748b; font-weight: 500; margin-left: 6px; font-size: 12px; }
  .doc-title { font-size: 13px; color: #64748b; text-align: right; }
  .doc-title b { display: block; color: #0f172a; font-size: 15px; margin-bottom: 2px; }
  h1 { font-size: 22px; margin: 24px 0 4px; color: #1e293b; }
  .subtitle { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  .period { background: #f1f5f9; border-left: 3px solid #6366f1; padding: 10px 14px;
            font-size: 13px; margin: 20px 0; border-radius: 4px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 20px 0; }
  .metric { border: 1px solid #e2e8f0; padding: 14px; border-radius: 6px; background: #f8fafc; }
  .metric .lbl { color: #64748b; font-size: 11px; text-transform: uppercase;
                 letter-spacing: 0.05em; font-weight: 600; margin-bottom: 6px; }
  .metric .val { font-size: 26px; font-weight: 800; }
  .metric.warn .val { color: #b45309; }
  .metric.danger .val { color: #b91c1c; }
  .metric.ok .val { color: #047857; }
  .metric.info .val { color: #4338ca; }
  .footer { margin-top: 42px; border-top: 1px solid #cbd5e1; padding-top: 14px;
            font-size: 11px; color: #64748b; display: flex; justify-content: space-between; }
  .sign { margin-top: 60px; display: flex; justify-content: space-between; }
  .sign > div { width: 45%; text-align: center; font-size: 11px; color: #475569;
                border-top: 1px solid #94a3b8; padding-top: 6px; }
  .compliance-note { margin: 24px 0; padding: 12px 16px; background: #ecfdf5;
                     border-left: 3px solid #059669; font-size: 12px; color: #065f46;
                     border-radius: 4px; }
  @media print { .noprint { display: none; } body { -webkit-print-color-adjust: exact; } }
</style></head><body>
<div class="hdr">
  <div>
    <div class="brand">Gökyüzü<span style="color:#0f172a">WebSpam</span><small>Compliance Report</small></div>
  </div>
  <div class="doc-title">
    <b>Compliance Snapshot</b>
    <div>Rapor Tarihi: ${dateStr}</div>
    <div style="font-family:monospace; font-size:11px;">${(d.license_key || "").slice(0, 20)}</div>
  </div>
</div>

<h1>GDPR / KVKK Uyumluluk Özeti</h1>
<div class="subtitle">Son ${d.period_days} gün için mail filtreleme performansı ve tehdit bloklama metrikleri</div>

<div class="period">
  <b>Rapor Dönemi:</b> ${periodStart} — ${periodEnd} &nbsp;·&nbsp;
  <b>Toplam Taranan:</b> ${(d.total_scanned ?? 0).toLocaleString("tr-TR")} mail &nbsp;·&nbsp;
  <b>Genel Blok Oranı:</b> %${d.block_ratio ?? 0}
</div>

<div class="grid">
  <div class="metric warn">
    <div class="lbl">Spam Engellendi</div>
    <div class="val">${(d.spam_blocked ?? 0).toLocaleString("tr-TR")}</div>
  </div>
  <div class="metric danger">
    <div class="lbl">Virüs Bloklandı</div>
    <div class="val">${(d.virus_blocked ?? 0).toLocaleString("tr-TR")}</div>
  </div>
  <div class="metric ok">
    <div class="lbl">Temiz Teslim</div>
    <div class="val">${(d.clean_delivered ?? 0).toLocaleString("tr-TR")}</div>
  </div>
  <div class="metric info">
    <div class="lbl">Blok Oranı</div>
    <div class="val">%${d.block_ratio ?? 0}</div>
  </div>
</div>

<div class="compliance-note">
  <b>Uyumluluk Beyanı:</b> Bu rapor GDPR Madde 30 (İşleme faaliyetleri kayıtları) ve KVKK Madde 12
  (Veri güvenliği yükümlülükleri) kapsamında hazırlanmıştır. Tüm blok kararları otomatik
  filtreleme mekanizmaları tarafından, kişisel veri kaydedilmeksizin (yalnızca meta veri: gönderen,
  konu başlığı, verdict, zaman) verilmiştir. Mail içerikleri saklanmaz.
</div>

<div class="sign">
  <div>Sorumlu Yönetici<br/><span style="color:#94a3b8">(imza)</span></div>
  <div>Veri Sorumlusu (DPO)<br/><span style="color:#94a3b8">(imza)</span></div>
</div>

<div class="footer">
  <div>Otomatik olarak GökyüzüWebSpam tarafından oluşturuldu · ${now.toLocaleString("tr-TR")}</div>
  <div>Sayfa 1 / 1</div>
</div>

<div class="noprint" style="text-align:center; margin-top:30px; padding:20px; background:#f8fafc; border-radius:8px;">
  <button onclick="window.print()" style="padding:10px 24px; background:#6366f1; color:white;
    border:none; border-radius:6px; font-weight:600; cursor:pointer; font-size:14px;">
    ↓ PDF Olarak Kaydet / Yazdır
  </button>
  <div style="margin-top:8px; font-size:11px; color:#64748b;">
    Dialog'da "PDF olarak kaydet" seçin — imzalı format hazır
  </div>
</div>
</body></html>`;
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) { toast.error("Popup engellendi — tarayıcı ayarlarını kontrol edin"); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (_) {} }, 400);
    toast.success("PDF penceresi açıldı");
  }

  return (
    <Card data-testid="compliance-snapshot-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><Shield className="w-4 h-4 text-emerald-400" /> Compliance Snapshot</span>}
        subtitle={`Son ${d.period_days || days} gün — GDPR/KVKK raporları`}
        right={
          <div className="flex gap-2">
            <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}
                    className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-100"
                    data-testid="compliance-days-select">
              <option value={7}>7 gün</option>
              <option value={30}>30 gün</option>
              <option value={90}>90 gün</option>
              <option value={365}>1 yıl</option>
            </select>
            <button onClick={downloadReport}
                    className="text-xs px-3 py-1 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 inline-flex items-center gap-1"
                    data-testid="compliance-download-btn">
              <FileDown className="w-3.5 h-3.5" /> CSV
            </button>
            <button onClick={downloadPdf}
                    className="text-xs px-3 py-1 rounded bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 inline-flex items-center gap-1"
                    data-testid="compliance-pdf-btn"
                    title="GDPR/KVKK uyumlu, imza satırlı PDF">
              <Printer className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        }
      />
      <CardBody>
        <div className="grid grid-cols-2 gap-3">
          <Metric icon={ShieldOff} label="Spam Engellendi"   value={d.spam_blocked}    tone="warning" />
          <Metric icon={Bug}       label="Virüs Bloklandı"   value={d.virus_blocked}   tone="danger" />
          <Metric icon={Shield}    label="Temiz Teslim"      value={d.clean_delivered} tone="success" />
          <Metric icon={FileDown}  label="Blok Oranı"        value={`%${d.block_ratio ?? 0}`} tone="info" />
        </div>
        <div className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-500">
          Toplam taranan: <span className="mono text-slate-200">{d.total_scanned ?? 0}</span> ·
          Rapor: <span className="mono text-slate-400">{d.generated_at ? new Date(d.generated_at).toLocaleString("tr-TR", {hour12:false}) : "-"}</span>
        </div>
      </CardBody>
    </Card>
  );
}

function Metric({ icon: Icon, label, value, tone }) {
  const c = tone === "success" ? "text-emerald-400"
         : tone === "warning" ? "text-amber-400"
         : tone === "danger"  ? "text-rose-400"
         : "text-indigo-400";
  return (
    <div className="p-3 rounded bg-slate-900/40 border border-slate-800" data-testid={`compliance-metric-${label}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 ${c}`} />
        <span className="text-[11px] text-slate-500">{label}</span>
      </div>
      <div className={`mono text-xl font-bold ${c}`}>{value ?? 0}</div>
    </div>
  );
}
