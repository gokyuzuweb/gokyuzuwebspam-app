import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { Activity, AlertTriangle, CheckCircle2, XCircle, RefreshCcw, Zap } from "lucide-react";
import { toast } from "sonner";

/**
 * PluginHealth — Master-only sayfa. Tüm bayilerin plugin normalize sağlığını
 * ve son plugin_normalization alert'lerini gösterir.
 */
export default function PluginHealth() {
  const [hours, setHours] = useState(24);
  const [threshold, setThreshold] = useState(100);
  const qc = useQueryClient();

  const health = useQuery({
    queryKey: ["plugin-health-list", hours],
    queryFn: () => api.pluginHealthList({ hours }),
    refetchInterval: 30000,
  });

  const scan = useMutation({
    mutationFn: () => api.pluginHealthScan({ threshold, hours, force: true }),
    onSuccess: (data) => {
      toast.success(`Tarama tamamlandı — ${data.created} yeni uyarı oluşturuldu`);
      qc.invalidateQueries({ queryKey: ["plugin-health-list"] });
      qc.invalidateQueries({ queryKey: ["threat-alerts"] });
    },
    onError: (e) => toast.error("Tarama hatası: " + (e?.response?.data?.detail || e.message)),
  });

  const items = health.data?.items || [];

  return (
    <div className="p-6 space-y-4" data-testid="plugin-health-page">
      {/* Header stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard tone="text-slate-100" label="Toplam Bayi" value={health.data?.total_bayi ?? "—"} icon={Activity} testid="ph-total"/>
        <StatCard tone="text-rose-300" label="Kritik" value={health.data?.critical ?? 0} icon={XCircle} testid="ph-critical"/>
        <StatCard tone="text-amber-300" label="Uyarı" value={health.data?.warning ?? 0} icon={AlertTriangle} testid="ph-warning"/>
        <StatCard tone="text-emerald-300" label="Sağlıklı" value={health.data?.healthy ?? 0} icon={CheckCircle2} testid="ph-healthy"/>
      </div>

      {/* Controls */}
      <Card>
        <CardBody className="p-3 flex flex-wrap items-center gap-3">
          <label className="text-xs text-slate-400 uppercase tracking-widest">Zaman penceresi:</label>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}
                  data-testid="ph-hours-select"
                  className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm text-slate-200">
            <option value={1}>Son 1 saat</option>
            <option value={6}>Son 6 saat</option>
            <option value={24}>Son 24 saat</option>
            <option value={168}>Son 7 gün</option>
            <option value={720}>Son 30 gün</option>
          </select>
          <span className="w-px h-6 bg-slate-800 mx-1"/>
          <label className="text-xs text-slate-400 uppercase tracking-widest">Uyarı eşiği:</label>
          <input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value) || 100)}
                 data-testid="ph-threshold-input"
                 className="w-24 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm mono text-slate-200"/>
          <button onClick={() => scan.mutate()} disabled={scan.isPending}
                  data-testid="ph-scan-btn"
                  className="ml-auto inline-flex items-center gap-2 px-3 py-1.5 rounded border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 text-sm disabled:opacity-50">
            <Zap className="w-3.5 h-3.5"/>
            {scan.isPending ? "Taranıyor…" : "Şimdi Tara + Uyarı Oluştur"}
          </button>
          <button onClick={() => health.refetch()} className="p-1.5 rounded hover:bg-slate-800 text-slate-400" title="Yenile">
            <RefreshCcw className="w-4 h-4"/>
          </button>
        </CardBody>
      </Card>

      {/* Table */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/60 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="text-left px-3 py-2">Durum</th>
                  <th className="text-left px-3 py-2">Bayi</th>
                  <th className="text-right px-3 py-2">Toplam Mail</th>
                  <th className="text-right px-3 py-2">Normalize</th>
                  <th className="text-right px-3 py-2">Clamp</th>
                  <th className="text-right px-3 py-2">Oran</th>
                  <th className="text-left px-3 py-2">Son Uyarı</th>
                </tr>
              </thead>
              <tbody data-testid="ph-table-body">
                {items.map(row => (
                  <tr key={row.license_key} data-testid={`ph-row-${row.license_key}`}
                      className="border-b border-slate-800/50 hover:bg-slate-800/30">
                    <td className="px-3 py-2"><StatusBadge status={row.status}/></td>
                    <td className="px-3 py-2">
                      <div className="text-slate-100">{row.company || "(isimsiz)"}</div>
                      <div className="text-[11px] text-slate-500 mono">{row.email || row.license_key.slice(0, 20)}…</div>
                    </td>
                    <td className="px-3 py-2 text-right mono text-slate-200">{row.total}</td>
                    <td className={`px-3 py-2 text-right mono ${row.normalized > 100 ? "text-rose-300 font-semibold" : row.normalized > 0 ? "text-amber-300" : "text-slate-500"}`}>
                      {row.normalized}
                    </td>
                    <td className="px-3 py-2 text-right mono text-slate-400">{row.clamped}</td>
                    <td className={`px-3 py-2 text-right mono ${row.ratio > 20 ? "text-rose-300" : row.ratio > 5 ? "text-amber-300" : "text-slate-500"}`}>
                      %{row.ratio}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      {row.last_alert_at ? (
                        <span className={row.last_alert_seen ? "text-slate-500" : "text-rose-300 font-medium"}>
                          {new Date(row.last_alert_at).toLocaleString("tr-TR")}
                          <span className="ml-1 text-slate-500">({row.last_alert_count})</span>
                          {!row.last_alert_seen && <span className="ml-1 px-1 rounded bg-rose-500/20">yeni</span>}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && !health.isLoading && (
                  <tr><td colSpan={7} className="px-3 py-12 text-center text-sm text-slate-500">
                    Bayi bulunamadı — henüz kimse plugin yüklememiş
                  </td></tr>
                )}
                {health.isLoading && (
                  <tr><td colSpan={7} className="px-3 py-12 text-center text-sm text-slate-500">Yükleniyor…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="text-[11px] text-slate-500 leading-relaxed">
        <b>Nasıl okunur?</b> Plugin yanlış <span className="mono text-slate-300">total_score</span> yolluyorsa panel bunu SpamAssassin skoruyla otomatik düzeltir (<b>normalize</b>). 24 saatte 100+ normalize eden bayinin <span className="mono text-slate-300">mailshield-logtail.pl</span> plugin'i güncellenmeli — <span className="mono text-slate-300">install-bayi.sh</span> ile yeniden kur.
      </div>
    </div>
  );
}

function StatCard({ tone, label, value, icon: Icon, testid }) {
  return (
    <div data-testid={testid} className="rounded-md border border-slate-800 bg-slate-900/40 px-4 py-3 flex items-center gap-3">
      <Icon className={`w-5 h-5 ${tone}`}/>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
        <div className={`mono text-xl font-semibold ${tone}`}>{value}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    critical: { cls: "bg-rose-500/15 text-rose-300 border-rose-500/40", label: "Kritik", Icon: XCircle },
    warning: { cls: "bg-amber-500/15 text-amber-300 border-amber-500/40", label: "Uyarı", Icon: AlertTriangle },
    healthy: { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", label: "Sağlıklı", Icon: CheckCircle2 },
  };
  const s = map[status] || map.healthy;
  const I = s.Icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border ${s.cls}`}>
      <I className="w-3 h-3"/>{s.label}
    </span>
  );
}
