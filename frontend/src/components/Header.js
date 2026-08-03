import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Clock, RefreshCw } from "lucide-react";
import ThreatAlertBell from "@/components/ThreatAlertBell";

export default function Header({ title }) {
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["overview-header"],
    queryFn: api.overview,
    refetchInterval: 15000,
  });
  const active = data?.engines_active ?? 0;
  const total = data?.engines_total ?? 0;
  const status = active > 0 ? "aktif" : "durduruldu";
  const dot = active > 0 ? "bg-emerald-400 text-emerald-400" : "bg-rose-500 text-rose-500";
  return (
    <header data-testid="app-header" className="sticky top-0 z-30 h-14 border-b border-slate-800 bg-gradient-to-b from-slate-900/95 to-slate-950/90 backdrop-blur px-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">{title}</h1>
        <span className="text-[10px] mono tracking-widest text-slate-500 uppercase border border-slate-800 rounded px-1.5 py-0.5">
          WHM PLUGIN
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 mono">
          <Clock className="w-3.5 h-3.5" />
          Son 24 saat
        </div>
        <button
          data-testid="refresh-btn"
          onClick={() => refetch()}
          className="text-slate-400 hover:text-slate-100 transition-colors"
          title="Yenile"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
        <ThreatAlertBell />
        <div data-testid="engine-status" className="flex items-center gap-2 text-xs">
          <span className="relative inline-flex w-2 h-2">
            <span className={`absolute inset-0 rounded-full ${dot.split(" ")[0]}`}></span>
            <span className={`pulse-dot ${dot.split(" ")[1]}`}></span>
          </span>
          <span className="mono uppercase tracking-widest text-slate-400">Motor {status}</span>
          <span className="mono text-slate-500">{active}/{total}</span>
        </div>
      </div>
    </header>
  );
}
