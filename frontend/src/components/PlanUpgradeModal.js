import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Check, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { trackPlanEvent } from "@/lib/track";

/**
 * PlanUpgradeModal — Kullanıcı kilitli bir özelliğe tıkladığında açılan modal.
 * Mevcut planı vs önerilen planı yan yana gösterir, tek tıkla checkout'a yönlendirir.
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - currentPlan: 'starter'|'pro'|'enterprise'
 *  - targetPlan: 'pro'|'enterprise' (önerilen minimum plan)
 *  - featureLabel: string (kilitli özelliğin adı - modal başlığında görünür)
 */
export function PlanUpgradeModal({ open, onClose, currentPlan = "starter", targetPlan = "pro", featureLabel = "" }) {
  const [cycle, setCycle] = useState("monthly");

  const pricing = useQuery({
    queryKey: ["pricing"],
    queryFn: api.pricing,
    enabled: open,
    staleTime: 60000,
  });

  useEffect(() => {
    if (!open) return;
    // Modal açıldı event'i
    trackPlanEvent("modal_open", {
      feature: featureLabel, current_plan: currentPlan, target_plan: targetPlan,
    });
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const plans = pricing.data?.plans || [];
  const cur = plans.find((p) => p.code === currentPlan);
  const tgt = plans.find((p) => p.code === targetPlan);

  const priceOf = (p) => (cycle === "yearly" ? p?.yearly_price : p?.monthly_price) || 0;
  const currency = tgt?.currency || "USD";
  const currencySym = { USD: "$", EUR: "€", TRY: "₺", GBP: "£" }[currency] || currency;
  const diff = priceOf(tgt) - priceOf(cur);

  const goCheckout = () => {
    trackPlanEvent("checkout_click", {
      feature: featureLabel, current_plan: currentPlan, target_plan: targetPlan, cycle,
    });
    // Panel içinde /panel/pricing var; oradan checkout başlar.
    toast.info(`${tgt?.name || targetPlan} planına yükseltme sayfasına yönlendiriliyor…`);
    window.location.href = `/panel/pricing?upgrade=${encodeURIComponent(targetPlan)}&cycle=${cycle}`;
  };

  return (
    <div
      data-testid="plan-upgrade-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-950 shadow-2xl shadow-indigo-500/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-slate-100 font-semibold">
              <Sparkles className="w-4 h-4 text-amber-300" />
              Planınızı Yükseltin
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {featureLabel ? (
                <>
                  <b className="text-amber-200">{featureLabel}</b> özelliği bu planınızda kapalı — açmak için
                </>
              ) : "Daha fazla özellik için"} <b className="text-slate-200">{tgt?.name || targetPlan}</b> planına geçin.
            </p>
          </div>
          <button
            data-testid="plan-upgrade-close"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Billing cycle toggle */}
        <div className="px-5 pt-4">
          <div className="inline-flex bg-slate-800/50 rounded-md p-1 gap-0.5">
            {[
              { v: "monthly", label: "Aylık" },
              { v: "yearly", label: "Yıllık (2 ay hediye)" },
            ].map((o) => (
              <button
                key={o.v}
                data-testid={`plan-upgrade-cycle-${o.v}`}
                onClick={() => {
                  setCycle(o.v);
                  trackPlanEvent("cycle_change", {
                    feature: featureLabel, current_plan: currentPlan, target_plan: targetPlan, cycle: o.v,
                  });
                }}
                className={`text-xs px-3 py-1.5 rounded transition-colors ${
                  cycle === o.v ? "bg-indigo-500/25 text-indigo-200" : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body: current vs target */}
        {pricing.isLoading ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Fiyatlar yükleniyor…
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <PlanColumn plan={cur} priceOf={priceOf} currencySym={currencySym} cycle={cycle} tone="dim" label="Mevcut Planınız" />
            <PlanColumn plan={tgt} priceOf={priceOf} currencySym={currencySym} cycle={cycle} tone="highlight" label="Önerilen Plan" />
          </div>
        )}

        {/* Footer / CTA */}
        <div className="px-5 pb-5 pt-2 flex items-center justify-between flex-wrap gap-3 border-t border-slate-800">
          <div className="text-xs text-slate-400">
            {diff > 0 ? (
              <>
                Fark: <b className="text-emerald-300 mono">
                  +{currencySym}{diff.toFixed(2)}/{cycle === "yearly" ? "yıl" : "ay"}
                </b> · anında etkin, iptal serbest.
              </>
            ) : (
              <>Ödeme sayfasında tam fiyat ve taksit seçenekleri görünür.</>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="plan-upgrade-cancel"
              onClick={onClose}
              className="px-3 py-2 rounded-md text-xs border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
            >
              Kapat
            </button>
            <button
              data-testid="plan-upgrade-confirm"
              onClick={goCheckout}
              disabled={!tgt}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-medium border border-indigo-400/40 bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:brightness-110 disabled:opacity-50 shadow-lg shadow-indigo-500/20"
            >
              {tgt?.name || targetPlan}'a Geç <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanColumn({ plan, priceOf, currencySym, cycle, tone, label }) {
  if (!plan) {
    return (
      <div className="p-4 rounded-lg border border-slate-800 bg-slate-900/30 text-slate-500 text-xs">
        {label}: plan bulunamadı
      </div>
    );
  }
  const isHi = tone === "highlight";
  return (
    <div
      className={`p-4 rounded-lg border ${
        isHi
          ? "border-indigo-500/50 bg-gradient-to-b from-indigo-500/10 to-fuchsia-500/5 shadow-lg shadow-indigo-500/10"
          : "border-slate-800 bg-slate-900/40"
      }`}
    >
      <div className={`text-[10px] uppercase tracking-widest mb-1 ${isHi ? "text-indigo-300" : "text-slate-500"}`}>
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-lg font-semibold ${isHi ? "text-slate-100" : "text-slate-300"}`}>{plan.name}</span>
        {plan.highlighted && isHi && (
          <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-500/30">
            popüler
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className={`text-2xl font-semibold tabular-nums ${isHi ? "text-slate-100" : "text-slate-400"}`}>
          {currencySym}
          {priceOf(plan).toFixed(0)}
        </span>
        <span className="text-[11px] text-slate-500">/ {cycle === "yearly" ? "yıl" : "ay"}</span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {(plan.features || []).slice(0, 6).map((f, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
            <Check className={`w-3 h-3 mt-0.5 shrink-0 ${isHi ? "text-emerald-400" : "text-slate-500"}`} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
