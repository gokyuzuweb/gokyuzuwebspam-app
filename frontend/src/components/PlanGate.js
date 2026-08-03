import { useState } from "react";
import { Lock, Sparkles } from "lucide-react";
import { usePlanFeatures } from "@/hooks/usePlanFeatures";
import { PlanUpgradeModal } from "@/components/PlanUpgradeModal";

/**
 * PlanGate — Kullanıcının aktif plan matrisi feature'ı kapsamıyorsa
 * children yerine "Üst versiyonda geçerli" uyarı kartı render eder.
 *
 * Örnek:
 *   <PlanGate feature="bulk_actions" featureLabel="Toplu İşlemler">
 *     <BulkActionsPanel />
 *   </PlanGate>
 */
export function PlanGate({ feature, featureLabel, minPlan = "pro", children, compact = false }) {
  const { features, plan, labels, isLoading } = usePlanFeatures();
  const [modalOpen, setModalOpen] = useState(false);
  if (isLoading) return null;
  const allowed = !!features[feature];
  if (allowed) return children;

  const requiredLabel = labels[minPlan] || "Pro";
  const currentLabel = labels[plan] || "Starter";

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          data-testid={`plan-gate-${feature}`}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs hover:bg-amber-500/20 transition-colors"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>
            {featureLabel || feature} · <b>{requiredLabel}</b> planında geçerli
          </span>
        </button>
        <PlanUpgradeModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          currentPlan={plan}
          targetPlan={minPlan}
          featureLabel={featureLabel || feature}
        />
      </>
    );
  }

  return (
    <>
      <div
        data-testid={`plan-gate-${feature}`}
        className="p-6 rounded-lg border border-amber-500/30 bg-amber-500/5 flex items-start gap-4"
      >
        <div className="p-3 rounded-full bg-amber-500/10 border border-amber-500/30">
          <Lock className="w-5 h-5 text-amber-300" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-amber-100">
              {featureLabel || feature} — üst versiyonda geçerli
            </h3>
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              Mevcut plan: {currentLabel}
            </span>
          </div>
          <p className="text-xs text-amber-200/80 mt-1.5 leading-relaxed">
            Bu modül <b className="text-amber-100">{requiredLabel}</b> ve üzeri planlarda kullanılabilir.
            Planınızı yükselttiğinizde <span className="mono">{featureLabel || feature}</span> özelliği
            otomatik olarak açılır.
          </p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            data-testid={`plan-gate-${feature}-upgrade`}
            className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Planı Yükselt
          </button>
        </div>
      </div>
      <PlanUpgradeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        currentPlan={plan}
        targetPlan={minPlan}
        featureLabel={featureLabel || feature}
      />
    </>
  );
}

/**
 * PlanBadge — Sayfa başlığı yanında gösterilen plan rozeti + kilit ipucu.
 * Kullanıcı hangi planda olduğunu net görsün diye.
 */
export function PlanBadge({ className = "" }) {
  const { plan, labels, isLoading } = usePlanFeatures();
  if (isLoading) return null;
  const tone =
    plan === "enterprise" ? "bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-200" :
    plan === "pro"        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200" :
                            "bg-slate-500/10 border-slate-500/30 text-slate-300";
  return (
    <span
      data-testid="plan-badge"
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${tone} ${className}`}
    >
      <Sparkles className="w-3 h-3" />
      {labels[plan] || "Starter"}
    </span>
  );
}
