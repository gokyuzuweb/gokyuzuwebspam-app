import "@/App.css";
import React from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import {
  Activity, ShieldAlert, Inbox, ListChecks, Cpu, Settings2,
  Users, Terminal, PackageOpen, ArrowUpRight, GaugeCircle, Wrench,
  Bell, BellRing, FileText, Key, Radar, DollarSign, Home, Sparkles, SlidersHorizontal, Server, History, Mail,
  Bug, Filter, BookOpen, Globe, HeartPulse, HardDrive, BadgeCheck, Palette, Store, MailX, Stethoscope,
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
import Marketplace from "@/pages/Marketplace";
import BounceDigest from "@/pages/BounceDigest";
import LiveDiagnostic from "@/pages/LiveDiagnostic";
import CustomDomainGuide from "@/pages/CustomDomainGuide";
import AuditLog from "@/pages/AuditLog";
import SmtpSettings from "@/pages/SmtpSettings";
import MasterOnlyGuard from "@/components/MasterOnlyGuard";

// v43.67 — Master-only sayfa wrapper'ları (URL'ye direkt yazan bayilere karşı defense-in-depth)
const MO = (Component, title) => <MasterOnlyGuard pageTitle={title}><Component /></MasterOnlyGuard>;
import CommandPalette from "@/components/CommandPalette";
import Header from "@/components/Header";

const NAV = [
  // 📊 İZLEME
  { to: "/panel", key: "dashboard", icon: Activity, testid: "nav-dashboard", end: true, group: "izleme" },
  { to: "/panel/mailscanner", key: "mailscanner", icon: Filter, testid: "nav-mailscanner", label: "MailScanner", group: "izleme" },
  { to: "/panel/mail-health", key: "mail_health", icon: HeartPulse, testid: "nav-mail-health", label: "Mail Sağlık", group: "izleme" },
  { to: "/panel/threat-intel", key: "threat_intel", icon: Globe, testid: "nav-threat-intel", label: "Tehdit Zekası", group: "izleme" },
  { to: "/panel/marketplace", key: "marketplace", icon: Store, testid: "nav-marketplace", label: "İmza Marketplace", group: "koruma" },
  { to: "/panel/bounce-digest", key: "bounce_digest", icon: MailX, testid: "nav-bounce-digest", label: "Bounce Digest", group: "izleme" },
  { to: "/panel/live-diagnostic", key: "live_diagnostic", icon: Stethoscope, testid: "nav-live-diagnostic", label: "Canlı Sunucu Tanı", group: "sistem" },
  { to: "/panel/master-live", key: "master_live", icon: Activity, testid: "nav-master-live", label: "Canlı Bayi Trafiği", masterOnly: true, sellerOnly: true, group: "izleme" },
  // 🛡️ KORUMA
  { to: "/panel/quarantine", key: "quarantine", icon: Inbox, testid: "nav-quarantine", group: "koruma" },
  { to: "/panel/lists", key: "lists", icon: ListChecks, testid: "nav-lists", label: "Kara/Beyaz Liste", group: "koruma" },
  { to: "/panel/blacklist", key: "blacklist", icon: Radar, testid: "nav-blacklist", label: "IP Blacklist Çıkışı", group: "koruma" },
  { to: "/panel/rules", key: "rules", icon: Wrench, testid: "nav-rules", label: "Kurallar", group: "koruma" },
  { to: "/panel/engines", key: "engines", icon: Cpu, testid: "nav-engines", label: "Motorlar", group: "koruma" },
  { to: "/panel/security", key: "security", icon: Bug, testid: "nav-security", label: "Güvenlik", group: "koruma" },
  // 📨 POSTA
  { to: "/panel/outbound", key: "outbound", icon: ArrowUpRight, testid: "nav-outbound", label: "Giden Posta", group: "posta" },
  { to: "/panel/whitelist-history", key: "whitelist_history", icon: BadgeCheck, testid: "nav-whitelist-history", label: "Whitelist Geçmişi", group: "posta" },
  // 👥 KULLANICILAR & BAYİ
  { to: "/panel/users", key: "users", icon: Users, testid: "nav-users", label: "Kullanıcılar", group: "user" },
  { to: "/panel/resellers-admin", key: "resellers_admin", icon: Users, testid: "nav-resellers-admin", label: "Bayi Yönetimi", masterOnly: true, sellerOnly: true, group: "user" },
  { to: "/panel/licenses", key: "licenses", icon: Key, testid: "nav-licenses", label: "Lisanslar", sellerOnly: true, masterOnly: true, group: "user" },
  { to: "/panel/subscription", key: "subscription", icon: Sparkles, testid: "nav-subscription", label: "Aboneliğim", group: "user" },
  // 💰 SATIŞ & ÖDEME
  { to: "/panel/pricing", key: "pricing", icon: DollarSign, testid: "nav-pricing", label: "Fiyatlandırma", sellerOnly: true, masterOnly: true, group: "sales" },
  { to: "/panel/payments-admin", key: "payments_admin", icon: DollarSign, testid: "nav-payments-admin", label: "Ödeme Panosu", masterOnly: true, sellerOnly: true, group: "sales" },
  { to: "/panel/plan-analytics", key: "plan_analytics", icon: DollarSign, testid: "nav-plan-analytics", label: "Plan Analitiği", masterOnly: true, sellerOnly: true, group: "sales" },
  // 🔔 BİLDİRİM & RAPOR
  { to: "/panel/notifications", key: "notifications", icon: Bell, testid: "nav-notifications", label: "Bildirim Kutusu", group: "bildirim" },
  { to: "/panel/alerts", key: "alerts", icon: BellRing, testid: "nav-alerts", label: "Alarm Kuralları", group: "bildirim" },
  { to: "/panel/reports", key: "reports", icon: FileText, testid: "nav-reports", label: "Raporlar", group: "bildirim" },
  { to: "/panel/email-templates", key: "email_templates", icon: Mail, testid: "nav-email-templates", label: "Mail Şablonları", masterOnly: true, sellerOnly: true, group: "bildirim" },
  // 🎨 MASTER YÖNETİM
  { to: "/panel/landing-cms", key: "landing_cms", icon: Palette, testid: "nav-landing-cms", label: "Landing CMS", masterOnly: true, sellerOnly: true, group: "master" },
  { to: "/panel/plan-config", key: "plan_config", icon: SlidersHorizontal, testid: "nav-plan-config", label: "Plan Modülleri", masterOnly: true, sellerOnly: true, group: "master" },
  { to: "/panel/version-publish", key: "version_publish", icon: PackageOpen, testid: "nav-version-publish", label: "Sürüm Yayınla", masterOnly: true, sellerOnly: true, group: "master" },
  { to: "/panel/plugin-health", key: "plugin_health", icon: HeartPulse, testid: "nav-plugin-health", label: "Plugin Sağlığı", masterOnly: true, sellerOnly: true, group: "master" },
  { to: "/panel/wake-history", key: "wake_history", icon: History, testid: "nav-wake-history", label: "Ping Geçmişi", masterOnly: true, sellerOnly: true, group: "master" },
  { to: "/panel/audit-log", key: "audit_log", icon: ShieldAlert, testid: "nav-audit-log", label: "Audit Log", masterOnly: true, sellerOnly: true, group: "master" },
  // 🔧 SİSTEM
  { to: "/panel/my-server", key: "my_server", icon: Server, testid: "nav-my-server", label: "Sunucumu Bağla", group: "sistem" },
  { to: "/panel/smtp-settings", key: "smtp_settings", icon: Mail, testid: "nav-smtp", label: "Mail (SMTP)", group: "sistem" },
  { to: "/panel/logs", key: "logs", icon: Terminal, testid: "nav-logs", label: "Loglar", masterOnly: true, sellerOnly: true, group: "sistem" },
  { to: "/panel/maintenance", key: "maintenance", icon: HardDrive, testid: "nav-maintenance", label: "DB Bakım", masterOnly: true, sellerOnly: true, group: "sistem" },
  { to: "/panel/settings", key: "settings", icon: Settings2, testid: "nav-settings", label: "Ayarlar", masterOnly: true, sellerOnly: true, group: "sistem" },
  { to: "/panel/install", key: "install", icon: PackageOpen, testid: "nav-install", label: "Kurulum", masterOnly: true, sellerOnly: true, group: "sistem" },
  { to: "/panel/docs", key: "docs", icon: BookOpen, testid: "nav-docs", label: "Dokümantasyon", group: "sistem" },
  { to: "/panel/custom-domain", key: "custom_domain", icon: Globe, testid: "nav-custom-domain", label: "Kendi Domain'im", masterOnly: true, sellerOnly: true, group: "sistem" },
];

const NAV_GROUPS = [
  { key: "izleme",   label: "İzleme",           icon: "📊" },
  { key: "koruma",   label: "Koruma",           icon: "🛡" },
  { key: "posta",    label: "Posta",            icon: "📨" },
  { key: "user",     label: "Kullanıcı & Bayi", icon: "👥" },
  { key: "sales",    label: "Satış & Ödeme",    icon: "💰" },
  { key: "bildirim", label: "Bildirim & Rapor", icon: "🔔" },
  { key: "master",   label: "Master Yönetim",   icon: "🎨" },
  { key: "sistem",   label: "Sistem",           icon: "🔧" },
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
  // v43.27 — Multi-open akordiyon: state artık Set of open group keys.
  // - Click on group → toggle (birden fazla açık olabilir)
  // - "Hepsini Aç" → tüm gruplar
  // - "Hepsini Kapat" → boş set
  const [openGroups, setOpenGroups] = React.useState(() => {
    try {
      const raw = localStorage.getItem("gws.sidebar.openGroups");
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
      // Backwards compat: eski `openGroup` string tercihi varsa import et
      const legacy = localStorage.getItem("gws.sidebar.openGroup");
      if (legacy) return new Set([legacy]);
    } catch {}
    return new Set(["izleme"]);
  });
  const persistOpenGroups = (next) => {
    try { localStorage.setItem("gws.sidebar.openGroups", JSON.stringify([...next])); } catch {}
  };
  const toggleGroup = (key) => {
    const next = new Set(openGroups);
    if (next.has(key)) next.delete(key); else next.add(key);
    setOpenGroups(next);
    persistOpenGroups(next);
  };
  const collapseAll = () => {
    const next = new Set();
    setOpenGroups(next);
    persistOpenGroups(next);
  };
  const expandAll = () => {
    const next = new Set(NAV_GROUPS.map((g) => g.key));
    setOpenGroups(next);
    persistOpenGroups(next);
  };
  const anyOpen = openGroups.size > 0;
  const allOpen = openGroups.size >= NAV_GROUPS.length;
  const items = NAV.filter((n) => {
    if (n.sellerOnly && !isSeller) return false;
    if (n.masterOnly && !isMaster) return false;
    return true;
  });
  // v43.21 — grup bazlı bölütleme (NAV_GROUPS sırasına uygun)
  const grouped = NAV_GROUPS.map((g) => ({
    ...g,
    items: items.filter((n) => n.group === g.key),
  })).filter((g) => g.items.length > 0);
  const ungrouped = items.filter((n) => !n.group);

  return (
    <aside data-testid="sidebar" className={`w-60 shrink-0 border-r border-slate-800/80 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900/60 backdrop-blur flex flex-col ${effective === "ar" ? "rtl" : ""}`}>
      <div className="h-14 flex items-center gap-2 px-3 border-b border-slate-800/80">
        <NavLink to="/" data-testid="sidebar-home" className="relative w-8 h-8 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/20 ring-1 ring-white/10" title="Home">
          <ShieldAlert className="w-4 h-4 text-white" />
        </NavLink>
        <div className="leading-tight min-w-0">
          <div className="text-slate-100 font-bold tracking-tight text-[15px] truncate">Gökyüzü<span className="text-indigo-400">WebSpam</span></div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mono">v1.3 · {effective.toUpperCase()}</div>
        </div>
      </div>
      <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto sidebar-scroll">
        <NavLink
          to="/"
          data-testid="nav-home"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-500 hover:text-indigo-300 hover:bg-slate-800/60 border border-transparent transition-colors"
        >
          <Home className="w-4 h-4" strokeWidth={1.75} />
          <span>Home</span>
        </NavLink>
        {openGroups.size > 0 && !allOpen && (
          <button
            type="button"
            onClick={expandAll}
            data-testid="nav-expand-all"
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] text-slate-500 hover:text-indigo-300 hover:bg-indigo-500/5 border border-transparent hover:border-indigo-500/20 transition-colors"
            title="Tüm menü gruplarını aç"
          >
            <span className="text-xs">▼</span>
            <span>Hepsini Aç</span>
          </button>
        )}
        {openGroups.size === 0 && (
          <button
            type="button"
            onClick={expandAll}
            data-testid="nav-expand-all"
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] text-indigo-400 hover:text-indigo-200 bg-indigo-500/5 hover:bg-indigo-500/10 border border-indigo-500/20 hover:border-indigo-500/40 transition-colors font-semibold"
            title="Tüm menü gruplarını aç"
          >
            <span className="text-xs">▼</span>
            <span>Hepsini Aç</span>
          </button>
        )}
        {anyOpen && (
          <button
            type="button"
            onClick={collapseAll}
            data-testid="nav-collapse-all"
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] text-slate-500 hover:text-rose-300 hover:bg-rose-500/5 border border-transparent hover:border-rose-500/20 transition-colors"
            title="Tüm menü gruplarını kapat"
          >
            <span className="text-xs">✕</span>
            <span>Hepsini Kapat</span>
          </button>
        )}
        <div className="h-px bg-slate-800/60 my-2" />
        {grouped.map((g, gi) => {
          const isCollapsed = !openGroups.has(g.key);
          return (
            <div key={g.key} className={gi > 0 ? "pt-3" : ""} data-testid={`nav-group-${g.key}`}>
              <button
                type="button"
                onClick={() => toggleGroup(g.key)}
                data-testid={`nav-group-toggle-${g.key}`}
                className={`w-full px-2.5 py-2 mb-1 flex items-center gap-2 rounded-md text-[11px] uppercase tracking-[0.14em] font-black select-none transition-all duration-200 group ${
                  isCollapsed
                    ? "text-slate-400 hover:text-indigo-200 hover:bg-slate-800/40 border border-transparent hover:border-indigo-500/20"
                    : "text-indigo-200 bg-gradient-to-r from-indigo-500/15 via-slate-900/30 to-transparent border border-indigo-500/30 shadow-sm shadow-indigo-500/10"
                }`}
                title={isCollapsed ? "Aç" : "Kapat"}
              >
                <span className={`inline-flex items-center justify-center w-4 h-4 rounded transition-all duration-200 ${
                  isCollapsed
                    ? "text-slate-600 group-hover:text-indigo-400"
                    : "text-indigo-300 rotate-90"
                }`}>▶</span>
                <span className="text-[13px] leading-none">{g.icon}</span>
                <span className="tracking-[0.14em]">{g.label}</span>
                <span className={`ml-auto mono text-[9.5px] px-1.5 py-0.5 rounded-full ${
                  isCollapsed
                    ? "bg-slate-800/60 text-slate-500"
                    : "bg-indigo-500/20 text-indigo-300"
                }`}>{g.items.length}</span>
              </button>
              <div className={`space-y-0.5 overflow-hidden transition-all duration-200 ${isCollapsed ? "max-h-0 opacity-0" : "max-h-[999px] opacity-100"}`}>
                {g.items.map((n) => {
                  const showBadge = n.key === "payments_admin" && pendingCount > 0;
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.end}
                      data-testid={n.testid}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-all duration-150 ${
                          isActive
                            ? "bg-gradient-to-r from-indigo-500/15 to-transparent text-indigo-200 border border-indigo-500/30 shadow-sm shadow-indigo-500/10"
                            : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent hover:border-slate-700/40"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.6)]" />}
                          <n.icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-indigo-300" : "text-slate-500 group-hover:text-slate-300"}`} strokeWidth={1.75} />
                          <span className="flex-1 truncate">{n.label || t(`nav.${n.key}`)}</span>
                          {showBadge && (
                            <span
                              data-testid={`nav-badge-${n.key}`}
                              className="ml-auto shrink-0 mono text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white leading-none min-w-[16px] text-center animate-pulse"
                              title={`${pendingCount} bekleyen havale bildirimi`}
                            >
                              {pendingCount}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
        {ungrouped.length > 0 && (
          <div className="pt-3">
            <div className="px-3 mb-1 text-[9.5px] uppercase tracking-[0.2em] font-bold text-slate-600 select-none">Diğer</div>
            {ungrouped.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} data-testid={n.testid}
                className={({ isActive }) => `flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] ${isActive ? "bg-indigo-500/10 text-indigo-300" : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"}`}>
                <n.icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span className="flex-1 truncate">{n.label || t(`nav.${n.key}`)}</span>
              </NavLink>
            ))}
          </div>
        )}
      </nav>
      <div className="px-4 py-3 border-t border-slate-800/80 text-[11px] text-slate-500 mono flex items-center gap-2 bg-slate-950/60" data-testid="sidebar-role-strip">
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
  // v43.19 — Iframe içindeysek h-screen (kesin viewport yüksekliği) kullan,
  // scroll SADECE <main>'de olsun. Standalone'da min-h-screen (uzayabilir).
  const [inFrame, setInFrame] = React.useState(false);
  React.useEffect(() => {
    try { setInFrame(window.top !== window.self); } catch (_) { setInFrame(true); }
  }, []);
  const rootCls = inFrame
    ? "flex h-screen max-h-screen bg-slate-950 text-slate-100 overflow-hidden"
    : "flex min-h-screen bg-slate-950 text-slate-100";
  const mainCls = inFrame
    ? "flex-1 min-w-0 overflow-x-hidden overflow-y-auto"
    : "flex-1 min-w-0 overflow-x-hidden";
  return (
    <div className={rootCls} data-testid={inFrame ? "shell-embedded" : "shell-standalone"}>
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PluginStatusStripe />
        <ImpersonationBar />
        <PushToastBridge />
        <BayiEventBridge />
        <RenewalBanner />
        <Header title={active ? (active.label || t(`nav.${active.key}`)) : "GökyüzüWebSpam"} />
        <main className={mainCls} data-testid="panel-main-scroll">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/security" element={<Security />} />
            <Route path="/mailscanner" element={<MailScanner />} />
            <Route path="/threat-intel" element={<ThreatIntel />} />
            <Route path="/mail-health" element={<MailHealth />} />
            <Route path="/maintenance" element={MO(Maintenance, "DB Bakım")} />
            <Route path="/payments-admin" element={MO(PaymentsAdmin, "Ödeme Yönetim Panosu")} />
            <Route path="/resellers-admin" element={MO(ResellersAdmin, "Bayi Yönetimi")} />
            <Route path="/master-live" element={MO(MasterLive, "Canlı Bayi Trafiği")} />
            <Route path="/plan-analytics" element={MO(PlanAnalytics, "Plan Analitiği")} />
            <Route path="/plan-config" element={MO(PlanConfig, "Plan Modülleri")} />
            <Route path="/subscription" element={<Subscription />} />
            <Route path="/payment/havale" element={<HavalePayment />} />
            <Route path="/version-publish" element={MO(VersionPublish, "Sürüm Yayınla")} />
            <Route path="/wake-history" element={MO(WakeHistory, "Ping Geçmişi")} />
            <Route path="/audit-log" element={MO(AuditLog, "Master Audit Log")} />
            <Route path="/email-templates" element={MO(EmailTemplates, "Mail Şablonları")} />
            <Route path="/plugin-health" element={MO(PluginHealth, "Plugin Sağlığı")} />
            <Route path="/landing-cms" element={MO(LandingCMS, "Landing CMS")} />
            <Route path="/my-server" element={<BayiServer />} />
            <Route path="/smtp-settings" element={<SmtpSettings />} />
            <Route path="/whitelist-history" element={<WhitelistHistory />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/custom-domain" element={MO(CustomDomainGuide, "Kendi Domain'im")} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/bounce-digest" element={<BounceDigest />} />
            <Route path="/live-diagnostic" element={<LiveDiagnostic />} />
            <Route path="/quarantine" element={<Quarantine />} />
            <Route path="/lists" element={<Lists />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/engines" element={<Engines />} />
            <Route path="/outbound" element={<Outbound />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/alerts" element={<AlertsRules />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/licenses" element={MO(Licenses, "Lisans Yönetimi")} />
            <Route path="/pricing" element={MO(Pricing, "Fiyatlandırma Yönetimi")} />
            <Route path="/blacklist" element={<Blacklist />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/logs" element={MO(LogsPage, "Sistem Logları")} />
            <Route path="/settings" element={MO(SettingsPage, "Global Ayarlar")} />
            <Route path="/install" element={MO(Install, "Kurulum")} />
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
  // v43.19 — Iframe detection + parent auto-resize + compact layout
  // WHM CGI (mailshield.cgi) SPA'yı iframe olarak yükler. Panel içeriği
  // uzun (~1500px) olduğu için kullanıcı DIŞ WHM sayfasını aşağı kaydırıyor.
  // Çözüm: iframe içindeysek body height'ı 100vh'a kilitle, internal scroll
  // Shell içindeki `<main>` üstlensin. Ayrıca parent'a postMessage ile
  // "resize me to 100vh" bildir — WHM CGI dinleyip iframe'i yükseltir.
  const [isInIframe, setIsInIframe] = React.useState(false);
  React.useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const mk = params.get("master_key");
      if (mk && mk.startsWith("MS-")) {
        localStorage.setItem("gws.event_license", mk);
        localStorage.setItem("gws.master_license", mk);
        params.delete("master_key");
        const cleanUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
        window.history.replaceState({}, "", cleanUrl);
      }

      // v43.35 — Preview otomatik master activation: kullanıcı manuel key girmesin diye
      // preview subdomain'inde varsayılan master key otomatik set edilir.
      // Production'da bu bloka girmez (host name filtresi).
      try {
        const host = window.location.hostname;
        const isPreview = host.includes("preview.emergentagent.com") || host === "localhost";
        const existing = localStorage.getItem("gws.master_license") || "";
        if (isPreview && !existing.startsWith("MS-")) {
          const DEFAULT_PREVIEW_KEY = "MS-C02AB012652A4FE692D69676";
          localStorage.setItem("gws.master_license", DEFAULT_PREVIEW_KEY);
          localStorage.setItem("gws.event_license", DEFAULT_PREVIEW_KEY);
          localStorage.setItem("gws.license.dismissed", "1");
          console.log("[GWS] Preview auto-activated master mode");
        }
      } catch (_) {}
    } catch (_) {}

    // v43.19 iframe detection
    let inFrame = false;
    try { inFrame = window.top !== window.self; } catch (_) { inFrame = true; }
    if (!inFrame) return;

    setIsInIframe(true);
    // Kilitli fullscreen — html/body 100vh, scroll SADECE panel içi <main>'de
    const styleId = "gws-iframe-lock";
    if (!document.getElementById(styleId)) {
      const st = document.createElement("style");
      st.id = styleId;
      st.textContent = `
        html, body, #root { height: 100vh !important; max-height: 100vh !important; overflow: hidden !important; margin: 0 !important; padding: 0 !important; }
        .App { height: 100vh !important; max-height: 100vh !important; overflow: hidden !important; display: flex !important; flex-direction: column !important; }
      `;
      document.head.appendChild(st);
    }

    // Parent'a "beni 100vh yap" mesajı gönder — WHM CGI dinliyor (v43.18+)
    const notifyParent = () => {
      try {
        window.parent.postMessage({
          type: "gws-panel-resize",
          height: "100vh",
          scrollHeight: document.documentElement.scrollHeight,
          source: "gws-panel",
        }, "*");
      } catch (_) {}
    };
    notifyParent();
    const iv = setInterval(notifyParent, 1000);
    const cleanup = () => clearInterval(iv);
    window.addEventListener("beforeunload", cleanup);
    return cleanup;
  }, []);
  return (
    <div className={`App ${isInIframe ? "gws-embedded" : ""}`}>
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
