/**
 * v43.71 — Plan Özellik Kilidi (Feature Guard)
 *
 * Kullanım:
 *   <PlanFeatureGuard feature="custom_rules" featureLabel="Özel Kural Editörü">
 *     <Rules />
 *   </PlanFeatureGuard>
 *
 * Master `/panel/plan-config`'te bir modülü pasif yaptığında, o planı satın
 * alan bayı ilgili sayfaya girmeye çalışırsa "Bir üst versiyona geçiş yapmanız
 * gerekiyor" ekranı görür + Upgrade butonuyla /panel/subscription'a gider.
 */
import { useQuery } from "@tanstack/react-query";
import { Lock, Sparkles, ArrowUpCircle, Check, X } from "lucide-react";
import { Card, CardBody, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const PLAN_HIERARCHY = ["starter", "pro", "enterprise"];
const PLAN_LABEL = { starter: "Starter", pro: "Pro", enterprise: "Enterprise" };

export function usePlanFeatures() {
  return useQuery({
    queryKey: ["plan-effective"],
    queryFn: api.planEffective,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export default function PlanFeatureGuard({ feature, featureLabel, children }) {
  const q = usePlanFeatures();
  if (q.isLoading) return null;
  const data = q.data || {};
  // Master her zaman geçer (impersonation aktifse target bayi planı uygulanır)
  if (data.is_master === true) return children;
  const enabled = data.features?.[feature] === true;
  if (enabled) return children;

  const currentPlan = data.plan || "starter";
  const nextPlan = data.next_plan;
  const nextEnabled = nextPlan && data.next_plan_features?.[feature] === true;

  return (
    <div className="p-6" data-testid="plan-feature-guard">
      <Card>
        <CardBody className="p-8 text-center max-w-2xl mx-auto">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-amber-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-100 mb-2">Bu Modül Paketinizde Bulunmuyor</h1>
          <p className="text-sm text-slate-400 mb-2">
            <b className="text-amber-300">{featureLabel || feature}</b> modülü <b>{PLAN_LABEL[currentPlan] || currentPlan}</b> paketinize dahil değil.
          </p>
          {nextPlan && nextEnabled && (
            <p className="text-sm text-emerald-300 mb-6">
              Bu modülü kullanmak için <b>{PLAN_LABEL[nextPlan]}</b> veya <b>Enterprise</b> paketine geçmeniz gerekiyor.
            </p>
          )}
          {(!nextPlan || !nextEnabled) && (
            <p className="text-sm text-slate-500 mb-6">
              Bu modülü kullanmak için <b>Enterprise</b> paketine geçmeniz gerekiyor.
            </p>
          )}

          {/* Plan karşılaştırma */}
          <div className="grid grid-cols-2 gap-3 mb-6 text-left">
            <div className="p-4 rounded-lg border border-slate-700 bg-slate-950">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Mevcut Plan</div>
              <div className="text-lg font-bold text-slate-300 mb-3">{PLAN_LABEL[currentPlan] || currentPlan}</div>
              <div className="flex items-center gap-2 text-sm text-rose-400">
                <X className="w-4 h-4"/> {featureLabel || feature} yok
              </div>
            </div>
            {nextPlan && (
              <div className="p-4 rounded-lg border border-emerald-500/40 bg-emerald-500/5">
                <div className="text-[10px] uppercase tracking-widest text-emerald-500 mb-1 flex items-center gap-1">
                  <ArrowUpCircle className="w-3 h-3"/> Önerilen Plan
                </div>
                <div className="text-lg font-bold text-emerald-300 mb-3">{PLAN_LABEL[nextPlan]}</div>
                <div className="flex items-center gap-2 text-sm text-emerald-300">
                  {nextEnabled ? <><Check className="w-4 h-4"/> {featureLabel || feature} <b>aktif</b></> : <>+ daha fazla özellik</>}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <a href={`/panel/subscription?upgrade=${nextPlan || "pro"}&gateway=havale`} data-testid="plan-guard-upgrade"
               className="inline-flex items-center gap-2 px-5 py-2.5 rounded bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold shadow-lg hover:shadow-xl transition-shadow">
              <Sparkles className="w-4 h-4"/> Planı Yükselt (Havale) →
            </a>
            <a href="/panel" data-testid="plan-guard-back"
               className="text-xs px-3 py-2.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200">
              ← Ana sayfaya dön
            </a>
          </div>
          <p className="text-[11px] text-slate-600 mt-4">
            Bu özellik master tarafından planınızda pasifleştirilmiştir.
            Yükseltme sonrası anında erişim kazanırsınız.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
