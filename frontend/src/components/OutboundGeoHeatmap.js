import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe2, TrendingUp, ShieldAlert, MapPin, Zap } from "lucide-react";
import { Card, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

// Country → risk hue (spam ratio)
const spamRatio = (item) => {
  if (!item.mail_count) return 0;
  return (item.spam_count / item.mail_count) * 100;
};
const heatColor = (pct, risky) => {
  if (risky) return "bg-rose-500/25 border-rose-500/50 text-rose-200";
  if (pct >= 30) return "bg-rose-500/15 border-rose-500/30 text-rose-200";
  if (pct >= 15) return "bg-amber-500/15 border-amber-500/30 text-amber-200";
  if (pct >= 5) return "bg-yellow-500/10 border-yellow-500/30 text-yellow-200";
  return "bg-emerald-500/10 border-emerald-500/25 text-emerald-200";
};

export default function OutboundGeoHeatmap() {
  const [hours, setHours] = useState(24);
  const q = useQuery({
    queryKey: ["outbound-geo-stats", hours],
    queryFn: () => api.outboundGeoStats(hours),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const data = q.data;

  if (q.isLoading) {
    return (
      <Card data-testid="ob-geo-heatmap">
        <div className="p-6 text-center text-slate-500 text-sm">Coğrafi ısı haritası yükleniyor…</div>
      </Card>
    );
  }
  const empty = !data || data.total_mail === 0;
  return (
    <Card data-testid="ob-geo-heatmap">
      <CardHeader
        title={<span className="flex items-center gap-2"><Globe2 className="w-4 h-4 text-indigo-400"/> Giden Trafik Coğrafi Isı Haritası</span>}
        subtitle={
          empty ? "Son 24 saatte outbound veri yok" :
          <span data-testid="ob-geo-subtitle">
            {nfmt(data.total_mail)} mail · {nfmt(data.total_domains)} alıcı domain · {data.countries.length} ülke
            {data.risky_tlds.length > 0 && (
              <span className="ml-2 text-rose-400">· {data.risky_tlds.length} yüksek riskli TLD</span>
            )}
          </span>
        }
        right={
          <div className="flex items-center gap-1">
            {[6, 24, 168].map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                data-testid={`ob-geo-range-${h}`}
                className={`text-[11px] px-2 py-1 rounded border ${
                  hours === h
                    ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
                    : "border-slate-800 text-slate-500 hover:text-slate-300"
                }`}
              >
                {h === 6 ? "6s" : h === 24 ? "24s" : "7g"}
              </button>
            ))}
          </div>
        }
      />
      {empty ? (
        <div className="p-8 text-center text-slate-500 text-xs">
          Henüz outbound mail yok — yukarıdaki <b>🧪 Demo Outbound Ekle</b> veya <b>⚡ Backfill</b> butonunu deneyin.
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Countries roll-up */}
          <div>
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1">
              <MapPin className="w-3 h-3"/> Ülke Bazlı Dağılım
            </div>
            <div className="space-y-1.5">
              {data.countries.slice(0, 10).map((c) => {
                const pct = spamRatio(c);
                const totalPct = data.total_mail ? (c.mail_count / data.total_mail) * 100 : 0;
                return (
                  <div
                    key={c.country}
                    data-testid={`ob-geo-country-${c.country}`}
                    className={`px-3 py-2 rounded border ${heatColor(pct, c.risky)} flex items-center gap-2`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-1.5 truncate">
                        {c.risky && <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0"/>}
                        <span className="truncate">{c.country}</span>
                      </div>
                      <div className="mt-0.5 h-1.5 bg-slate-900/60 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${c.risky ? "bg-rose-400" : pct >= 15 ? "bg-amber-400" : "bg-emerald-400"}`}
                          style={{ width: `${Math.max(totalPct, 3)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="mono text-xs">{nfmt(c.mail_count)}</div>
                      {c.spam_count > 0 && (
                        <div className="text-[9px] text-slate-400 mono">%{pct.toFixed(0)} spam</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top domains */}
          <div>
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1">
              <TrendingUp className="w-3 h-3"/> En Çok Mail Giden 10 Domain
            </div>
            <div className="border border-slate-800 rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-500 bg-slate-900/40">
                    <th className="text-left px-2 py-1.5">Domain</th>
                    <th className="text-left px-2 py-1.5">Ülke</th>
                    <th className="text-right px-2 py-1.5">Mail</th>
                    <th className="text-right px-2 py-1.5">Spam</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_domains.slice(0, 10).map((d) => {
                    const pct = spamRatio(d);
                    return (
                      <tr
                        key={d.domain}
                        data-testid={`ob-geo-domain-${d.domain}`}
                        className="border-t border-slate-800/60 hover:bg-slate-900/40 group"
                        title={d.sample_recipients.join(", ")}
                      >
                        <td className="px-2 py-1.5 mono text-slate-300 truncate max-w-[180px]">
                          {d.risk && <ShieldAlert className="w-2.5 h-2.5 inline mr-1 text-rose-400"/>}
                          {d.domain}
                        </td>
                        <td className="px-2 py-1.5 text-slate-400 truncate max-w-[140px]">
                          {d.country}
                        </td>
                        <td className="px-2 py-1.5 text-right mono text-slate-200">{nfmt(d.mail_count)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {d.spam_count > 0 ? (
                            <Badge tone={pct >= 30 ? "danger" : pct >= 15 ? "warning" : "info"}>
                              {d.spam_count} · %{pct.toFixed(0)}
                            </Badge>
                          ) : (
                            <span className="text-emerald-500 text-[10px]">temiz</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Risky TLD alerts */}
          {data.risky_tlds.length > 0 && (
            <div className="lg:col-span-2">
              <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 flex items-start gap-2">
                <Zap className="w-4 h-4 text-rose-400 shrink-0 mt-0.5"/>
                <div className="text-xs text-rose-200">
                  <div className="font-semibold text-rose-300 mb-0.5">⚠ Yüksek riskli TLD tespit edildi</div>
                  <div className="text-slate-300">
                    Sunucunuzdan şu TLD'lere posta gönderildi:{" "}
                    {data.risky_tlds.map((t) => (
                      <span key={t} className="mono text-rose-300 mr-1">.{t}</span>
                    ))}
                    — Bu domainler genelde spam/kötü amaçlı sitelerdir. Outbound listesinde manuel inceleyin.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
