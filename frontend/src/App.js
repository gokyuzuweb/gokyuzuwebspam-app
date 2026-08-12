import "@/App.css";
import React from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import {
  Activity, ShieldAlert, Inbox, ListChecks, Cpu, Settings2,
  Users, Terminal, PackageOpen, ArrowUpRight, GaugeCircle, Wrench,
  Bell, BellRing, FileText, Key, Radar, DollarSign, Home, Sparkles, SlidersHorizontal, Server, History, Mail,
  Bug, Filter, BookOpen, Globe, HeartPulse, HardDrive, BadgeCheck, Palette,
} from "lucide-react";
import { I18nProvider, useT, useI18n } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { PluginStatusStripe, LicenseGate } from "@/components/LicenseGate";
import RenewalBanner from "@/components/RenewalBanner";
import { ImpersonationBar } from "@/components/Impersonate";
import PushToastBridge from "@/components/PushToastBridge";
import BayiEventBridge from "@/components/BayiEventBridge";
import { useIsMaster } from "@/hooks/useIsMaster";
import { api } from "@/lib/api";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Quarantine from "@/pages/Quarantine";
import PluginHealth from "@/pages/PluginHealth";
import Lists from "@/pages/Lists";
import Rules from "@/pages/Rules";
import Engines from "@/pages/Engines";
import SettingsPage from "@/pages/Settings";
import UsersPage from "@/pages/Users";
import LogsPage from "@/pages/Logs";
import Outbound from "@/pages/Outbound";
import Install from "@/pages/Install";
import PublicInstall from "@/pages/PublicInstall";
import Notifications from "@/pages/Notifications";
import Reports from "@/pages/Reports";
import Licenses from "@/pages/Licenses";
import AlertsRules from "@/pages/AlertsRules";
import Pricing from "@/pages/Pricing";
import Shop, { CheckoutSuccess } from "@/pages/Shop";
import HavalePayment from "@/pages/HavalePayment";
import VersionPublish from "@/pages/VersionPublish";
import WakeHistory from "@/pages/WakeHistory";
import EmailTemplates from "@/pages/EmailTemplates";
import Blacklist from "@/pages/Blacklist";
import Reseller from "@/pages/Reseller";
import Security from "@/pages/Security";
import MailScanner from "@/pages/MailScanner";
import Docs from "@/pages/Docs";
import ThreatIntel from "@/pages/ThreatIntel";
import MailHealth from "@/pages/MailHealth";
import Maintenance from "@/pages/Maintenance";
import PaymentsAdmin from "@/pages/PaymentsAdmin";
import ResellersAdmin from "@/pages/ResellersAdmin";
import MasterLive from "@/pages/MasterLive";
import PlanAnalytics from "@/pages/PlanAnalytics";
import Subscription from "@/pages/Subscription";
import PlanConfig from "@/pages/PlanConfig";
import BayiServer from "@/pages/BayiServer";
import WhitelistHistory from "@/pages/WhitelistHistory";
import LandingCMS from "@/pages/LandingCMS";
import CommandPalette from "@/components/CommandPalette";
import Header from "@/components/Header";

