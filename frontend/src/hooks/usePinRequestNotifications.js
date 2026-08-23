/**
 * usePinRequestNotifications — v44.00.09
 *
 * Master paneli açık olduğunda bayı PIN talebi geldiğinde browser
 * Notification API ile masaüstü bildirimi gönderir.
 *
 * Neden faydalı: Master gün içinde başka sekmelerdeyken bayı PIN taleplerini
 * fark etmez → onay 30+ dakika gecikir. Push bildirim ile 10x hızlanır.
 *
 * Nasıl çalışır:
 *   1. Master ilk mount'ta `Notification.requestPermission()` çağrılır (bir kez)
 *   2. `pinApprovalPending()` 30sn polling'de yeni bir pending kayıt görürse
 *      → `new Notification(...)` ile masaüstü bildirimi + `toast`
 *   3. Kullanıcı bildirime tıklarsa → PIN onay sayfasına götürür
 *
 * Hafif: service worker yok, subscription DB yok, VAPID yok. Sadece
 * open-tab için çalışır — MVP için yeterli.
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const PERM_ASK_KEY = "gws.pin_notify.perm_asked";

// v44.00.11 — Kısa "ding" ses efekti (WebAudio API — asset gerektirmez)
// Master arka plan sekmedeyken bile PIN talebini duyabilsin.
function playDing() {
  if (typeof window === "undefined") return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    // İki hoş, hafif çıngırak sesi (E5 → G5)
    const now = ctx.currentTime;
    [
      { freq: 659.25, start: 0,    dur: 0.18 },  // E5
      { freq: 783.99, start: 0.14, dur: 0.28 },  // G5
    ].forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // ADSR — hızlı attack, yumuşak decay (rahatsız etmesin)
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.22, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.05);
    });
    // Otomatik kapat
    setTimeout(() => { try { ctx.close(); } catch {} }, 800);
  } catch (_) { /* ignore — bazı tarayıcılar autoplay policy nedeniyle bloklayabilir */ }
}

export default function usePinRequestNotifications() {
  const { isMaster, ready } = useIsMaster();
  const seenIdsRef = useRef(new Set());
  const initializedRef = useRef(false);

  // Notification izni iste (bir kez, sadece master için)
  useEffect(() => {
    if (!isMaster || !ready) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted" || Notification.permission === "denied") return;
    try {
      if (localStorage.getItem(PERM_ASK_KEY) === "1") return;  // bir kez sorduysak tekrar sorma
    } catch {}
    // 3 saniye gecikme — sayfa yüklendikten SONRA sor ki agresif görünmesin
    const t = setTimeout(() => {
      try {
        Notification.requestPermission().then((perm) => {
          try { localStorage.setItem(PERM_ASK_KEY, "1"); } catch {}
          if (perm === "granted") {
            toast.success("🔔 PIN talep bildirimleri açıldı", {
              description: "Yeni bir PIN talebi geldiğinde masaüstünde bildirim alacaksınız",
              duration: 5000,
            });
          }
        }).catch(() => {});
      } catch {}
    }, 3000);
    return () => clearTimeout(t);
  }, [isMaster, ready]);

  // Bekleyen talepleri polling ile takip et
  const q = useQuery({
    queryKey: ["pin-notify-pending"],
    queryFn: () => api.pinApprovalPending(),
    enabled: !!isMaster && !!ready,
    refetchInterval: 30_000,
    retry: false,
  });

  useEffect(() => {
    if (!q.data || !isMaster) return;
    const items = q.data.items || [];
    // İlk mount'ta mevcut talepleri "görüldü" olarak işaretle — bildirim spam etme
    if (!initializedRef.current) {
      items.forEach((i) => seenIdsRef.current.add(i.id));
      initializedRef.current = true;
      return;
    }
    // Yeni gelen talepler
    const newOnes = items.filter((i) => !seenIdsRef.current.has(i.id));
    if (newOnes.length === 0) return;
    newOnes.forEach((req) => {
      seenIdsRef.current.add(req.id);
      const bayiName = req.customer_name || (req.bayi_license_key || "").slice(0, 12) + "...";
      const title = "🔐 Yeni PIN Talebi · Onay Bekliyor";
      const body = `${bayiName} PIN değişikliği istiyor${req.reason ? " — " + req.reason.slice(0, 80) : ""}`;
      // v44.00.11 — Ding sesi çal ki arka plan sekmede bile master duyabilsin
      try { playDing(); } catch (_) { /* ignore */ }
      // 1) Sonner toast (panel içi)
      toast.info(title, {
        description: body,
        duration: 15_000,
        action: {
          label: "Onaya Git",
          onClick: () => { try { window.location.href = "/panel/settings"; } catch {} },
        },
      });
      // 2) Browser Notification (masaüstü — sekme arka planda bile çalışır)
      try {
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          const n = new Notification(title, {
            body,
            icon: "/logo192.png",
            badge: "/logo192.png",
            tag: `pin-request-${req.id}`,
            requireInteraction: true,  // master tıklayana kadar kalsın
          });
          n.onclick = () => {
            try {
              window.focus();
              window.location.href = "/panel/settings";
            } catch {}
            n.close();
          };
        }
      } catch (_) { /* ignore */ }
    });
  }, [q.data, isMaster]);

  return { pendingCount: (q.data?.items || []).length, permission: (typeof window !== "undefined" && "Notification" in window) ? Notification.permission : "unsupported" };
}
