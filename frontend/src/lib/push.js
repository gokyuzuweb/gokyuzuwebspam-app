/**
 * PWA notifications for the reseller portal (mobile-first).
 *
 * Uses the browser's built-in Notification API + service-worker registration
 * to display local alerts when new critical events arrive while the user
 * has the reseller portal open (foreground) or when reopens the PWA (via
 * service-worker cached badge).
 *
 * Server-driven Web Push (VAPID) is NOT wired up yet — that requires a
 * VAPID key pair + push subscription endpoint. This module provides:
 *   1) permission prompt UI
 *   2) local notification when the reseller portal polls alerts and finds
 *      a new critical one (score >= 10 or verdict in {virus, phish, high_spam})
 *   3) audio ping
 *   4) badge count in the tab title
 */

const KEY_ENABLED = "gws.push_enabled";
const KEY_LAST_SEEN_ID = "gws.push_last_seen";

/** Register a tiny service worker so the PWA can show notifications when
 *  the tab is not focused. Idempotent. */
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    // Inline blob-based service worker (no separate file needed)
    const sw = `
      self.addEventListener('install', () => self.skipWaiting());
      self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
      // Placeholder for future Web Push
      self.addEventListener('push', function(event) {
        const data = event.data ? event.data.json() : {};
        const title = data.title || 'GökyüzüWebSpam';
        const body  = data.body  || 'Yeni bildirim';
        event.waitUntil(self.registration.showNotification(title, {
          body,
          icon: '/favicon.ico',
          badge: '/favicon.ico',
          tag: data.tag || 'gws',
          renotify: true,
          data: data.url ? { url: data.url } : {},
        }));
      });
      self.addEventListener('notificationclick', function(event) {
        event.notification.close();
        const url = event.notification.data?.url || '/reseller?mobile=1';
        event.waitUntil(clients.openWindow(url));
      });
    `;
    const blob = new Blob([sw], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const reg = await navigator.serviceWorker.register(url);
    return reg;
  } catch (e) {
    console.warn("SW register failed:", e);
    return null;
  }
}

export async function requestPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") {
    localStorage.setItem(KEY_ENABLED, "1");
    return "granted";
  }
  if (Notification.permission === "denied") return "denied";
  const p = await Notification.requestPermission();
  if (p === "granted") {
    localStorage.setItem(KEY_ENABLED, "1");
    await registerServiceWorker();
  }
  return p;
}

export function pushEnabled() {
  return typeof window !== "undefined"
    && "Notification" in window
    && Notification.permission === "granted"
    && localStorage.getItem(KEY_ENABLED) === "1";
}

let audioCtx = null;
function ping() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine"; o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.15);
  } catch (_) {}
}

/**
 * Given a list of recent alerts (from api.alertsRecent), fire a local
 * notification for each *new* critical alert not yet seen.
 */
export function notifyIfNew(alerts) {
  if (!pushEnabled() || !Array.isArray(alerts) || alerts.length === 0) return 0;
  const lastSeen = localStorage.getItem(KEY_LAST_SEEN_ID);
  const critical = alerts.filter((a) => {
    const v = a?.sample_event?.verdict;
    return ["virus", "phish", "high_spam"].includes(v)
        || (a?.sample_event?.score >= 10);
  });
  if (critical.length === 0) return 0;
  // Notify only alerts newer than last seen
  const toNotify = lastSeen
    ? critical.filter((a) => a.id !== lastSeen && a.fired_at > (lastSeen))
    : critical;

  if (toNotify.length === 0) return 0;
  const latest = toNotify[0];
  localStorage.setItem(KEY_LAST_SEEN_ID, latest.fired_at || latest.id);

  // Aggregate if many
  const title = toNotify.length === 1
    ? `⚠ ${latest.rule_name}`
    : `⚠ ${toNotify.length} yeni kritik alarm`;
  const body = latest.reason || latest.sample_event?.subject || "Panelde detaylar";

  try {
    new Notification(title, {
      body,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: "gws-alert",
      renotify: true,
      requireInteraction: false,
    });
    ping();
    // Also update tab title with a badge for foreground visibility
    if (typeof document !== "undefined") {
      const original = document.title.replace(/^\(\d+\) /, "");
      document.title = `(${toNotify.length}) ${original}`;
      // Reset when tab gets focus
      const reset = () => {
        document.title = original;
        window.removeEventListener("focus", reset);
      };
      window.addEventListener("focus", reset);
    }
  } catch (_) {}

  return toNotify.length;
}
