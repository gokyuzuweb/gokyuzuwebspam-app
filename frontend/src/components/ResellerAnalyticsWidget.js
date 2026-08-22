/**
 * ResellerAnalyticsWidget — v44.00.04
 *
 * Bayi (ve master) için mini analytics kartı: son 7/30 gün spam bloke,
 * tehlike kategorileri, tahmini ekonomik kazanç, günlük trend sparkline.
 *
 * Amaç: bayi kendi WHM sunucusunda "kaç mail engelledim, ne kadar para
 * korudum" görsün → churn azalır, upgrade motivasyonu artar.
 *
 * Overview sayfasının üst kısmına mount edilir.
 */
import { useQuery } from "@tanstack/react-query";
import { Shield, TrendingUp, Skull, Bug, Zap, DollarSign, Activity } from "lucide-react";
import { Card, CardBody, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);
const usd = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n ?? 0);

export default function ResellerAnalyticsWidget() {
  const q = useQuery({
    queryKey: ["reseller-stats"],
    queryFn: api.resellerStats,
    refetchInterval: 60_000,
    retry: false,
  });
  if (q.isError) return null;
  const d = q.data;
  if (!d) {
    return (
      <Card>
        <CardBody className="text-xs text-slate-500 py-4 text-center">Analytics yükleniyor…</CardBody>
      </Card>
    );
  }
  const trend = d.trend_7d || [];
  const maxTrend = Math.max(1, ...trend.map(t => t.blocked));
  return (
    <Card data-testid="reseller-analytics-widget">
      <CardBody className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-slate-100 font-bold text-sm">Kişisel Koruma Panosu</div>
              <div className="text-[10px] text-slate-500 mono">
                {d.scope === "master" ? "MASTER — Tüm bayi trafiği" : `BAYI · ${d.license_key_short}`}
              </div>
            </div>
          </div>
          <Badge tone={d.engines.active === d.engines.total ? "success" : "warning"}>
            {d.engines.active}/{d.engines.total} motor aktif
          </Badge>
        </div>

        {/* Row: 4 KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <KPI icon={Activity} label="Son 24s Taranan"        value={nfmt(d.counts.scanned_24h)} tone="slate" />
          <KPI icon={Shield}   label="Son 24s Engellenen"     value={nfmt(d.counts.blocked_24h)} tone="rose" />
          <KPI icon={TrendingUp} label="7 Gün Engelleme %"    value={`%${d.block_rate_pct}`}    tone="cyan" />
          <KPI icon={DollarSign} label="30g Tahmini Kazanç"    value={usd(d.estimated_savings_usd_30d)} tone="emerald" />
        </div>

        {/* Row: Trend sparkline + top threats */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400" />
              7 Gün Engelleme Trendi
            </div>
            {trend.length === 0 ? (
              <div className="text-xs text-slate-600 italic text-center py-4">Henüz veri yok</div>
            ) : (
              <div className="flex items-end justify-between gap-1 h-16">
                {trend.map((t, i) => {
                  const h = Math.max(4, (t.blocked / maxTrend) * 60);
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${t.day}: ${t.blocked} bloke`}>
                      <div className="w-full rounded-t bg-gradient-to-t from-rose-500 to-amber-400 transition-all hover:from-rose-400 hover:to-amber-300" style={{ height: `${h}px` }} />
                      <div className="text-[9px] mono text-slate-600">{t.day.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-2 pt-2 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between">
              <span>Toplam 7g bloke: <b className="text-slate-300 mono">{nfmt(d.counts.blocked_7d)}</b></span>
              <span>Karantina: <b className="text-slate-300 mono">{nfmt(d.quarantine.total)}</b></span>
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1">
              <Skull className="w-3 h-3 text-rose-400" />
              En Sık Tehditler (7g)
            </div>
            {d.top_threats.length === 0 ? (
              <div className="text-xs text-slate-600 italic text-center py-4">Henüz tehdit yok — güzel!</div>
            ) : (
              <div className="space-y-1.5">
                {d.top_threats.slice(0, 5).map((t, i) => {
                  const pct = (t.count / (d.top_threats[0]?.count || 1)) * 100;
                  return (
                    <div key={i} data-testid={`threat-row-${i}`}>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-slate-300 truncate max-w-[180px]" title={t.category}>{t.category}</span>
                        <span className="mono text-rose-300 font-bold">{nfmt(t.count)}</span>
                      </div>
                      <div className="h-1 rounded bg-slate-800 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-rose-500 to-amber-400" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {d.quarantine.phish + d.quarantine.virus > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-800 flex items-center gap-3 text-[10px] text-slate-500">
                <span>🎣 Phishing: <b className="text-rose-300">{d.quarantine.phish}</b></span>
                <span>🦠 Virüs: <b className="text-amber-300">{d.quarantine.virus}</b></span>
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function KPI({ icon: Icon, label, value, tone }) {
  const tones = {
    slate: "border-slate-800 bg-slate-950/40 text-slate-100",
    rose: "border-rose-500/30 bg-rose-500/5 text-rose-100",
    cyan: "border-cyan-500/30 bg-cyan-500/5 text-cyan-100",
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-100",
  };
  const iconTones = {
    slate: "text-slate-500", rose: "text-rose-400", cyan: "text-cyan-400", emerald: "text-emerald-400",
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={`w-3 h-3 ${iconTones[tone]}`} />
        <div className="text-[10px] uppercase tracking-widest text-slate-500 truncate">{label}</div>
      </div>
      <div className="text-xl font-bold mono">{value}</div>
    </div>
  );
}
