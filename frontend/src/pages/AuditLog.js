/**
 * v43.69 — Master Audit Log Page
 * Her master işlemi (havale onay/red, DB temizlik, sürüm yayınlama vb.)
 * audit_logs koleksiyonuna kaydedilir. Bu sayfa listeleme sağlar.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Filter, Clock, Server } from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const ACTION_LABELS = {
  havale_approve: { label: "Havale Onay", tone: "success" },
  havale_reject:  { label: "Havale Red",  tone: "danger" },
  db_cleanup:     { label: "DB Temizlik", tone: "warning" },
  version_publish:{ label: "Sürüm Yayın", tone: "info" },
  license_issue:  { label: "Lisans Üret", tone: "brand" },
};

const fmtTs = (iso) => {
  try {
    const d = new Date(iso);
    return d.toLocaleString("tr-TR", { hour12: false });
  } catch { return iso; }
};

export default function AuditLog() {
  const [hours, setHours] = useState(168);       // 7 gün default
  const [filterAction, setFilterAction] = useState("");
  const q = useQuery({
    queryKey: ["audit-logs", hours, filterAction],
    queryFn: () => api.auditLogs(hours, filterAction || undefined, 500),
    refetchInterval: 15000,
    staleTime: 0,
  });
  const items = q.data?.items || [];
  const summary = q.data?.summary_by_action || {};
  return (
    <div className="p-6 space-y-4">
      <Card data-testid="audit-log-card">
        <CardHeader
          title={<span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400"/> Master Audit Log</span>}
          subtitle={`Son ${hours} saatte ${items.length} master işlemi kayıtlı`}
          right={
            <div className="flex items-center gap-2">
              <select
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                data-testid="audit-hours"
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs mono text-slate-300">
                <option value="24">Son 24 saat</option>
                <option value="168">Son 7 gün</option>
                <option value="720">Son 30 gün</option>
                <option value="8760">Son 365 gün</option>
              </select>
              <select
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
                data-testid="audit-action-filter"
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs mono text-slate-300">
                <option value="">Tüm işlemler</option>
                {Object.keys(ACTION_LABELS).map((a) => (
                  <option key={a} value={a}>{ACTION_LABELS[a].label}</option>
                ))}
              </select>
            </div>
          }
        />
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
            {Object.entries(summary).map(([a, n]) => {
              const meta = ACTION_LABELS[a] || { label: a, tone: "default" };
              return (
                <div key={a} className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">{meta.label}</div>
                  <div className="text-xl font-bold text-slate-100 mono">{n}</div>
                </div>
              );
            })}
            {Object.keys(summary).length === 0 && !q.isLoading && (
              <div className="col-span-5 text-center text-slate-500 py-6 text-sm">Henüz audit log kaydı yok</div>
            )}
          </div>

          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-950 z-10">
                <tr className="text-[11px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                  <th className="text-left px-3 py-2 font-semibold">Zaman</th>
                  <th className="text-left px-3 py-2 font-semibold">İşlem</th>
                  <th className="text-left px-3 py-2 font-semibold">Hedef</th>
                  <th className="text-left px-3 py-2 font-semibold">IP</th>
                  <th className="text-left px-3 py-2 font-semibold">Özet</th>
                </tr>
              </thead>
              <tbody data-testid="audit-tbody">
                {items.map((r) => {
                  const meta = ACTION_LABELS[r.action] || { label: r.action, tone: "default" };
                  return (
                    <tr key={r.id} data-testid={`audit-row-${r.id}`} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                      <td className="px-3 py-2 mono text-xs text-slate-400 whitespace-nowrap">
                        <Clock className="w-3 h-3 inline mr-1 text-slate-600"/>{fmtTs(r.ts)}
                      </td>
                      <td className="px-3 py-2"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                      <td className="px-3 py-2 mono text-xs text-slate-300 break-all">{r.target || "—"}</td>
                      <td className="px-3 py-2 mono text-xs text-slate-400">
                        <Server className="w-3 h-3 inline mr-1 text-slate-600"/>{r.client_ip || "?"}
                      </td>
                      <td className="px-3 py-2 mono text-[10px] text-slate-500 break-all max-w-[400px]">
                        {r.summary && Object.keys(r.summary).length > 0
                          ? Object.entries(r.summary).map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 60)}`).join(" · ")
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && !q.isLoading && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500 text-sm">
                    Bu zaman aralığında master işlemi kayıtlı değil
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
