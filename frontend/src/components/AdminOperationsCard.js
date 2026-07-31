import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { PowerOff, Save, Play, Download, TrendingDown, FileDown, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * Auto-suspend rule config + weekly analytics export.
 * Master-only. Shown at bottom of Licenses page.
 */
export default function AdminOperationsCard() {
  const qc = useQueryClient();
  const licenseKey = typeof window !== "undefined"
    ? (localStorage.getItem("gws.event_license") || "") : "";
  const [days, setDays] = useState(30);

  const cfg = useQuery({
    queryKey: ["auto-suspend"],
    queryFn: () => api.adminAutoSuspendGet(licenseKey),
    retry: false,
  });
  const [form, setForm] = useState(null);
  if (cfg.data && !form) setForm(cfg.data);

  const save = useMutation({
    mutationFn: (p) => api.adminAutoSuspendPut(licenseKey, p),
    onSuccess: () => { toast.success("Auto-suspend ayarları kaydedildi");
      qc.invalidateQueries({ queryKey: ["auto-suspend"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });
  const run = useMutation({
    mutationFn: () => api.adminAutoSuspendRun(licenseKey),
    onSuccess: (d) => {
      if (!d.ok) toast.info(`Devre dışı — ${d.reason}`);
      else toast.success(`${d.suspended} bayi askıya alındı`, { duration: 6000 });
      qc.invalidateQueries({ queryKey: ["admin-resellers"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });

  if (!form) return null;

  const downloadUrl = api.adminAnalyticsExport(licenseKey, days);

  return (
    <Card data-testid="admin-ops-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><PowerOff className="w-4 h-4 text-rose-400" /> Otomasyon & Raporlar</span>}
        subtitle="Uykuda bayileri otomatik askıya al + haftalık analytics dışa aktar"
      />
      <CardBody className="space-y-4">
        {/* Auto-suspend rule */}
        <div className="space-y-2 p-3 rounded border border-rose-500/20 bg-rose-500/5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-100">Otomatik Askıya Alma</div>
              <div className="text-[10px] text-slate-500">
                Belirlenen gün sayısından uzun girişsiz bayiler her gece otomatik askıya alınır
              </div>
            </div>
            <button
              onClick={() => { const n = { ...form, enabled: !form.enabled }; setForm(n); save.mutate(n); }}
              className={`relative w-11 h-6 rounded-full transition ${form.enabled ? "bg-rose-500" : "bg-slate-700"}`}
              data-testid="autosuspend-toggle"
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${form.enabled ? "translate-x-5" : ""}`} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-widest text-slate-500">Eşik</label>
            <input
              type="number" min={7} max={365}
              value={form.idle_days_threshold}
              onChange={(e) => setForm({ ...form, idle_days_threshold: parseInt(e.target.value) || 30 })}
              className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm mono text-slate-100 text-right"
              data-testid="autosuspend-threshold"
            />
            <span className="text-xs text-slate-400">gün girişsiz olan bayileri askıya al</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.notify_before}
                   onChange={(e) => setForm({ ...form, notify_before: e.target.checked })}
                   className="rounded" data-testid="autosuspend-notify" />
            <span className="text-slate-400">Askıya almadan önce bayiye e-posta bildir</span>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => save.mutate(form)} disabled={save.isPending}
                    className="text-xs px-3 py-1.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 inline-flex items-center gap-1 disabled:opacity-50"
                    data-testid="autosuspend-save">
              <Save className="w-3 h-3" /> Kaydet
            </button>
            <button onClick={() => run.mutate()} disabled={run.isPending || !form.enabled}
                    className="text-xs px-3 py-1.5 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 inline-flex items-center gap-1 disabled:opacity-50"
                    title="Şimdi çalıştır"
                    data-testid="autosuspend-run">
              {run.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Şimdi Çalıştır
            </button>
            {cfg.data?.last_run_at && (
              <span className="text-[10px] text-slate-500 self-center ml-auto">
                Son: {new Date(cfg.data.last_run_at).toLocaleString("tr-TR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                {" · "}{cfg.data.last_suspended_count} askı
              </span>
            )}
          </div>
        </div>

        {/* Analytics export */}
        <div className="space-y-2 p-3 rounded border border-indigo-500/20 bg-indigo-500/5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-100 flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5 text-indigo-400" /> Bayi Analytics Raporu
              </div>
              <div className="text-[10px] text-slate-500">Tüm bayilerin login + mail + spam verilerini CSV olarak indir</div>
            </div>
            <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}
                    className="text-xs bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200"
                    data-testid="analytics-days">
              <option value={7}>7 gün</option>
              <option value={30}>30 gün</option>
              <option value={90}>90 gün</option>
              <option value={365}>1 yıl</option>
            </select>
          </div>
          <a href={downloadUrl}
             target="_blank"
             rel="noreferrer"
             data-testid="analytics-download"
             className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded bg-gradient-to-br from-indigo-500 to-indigo-600 text-white text-sm font-semibold shadow hover:shadow-indigo-500/40 transition">
            <FileDown className="w-4 h-4" /> CSV İndir ({days} gün)
          </a>
          <div className="text-[10px] text-slate-500 text-center">
            Excel uyumlu · UTF-8 BOM · e-posta, plan, alt hesap sayısı, login/spam/oran
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
