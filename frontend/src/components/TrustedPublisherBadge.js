/**
 * v43.74 — Trusted Publisher Badge
 *
 * Bayı Dashboard'unda ve Marketplace kartlarında görünür. Fetch'ler
 * /api/marketplace/publisher/stats ile mevcut tier + ilerleme.
 *
 *   - Trusted (5+ imza) → emerald
 *   - Expert (15+)      → violet
 *   - Elite (30+)       → amber
 */
import { useQuery } from "@tanstack/react-query";
import { Award, Star, Sparkles, ArrowRight } from "lucide-react";
import { client } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const TIER_STYLE = {
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-300", chip: "bg-emerald-500/20 text-emerald-200", Icon: Award },
  violet:  { bg: "bg-violet-500/10",  border: "border-violet-500/40",  text: "text-violet-300",  chip: "bg-violet-500/20 text-violet-200",  Icon: Sparkles },
  amber:   { bg: "bg-amber-500/10",   border: "border-amber-500/40",   text: "text-amber-300",   chip: "bg-amber-500/20 text-amber-200",   Icon: Star },
};

export default function TrustedPublisherBadge({ compact = false }) {
  // Master publisher değildir — bu widget bayilerv için
  const { isMaster } = useIsMaster();
  // Aktif oturumun bayi lisansı ile publisher stats
  const licenseKey = (typeof window !== "undefined"
    && (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license") || "")).trim();
  const q = useQuery({
    queryKey: ["mp-publisher-stats", licenseKey],
    queryFn: () => client.get("/marketplace/publisher/stats", { params: { license_key: licenseKey } }).then(r => r.data),
    enabled: !!licenseKey && licenseKey.startsWith("MS-") && !isMaster,
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (isMaster) return null;
  if (!q.data) return null;
  const s = q.data;

  // Hiç imza yayınlamamış → gizle (compact mode banner spam olmasın)
  if (s.signatures_published === 0 && compact) return null;

  const tier = s.tier;
  const nextTier = s.next_tier;

  if (compact && tier) {
    const style = TIER_STYLE[tier.badge_color] || TIER_STYLE.emerald;
    const { Icon } = style;
    return (
      <span
        data-testid="publisher-badge-compact"
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${style.border} ${style.chip}`}
        title={`${s.signatures_published} aktif imza · ${s.total_installs} kurulum`}
      >
        <Icon className="w-3 h-3"/> {tier.label}
      </span>
    );
  }

  if (compact) return null;

  // Full banner
  if (tier) {
    const style = TIER_STYLE[tier.badge_color] || TIER_STYLE.emerald;
    const { Icon } = style;
    return (
      <a
        href="/panel/marketplace"
        data-testid="publisher-badge-banner"
        className={`group block rounded-lg border ${style.border} ${style.bg} p-4 hover:brightness-125 transition-all`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full ${style.chip} flex items-center justify-center shrink-0`}>
            <Icon className="w-5 h-5"/>
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-[10px] uppercase tracking-widest font-bold ${style.text}`}>🏅 Marketplace Rozetiniz</div>
            <div className="text-lg font-bold text-slate-100 mt-0.5">{tier.label}</div>
            <div className="text-xs text-slate-400 mt-1">
              {s.signatures_published} aktif imza · {s.total_installs.toLocaleString("tr-TR")} kurulum · ▲ {s.total_upvotes} oy
            </div>
            {nextTier && (
              <div className="mt-2">
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span>Sonraki:</span>
                  <b className={style.text}>{nextTier.label}</b>
                  <span>· {nextTier.remaining} imza daha</span>
                </div>
                <div className="mt-1 h-1 rounded bg-slate-800 overflow-hidden">
                  <div
                    className={style.chip.split(" ")[0]}
                    style={{ height: "100%", width: `${Math.min(100, (s.signatures_published / nextTier.min_signatures) * 100)}%`, transition: "width 300ms" }}
                  />
                </div>
              </div>
            )}
          </div>
          <ArrowRight className="w-4 h-4 text-slate-500 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </a>
    );
  }

  // No tier yet — encourage bayi to publish
  if (!nextTier) return null;
  return (
    <a
      href="/panel/marketplace"
      data-testid="publisher-badge-progress"
      className="group block rounded-lg border border-slate-800 bg-slate-900/40 p-4 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-500 group-hover:bg-emerald-500/20 group-hover:text-emerald-300 flex items-center justify-center shrink-0 transition-colors">
          <Award className="w-5 h-5"/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500 group-hover:text-emerald-300">Marketplace Rozetleri</div>
          <div className="text-sm text-slate-300 mt-0.5">
            <b>{nextTier.remaining}</b> imza daha yayınlayın, <b className="text-emerald-300">{nextTier.label}</b> rozetini kazanın!
          </div>
          <div className="mt-1.5 h-1 rounded bg-slate-800 overflow-hidden">
            <div
              className="bg-emerald-500"
              style={{ height: "100%", width: `${Math.min(100, (s.signatures_published / nextTier.min_signatures) * 100)}%`, transition: "width 300ms" }}
            />
          </div>
          <div className="text-[10px] text-slate-500 mt-1 mono">
            {s.signatures_published}/{nextTier.min_signatures} imza
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-slate-500 group-hover:translate-x-0.5 group-hover:text-emerald-300 transition-all" />
      </div>
    </a>
  );
}
