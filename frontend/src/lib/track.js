/**
 * track.js — hafif event tracker, PlanGate/PlanUpgradeModal huni analitiği için.
 * Backend `POST /api/analytics/plan-event` endpoint'ine yazar. Ziyaretçilerden
 * de gelir; başarısız istekler sessizce yutulur (analitik iş akışını kırmasın).
 */
import { client } from "@/lib/api";

const SESSION_KEY = "gws.plan_session";

function ensureSession() {
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = "s_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch (_) {
    return null;
  }
}

/**
 * trackPlanEvent — PlanGate/Modal aşamalarında çağrılır.
 * @param {string} event  gate_view|gate_click|modal_open|cycle_change|checkout_click|purchase
 * @param {object} data   { feature, current_plan, target_plan, cycle, meta }
 */
export function trackPlanEvent(event, data = {}) {
  try {
    const licenseKey =
      (typeof window !== "undefined" &&
        (localStorage.getItem("gws.master_license") ||
          localStorage.getItem("gws.event_license"))) || null;
    const payload = {
      event,
      feature: data.feature || null,
      current_plan: data.current_plan || null,
      target_plan: data.target_plan || null,
      cycle: data.cycle || null,
      license_key: licenseKey,
      session_id: ensureSession(),
      page: typeof window !== "undefined" ? window.location.pathname : null,
      meta: data.meta || null,
    };
    // Fire-and-forget; hata olsa da UI'yi bloklama
    client.post("/analytics/plan-event", payload).catch(() => {});
  } catch (_) {
    /* noop */
  }
}
