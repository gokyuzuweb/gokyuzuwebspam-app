import { useEffect, useRef } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, ShieldAlert, Info } from "lucide-react";
import { api } from "@/lib/api";

/**
 * BayiEventBridge — Master ile bayi paneli arasında canlı köprü.
 * `/api/maintenance/ws/attacks` WebSocket'inden gelen sistem event'lerini
 * dinler ve ilgili UI aksiyonlarını tetikler:
 *
 *  • `plan_matrix_updated` → plan_features cache invalidate + info toast
 *  • `plan_changed` (bu bayinin lisansı) → "🎉 Planınız X'e yükseltildi" + reload
 *  • `license_state_changed` (bu bayinin lisansı, active=false) → oturum kapatma + login yönlendirme
 *  • `bayi_wake_bulk` (bu bayinin lisansı listede) → arka planda whoami tetikle
 *
 * Görsel çıktısı yok (invisible bridge).
 */
export default function BayiEventBridge() {
  const qc = useQueryClient();
  const wsRef = useRef(null);

  // Session expired safety-net: 60sn'de bir plugin/status kontrolü — WS düşse
  // bile master deaktive edince max 60sn'de oturum kapansın.
  const status = useQuery({
    queryKey: ["plugin-status-bridge"],
    queryFn: api.pluginStatus,
    refetchInterval: 60000,
    retry: false,
    staleTime: 30000,
  });
  useEffect(() => {
    if (status.data?.session_expired) {
      const reason = status.data.session_expired_reason || "deactivated";
      const msg = reason === "expired"
        ? "🕐 Lisansınızın süresi doldu — yenilemeniz gerekiyor"
        : "🔒 Lisansınız master tarafından pasifleştirildi";
      toast.error(msg, {
        description: "3 saniye içinde çıkış yapılacak",
        duration: 3000,
        icon: <ShieldAlert className="w-4 h-4 text-rose-400" />,
      });
      setTimeout(() => {
        try {
          localStorage.removeItem("gws.master_license");
          localStorage.removeItem("gws.event_license");
        } catch (_) {}
        window.location.href = "/";
      }, 3000);
    }
  }, [status.data]);

  useEffect(() => {
    const url = (process.env.REACT_APP_BACKEND_URL || window.location.origin)
      .replace(/^http/, "ws") + "/api/maintenance/ws/attacks";
    const myLicense = localStorage.getItem("gws.event_license") || "";
    let ws;
    let alive = true;

    const connect = () => {
      if (!alive) return;
      try {
        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onmessage = (evt) => {
          let data;
          try { data = JSON.parse(evt.data); } catch { return; }
          const t = data.type;

          // 1) Plan matrisi güncellendi — herkes için cache tazele
          if (t === "plan_matrix_updated") {
            qc.invalidateQueries({ queryKey: ["plan-features"] });
            toast.info("⚙️ Modül izinleri güncellendi", {
              description: "Panelinizde yeni yetkiler artık aktif",
              duration: 5000,
              icon: <Info className="w-4 h-4 text-sky-400" />,
            });
            return;
          }

          // 2) Bu bayinin planı değişti
          if (t === "plan_changed" && data.license_key && data.license_key === myLicense) {
            qc.invalidateQueries({ queryKey: ["plan-features"] });
            qc.invalidateQueries({ queryKey: ["plugin-status"] });
            const upgrade = ["starter", "pro", "enterprise"].indexOf(data.new_plan) >
                            ["starter", "pro", "enterprise"].indexOf(data.old_plan);
            toast.success(
              `🎉 Planınız ${data.new_plan?.toUpperCase()} planına ${upgrade ? "yükseltildi" : "güncellendi"}`,
              {
                description: `${data.old_plan || "-"} → ${data.new_plan}. Yeni modüller birazdan görünecek.`,
                duration: 10000,
                icon: <Sparkles className="w-4 h-4 text-emerald-400" />,
              }
            );
            return;
          }

          // 3) Bu bayinin lisansı deaktive edildi → oturum kapat
          if (t === "license_state_changed" && data.license_key && data.license_key === myLicense) {
            if (data.active === false) {
              toast.error("🔒 Lisansınız master tarafından pasifleştirildi", {
                description: "3 saniye içinde çıkış yapılacak — hesap durumu için destek ile iletişime geçin",
                duration: 3000,
                icon: <ShieldAlert className="w-4 h-4 text-rose-400" />,
              });
              setTimeout(() => {
                try {
                  localStorage.removeItem("gws.master_license");
                  localStorage.removeItem("gws.event_license");
                } catch (_) {}
                window.location.href = "/";
              }, 3000);
            } else {
              qc.invalidateQueries({ queryKey: ["plugin-status"] });
              toast.success("✓ Lisansınız yeniden aktif edildi", {
                icon: <Sparkles className="w-4 h-4 text-emerald-400" />,
              });
            }
            return;
          }

          // 4) Toplu wake bulk — kendi lisansımız listede mi?
          if (t === "bayi_wake_bulk" && Array.isArray(data.licenses)
              && myLicense && data.licenses.includes(myLicense)) {
            // Fon'da whoami ve status tetikle — heartbeat düşsün
            qc.invalidateQueries({ queryKey: ["plugin-status"] });
            qc.invalidateQueries({ queryKey: ["whoami"] });
          }
        };

        ws.onclose = () => {
          if (!alive) return;
          // 5sn sonra reconnect
          setTimeout(connect, 5000);
        };
        ws.onerror = () => { try { ws.close(); } catch (_) {} };
      } catch (_) {
        setTimeout(connect, 5000);
      }
    };

    connect();
    return () => {
      alive = false;
      try { if (ws) ws.close(); } catch (_) {}
    };
  }, [qc]);

  return null;
}