const NAV = [
  { to: "/panel", key: "dashboard", icon: Activity, testid: "nav-dashboard", end: true },
  { to: "/panel/mailscanner", key: "mailscanner", icon: Filter, testid: "nav-mailscanner", label: "MailScanner" },
  { to: "/panel/mail-health", key: "mail_health", icon: HeartPulse, testid: "nav-mail-health", label: "Mail Sağlık" },
  { to: "/panel/threat-intel", key: "threat_intel", icon: Globe, testid: "nav-threat-intel", label: "Tehdit Zekası" },
  { to: "/panel/security", key: "security", icon: Bug, testid: "nav-security", label: "Güvenlik" },
  { to: "/panel/quarantine", key: "quarantine", icon: Inbox, testid: "nav-quarantine" },
  { to: "/panel/lists", key: "lists", icon: ListChecks, testid: "nav-lists" },
  { to: "/panel/blacklist", key: "blacklist", icon: Radar, testid: "nav-blacklist" },
  { to: "/panel/rules", key: "rules", icon: Wrench, testid: "nav-rules" },
  { to: "/panel/engines", key: "engines", icon: Cpu, testid: "nav-engines" },
  { to: "/panel/outbound", key: "outbound", icon: ArrowUpRight, testid: "nav-outbound" },
  { to: "/panel/notifications", key: "notifications", icon: Bell, testid: "nav-notifications" },
  { to: "/panel/alerts", key: "alerts", icon: BellRing, testid: "nav-alerts" },
  { to: "/panel/reports", key: "reports", icon: FileText, testid: "nav-reports" },
  { to: "/panel/licenses", key: "licenses", icon: Key, testid: "nav-licenses", sellerOnly: true, masterOnly: true },
  { to: "/panel/subscription", key: "subscription", icon: Sparkles, testid: "nav-subscription", label: "Aboneliğim" },
  { to: "/panel/my-server", key: "my_server", icon: Server, testid: "nav-my-server", label: "Sunucumu Bağla" },
  { to: "/panel/pricing", key: "pricing", icon: DollarSign, testid: "nav-pricing", sellerOnly: true, masterOnly: true },
  { to: "/panel/users", key: "users", icon: Users, testid: "nav-users" },
  { to: "/panel/logs", key: "logs", icon: Terminal, testid: "nav-logs" },
  { to: "/panel/settings", key: "settings", icon: Settings2, testid: "nav-settings" },
  { to: "/panel/maintenance", key: "maintenance", icon: HardDrive, testid: "nav-maintenance", label: "DB Bakım" },
  { to: "/panel/payments-admin", key: "payments_admin", icon: DollarSign, testid: "nav-payments-admin", label: "Ödeme Panosu" },
  { to: "/panel/resellers-admin", key: "resellers_admin", icon: Users, testid: "nav-resellers-admin", label: "Bayi Panosu" },
  { to: "/panel/master-live", key: "master_live", icon: Activity, testid: "nav-master-live", label: "Canlı Bayi Trafiği", masterOnly: true, sellerOnly: true },
  { to: "/panel/plan-analytics", key: "plan_analytics", icon: DollarSign, testid: "nav-plan-analytics", label: "Plan Analitiği", masterOnly: true, sellerOnly: true },
  { to: "/panel/plan-config", key: "plan_config", icon: SlidersHorizontal, testid: "nav-plan-config", label: "Plan Modül Yapıl.", masterOnly: true, sellerOnly: true },
  { to: "/panel/version-publish", key: "version_publish", icon: PackageOpen, testid: "nav-version-publish", label: "Sürüm Yayın", masterOnly: true, sellerOnly: true },
  { to: "/panel/wake-history", key: "wake_history", icon: History, testid: "nav-wake-history", label: "Ping Geçmişi", masterOnly: true, sellerOnly: true },
  { to: "/panel/email-templates", key: "email_templates", icon: Mail, testid: "nav-email-templates", label: "Mail Şablonları", masterOnly: true, sellerOnly: true },
  { to: "/panel/plugin-health", key: "plugin_health", icon: HeartPulse, testid: "nav-plugin-health", label: "Plugin Sağlık", masterOnly: true, sellerOnly: true },
  { to: "/panel/landing-cms", key: "landing_cms", icon: Palette, testid: "nav-landing-cms", label: "Landing CMS", masterOnly: true, sellerOnly: true },
  { to: "/panel/whitelist-history", key: "whitelist_history", icon: BadgeCheck, testid: "nav-whitelist-history", label: "Whitelist" },
  { to: "/panel/install", key: "install", icon: PackageOpen, testid: "nav-install" },
  { to: "/panel/docs", key: "docs", icon: BookOpen, testid: "nav-docs", label: "Modül Dokümantasyonu" },
];

