/**
 * v43.53 — Bounce Digest Dashboard Widget
 * Son 24 saatte bounce olmuşsa Dashboard'da uyarı kartı gösterir; kullanıcıyı
 * /panel/bounce-digest sayfasına yönlendirir. 0 bounce olduğunda component
 * null döner (görsel gürültü yaratmaz).
 */
import { useQuery } from "@tanstack/react-query";
import { Mail, ArrowRight, TrendingDown } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";

export default function BounceDigestWidget() {
  const preview = useQuery({
    queryKey: ["bd-dashboard-preview"],
    queryFn: () => api.bounceDigestPreview(24),
    refetchInterval: 60_000,
    staleTime: 45_000,
  });
  const p = preview.data;
  if (!p || p.total_bounces === 0) return null;

  const topUser = (p.top_users && p.top_users[0]) || null;
  const topDomain = (p.top_domains && p.top_domains[0]) || null;

  return (
    <div
      className="rounded-xl border border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-slate-900/60 to-amber-500/5 p-4"
      data-testid="dashboard-bounce-widget"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0">
          <TrendingDown className="w-5 h-5 text-rose-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-slate-100 text-base font-bold">
              {p.total_bounces} bounce
            </span>
            <span className="text-xs text-slate-400">son 24 saat</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {topUser && (
              <span data-testid="dash-bd-top-user">
                En çok: <span className="mono text-rose-300">{topUser[0]}</span> ({topUser[1]})
              </span>
            )}
            {topDomain && (
              <span className="ml-3" data-testid="dash-bd-top-domain">
                Alıcı: <span className="mono text-amber-300">{topDomain[0]}</span> ({topDomain[1]})
              </span>
            )}
          </div>
        </div>
        <Link
          to="/panel/bounce-digest"
          data-testid="dash-bd-link"
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 whitespace-nowrap"
        >
          <Mail className="w-3.5 h-3.5" /> Bounce Digest <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
