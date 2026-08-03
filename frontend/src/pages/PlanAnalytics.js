import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, TrendingUp, Package, RefreshCw, ArrowRight } from "lucide-react";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const LICKEY = () =>
  (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) ||
  "";

const STAGE_META = {
  gate_view: { label: "PlanGate Görüntülendi", tone: "slate" },
  gate_click: { label: "Kilit Tıklaması", tone: "indigo" },
  modal_open: { label: "Modal Açıldı", tone: "indigo" },
  checkout_click: { label: "Checkout'a Tıklandı", tone: "amber" },
  purchase: { label: "Satın Alma Tamamlandı", tone: "emerald" },
};

const DAYS_OPTS = [7, 14, 30, 90];

export default function PlanAnalytics() {
  const [days, setDays] = useState(30);

  const q = useQuery({
    queryKey: ["plan-funnel", days],
    queryFn: () => api.adminPlanFunnel(LICKEY(), days),
    refetchInterval: 60000,
    retry: false,
  });

  const data = q.data;
  const funnel = data?.funnel || [];
  const maxCount = Math.max(1, ...funnel.map((s) => s.count));
  const view = funnel.find((s) => s.stage === "gate_view")?.count || 0;
  const clicks = funnel.find((s) => s.stage === "gate_click")?.count || 0;
  const purchases = funnel.find((s) => s.stage === "purchase")?.count || 0;
  const overallConv = view ? ((purchases / view) * 100).toFixed(1) : "0.0";

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
            Plan Yükseltme Huni Analitiği
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            PlanGate görüntülenmelerinden satın almaya kadar tüm dönüşüm hunisi ·
            son <b className="text-slate-300">{days} gün</b>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-800/50 rounded-md p-1 gap-0.5">
            {DAYS_OPTS.map((d) => (
              <button
                key={d}
                data-testid={`pa-days-${d}`}
                onClick={() => setDays(d)}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${
                  days === d ? "bg-indigo-500/25 text-indigo-200" : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {d}g
              </button>
            ))}
          </div>
          <button
            data-testid="pa-refresh"
            onClick={() => q.refetch()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            <RefreshCw className={`w-3 h-3 ${q.isFetching ? "animate-spin" : ""}`} /> Yenile
          </button>
        </div>
      </div>

      {/* Top-line metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Görüntülenme" value={view.toLocaleString("tr-TR")} icon={BarChart3} testid="pa-stat-view" />
        <StatCard label="Kilit Tıklaması" value={clicks.toLocaleString("tr-TR")} icon={TrendingUp} tone="indigo" testid="pa-stat-clicks" />
        <StatCard label="Satın Alma" value={purchases.toLocaleString("tr-TR")} icon={Package} tone="emerald" testid="pa-stat-purchases" />
        <StatCard label="Toplam Dönüşüm" value={`%${overallConv}`} icon={ArrowRight} tone="amber" testid="pa-stat-conversion" />
      </div>

      {/* Funnel bars */}
      <Card>
        <CardHeader title="Huni Aşamaları" subtitle="Her aşamanın toplam sayısı ve önceki aşamaya göre dönüşüm oranı" />
        <CardBody>
          {q.isLoading ? (
            <div className="text-center py-8 text-slate-500 text-sm">Yükleniyor…</div>
          ) : (
            <div className="space-y-3">
              {funnel.map((s, idx) => {
                const meta = STAGE_META[s.stage] || { label: s.stage, tone: "slate" };
                const pct = (s.count / maxCount) * 100;
                const barTone =
                  meta.tone === "emerald" ? "from-emerald-500/70 to-emerald-500/40" :
                  meta.tone === "amber"   ? "from-amber-500/70 to-amber-500/40" :
                  meta.tone === "indigo"  ? "from-indigo-500/70 to-indigo-500/40" :
                                            "from-slate-600/70 to-slate-600/40";
                return (
                  <div key={s.stage} data-testid={`pa-funnel-${s.stage}`}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <div className="flex items-center gap-2 text-slate-300">
                        <span className="mono text-slate-500 text-[10px]">{idx + 1}</span>
                        <span>{meta.label}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="mono text-slate-100 tabular-nums">
                          {s.count.toLocaleString("tr-TR")}
                        </span>
                        {idx > 0 && (
                          <span className="text-[10px] text-slate-500 mono">
                            → %{s.conversion_pct}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="w-full h-6 bg-slate-900 rounded-md overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r ${barTone} transition-all duration-500`}
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {funnel.every((s) => s.count === 0) && (
                <div className="text-center py-8 text-slate-500 text-xs">
                  Henüz plan-upgrade event'i yok. Kullanıcılar kilitli özelliklere tıkladığında burada
                  görünecek.
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* By-feature breakdown */}
      <Card>
        <CardHeader
          title="En Çok Etkileşim Alan Kilitler"
          subtitle="Hangi özellik kilidi ne kadar tıklanıyor ve dönüşüm oranı"
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/50 text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2">Özellik</th>
                  <th className="text-right px-4 py-2">Kilit Tıkı</th>
                  <th className="text-right px-4 py-2">Satın Alma</th>
                  <th className="text-right px-4 py-2">Dönüşüm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {(data?.by_feature || []).map((f) => (
                  <tr key={f.feature} data-testid={`pa-feature-row-${f.feature}`} className="hover:bg-slate-900/40">
                    <td className="px-4 py-2.5 text-slate-200 mono text-xs">{f.feature}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300 mono tabular-nums">
                      {f.clicks.toLocaleString("tr-TR")}
                    </td>
                    <td className="px-4 py-2.5 text-right text-emerald-300 mono tabular-nums">
                      {f.purchases.toLocaleString("tr-TR")}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`mono text-xs px-2 py-0.5 rounded ${
                        f.conversion_pct >= 15 ? "bg-emerald-500/10 text-emerald-300" :
                        f.conversion_pct >= 5  ? "bg-amber-500/10 text-amber-300" :
                                                 "bg-slate-800 text-slate-400"
                      }`}>
                        %{f.conversion_pct}
                      </span>
                    </td>
                  </tr>
                ))}
                {(!data?.by_feature || data.by_feature.length === 0) && (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-slate-500 text-xs">
                      Henüz kilit tıklaması yok
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
