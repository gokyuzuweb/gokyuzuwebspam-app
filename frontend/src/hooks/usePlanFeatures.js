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
  // v43.99.4 — Demo mode: lisans yoksa TÜM özellikler görüntüleme amaçlı AÇIK.
  // Kullanıcı ürünü tam kapsam ile inceleyebilsin, sonra satın alma kararı versin.
  // Lisans girildikten sonra normal plan gating devreye girer.
  const isDemo = !licenseKey;
  const q = useQuery({
    queryKey: ["plan-features", licenseKey],
    queryFn: () => api.planFeatures(licenseKey),
    // Master plan matrix'i güncelleyince bayilerin panelinde ~30sn içinde
    // yeni yetkilerin aktifleşmesi için sıkı polling + window-focus refetch.
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    retry: false,
    staleTime: 15000,
    enabled: !!licenseKey,
  });
  const plan = isDemo ? "demo" : (q.data?.plan || "starter");
  // Demo: her şey görünür + kullanıcı denesin
  const demoFeatures = {
    max_domains: 999, max_mails_per_day: 999999,
    ai_explanations: true, exploit_editor: true, bulk_actions: true,
    custom_rules: true, attack_map: true, reseller_mode: true,
    priority_support: true, api_access: true, marketplace: true, label: "Demo",
  };
  const features = isDemo ? demoFeatures : (q.data?.features || {
    max_domains: 1, max_mails_per_day: 5000,
    ai_explanations: false, exploit_editor: false, bulk_actions: false,
    custom_rules: false, attack_map: true, reseller_mode: false,
    priority_support: false, api_access: false, label: "Starter",
  });
  const labels = q.data?.labels || { starter: "Starter", pro: "Pro", enterprise: "Enterprise", demo: "Demo" };
  const isStarter = plan === "starter";
  const isPro = plan === "pro";
  const isEnterprise = plan === "enterprise";
  return {
    plan, features, labels,
    isStarter, isPro, isEnterprise, isDemo,
    isLoading: q.isLoading,
    // Kolay yardımcılar — feature name ile query
    can: (featureName) => isDemo ? true : !!features[featureName],
    // Plan yükseltme URL'i (kullanıcıyı satın alma sayfasına yönlendirmek için)
    upgradeUrl: "/pricing",
  };
}
