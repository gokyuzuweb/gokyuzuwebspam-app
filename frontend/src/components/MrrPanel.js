import { useQuery } from "@tanstack/react-query";
import { DollarSign, TrendingUp, Users2, Activity, Percent, Wallet, Sparkles } from "lucide-react";
import { Card, CardBody, CardHeader, Badge, StatCard } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useT, useI18n } from "@/i18n";

const PLAN_TONE = { starter: "info", pro: "brand", enterprise: "success" };

function fmtCurrency(n, currency = "USD", locale = "en-US") {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);
  } catch { return `${(n || 0).toFixed(0)} ${currency}`; }
}
function fmtNumber(n, locale = "en-US") {
  return new Intl.NumberFormat(locale).format(n || 0);
}

export default function MrrPanel() {
  const t = useT();
  const { effective } = useI18n();
  const locale = { tr: "tr-TR", en: "en-US", de: "de-DE", fr: "fr-FR", es: "es-ES", ar: "ar-SA" }[effective] || "en-US";
  const q = useQuery({ queryKey: ["mrr"], queryFn: api.analyticsMrr, refetchInterval: 30000 });
  const d = q.data;
  const cur = d?.currency || "USD";

  // Compute trend max for bar heights
  const maxMrr = Math.max(1, ...(d?.trend || []).map(x => x.mrr));

  return (
    <div className="space-y-4" data-testid="mrr-panel">
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-emerald-400" /> {t("mrr.title")}</span>}
          subtitle={t("mrr.sub")}
          right={q.isLoading ? <span className="text-xs text-slate-500 mono">loading…</span> : null}
        />
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={t("mrr.mrr")} tone="success" icon={DollarSign} testid="mrr-stat-mrr"
                  value={fmtCurrency(d?.mrr, cur, locale)}
                  hint={`+ ${fmtCurrency(d?.new_mrr_30d, cur, locale)} (30d)`} />
        <StatCard label={t("mrr.arr")} tone="brand" icon={TrendingUp} testid="mrr-stat-arr"
                  value={fmtCurrency(d?.arr, cur, locale)}
                  hint={`${t("mrr.total_revenue")}: ${fmtCurrency(d?.total_revenue, cur, locale)}`} />
        <StatCard label={t("mrr.active_subs")} tone="info" icon={Users2} testid="mrr-stat-subs"
                  value={fmtNumber(d?.active_subs, locale)}
                  hint={`ARPU ${fmtCurrency(d?.arpu, cur, locale)}`} />
        <StatCard label={t("mrr.ltv")} tone="warning" icon={Wallet} testid="mrr-stat-ltv"
                  value={fmtCurrency(d?.ltv, cur, locale)}
                  hint={`${t("mrr.churn")} ${d?.churn_pct || 0}%`} />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-7">
          <CardHeader
            title={<span className="flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-400" /> {t("mrr.trend_title")}</span>}
            subtitle={t("mrr.trend_sub")}
          />
          <CardBody>
            <div className="flex items-end gap-2 h-40" data-testid="mrr-trend">
              {(d?.trend || []).map((pt) => {
                const h = Math.max(4, (pt.mrr / maxMrr) * 140);
                return (
                  <div key={pt.month} className="flex-1 flex flex-col items-center gap-2" title={`${pt.month}: ${fmtCurrency(pt.mrr, cur, locale)}`}>
                    <div className="mono text-[10px] text-slate-400">{fmtCurrency(pt.mrr, cur, locale)}</div>
                    <div className="w-full rounded-t bg-gradient-to-t from-indigo-600/70 to-indigo-400/40 border border-indigo-500/40" style={{ height: `${h}px` }} />
                    <div className="mono text-[10px] text-slate-500">{pt.month.slice(5)}</div>
                  </div>
                );
              })}
              {(!d?.trend || d.trend.length === 0) && (
                <div className="flex-1 text-center text-slate-500 text-sm py-6">{t("common.no_records")}</div>
              )}
            </div>
          </CardBody>
        </Card>

        <Card className="col-span-12 lg:col-span-5">
          <CardHeader
            title={<span className="flex items-center gap-2"><Percent className="w-4 h-4 text-indigo-400" /> {t("mrr.plan_breakdown")}</span>}
          />
          <CardBody>
            <table className="w-full text-sm" data-testid="mrr-plan-table">
              <thead>
                <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                  <th className="text-left py-2 font-semibold">{t("mrr.plan")}</th>
                  <th className="text-right py-2 font-semibold">{t("mrr.count")}</th>
                  <th className="text-right py-2 font-semibold">MRR</th>
                </tr>
              </thead>
              <tbody>
                {(d?.plans_breakdown || []).map((p) => (
                  <tr key={p.plan} className="border-t border-slate-800">
                    <td className="py-2"><Badge tone={PLAN_TONE[p.plan] || "info"}>{(p.plan || "unknown").toUpperCase()}</Badge></td>
                    <td className="py-2 text-right mono text-slate-200">{fmtNumber(p.count, locale)}</td>
                    <td className="py-2 text-right mono text-emerald-300">{fmtCurrency(p.mrr, cur, locale)}</td>
                  </tr>
                ))}
                {(!d?.plans_breakdown || d.plans_breakdown.length === 0) && (
                  <tr><td colSpan={3} className="py-6 text-center text-slate-500">{t("common.no_records")}</td></tr>
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("mrr.recent_tx")} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="mrr-recent">
            <thead>
              <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                <th className="text-left px-4 py-3 font-semibold">{t("mrr.when")}</th>
                <th className="text-left px-4 py-3 font-semibold">{t("mrr.customer")}</th>
                <th className="text-left px-4 py-3 font-semibold">{t("mrr.plan")}</th>
                <th className="text-right px-4 py-3 font-semibold">{t("mrr.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {(d?.recent || []).map((r) => (
                <tr key={r.session_id} className="border-t border-slate-800">
                  <td className="px-4 py-2.5 mono text-xs text-slate-400">
                    {r.completed_at ? new Date(r.completed_at).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-slate-200">{r.customer_name || r.customer_email}</div>
                    <div className="mono text-[11px] text-slate-500">{r.customer_email}</div>
                  </td>
                  <td className="px-4 py-2.5"><Badge tone={PLAN_TONE[r.plan_code] || "info"}>{(r.plan_code || "").toUpperCase()}</Badge>
                    <span className="ml-2 text-[10px] text-slate-500 mono">{r.billing_period}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right mono text-emerald-300">{fmtCurrency(r.amount, r.currency || cur, locale)}</td>
                </tr>
              ))}
              {(!d?.recent || d.recent.length === 0) && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">{t("common.no_records")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