function Sidebar() {
  const t = useT();
  const { effective } = useI18n();
  const mode = useQuery({ queryKey: ["system-mode"], queryFn: api.systemMode });
  const isSeller = mode.data?.mode === "seller";
  const { isMaster, clientIp, masterIp } = useIsMaster();
  const pendingPayments = useQuery({
    queryKey: ["sidebar-pending-havale"],
    queryFn: api.adminPendingHavale,
    refetchInterval: 15000,
    staleTime: 10000,
  });
  const pendingCount = pendingPayments.data?.notified_count || 0;
  const items = NAV.filter((n) => {
    if (n.sellerOnly && !isSeller) return false;
    if (n.masterOnly && !isMaster) return false;
    return true;
  });
  return (
    <aside data-testid="sidebar" className={`w-60 shrink-0 border-r border-slate-800 bg-slate-900/60 flex flex-col ${effective === "ar" ? "rtl" : ""}`}>
      <div className="h-14 flex items-center gap-2 px-3 border-b border-slate-800">
        <NavLink to="/" data-testid="sidebar-home" className="relative w-8 h-8 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center shrink-0" title="Home">
          <ShieldAlert className="w-4 h-4 text-white" />
        </NavLink>
        <div className="leading-tight min-w-0">
          <div className="text-slate-100 font-bold tracking-tight text-[15px] truncate">Gökyüzü<span className="text-indigo-400">WebSpam</span></div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mono">v1.3 · {effective.toUpperCase()}</div>
        </div>
      </div>
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        <NavLink
          to="/"
          data-testid="nav-home"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-500 hover:text-indigo-300 hover:bg-slate-800/60 border border-transparent transition-colors"
        >
          <Home className="w-4 h-4" strokeWidth={1.75} />
          <span>Home</span>
        </NavLink>
        <div className="h-px bg-slate-800/60 my-1.5" />
        {items.map((n) => {
          const showBadge = n.key === "payments_admin" && pendingCount > 0;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              data-testid={n.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors duration-150 ${
                  isActive
                    ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/30"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent"
                }`
              }
            >
              <n.icon className="w-4 h-4" strokeWidth={1.75} />
              <span className="flex-1">{n.label || t(`nav.${n.key}`)}</span>
              {showBadge && (
                <span
                  data-testid={`nav-badge-${n.key}`}
                  className="ml-auto shrink-0 mono text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white leading-none min-w-[18px] text-center animate-pulse"
                  title={`${pendingCount} bekleyen havale bildirimi`}
                >
                  {pendingCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-500 mono flex items-center gap-2" data-testid="sidebar-role-strip">
        <GaugeCircle className="w-3.5 h-3.5" />
        {isMaster ? (
          <>
            <span className="text-indigo-400">MASTER</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-400">{masterIp}</span>
          </>
        ) : (
          <>
            <span className={isSeller ? "text-amber-400" : "text-emerald-400"}>
              {isSeller ? "SELLER" : "CUSTOMER"}
            </span>
            {clientIp && <><span className="text-slate-600">·</span><span className="truncate max-w-[80px]">{clientIp}</span></>}
          </>
        )}
      </div>
    </aside>
  );
}

function Shell() {
  const loc = useLocation();
  const t = useT();
  const active = NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PluginStatusStripe />
        <ImpersonationBar />
        <PushToastBridge />
        <BayiEventBridge />
        <RenewalBanner />
        <Header title={active ? (active.label || t(`nav.${active.key}`)) : "GökyüzüWebSpam"} />
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/security" element={<Security />} />
            <Route path="/mailscanner" element={<MailScanner />} />
            <Route path="/threat-intel" element={<ThreatIntel />} />
            <Route path="/mail-health" element={<MailHealth />} />
            <Route path="/maintenance" element={<Maintenance />} />
            <Route path="/payments-admin" element={<PaymentsAdmin />} />
            <Route path="/resellers-admin" element={<ResellersAdmin />} />
            <Route path="/master-live" element={<MasterLive />} />
            <Route path="/plan-analytics" element={<PlanAnalytics />} />
            <Route path="/plan-config" element={<PlanConfig />} />
            <Route path="/subscription" element={<Subscription />} />
            <Route path="/payment/havale" element={<HavalePayment />} />
            <Route path="/version-publish" element={<VersionPublish />} />
            <Route path="/wake-history" element={<WakeHistory />} />
            <Route path="/email-templates" element={<EmailTemplates />} />
            <Route path="/plugin-health" element={<PluginHealth />} />
            <Route path="/landing-cms" element={<LandingCMS />} />
            <Route path="/my-server" element={<BayiServer />} />
            <Route path="/whitelist-history" element={<WhitelistHistory />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/quarantine" element={<Quarantine />} />
            <Route path="/lists" element={<Lists />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/engines" element={<Engines />} />
            <Route path="/outbound" element={<Outbound />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/alerts" element={<AlertsRules />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/licenses" element={<Licenses />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/blacklist" element={<Blacklist />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/install" element={<Install />} />
            <Route path="*" element={<Navigate to="/panel" replace />} />
          </Routes>
        </main>
      </div>
      {/* v43.10 Panel-wide Cmd+K Command Palette */}
      <CommandPalette />
    </div>
  );
}

export default function App() {
  // WHM CGI iframe'inden gelen ?master_key=... parametresini yakalayıp localStorage'a yaz
  // Bu sayede WHM'e root erişimi olan kullanıcı otomatik olarak master modunda görünür
  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const mk = params.get("master_key");
      if (mk && mk.startsWith("MS-")) {
        localStorage.setItem("gws.event_license", mk);
        localStorage.setItem("gws.master_license", mk);
        // URL'den anahtarı temizle (tarayıcı adres çubuğunda görünmesin)
        params.delete("master_key");
        const cleanUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
        window.history.replaceState({}, "", cleanUrl);
      }
    } catch (_) {}
  }, []);
  return (
    <div className="App">
      <I18nProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/checkout/success" element={<CheckoutSuccess />} />
            <Route path="/reseller" element={<Reseller />} />
            <Route path="/install" element={<PublicInstall />} />
            <Route path="/panel/*" element={<><Shell /><LicenseGate /></>} />
            {/* Legacy redirects — old panel URLs → /panel */}
            <Route path="/quarantine" element={<Navigate to="/panel/quarantine" replace />} />
            <Route path="/lists" element={<Navigate to="/panel/lists" replace />} />
            <Route path="/blacklist" element={<Navigate to="/panel/blacklist" replace />} />
            <Route path="/rules" element={<Navigate to="/panel/rules" replace />} />
            <Route path="/engines" element={<Navigate to="/panel/engines" replace />} />
            <Route path="/outbound" element={<Navigate to="/panel/outbound" replace />} />
            <Route path="/notifications" element={<Navigate to="/panel/notifications" replace />} />
            <Route path="/reports" element={<Navigate to="/panel/reports" replace />} />
            <Route path="/licenses" element={<Navigate to="/panel/licenses" replace />} />
            <Route path="/pricing" element={<Navigate to="/panel/pricing" replace />} />
            <Route path="/users" element={<Navigate to="/panel/users" replace />} />
            <Route path="/logs" element={<Navigate to="/panel/logs" replace />} />
            <Route path="/settings" element={<Navigate to="/panel/settings" replace />} />
            <Route path="/install" element={<Navigate to="/panel/install" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#0f172a",
                border: "1px solid #1e293b",
                color: "#e2e8f0",
              },
            }}
          />
        </BrowserRouter>
      </I18nProvider>
    </div>
  );
}
