import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { X, Globe2, Mail, Activity } from "lucide-react";

const LICKEY = () => (typeof window !== "undefined"
  ? (localStorage.getItem("gws.event_license") || "MS-C02AB012652A4FE692D69676")
  : "MS-C02AB012652A4FE692D69676");

export default function IpDrilldownDrawer({ ip, onClose }) {
  const q = useQuery({
    queryKey: ["ip-drilldown", ip],
    queryFn: () => api.ipDrilldown(LICKEY(), ip),
    enabled: !!ip,
  });
  if (!ip) return null;
  const d = q.data || {};
  const rows = d.sample || [];

  return (
    <div data-testid="ip-drilldown-drawer" className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl h-full bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-500 mb-1">IP Drilldown</div>
            <h2 className="text-slate-100 font-semibold mono flex items-center gap-2">{ip}
              <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                <Globe2 className="w-3 h-3"/> {d.country || "?"}
              </span>
            </h2>
          </div>
          <button data-testid="ip-drilldown-close" onClick={onClose} className="p-2 rounded hover:bg-slate-800 text-slate-400"><X className="w-4 h-4"/></button>
        </div>

        <div className="grid grid-cols-3 gap-3 p-5 border-b border-slate-800 bg-slate-950/50">
          <StatMini label="Toplam Trafik" value={d.total ?? "-"} icon={Activity} tone="text-indigo-300"/>
          <StatMini label="Spam" value={d.spam_total ?? "-"} icon={Mail} tone="text-rose-300"/>
          <StatMini label="Ülke" value={d.country || "?"} icon={Globe2} tone="text-amber-300"/>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-2">
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Son 50 mail — kimden / kime</div>
          {rows.map((r) => (
            <div key={r.id} data-testid={`ip-drilldown-row-${r.id}`} className="border border-slate-800 rounded-md p-3 hover:bg-slate-800/30">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="text-sm text-slate-100 truncate flex-1">{r.subject || "(konu yok)"}</div>
                <span className={`text-[10px] mono px-2 py-0.5 rounded border
                  ${r.verdict === "high_spam" ? "bg-rose-500/10 text-rose-300 border-rose-500/40" :
                    r.verdict === "virus" ? "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/40" :
                    r.verdict === "spam" ? "bg-amber-500/10 text-amber-300 border-amber-500/40" :
                    "bg-emerald-500/10 text-emerald-300 border-emerald-500/40"}`}>
                  {r.verdict}
                </span>
              </div>
              <div className="text-[11px] mono text-slate-400 flex flex-wrap gap-x-3">
                <span><span className="text-slate-600">FROM:</span> {r.from_addr}</span>
                <span><span className="text-slate-600">TO:</span> {r.to_addr}</span>
                <span className="text-slate-500">score {Number(r.score || 0).toFixed(1)}</span>
                <span className="text-slate-600">{(r.ingested_at || "").slice(11, 19)}</span>
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="text-center text-slate-500 text-sm py-12">Bu IP için son trafik bulunamadı</div>}
        </div>
      </div>
    </div>
  );
}

function StatMini({ label, value, icon: Icon, tone }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-md p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500">
        <Icon className="w-3 h-3"/>{label}
      </div>
      <div className={`mono text-xl mt-1 ${tone}`}>{value}</div>
    </div>
  );
}
