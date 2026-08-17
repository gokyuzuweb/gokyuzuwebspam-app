/**
 * v43.73 — Marketplace Haftalık Lider Banner
 *
 * Dashboard tepesinde görünür — son 7 günde en çok imza paylaşan bayı.
 * Sadece kazanan varsa render eder (yoksa null).
 */
import { useQuery } from "@tanstack/react-query";
import { Trophy, Store, ArrowRight } from "lucide-react";
import { client } from "@/lib/api";

const api = {
  weekly: () => client.get("/marketplace/leaderboard/weekly").then(r => r.data),
};

export default function MarketplaceLeaderboardBanner() {
  const q = useQuery({
    queryKey: ["mp-weekly-leaderboard"],
    queryFn: api.weekly,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: false,
  });
  const w = q.data?.winner;
  if (!w || !w.signatures_published) return null;

  return (
    <a
      href="/panel/marketplace"
      data-testid="mp-weekly-banner"
      className="group relative block rounded-lg border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-transparent px-4 py-3 hover:from-amber-500/15 hover:border-amber-500/50 transition-all"
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0 w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
          <Trophy className="w-5 h-5 text-amber-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-widest font-bold text-amber-300">
              🏆 Haftanın Marketplace Lideri
            </span>
            <span className="text-[10px] mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-500/30">
              Son 7 gün
            </span>
          </div>
          <div className="text-sm text-slate-100 mt-0.5 flex items-center gap-2 flex-wrap">
            <b className="text-amber-200">{w.publisher_label}</b>
            <span className="text-slate-400">·</span>
            <span className="text-slate-300">{w.signatures_published} imza yayınladı</span>
            {w.total_installs > 0 && (
              <>
                <span className="text-slate-400">·</span>
                <span className="text-emerald-300">{w.total_installs.toLocaleString("tr-TR")} kurulum</span>
              </>
            )}
            {w.total_upvotes > 0 && (
              <>
                <span className="text-slate-400">·</span>
                <span className="text-sky-300">▲ {w.total_upvotes} oy</span>
              </>
            )}
          </div>
          {w.sample_names?.length > 0 && (
            <div className="text-[11px] text-slate-500 mt-0.5 truncate">
              Örnek: {w.sample_names.slice(0, 2).join(" · ")}
            </div>
          )}
        </div>
        <div className="hidden md:flex items-center gap-1 text-xs text-amber-300/80 group-hover:text-amber-200">
          <Store className="w-3.5 h-3.5" /> Marketplace <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </a>
  );
}
