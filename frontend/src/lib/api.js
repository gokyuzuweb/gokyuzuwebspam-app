import axios from "axios";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API, timeout: 20000 });
// LLM-backed endpoints can take 30-60s (Claude / GPT / Gemini reasoning)
const llmClient = axios.create({ baseURL: API, timeout: 90000 });

// Demo modu: 423 Locked cevabında kullanıcıyı bilgilendir ve akışı durdur
const _demoInterceptor = (err) => {
  if (err?.response?.status === 423 && err.response?.data?.code === "DEMO_READ_ONLY") {
    toast.error("Demo modunda işlem yapılamaz — Lisans girin", {
      description: "Sadece görüntüleme aktif. Lisans anahtarınızla panele tam erişim alın.",
      duration: 4500,
      action: {
        label: "Lisans Gir",
        onClick: () => {
          try { window.dispatchEvent(new CustomEvent("gws:open-license-modal")); } catch (_) {}
        },
      },
    });
  }
  return Promise.reject(err);
};
client.interceptors.response.use((r) => r, _demoInterceptor);
llmClient.interceptors.response.use((r) => r, _demoInterceptor);

export const api = {
  overview: () => client.get("/stats/overview").then(r => r.data),
  traffic: (hours = 24) => client.get(`/stats/traffic?hours=${hours}`).then(r => r.data),
  topSenders: () => client.get("/stats/top-senders").then(r => r.data),

  // SaaS live mail events (from remote milter POST /api/events/ingest)
  liveEvents: (licenseKey, limit = 60, scopeUser = null, verdict = null) =>
    client.get("/events", { params: {
      license_key: licenseKey, limit,
      ...(scopeUser ? { scope_user: scopeUser } : {}),
      ...(verdict && verdict !== "all" ? { verdict } : {}),
    }}).then(r => r.data),
  liveEventsSummary: (licenseKey, scopeUser = null) =>
    client.get("/events/summary", { params: {
      license_key: licenseKey,
      ...(scopeUser ? { scope_user: scopeUser } : {}),
    }}).then(r => r.data),
  testIngestEvents: (licenseKey) =>
    client.post(`/events/test-ingest?license_key=${encodeURIComponent(licenseKey)}`).then(r => r.data),
  quarantineAction: (licenseKey, eventId, action) =>
    client.post("/events/quarantine-action", {
      license_key: licenseKey, event_id: eventId, action,
    }).then(r => r.data),
  eventsByServer: (licenseKey) =>
    client.get("/events/by-server", { params: { license_key: licenseKey } }).then(r => r.data),
  eventGet: (licenseKey, eventId) =>
    client.get(`/events/${eventId}`, { params: { license_key: licenseKey } }).then(r => r.data),
  eventMarkSpam: (licenseKey, eventId) =>
    client.post(`/events/${eventId}/mark-spam`, null, { params: { license_key: licenseKey } }).then(r => r.data),
  alertsRules: (licenseKey) =>
    client.get("/alerts/rules", { params: { license_key: licenseKey } }).then(r => r.data),
  alertsRuleUpsert: (licenseKey, rule) =>
    client.post("/alerts/rules", { license_key: licenseKey, ...rule }).then(r => r.data),
  alertsRuleDelete: (licenseKey, ruleId) =>
    client.delete(`/alerts/rules/${ruleId}`, { params: { license_key: licenseKey } }).then(r => r.data),
  alertsRecent: (licenseKey, limit = 20) =>
    client.get("/alerts", { params: { license_key: licenseKey, limit } }).then(r => r.data),
  alertsTestWebhook: (licenseKey, webhookUrl, webhookKind) =>
    client.post("/alerts/test-webhook", {
      license_key: licenseKey, webhook_url: webhookUrl, webhook_kind: webhookKind,
    }).then(r => r.data),
  brandingGet: (licenseKey) =>
    client.get("/reseller/branding", { params: { license_key: licenseKey } }).then(r => r.data),
  brandingPut: (licenseKey, branding) =>
    client.put("/reseller/branding", { license_key: licenseKey, ...branding }).then(r => r.data),
  healthMetrics: (licenseKey) =>
    client.get("/events/health-metrics", { params: { license_key: licenseKey } }).then(r => r.data),
  alertsTimeline: (licenseKey) =>
    client.get("/alerts/timeline", { params: { license_key: licenseKey } }).then(r => r.data),
  complianceSnapshot: (licenseKey, days = 30) =>
    client.get("/events/compliance-snapshot", { params: { license_key: licenseKey, days } }).then(r => r.data),

  quarantine: (params = {}) => client.get("/quarantine", { params }).then(r => r.data),
  quarantineGet: (id) => client.get(`/quarantine/${id}`).then(r => r.data),
  quarantineRelease: (ids) => client.post("/quarantine/release", { ids }).then(r => r.data),
  quarantineDelete: (ids) => client.post("/quarantine/delete", { ids }).then(r => r.data),
  quarantineReport: (ids) => client.post("/quarantine/report-spam", { ids }).then(r => r.data),

  lists: (params = {}) => client.get("/lists", { params }).then(r => r.data),
  listAdd: (payload) => client.post("/lists", payload).then(r => r.data),
  listDel: (id) => client.delete(`/lists/${id}`).then(r => r.data),

  rules: () => client.get("/rules").then(r => r.data),
  ruleAdd: (payload) => client.post("/rules", payload).then(r => r.data),
  ruleDel: (id) => client.delete(`/rules/${id}`).then(r => r.data),
  ruleUpdate: (id, payload) => client.put(`/rules/${id}`, payload).then(r => r.data),

  engines: () => client.get("/engines").then(r => r.data),
  engineToggle: (name) => client.post(`/engines/${name}/toggle`).then(r => r.data),

  settings: () => client.get("/settings").then(r => r.data),
  settingsPut: (payload) => client.put("/settings", payload).then(r => r.data),

  users: () => client.get("/users").then(r => r.data),
  logs: (params = {}) => client.get("/logs", { params }).then(r => r.data),
  outbound: () => client.get("/outbound").then(r => r.data),

  notifications: () => client.get("/notifications").then(r => r.data),
  notificationsPut: (payload) => client.put("/notifications", payload).then(r => r.data),
  notificationsTest: (channel) => client.post("/notifications/test", { channel }).then(r => r.data),
  notificationsSimulate: () => client.post("/notifications/simulate-threat").then(r => r.data),

  smtpGet: () => client.get("/settings/smtp").then(r => r.data),
  smtpPut: (payload) => client.put("/settings/smtp", payload).then(r => r.data),
  mailTest: (payload) => client.post("/mail/test", payload).then(r => r.data),

  reportDownload: () => `${API}/reports/weekly`,
  reportSend: (recipient) => client.post("/reports/weekly/send", { recipient }).then(r => r.data),

  scanAI: (payload) => llmClient.post("/scan/ai", payload).then(r => r.data),

  // Version
  versionCurrent: () => client.get("/version/current").then(r => r.data),
  versionManifest: () => client.get("/version/manifest").then(r => r.data),
  versionManifestPut: (payload) => client.put("/version/manifest", payload).then(r => r.data),
  versionCheckUpdate: () => client.get("/version/check-update").then(r => r.data),
  versionPublish: (payload) => client.post("/version/publish", payload).then(r => r.data),

  // Admin gate
  whoami: (licenseKey) =>
    client.get("/admin/whoami", { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  masterUnlock: (licenseKey) =>
    client.post("/admin/master-unlock", { license_key: licenseKey }, { withCredentials: true }).then(r => r.data),
  masterLogout: () =>
    client.post("/admin/master-logout", null, { withCredentials: true }).then(r => r.data),
  adminResellers: (licenseKey) =>
    client.get("/admin/resellers", { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminResellerLogins: (licenseKey, limit = 100) =>
    client.get("/admin/reseller-logins", { params: { limit, ...(licenseKey ? { license_key: licenseKey } : {}) }, withCredentials: true }).then(r => r.data),
  adminSubaccounts: (licenseKey) =>
    client.get("/admin/subaccounts", { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminResellerReset: (licenseKey, rid, newPassword) =>
    client.post(`/admin/resellers/${rid}/reset-password`, { new_password: newPassword },
                { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminResellerToggle: (licenseKey, rid) =>
    client.post(`/admin/resellers/${rid}/toggle-active`, null,
                { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminResellerDelete: (licenseKey, rid) =>
    client.delete(`/admin/resellers/${rid}`,
                  { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminResellerCreate: (licenseKey, payload) =>
    client.post("/admin/resellers", payload,
                { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminResellerActivity: (licenseKey, rid, days = 30) =>
    client.get(`/admin/resellers/${rid}/activity`, { params: { days, ...(licenseKey ? { license_key: licenseKey } : {}) }, withCredentials: true }).then(r => r.data),
  adminSendReminder: (licenseKey, rid) =>
    client.post(`/admin/resellers/${rid}/send-reminder`, null,
                { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminOnboardingStatus: (licenseKey) =>
    client.get("/admin/onboarding-status", { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminOnboardingComplete: (licenseKey) =>
    client.post("/admin/onboarding-complete", null,
                { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminAutoSuspendGet: (licenseKey) =>
    client.get("/admin/auto-suspend", { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminAutoSuspendPut: (licenseKey, payload) =>
    client.put("/admin/auto-suspend", payload,
               { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminAutoSuspendRun: (licenseKey) =>
    client.post("/admin/auto-suspend/run", null,
                { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  adminAnalyticsExport: (licenseKey, days = 30) =>
    `${client.defaults.baseURL}/admin/analytics/export?fmt=csv&days=${days}${licenseKey ? `&license_key=${encodeURIComponent(licenseKey)}` : ""}`,
  pushVapidPublic: () => client.get("/push/vapid-public").then(r => r.data),
  pushSubscribe: (payload) => client.post("/push/subscribe", payload).then(r => r.data),
  pushSend: (payload) => client.post("/push/send", payload, { withCredentials: true }).then(r => r.data),
  aiExplainSpam: (payload) => client.post("/ai/explain-spam", payload).then(r => r.data),
  adminResellerBreakdown: (licenseKey, rid, days = 30) =>
    client.get(`/admin/resellers/${rid}/activity-breakdown`, { params: { days, ...(licenseKey ? { license_key: licenseKey } : {}) }, withCredentials: true }).then(r => r.data),
  // Security / whitelist / country rules
  countryRules: () => client.get("/security/country-rules").then(r => r.data),
  countryRuleAdd: (licenseKey, payload) =>
    client.post("/security/country-rules", payload,
                { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  countryRuleDel: (licenseKey, code) =>
    client.delete(`/security/country-rules/${code}`,
                  { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  whitelistFromEvent: (licenseKey, eventId) =>
    client.post("/security/whitelist-from-event", null,
                { params: { event_id: eventId, license_key: licenseKey } }).then(r => r.data),
  pushSendTest: (licenseKey) =>
    client.post("/push/send-test", null,
                { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  quarantineLocalDomains: () =>
    client.get("/quarantine/local-domains").then(r => r.data),
  quarantinePurgeDemo: () =>
    client.post("/quarantine/purge-demo").then(r => r.data),

  // Licenses
  licenses: () => client.get("/licenses").then(r => r.data),
  licenseAdd: (payload) => client.post("/licenses", payload).then(r => r.data),
  licenseUpdate: (id, payload) => client.put(`/licenses/${id}`, payload).then(r => r.data),
  licenseDelete: (id) => client.delete(`/licenses/${id}`).then(r => r.data),
  violations: () => client.get("/license/violations").then(r => r.data),
  violationsClear: () => client.delete("/license/violations").then(r => r.data),
  violationSimulate: (payload) => client.post("/license/simulate-violation", payload).then(r => r.data),
  simulateAlarm: (kind) => client.post("/events/simulate-alert", { kind }).then(r => r.data),

  // Blacklist
  blacklistProviders: () => client.get("/blacklist/providers").then(r => r.data),
  blacklistCheck: (payload) => client.post("/blacklist/check", payload).then(r => r.data),
  blacklistDelist: (payload) => client.post("/blacklist/delist", payload).then(r => r.data),
  blacklistRequests: () => client.get("/blacklist/requests").then(r => r.data),
  blacklistUpdateRequest: (id, payload) => client.put(`/blacklist/requests/${id}`, payload).then(r => r.data),

  // AI Rule Generator
  rulesGenerate: (prompt, model, language) => llmClient.post("/rules/generate", { prompt, model, language }).then(r => r.data),

  // i18n
  i18nLanguages: () => client.get("/i18n/languages").then(r => r.data),
  i18nEffective: (cpanel_lang) => client.get("/i18n/effective", { params: { cpanel_lang } }).then(r => r.data),

  // Plugin state (demo / licensed)
  pluginStatus: () => client.get("/plugin/status").then(r => r.data),
  pluginVerifyLicense: (payload) => client.post("/plugin/verify-license", payload).then(r => r.data),
  pluginResetDemo: () => client.post("/plugin/reset-demo").then(r => r.data),
  pluginSimulateState: (state) => client.post("/plugin/simulate-state", { state }).then(r => r.data),
  systemMode: () => client.get("/system/mode").then(r => r.data),

  // Pricing
  pricing: () => client.get("/pricing").then(r => r.data),
  pricingPublic: () => client.get("/pricing").then(r => r.data),
  pricingPut: (payload) => client.put("/pricing", payload).then(r => r.data),

  // Stripe checkout
  checkoutCreate: (payload) => client.post("/checkout/create-session", payload).then(r => r.data),
  checkoutStatus: (session_id) => client.get(`/checkout/status/${session_id}`).then(r => r.data),
  checkoutTransactions: () => client.get("/checkout/transactions").then(r => r.data),

  // Financial analytics
  analyticsMrr: () => client.get("/analytics/mrr").then(r => r.data),

  // License server (upstream)
  licenseServerHealth: () => client.get("/license-server/health").then(r => r.data),
  licenseServerConfig: () => client.get("/license-server/config").then(r => r.data),
  licenseServerVerify: (license_key, server_ip) => client.post("/license-server/verify", { license_key, server_ip }).then(r => r.data),
  licenseServerRevoke: (license_key, reason) => client.post("/license-server/revoke", { license_key, reason }).then(r => r.data),

  // Reseller portal
  resellerRegister: (payload) => client.post("/reseller/auth/register", payload).then(r => r.data),
  resellerLogin: (payload) => client.post("/reseller/auth/login", payload).then(r => r.data),
  resellerMe: (token) => client.get("/reseller/me", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  resellerAddSub: (token, payload) => client.post("/reseller/subaccounts", payload, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  resellerDelSub: (token, id) => client.delete(`/reseller/subaccounts/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  resellerQuarantine: (token) => client.get("/reseller/quarantine", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  resellerLists: (token) => client.get("/reseller/lists", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  resellerAddList: (token, payload) => client.post("/reseller/lists", payload, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  resellerDelList: (token, id) => client.delete(`/reseller/lists/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  resellerInvoices: (token) => client.get("/reseller/invoices", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.data),
  resellerInvoicePdfUrl: (token, tx_id) => `${API}/reseller/invoices/${tx_id}/pdf`,
  resellerInvoicePdfBlob: (token, tx_id, lang = "tr") => client.get(`/reseller/invoices/${tx_id}/pdf`, { params: { lang }, headers: { Authorization: `Bearer ${token}` }, responseType: "blob" }).then(r => r.data),

  // Plugin download + install info
  pluginInstallInfo: (license_key) => client.get("/plugin/install-info", { params: license_key ? { license_key } : {} }).then(r => r.data),
  pluginDownloadUrl: () => `${API}/plugin/download`,

  // Plugin upgrade
  pluginUpgrade: () => client.post("/plugin/upgrade").then(r => r.data),

  scanTest: (payload) => client.post("/scan/test", payload).then(r => r.data),

  // Queue management (Exim)
  queueList: (licenseKey, opts = {}) =>
    client.get("/queue", { params: { license_key: licenseKey, limit: 100, ...opts } }).then(r => r.data),
  queueStats: (licenseKey) =>
    client.get("/queue/stats", { params: { license_key: licenseKey } }).then(r => r.data),
  queueBulk: (licenseKey, mids, action, forwardTo = null) =>
    client.post("/queue/bulk", { license_key: licenseKey, mids, action, forward_to: forwardTo }).then(r => r.data),
  queueAudit: (licenseKey) =>
    client.get("/queue/audit", { params: { license_key: licenseKey, limit: 50 } }).then(r => r.data),

  // Attack map + IP drilldown + geo lookup
  attackMap: (licenseKey, hours = 1) =>
    client.get("/security/attack-map", { params: { license_key: licenseKey, hours } }).then(r => r.data),
  ipDrilldown: (licenseKey, ip) =>
    client.get("/security/ip-drilldown", { params: { license_key: licenseKey, ip } }).then(r => r.data),
  geoLookup: (ip) =>
    client.get("/geo/lookup", { params: { ip } }).then(r => r.data),

  // Exploit scanner
  exploitRun: (licenseKey, rootPath = "/var/www") =>
    client.post(`/security/exploit-scan/run?license_key=${encodeURIComponent(licenseKey)}&root_path=${encodeURIComponent(rootPath)}`).then(r => r.data),
  exploitLatest: (licenseKey) =>
    client.get("/security/exploit-scan/latest", { params: { license_key: licenseKey } }).then(r => r.data),
  exploitScans: (licenseKey) =>
    client.get("/security/exploit-scan/scans", { params: { license_key: licenseKey } }).then(r => r.data),
  exploitFindings: (licenseKey, filters = {}) =>
    client.get("/security/exploit-scan/findings", { params: { license_key: licenseKey, ...filters } }).then(r => r.data),
  exploitDismiss: (licenseKey, findingId) =>
    client.post(`/security/exploit-scan/dismiss/${findingId}`, null, { params: { license_key: licenseKey } }).then(r => r.data),
  exploitSignatures: () => client.get("/security/exploit-scan/signatures").then(r => r.data),

  // MailScanner independent module
  msConfig: (licenseKey) =>
    client.get("/mailscanner/config", { params: { license_key: licenseKey } }).then(r => r.data),
  msConfigPut: (licenseKey, payload) =>
    client.put("/mailscanner/config", { license_key: licenseKey, ...payload }).then(r => r.data),
  msStats: (licenseKey, hours = 24) =>
    client.get("/mailscanner/stats", { params: { license_key: licenseKey, hours } }).then(r => r.data),
  msRules: (licenseKey) =>
    client.get("/mailscanner/rules", { params: { license_key: licenseKey } }).then(r => r.data),
  msRuleUpsert: (licenseKey, rule) =>
    client.post("/mailscanner/rules", { license_key: licenseKey, ...rule }).then(r => r.data),
  msRuleDelete: (licenseKey, ruleId) =>
    client.delete(`/mailscanner/rules/${ruleId}`, { params: { license_key: licenseKey } }).then(r => r.data),
  msPolicies: (licenseKey) =>
    client.get("/mailscanner/user-policy", { params: { license_key: licenseKey } }).then(r => r.data),
  msPolicyPut: (licenseKey, payload) =>
    client.put("/mailscanner/user-policy", { license_key: licenseKey, ...payload }).then(r => r.data),
  msBayesTrain: (licenseKey, label, samples) =>
    client.post("/mailscanner/train-bayes", { license_key: licenseKey, label, samples }).then(r => r.data),
  msBayesStatus: (licenseKey) =>
    client.get("/mailscanner/bayes-status", { params: { license_key: licenseKey } }).then(r => r.data),
  msHealth: () => client.get("/mailscanner/health").then(r => r.data),
  msModules: (licenseKey) =>
    client.get("/mailscanner/modules", { params: { license_key: licenseKey } }).then(r => r.data),
  msAiAnalyze: (licenseKey) =>
    llmClient.post("/mailscanner/ai/analyze", null, { params: { license_key: licenseKey } }).then(r => r.data),

  // AI Self-training
  msSelfTrainRun: () => llmClient.post("/mailscanner/ai/self-train/run").then(r => r.data),
  msSelfTrainLog: (limit = 30) => client.get("/mailscanner/ai/self-train/log", { params: { limit } }).then(r => r.data),
  msSuggestions: (licenseKey, applied = false) =>
    client.get("/mailscanner/ai/self-train/suggestions", { params: { license_key: licenseKey, applied } }).then(r => r.data),
  msSuggestionApply: (licenseKey, id) =>
    client.post(`/mailscanner/ai/self-train/apply/${id}`, null, { params: { license_key: licenseKey } }).then(r => r.data),
  msSuggestionReject: (licenseKey, id) =>
    client.post(`/mailscanner/ai/self-train/reject/${id}`, null, { params: { license_key: licenseKey } }).then(r => r.data),

  // Docs Media upload
  docsMediaList: (moduleKey = null) =>
    client.get("/mailscanner/docs/media", { params: moduleKey ? { module_key: moduleKey } : {} }).then(r => r.data),
  docsMediaUpload: async (moduleKey, file, caption = "") => {
    const reader = new FileReader();
    const b64 = await new Promise((res, rej) => {
      reader.onload = () => res(String(reader.result).split(",")[1] || "");
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    return client.post("/mailscanner/docs/media", {
      module_key: moduleKey, filename: file.name,
      content_type: file.type, data_b64: b64, caption,
    }).then(r => r.data);
  },
  docsMediaDelete: (id) =>
    client.delete(`/mailscanner/docs/media/${id}`).then(r => r.data),

  // Module AI Assistant
  moduleAsk: (payload) => llmClient.post("/mailscanner/ai/module-ask", payload).then(r => r.data),
  moduleIllustrate: (payload) => llmClient.post("/mailscanner/ai/module-illustrate", payload).then(r => r.data),
  moduleQaLog: (moduleKey) => client.get("/mailscanner/ai/module-qa-log", { params: moduleKey ? { module_key: moduleKey } : {} }).then(r => r.data),

  // Threat Intelligence
  tiIocList: (opts = {}) => client.get("/threat-intel/ioc", { params: opts }).then(r => r.data),
  tiIocAdd: (payload) => client.post("/threat-intel/ioc", payload).then(r => r.data),
  tiIocDelete: (id) => client.delete(`/threat-intel/ioc/${id}`).then(r => r.data),
  tiDmarcSummary: (days = 30) => client.get("/threat-intel/dmarc/summary", { params: { days } }).then(r => r.data),
  tiDmarcIngest: (payload) => client.post("/threat-intel/dmarc/ingest", payload).then(r => r.data),
  tiFeeds: () => client.get("/threat-intel/feeds").then(r => r.data),
  tiFeedSync: (key) => client.post(`/threat-intel/feeds/${key}/sync`).then(r => r.data),
  tiCompliance: () => client.get("/threat-intel/compliance").then(r => r.data),
  tiComplianceToggle: (payload) => client.post("/threat-intel/compliance/toggle", payload).then(r => r.data),

  // RBL + Mail Health + Update
  rblProviders: () => client.get("/threat-intel/rbl/providers").then(r => r.data),
  rblCheck: (ip) => client.post("/threat-intel/rbl/check", { ip }).then(r => r.data),
  rblDelist: (payload) => client.post("/threat-intel/rbl/delist", payload).then(r => r.data),
  rblDelistAll: (payload) => client.post("/threat-intel/rbl/delist-all", payload).then(r => r.data),
  mailHealth: (domain) => client.post("/threat-intel/mail/health-check", { domain }).then(r => r.data),
  updateCheck: (version) => client.get("/threat-intel/update/check", { params: { version } }).then(r => r.data),
  updateVersions: () => client.get("/threat-intel/update/versions").then(r => r.data),

  // AI Predict Score (ingest-time) + AI Docs Narration
  msPredictScore: (payload, useLlm = false) =>
    llmClient.post("/mailscanner/ai/predict-score", payload, { params: { use_llm: useLlm } }).then(r => r.data),
  msDocsNarrate: (payload) =>
    llmClient.post("/mailscanner/ai/docs-narrate", payload).then(r => r.data),

  // Weekly report test email
  weeklyMailTest: () => client.post("/settings/smtp/test-weekly").then(r => r.data),

  // BEC / URL / Sandbox / Reputation / SIEM
  msBecCheck: (licenseKey, payload) =>
    client.post("/mailscanner/bec/check", { license_key: licenseKey, ...payload }).then(r => r.data),
  msUrlRewrite: (licenseKey, urls) =>
    client.post("/mailscanner/url/rewrite", { license_key: licenseKey, urls }).then(r => r.data),
  msUrlInspect: (token) =>
    client.get("/mailscanner/url/inspect", { params: { token } }).then(r => r.data),
  msSandboxSubmit: (licenseKey, payload) =>
    client.post("/mailscanner/sandbox/submit", { license_key: licenseKey, ...payload }).then(r => r.data),
  msSandboxJobs: (licenseKey) =>
    client.get("/mailscanner/sandbox/jobs", { params: { license_key: licenseKey } }).then(r => r.data),
  msReputation: (licenseKey) =>
    client.get("/mailscanner/reputation", { params: { license_key: licenseKey } }).then(r => r.data),
  msSiemExport: (licenseKey, format = "cef", hours = 24) =>
    client.post("/mailscanner/siem/export", { license_key: licenseKey, format, hours }, { responseType: "text" }).then(r => r.data),

  // AI weekly report
  aiWeeklyRun: (licenseKey) =>
    client.post("/ai/weekly-report/run", null,
                { params: licenseKey ? { license_key: licenseKey } : {}, withCredentials: true }).then(r => r.data),
  aiWeeklyLatest: () => client.get("/ai/weekly-report/latest").then(r => r.data),
  aiWeeklyList: () => client.get("/ai/weekly-report/list").then(r => r.data),

  // Maintenance: DB usage + cleanup + IP block
  dbUsage: () => client.get("/maintenance/db-usage").then(r => r.data),
  dbCleanup: (payload) => client.post("/maintenance/cleanup", payload).then(r => r.data),
  cleanupLog: () => client.get("/maintenance/cleanup-log").then(r => r.data),
  ipBlock: (payload) => client.post("/maintenance/ip/block", payload).then(r => r.data),
  ipUnblock: (payload) => client.post("/maintenance/ip/unblock", payload).then(r => r.data),
  ipWhitelist: (payload) => client.post("/maintenance/ip/whitelist", payload).then(r => r.data),
  ipStatus: (ip) => client.get("/maintenance/ip/status", { params: { ip } }).then(r => r.data),

  // Payments: PayTR + Havale
  paymentConfig: () => client.get("/payments/config").then(r => r.data),
  paytrCreate: (payload) => client.post("/payments/paytr/create", payload).then(r => r.data),
  havaleCreate: (payload) => client.post("/payments/havale/create", payload).then(r => r.data),
  havaleApprove: (payload) => client.post("/payments/havale/approve", payload).then(r => r.data),
  havaleReject: (payload) => client.post("/payments/havale/reject", payload).then(r => r.data),
  havaleNotify: (payload) => client.post("/payments/havale/notify", payload).then(r => r.data),
  paymentOrders: (params = {}) => client.get("/payments/orders", { params }).then(r => r.data),
  paymentOrder: (mid) => client.get(`/payments/order/${mid}`).then(r => r.data),
  adminPendingHavale: () => client.get("/payments/admin/pending").then(r => r.data),
  adminInbox: (params = {}) => client.get("/payments/admin/inbox", { params }).then(r => r.data),
  adminInboxRead: (nid) => client.post(`/payments/admin/inbox/${nid}/read`).then(r => r.data),

  // Auto-cleanup cron config + geo heatmap
  getAutoCleanup: () => client.get("/maintenance/auto-cleanup").then(r => r.data),
  setAutoCleanup: (cfg) => client.post("/maintenance/auto-cleanup", cfg).then(r => r.data),
  runAutoCleanupNow: () => client.post("/maintenance/auto-cleanup/run-now").then(r => r.data),
  geoBlockedHeatmap: () => client.get("/maintenance/geo/blocked-heatmap").then(r => r.data),
  geoCountryDetail: (cc, limit = 50) =>
    client.get("/maintenance/geo/country-detail", { params: { cc, limit } }).then(r => r.data),
  trustSnapshot: (score, findings, rblListed) =>
    client.post("/maintenance/trust-score/snapshot", null,
                { params: { score, findings, rbl_listed: rblListed } }).then(r => r.data),
  trustHistory: (days = 30) =>
    client.get("/maintenance/trust-score/history", { params: { days } }).then(r => r.data),
  publicBlockedStats: (region = "all") =>
    client.get("/maintenance/public/blocked-stats", { params: { region } }).then(r => r.data),
  publicSalesToday: () =>
    client.get("/maintenance/public/sales-today").then(r => r.data),

  // Whitelist management
  whitelistList: () => client.get("/maintenance/whitelist/list").then(r => r.data),
  whitelistRemove: (ip) => client.post("/maintenance/whitelist/remove", { ip }).then(r => r.data),

  // Master / reseller admin
  smartPosProviders: () => client.get("/smart-pos/providers").then(r => r.data),
  smartPosRoute: (payload) => client.post("/smart-pos/route", payload).then(r => r.data),
  smartPosStats: () => client.get("/smart-pos/stats").then(r => r.data),
  smartPosGetConfig: (key) => client.get(`/smart-pos/provider/${key}/config`).then(r => r.data),
  smartPosSetConfig: (key, payload) => client.post(`/smart-pos/provider/${key}/config`, payload).then(r => r.data),
  smartPosTestConfig: (key) => client.post(`/smart-pos/provider/${key}/test`).then(r => r.data),
  smartPosGetInstallments: (key) => client.get(`/smart-pos/installments/${key}`).then(r => r.data),
  smartPosSetInstallments: (key, payload) => client.post(`/smart-pos/installments/${key}`, payload).then(r => r.data),
  smartPosCalcInstallments: (payload) => client.post(`/smart-pos/installments/calculate`, payload).then(r => r.data),
  havaleStatementMatch: (payload) => client.post("/payments/havale/statement-match", payload).then(r => r.data),

  masterCheck: () => client.get("/master/check").then(r => r.data),
  masterStatus: () => client.get("/master/status").then(r => r.data),
  masterHeartbeats: (limit = 100) =>
    client.get("/master/relay/heartbeats", { params: { limit } }).then(r => r.data),
  masterPublishVersion: (payload) =>
    client.post("/master/publish-version", payload).then(r => r.data),
  masterNotifyResellers: (payload) =>
    client.post("/master/notify-resellers", payload).then(r => r.data),
  masterReleases: () => client.get("/master/releases").then(r => r.data),
};
