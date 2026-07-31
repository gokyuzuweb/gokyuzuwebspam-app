import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API, timeout: 20000 });
// LLM-backed endpoints can take 30-60s (Claude / GPT / Gemini reasoning)
const llmClient = axios.create({ baseURL: API, timeout: 90000 });

export const api = {
  overview: () => client.get("/stats/overview").then(r => r.data),
  traffic: (hours = 24) => client.get(`/stats/traffic?hours=${hours}`).then(r => r.data),
  topSenders: () => client.get("/stats/top-senders").then(r => r.data),

  // SaaS live mail events (from remote milter POST /api/events/ingest)
  liveEvents: (licenseKey, limit = 25, scopeUser = null) =>
    client.get("/events", { params: {
      license_key: licenseKey, limit,
      ...(scopeUser ? { scope_user: scopeUser } : {}),
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
};
