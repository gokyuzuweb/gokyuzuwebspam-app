import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const SEEN_KEY = "gws.push_toasts_last_seen";
const LICKEY = () =>
  (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) ||
  "";

/**
 * PushToastBridge — Sadece master için çalışır. 10sn'de bir /api/push/toasts
 * polling yapar; son 'seen' zamanından yeni olan bildirimleri:
 *   1) Sonner toast ile ekrana düşer (tıklanabilir → link'e git)
 *   2) Tarayıcı Notification API'si desteklenip izin verildiyse OS bildirimi de yollar
 * Görsel çıktısı yoktur (invisible bridge).
 */
export default function PushToastBridge() {
  const { isMaster } = useIsMaster();
  const seenRef = useRef(
    typeof window !== "undefined" ? localStorage.getItem(SEEN_KEY) || "" : ""
  );

  // Tarayıcı bildirim izni iste (bir kere)
  useEffect(() => {
    if (!isMaster || typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [isMaster]);

  const q = useQuery({
    queryKey: ["push-toasts", LICKEY()],
    queryFn: () => api.pushToasts(seenRef.current || undefined, LICKEY()),
    refetchInterval: 10000,
    enabled: !!isMaster,
    retry: false,
  });

  useEffect(() => {
    if (!q.data?.items?.length) return;
    const items = q.data.items;
    // Sadece SEEN'den yeni olanları göster (backend `since` ile filtreliyor, güvence)
    const fresh = items.filter((t) => !seenRef.current || t.created_at > seenRef.current);
    // Eskiden yeniye sırala (en son gelen en son toast)
    fresh.sort((a, b) => (a.created_at || "") > (b.created_at || "") ? 1 : -1);
    fresh.forEach((t) => {
      const desc = t.body || "";
      const link = t.link || "";
      // Sonner toast — kalıcı, tıklanabilir
      toast(t.title || "Bildirim", {
        description: desc,
        duration: 12000,
        icon: <Bell className="w-4 h-4 text-emerald-400" />,
        action: link
          ? {
              label: (
                <span className="inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> Aç
                </span>
              ),
              onClick: () => {
                window.location.href = link;
              },
            }
          : undefined,
      });
      // Tarayıcı bildirim (odaklanılmamış tab için)
      try {
        if ("Notification" in window && Notification.permission === "granted") {
          const n = new Notification(t.title || "GökyüzüWebSpam", {
            body: desc.slice(0, 240),
            tag: t.id || t.created_at,
            icon: "/favicon.ico",
          });
          if (link) {
            n.onclick = () => {
              window.focus();
              window.location.href = link;
              n.close();
            };
          }
        }
      } catch (_) {}
    });
    // En son toast'ın tarihini "seen" olarak kaydet
    const latest = items[0]?.created_at;
    if (latest && latest > (seenRef.current || "")) {
      seenRef.current = latest;
      try { localStorage.setItem(SEEN_KEY, latest); } catch (_) {}
    }
  }, [q.data]);

  return null;
}
