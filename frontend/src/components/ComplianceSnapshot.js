import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { FileDown, Shield, ShieldOff, Bug } from "lucide-react";
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
