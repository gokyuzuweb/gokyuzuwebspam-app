import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";

/**
 * useIsMaster — returns true only when this browser is authenticated as the
 * "master admin" (server IP `89.19.15.58` + master license key).
 *
 * Frontend gating is *UX-only*; backend enforces authoritatively via
 * `_require_master()` on mutating endpoints.
 */
export function useIsMaster() {
  const licenseKey = typeof window !== "undefined"
    ? (localStorage.getItem("gws.event_license") || localStorage.getItem("gws.master_license") || "")
    : "";
  const q = useQuery({
    queryKey: ["whoami", licenseKey],
    queryFn: () => api.whoami(licenseKey),
    refetchInterval: 60000,
    retry: false,
    staleTime: 30000,
  });
  // is_master + master_key backend'den geldiyse localStorage'a yaz ki
  // sonraki tüm PUT/DELETE isteklerinde X-Master-Key header'ı otomatik gitsin.
  useEffect(() => {
    if (q.data?.is_master && q.data?.master_key) {
      try {
        const existing = localStorage.getItem("gws.master_license");
        if (existing !== q.data.master_key) {
          localStorage.setItem("gws.master_license", q.data.master_key);
        }
      } catch (_) {}
    }
  }, [q.data?.is_master, q.data?.master_key]);
  return {
    isMaster: !!q.data?.is_master,
    ipMatch:  !!q.data?.ip_match,
    keyMatch: !!q.data?.key_match,
    masterIp: q.data?.master_ip || "",
    masterHost: q.data?.master_host || "",
    clientIp: q.data?.client_ip || "",
    isLoading: q.isLoading,
  };
}
