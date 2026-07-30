import "@/App.css";
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import {
  Activity, ShieldAlert, Inbox, ListChecks, Cpu, Settings2,
  Users, Terminal, PackageOpen, ArrowUpRight, GaugeCircle, Wrench,
  Bell, FileText, Key, Radar, DollarSign,
} from "lucide-react";
import { I18nProvider, useT, useI18n } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { PluginStatusStripe, LicenseGate } from "@/components/LicenseGate";
import { api } from "@/lib/api";
import Dashboard from "@/pages/Dashboard";
import Quarantine from "@/pages/Quarantine";
import Lists from "@/pages/Lists";
import Rules from "@/pages/Rules";
import Engines from "@/pages/Engines";
import SettingsPage from "@/pages/Settings";
import UsersPage from "@/pages/Users";
import LogsPage from "@/pages/Logs";
import Outbound from "@/pages/Outbound";
import Install from "@/pages/Install";
import Notifications from "@/pages/Notifications";
import Reports from "@/pages/Reports";
import Licenses from "@/pages/Licenses";
import Pricing from "@/pages/Pricing";
import Shop, { CheckoutSuccess } from "@/pages/Shop";
import Blacklist from "@/pages/Blacklist";
import Header from "@/components/Header";

const NAV = [
  { to: "/", key: "dashboard", icon: Activity, testid: "nav-dashboard", end: true },
  { to: "/quarantine", key: "quarantine", icon: Inbox, testid: "nav-quarantine" },
  { to: "/lists", key: "lists", icon: ListChecks, testid: "nav-lists" },
  { to: "/blacklist", key: "blacklist", icon: Radar, testid: "nav-blacklist" },
  { to: "/rules", key: "rules", icon: Wrench, testid: "nav-rules" },
  { to: "/engines", key: "engines", icon: Cpu, testid: "nav-engines" },
  { to: "/outbound", key: "outbound", icon: ArrowUpRight, testid: "nav-outbound" },
  { to: "/notifications", key: "notifications", icon: Bell, testid: "nav-notifications" },
  { to: "/reports", key: "reports", icon: FileText, testid: "nav-reports" },
  // sellerOnly: sadece satıcı yönetim panelinde görünür
  { to: "/licenses", key: "licenses", icon: Key, testid: "nav-licenses", sellerOnly: true },
  { to: "/pricing", key: "pricing", icon: DollarSign, testid: "nav-pricing", sellerOnly: true },
  { to: "/users", key: "users", icon: Users, testid: "nav-users" },
  { to: "/logs", key: "logs", icon: Terminal, testid: "nav-logs" },
  { to: "/settings", key: "settings", icon: Settings2, testid: "nav-settings" },
  { to: "/install", key: "install", icon: PackageOpen, testid: "nav-install" },
];

function Sidebar() {
  const t = useT();
  const { effective } = useI18n();
  const mode = useQuery({ queryKey: ["system-mode"], queryFn: api.systemMode });
  const isSeller = mode.data?.mode === "seller";
  const items = NAV.filter((n) => isSeller || !n.sellerOnly);
  return (
    <aside data-testid="sidebar" className={`w-60 shrink-0 border-r border-slate-800 bg-slate-900/60 flex flex-col ${effective === "ar" ? "rtl" : ""}`}>
      <div className="h-14 flex items-center gap-2 px-3 border-b border-slate-800">
        <div className="relative w-8 h-8 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-4 h-4 text-white" />
        </div>
        <div className="leading-tight min-w-0">
          <div className="text-slate-100 font-bold tracking-tight text-[15px] truncate">Gökyüzü<span className="text-indigo-400">WebSpam</span></div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mono">v1.1 · {effective.toUpperCase()}</div>
        </div>
      </div>
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {items.map((n) => (
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
            <span>{t(`nav.${n.key}`)}</span>
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-500 mono flex items-center gap-2">
        <GaugeCircle className="w-3.5 h-3.5" />
        cPanel 136.0.32 · <span className={isSeller ? "text-indigo-400" : "text-emerald-400"}>{isSeller ? "SELLER" : "CUSTOMER"}</span>
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
        <Header title={active ? t(`nav.${active.key}`) : "GökyüzüWebSpam"} />
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/quarantine" element={<Quarantine />} />
            <Route path="/lists" element={<Lists />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/engines" element={<Engines />} />
            <Route path="/outbound" element={<Outbound />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/licenses" element={<Licenses />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/blacklist" element={<Blacklist />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/install" element={<Install />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="App">
      <I18nProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/shop" element={<Shop />} />
            <Route path="/checkout/success" element={<CheckoutSuccess />} />
            <Route path="*" element={<><Shell /><LicenseGate /></>} />
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
