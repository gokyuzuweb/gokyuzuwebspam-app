import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * usePlanFeatures — Mevcut lisansın plan bazlı özellik matrisini döner.
 * Frontend UI gating için kullanılır: butonlar/tablar plan yeterli değilse
 * gizlenir veya "🔒 Pro'ya yükselt" tooltip'i ile disable edilir.
 *
 * Kullanım:
 *   const { features, plan, upgradeUrl } = usePlanFeatures();
 *   if (!features.ai_explanations) return null;   // AI butonunu gizle
 *   if (!features.bulk_actions) disabled = true;  // toplu işlem yok
 */
export function usePlanFeatures() {
  const licenseKey = typeof window !== "undefined"
    ? (localStorage.getItem("gws.master_license")
       || localStorage.getItem("gws.event_license")
       || "")
    : "";
  const q = useQuery({
    queryKey: ["plan-features", licenseKey],
    queryFn: () => api.planFeatures(licenseKey),
    refetchInterval: 60000,
    retry: false,
    staleTime: 30000,
    enabled: !!licenseKey,
  });
  const plan = q.data?.plan || "starter";
  const features = q.data?.features || {
    max_domains: 1, max_mails_per_day: 5000,
    ai_explanations: false, exploit_editor: false, bulk_actions: false,
    custom_rules: false, attack_map: true, reseller_mode: false,
    priority_support: false, api_access: false, label: "Starter",
  };
  const labels = q.data?.labels || { starter: "Starter", pro: "Pro", enterprise: "Enterprise" };
  const isStarter = plan === "starter";
  const isPro = plan === "pro";
  const isEnterprise = plan === "enterprise";
  return {
    plan, features, labels,
    isStarter, isPro, isEnterprise,
    isLoading: q.isLoading,
    // Kolay yardımcılar — feature name ile query
    can: (featureName) => !!features[featureName],
    // Plan yükseltme URL'i (kullanıcıyı satın alma sayfasına yönlendirmek için)
    upgradeUrl: "/pricing",
  };
}
