import "@/App.css";
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import {
  Activity, ShieldAlert, Inbox, ListChecks, Cpu, Settings2,
  Users, Terminal, PackageOpen, ArrowUpRight, GaugeCircle, Wrench,
} from "lucide-react";
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
import Header from "@/components/Header";

const NAV = [
  { to: "/", label: "Kontrol Paneli", icon: Activity, testid: "nav-dashboard", end: true },
  { to: "/quarantine", label: "Karantina", icon: Inbox, testid: "nav-quarantine" },
  { to: "/lists", label: "Beyaz / Kara Liste", icon: ListChecks, testid: "nav-lists" },
  { to: "/rules", label: "Kurallar", icon: Wrench, testid: "nav-rules" },
  { to: "/engines", label: "Motorlar", icon: Cpu, testid: "nav-engines" },
  { to: "/outbound", label: "Giden Posta", icon: ArrowUpRight, testid: "nav-outbound" },
  { to: "/users", label: "Kullanıcılar", icon: Users, testid: "nav-users" },
  { to: "/logs", label: "Kayıtlar", icon: Terminal, testid: "nav-logs" },
  { to: "/settings", label: "Ayarlar", icon: Settings2, testid: "nav-settings" },
  { to: "/install", label: "Kurulum Kılavuzu", icon: PackageOpen, testid: "nav-install" },
];

function Sidebar() {
  return (
    <aside data-testid="sidebar" className="w-60 shrink-0 border-r border-slate-800 bg-slate-900/60 flex flex-col">
      <div className="h-14 flex items-center gap-2 px-4 border-b border-slate-800">
        <div className="relative w-8 h-8 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center">
          <ShieldAlert className="w-4 h-4 text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-slate-100 font-bold tracking-tight">MailShield</div>
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mono">Pro · v1.0</div>
        </div>
      </div>
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV.map((n) => (
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
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-500 mono flex items-center gap-2">
        <GaugeCircle className="w-3.5 h-3.5" />
        cPanel 136.0.32
      </div>
    </aside>
  );
}

function Shell() {
  const loc = useLocation();
  const active = NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={active?.label || "MailShield"} />
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/quarantine" element={<Quarantine />} />
            <Route path="/lists" element={<Lists />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/engines" element={<Engines />} />
            <Route path="/outbound" element={<Outbound />} />
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
      <BrowserRouter>
        <Shell />
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
    </div>
  );
}
