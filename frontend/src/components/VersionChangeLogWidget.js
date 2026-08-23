/**
 * VersionChangeLogWidget — v44.00.11
 *
 * Master paneline "Son 24 saatte güncellenen bayılar" göstergesi. Bayı
 * heartbeat'i last_heartbeat_version alanını değiştirdiğinde arka planda
 * db.version_changes koleksiyonuna kayıt düşer; bu widget onu görselleştirir.
 *
 * Faydası:
 *   • Master hangi müşterilerin gerçekten `gwsm-update` çalıştırdığını görür
 *   • Manuel takip yok — masaüstünde canlı sayaç
 *   • Latest sürüme geçen müşteriler yeşil rozet, eski sürüm alan sarı
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitCommit, TrendingUp, Clock, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const fmtAgo = (mins) => {
  if (mins == null) return "—";
  if (mins < 1) return "az önce";
  if (mins < 60) return `${mins}dk önce`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}sa önce`;
  return `${Math.floor(h / 24)}g önce`;
};

export default function VersionChangeLogWidget() {
  const [hours, setHours] = useState(24);
  const q = useQuery({
    queryKey: ["admin-version-changes", hours],
    queryFn: () => api.adminVersionChanges(hours),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const data = q.data || { changes: [], total_changes: 0, updated_to_latest: 0, latest_version: "" };
  const rows = data.changes || [];
  const latest = String(data.latest_version || "").replace(/^v/i, "");

  return (
    <Card data-testid="version-change-log-widget">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
            <GitCommit className="w-4 h-4 text-indigo-300" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">Son Güncellenen Bayılar</div>
            <div className="text-[11px] text-slate-500">Kim gerçekten <code className="mono text-indigo-300">gwsm-update</code> çalıştırdı?</div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          {[6, 24, 72, 168].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              data-testid={`vc-range-${h}`}
              className={`px-2 py-1 rounded font-mono border transition ${
                hours === h
                  ? "border-indigo-500/50 bg-indigo-500/20 text-indigo-200"
                  : "border-slate-700 bg-slate-800/50 text-slate-500 hover:text-slate-300"
              }`}
            >
              {h < 24 ? `${h}sa` : `${h / 24}g`}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2.5">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-0.5">Değişim</div>
            <div className="text-xl font-bold text-slate-100 mono" data-testid="vc-total">{data.total_changes}</div>
          </div>
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-widest text-emerald-400 mb-0.5 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Güncel
            </div>
            <div className="text-xl font-bold text-emerald-300 mono" data-testid="vc-latest">{data.updated_to_latest}</div>
          </div>
          <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-widest text-indigo-400 mb-0.5 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Latest
            </div>
            <div className="text-sm font-bold text-indigo-300 mono truncate" data-testid="vc-latest-ver">
              v{latest || "—"}
            </div>
          </div>
        </div>

        {q.isLoading ? (
          <div className="text-center text-xs text-slate-500 py-6">Yükleniyor…</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-6 rounded-lg border border-dashed border-slate-800">
            <Clock className="w-4 h-4 inline mr-1 opacity-40" />
            Bu zaman aralığında sürüm değişikliği yok
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
            {rows.map((r) => {
              const cur = String(r.new_version || "").replace(/^v/i, "");
              const prev = r.previous_version ? String(r.previous_version).replace(/^v/i, "") : null;
              return (
                <div
                  key={`${r.license_key}-${r.changed_at}`}
                  data-testid={`vc-row-${r.license_key}`}
                  className={`rounded-md border p-2.5 flex items-center gap-3 text-xs ${
                    r.is_latest
                      ? "border-emerald-500/25 bg-emerald-500/5"
                      : "border-amber-500/25 bg-amber-500/5"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-200 font-medium truncate">
                      {r.customer_name || r.license_key.slice(0, 20) + "…"}
                    </div>
                    <div className="text-[10px] mono text-slate-500 truncate">{r.license_key}</div>
                  </div>
                  <div className="flex items-center gap-1.5 mono text-[11px]">
                    {prev ? (
                      <>
                        <span className="text-slate-500">v{prev}</span>
                        <ArrowUpRight className={`w-3 h-3 ${r.is_latest ? "text-emerald-400" : "text-amber-400"}`} />
                      </>
                    ) : (
                      <span className="text-slate-600 text-[10px]">yeni</span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded font-bold border ${
                      r.is_latest
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                        : "border-amber-500/40 bg-amber-500/15 text-amber-200"
                    }`}>
                      v{cur}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mono shrink-0 w-16 text-right">
                    {fmtAgo(r.minutes_ago)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
