import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Clock, RefreshCw, Search } from "lucide-react";
import ThreatAlertBell from "@/components/ThreatAlertBell";
import { ImpersonatePicker } from "@/components/Impersonate";

/**
 * v43.21 Header — modern glass with global Spotlight-style search input
 * that opens the CommandPalette (dispatches `gws:open-palette`).
 */
function GlobalSearch() {
  const openPalette = (query = "") => {
    window.dispatchEvent(new CustomEvent("gws:open-palette", { detail: { query } }));
  };
  return (
    <div className="hidden md:flex flex-1 max-w-md">
      <button
        type="button"
        data-testid="global-search-btn"
        onClick={() => openPalette("")}
        onKeyDown={(e) => {
          // Kullanıcı doğrudan yazmaya başlarsa palette'i o karakterle aç
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            openPalette(e.key);
          }
        }}
        className="group relative flex-1 flex items-center gap-2.5 px-3.5 py-2 rounded-lg bg-slate-950/60 hover:bg-slate-900/80 border border-slate-800/80 hover:border-indigo-500/40 transition-all text-left focus:outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/10"
      >
        <Search className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 shrink-0 transition-colors" strokeWidth={2} />
        <span className="flex-1 text-sm text-slate-500 group-hover:text-slate-300 transition-colors truncate">
          Ara: sayfa, karantina, ayar, kural…
        </span>
        <span className="hidden lg:flex items-center gap-0.5 shrink-0">
          <kbd className="mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 group-hover:text-indigo-300 group-hover:border-indigo-500/40 transition-colors">⌘</kbd>
          <kbd className="mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 group-hover:text-indigo-300 group-hover:border-indigo-500/40 transition-colors">K</kbd>
        </span>
      </button>
    </div>
  );
}

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
    <header data-testid="app-header" className="sticky top-0 z-30 h-14 border-b border-slate-800 bg-gradient-to-b from-slate-900/95 to-slate-950/90 backdrop-blur px-4 md:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 shrink-0 min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-slate-100 truncate">{title}</h1>
        <span className="hidden sm:inline text-[10px] mono tracking-widest text-slate-500 uppercase border border-slate-800 rounded px-1.5 py-0.5 shrink-0">
          WHM PLUGIN
        </span>
      </div>
      <GlobalSearch />
      <div className="flex items-center gap-4 shrink-0">
        <div className="hidden xl:flex items-center gap-2 text-xs text-slate-400 mono">
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
        <ImpersonatePicker />
        <ThreatAlertBell />
        <div data-testid="engine-status" className="flex items-center gap-2 text-xs">
          <span className="relative inline-flex w-2 h-2">
            <span className={`absolute inset-0 rounded-full ${dot.split(" ")[0]}`}></span>
            <span className={`pulse-dot ${dot.split(" ")[1]}`}></span>
          </span>
          <span className="hidden sm:inline mono uppercase tracking-widest text-slate-400">Motor {status}</span>
          <span className="mono text-slate-500">{active}/{total}</span>
        </div>
      </div>
    </header>
  );
}
