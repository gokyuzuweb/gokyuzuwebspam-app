import { useQuery } from "@tanstack/react-query";
import { Globe, TrendingUp, Shield } from "lucide-react";
import { Card } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

const SOURCE_COLORS = {
  urlhaus:      { bar: "bg-cyan-500", text: "text-cyan-300", label: "URLhaus" },
  spamhaus_zen: { bar: "bg-rose-500", text: "text-rose-300", label: "Spamhaus" },
  barracuda_bl: { bar: "bg-amber-500", text: "text-amber-300", label: "Barracuda" },
  barracuda:    { bar: "bg-amber-500", text: "text-amber-300", label: "Barracuda" },
  sorbs:        { bar: "bg-fuchsia-500", text: "text-fuchsia-300", label: "SORBS" },
  uceprotect_l1:{ bar: "bg-emerald-500", text: "text-emerald-300", label: "UCEPROTECT" },
  uceprotect:   { bar: "bg-emerald-500", text: "text-emerald-300", label: "UCEPROTECT" },
  phishtank:    { bar: "bg-indigo-500", text: "text-indigo-300", label: "OpenPhish" },
  openphish:    { bar: "bg-indigo-500", text: "text-indigo-300", label: "OpenPhish" },
};

/**
 * v43.7 Threat Intel Today Widget
 * Ana panele "Bugün eklenen IOC" card'ı. Kaynak + tip kırılımı.
 */
export default function ThreatIntelTodayWidget() {
  const q = useQuery({
    queryKey: ["ti-today"],
    queryFn: () => api.tiTodayStats(),
    refetchInterval: 60000,
  });
  const d = q.data || { added_today: 0, total_all_time: 0, by_source: [], by_type: {} };
  const total_today = d.added_today || 0;
  const max_source = Math.max(1, ...(d.by_source || []).map((s) => s.count));

  return (
    <Card data-testid="ti-today-widget">
      <div className="p-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center">
              <Globe className="w-4 h-4 text-indigo-300" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Global Tehdit Zekası</h3>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mono">Bugün eklenen IOC</p>
            </div>
          </div>
          <div className="text-right">
            <div data-testid="ti-widget-today" className="text-2xl font-bold text-indigo-300 mono">
              +{nfmt(total_today)}
            </div>
            <div className="text-[10px] text-slate-500 mono">
              toplam: {nfmt(d.total_all_time)}
            </div>
          </div>
        </div>

        {/* Kaynak kırılımı bar chart */}
        {d.by_source && d.by_source.length > 0 ? (
          <div className="space-y-1.5" data-testid="ti-widget-sources">
            {d.by_source.slice(0, 6).map((s) => {
              const meta = SOURCE_COLORS[s.source] || { bar: "bg-slate-500", text: "text-slate-300", label: s.source };
              const pct = Math.round((s.count / max_source) * 100);
              return (
                <div key={s.source} className="flex items-center gap-2 text-xs">
                  <span className={`${meta.text} mono w-24 truncate`}>{meta.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-800/60 overflow-hidden">
                    <div className={`${meta.bar} h-full rounded-full transition-all duration-500`}
                         style={{ width: `${pct}%` }}/>
                  </div>
                  <span className="mono text-slate-300 w-12 text-right">+{s.count}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-4 text-slate-500 text-xs italic">
            Bugün henüz IOC eklenmedi — auto-sync aktif değilse manuel senkronize edin
          </div>
        )}

        {/* Tip kırılımı chip */}
        {d.by_type && Object.keys(d.by_type).length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-800/60 flex flex-wrap gap-1.5" data-testid="ti-widget-types">
            {Object.entries(d.by_type).map(([type, count]) => (
              <span key={type} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/60 border border-slate-700 text-[10px] mono">
                <Shield className="w-2.5 h-2.5 text-slate-400"/>
                <span className="text-slate-300 uppercase">{type}</span>
                <span className="text-indigo-300">+{count}</span>
              </span>
            ))}
          </div>
        )}

        <a href="/panel/threat-intel"
           className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-indigo-400 hover:text-indigo-300 group"
           data-testid="ti-widget-link">
          <span>Global Tehdit Zekası'na git</span>
          <TrendingUp className="w-3 h-3 group-hover:translate-x-0.5 transition-transform"/>
        </a>
      </div>
    </Card>
  );
}
