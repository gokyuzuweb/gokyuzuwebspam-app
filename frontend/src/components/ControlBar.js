import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Server, Cpu, Activity, Users, ShieldAlert, Zap } from "lucide-react";

const LICKEY = () => (typeof window !== "undefined"
  ? (localStorage.getItem("gws.event_license") || "MS-C02AB012652A4FE692D69676")
  : "MS-C02AB012652A4FE692D69676");

/** Renkli, hover mikro animasyonlu üst kontrol barı. */
export default function ControlBar({ onQueueClick }) {
  const overview = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 15000 });
  const qstats   = useQuery({ queryKey: ["queue-stats-bar"], queryFn: () => api.queueStats(LICKEY()), refetchInterval: 10000 });
  const resel    = useQuery({ queryKey: ["adm-resellers-bar"], queryFn: () => api.adminResellers().catch(() => ({items: []})), refetchInterval: 60000 });
  const map      = useQuery({ queryKey: ["attack-map-bar"], queryFn: () => api.attackMap(LICKEY(), 1), refetchInterval: 15000 });

  const s = overview.data || {};
  const spam1h = s.spam_last_hour ?? Math.round((s.caught_today || 0) / 24);
  const queueTotal = qstats.data?.total ?? 0;
  const wpm = Math.round((s.caught_today || 0) / 1440) || 0;
  const resellersTotal = (resel.data?.items || resel.data?.resellers || []).length;
  const countries = (map.data?.items || []).length;

  const cards = [
    { key: "queue", label: "Kuyrukta Bekleyen", val: queueTotal, sub: "tıkla → yönet", grad: "from-sky-500/20 via-sky-500/5 to-transparent", ring: "ring-sky-500/40", txt: "text-sky-300", Icon: Server, onClick: onQueueClick, testid: "control-queue" },
    { key: "spam1h", label: "Son 1 Saat Spam", val: spam1h, sub: "canlı", grad: "from-amber-500/20 via-amber-500/5 to-transparent", ring: "ring-amber-500/40", txt: "text-amber-300", Icon: ShieldAlert },
    { key: "wpm", label: "Yakalama / dk", val: `${wpm}/dk`, sub: "günlük ort.", grad: "from-emerald-500/20 via-emerald-500/5 to-transparent", ring: "ring-emerald-500/40", txt: "text-emerald-300", Icon: Cpu },
    { key: "engines", label: "Aktif Motorlar", val: `${s.engines_active ?? 0}/${s.engines_total ?? 0}`, sub: "SA · Bayes · ClamAV …", grad: "from-indigo-500/20 via-indigo-500/5 to-transparent", ring: "ring-indigo-500/40", txt: "text-indigo-300", Icon: Zap },
    { key: "resellers", label: "Bayi Sayısı", val: resellersTotal || "-", sub: "aktif portallar", grad: "from-fuchsia-500/20 via-fuchsia-500/5 to-transparent", ring: "ring-fuchsia-500/40", txt: "text-fuchsia-300", Icon: Users },
    { key: "geo", label: "Kaynak Ülke (1s)", val: countries, sub: "canlı saldırı haritası", grad: "from-rose-500/20 via-rose-500/5 to-transparent", ring: "ring-rose-500/40", txt: "text-rose-300", Icon: Activity },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3" data-testid="control-bar">
      {cards.map((c) => (
        <button
          key={c.key}
          onClick={c.onClick}
          data-testid={c.testid || `control-${c.key}`}
          className={`group text-left relative overflow-hidden bg-slate-900 border border-slate-800 rounded-lg p-4
                      transition-all duration-200 hover:-translate-y-0.5 hover:ring-1 ${c.ring} hover:border-slate-700`}
        >
          <div className={`absolute inset-0 bg-gradient-to-br ${c.grad} opacity-70 group-hover:opacity-100 transition-opacity`}/>
          <div className="relative">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{c.label}</div>
              <c.Icon className={`w-4 h-4 ${c.txt} opacity-70 group-hover:opacity-100 group-hover:scale-110 transition-transform`}/>
            </div>
            <div className={`mono mt-2 text-2xl font-semibold ${c.txt}`}>{c.val}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{c.sub}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
