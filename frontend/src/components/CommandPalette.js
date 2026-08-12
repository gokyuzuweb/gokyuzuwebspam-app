import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Command as CommandIcon, Search, Activity, Filter, HeartPulse, Globe,
  Bug, Inbox, ListChecks, Radar, Wrench, Cpu, ArrowUpRight, Bell, BellRing,
  FileText, Key, DollarSign, Users, Terminal, Settings2, HardDrive, BookOpen,
  Palette, Server, Sparkles, PackageOpen, History, Mail, ArrowRight,
} from "lucide-react";

/**
 * v43.10 Panel-wide Cmd+K Command Palette.
 * - Cmd+K / Ctrl+K açar
 * - Fuzzy search (arama sözü tüm route/testid'lerde geçiyorsa gösterir)
 * - Arrow up/down + Enter ile keyboard navigation
 * - ESC ile kapanır
 */
const ITEMS = [
  { path: "/panel",                   icon: Activity,     title: "Dashboard",          keywords: "kontrol paneli genel bakış" },
  { path: "/panel/mailscanner",       icon: Filter,       title: "MailScanner",        keywords: "spam motor" },
  { path: "/panel/mail-health",       icon: HeartPulse,   title: "Mail Sağlık",        keywords: "mx spf dkim dmarc ptr" },
  { path: "/panel/threat-intel",      icon: Globe,        title: "Tehdit Zekası",      keywords: "urlhaus spamhaus ioc" },
  { path: "/panel/security",          icon: Bug,          title: "Güvenlik",           keywords: "exploit webshell" },
  { path: "/panel/quarantine",        icon: Inbox,        title: "Karantina",          keywords: "izole edilmiş mail" },
  { path: "/panel/lists",             icon: ListChecks,   title: "Beyaz / Kara Liste", keywords: "whitelist blacklist" },
  { path: "/panel/blacklist",         icon: Radar,        title: "Blacklist Çıkışı",   keywords: "rbl delisting reputation" },
  { path: "/panel/rules",             icon: Wrench,       title: "Kurallar",           keywords: "regex ai rule" },
  { path: "/panel/engines",           icon: Cpu,          title: "Motorlar",           keywords: "spamassassin clamav dcc razor" },
  { path: "/panel/outbound",          icon: ArrowUpRight, title: "Giden Posta",        keywords: "outbound bulk" },
  { path: "/panel/notifications",     icon: Bell,         title: "Bildirimler",        keywords: "notification alarm" },
  { path: "/panel/alerts",            icon: BellRing,     title: "Alarm Kuralları",    keywords: "alert rules" },
  { path: "/panel/reports",           icon: FileText,     title: "Raporlar",           keywords: "reports pdf export" },
  { path: "/panel/licenses",          icon: Key,          title: "Lisans Yönetimi",    keywords: "license key" },
  { path: "/panel/subscription",      icon: Sparkles,     title: "Aboneliğim",         keywords: "subscription plan" },
  { path: "/panel/my-server",         icon: Server,       title: "Sunucumu Bağla",     keywords: "install bayi sunucu" },
  { path: "/panel/pricing",           icon: DollarSign,   title: "Fiyatlandırma",      keywords: "pricing plans" },
  { path: "/panel/users",             icon: Users,        title: "Kullanıcılar",       keywords: "users cpanel accounts" },
  { path: "/panel/logs",              icon: Terminal,     title: "Loglar",             keywords: "logs exim journal" },
  { path: "/panel/settings",          icon: Settings2,    title: "Ayarlar",            keywords: "settings config smtp" },
  { path: "/panel/maintenance",       icon: HardDrive,    title: "DB Bakım",           keywords: "database prune retention" },
  { path: "/panel/payments-admin",    icon: DollarSign,   title: "Ödeme Panosu",       keywords: "payments admin stripe" },
  { path: "/panel/resellers-admin",   icon: Users,        title: "Bayi Panosu",        keywords: "reseller admin" },
  { path: "/panel/master-live",       icon: Activity,     title: "Canlı Bayi Trafiği", keywords: "master live reseller" },
  { path: "/panel/plan-analytics",    icon: DollarSign,   title: "Plan Analitiği",     keywords: "plan analytics" },
  { path: "/panel/plan-config",       icon: Wrench,       title: "Plan Modül Yapıl.",  keywords: "plan config" },
  { path: "/panel/version-publish",   icon: PackageOpen,  title: "Sürüm Yayın",        keywords: "version publish release" },
  { path: "/panel/wake-history",      icon: History,      title: "Ping Geçmişi",       keywords: "wake history heartbeat" },
  { path: "/panel/email-templates",   icon: Mail,         title: "Mail Şablonları",    keywords: "email templates" },
  { path: "/panel/plugin-health",     icon: HeartPulse,   title: "Plugin Sağlık",      keywords: "plugin health monitor" },
  { path: "/panel/landing-cms",       icon: Palette,      title: "Landing CMS",        keywords: "landing cms tema light dark" },
  { path: "/panel/install",           icon: PackageOpen,  title: "Kurulum",            keywords: "install wizard" },
  { path: "/panel/docs",              icon: BookOpen,     title: "Dokümantasyon",      keywords: "docs help" },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const navigate = useNavigate();

  // Global shortcut listener (Cmd+K / Ctrl+K)
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setIdx(0);
      } else if (open && k === "escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus input on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS.slice(0, 12);
    return ITEMS.filter((it) => {
      const hay = `${it.title} ${it.keywords} ${it.path}`.toLowerCase();
      return q.split(/\s+/).every((tok) => hay.includes(tok));
    }).slice(0, 20);
  }, [query]);

  useEffect(() => { setIdx(0); }, [query]);

  const submit = (item) => {
    setOpen(false);
    if (item) navigate(item.path);
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter")   { e.preventDefault(); submit(results[idx]); }
  };

  // Scroll active into view
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${idx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [idx, open]);

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      data-testid="cmdk-open-btn"
      title="Cmd+K / Ctrl+K"
      aria-label="Komut paletini aç"
      className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 px-3.5 py-2.5 rounded-full
                 bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white text-xs font-semibold
                 shadow-[0_10px_30px_-5px_rgba(99,102,241,0.5),inset_0_1px_0_0_rgba(255,255,255,0.25)]
                 hover:scale-105 transition-transform"
    >
      <CommandIcon className="w-3.5 h-3.5"/>
      <span className="hidden md:inline">Cmd+K · Hızlı Git</span>
      <span className="md:hidden">⌘K</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 px-4"
         data-testid="cmdk-overlay"
         onClick={() => setOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"/>

      {/* Palette */}
      <div className="relative w-full max-w-2xl rounded-2xl overflow-hidden
                      bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-700
                      shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7),inset_0_1px_0_0_rgba(255,255,255,0.08)]
                      animate-in fade-in slide-in-from-top-4 duration-300"
           onClick={(e) => e.stopPropagation()}
           data-testid="cmdk-panel">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          <Search className="w-4 h-4 text-slate-500"/>
          <input
            ref={inputRef}
            data-testid="cmdk-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Sayfa ara: karantina, tehdit, motor, ödeme..."
            className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 text-sm focus:outline-none"
          />
          <kbd className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-slate-950 text-[10px] mono text-slate-500">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-2" data-testid="cmdk-list">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              Sonuç yok · başka bir kelime deneyin
            </div>
          )}
          {results.map((it, i) => {
            const active = i === idx;
            return (
              <button key={it.path}
                      data-idx={i}
                      data-testid={`cmdk-item-${it.path.replace(/\//g, "-")}`}
                      onMouseEnter={() => setIdx(i)}
                      onClick={() => submit(it)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors
                                 ${active ? "bg-indigo-500/20 text-white" : "text-slate-300 hover:bg-slate-800/50"}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0
                                ${active ? "bg-indigo-500/40 border border-indigo-400/60" : "bg-slate-800 border border-slate-700"}`}>
                  <it.icon className={`w-4 h-4 ${active ? "text-white" : "text-slate-400"}`}/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium truncate ${active ? "text-white" : "text-slate-100"}`}>{it.title}</div>
                  <div className="text-[11px] mono text-slate-500 truncate">{it.path}</div>
                </div>
                {active && <ArrowRight className="w-4 h-4 text-indigo-300 shrink-0"/>}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-800 text-[10px] mono text-slate-500 bg-slate-950/60">
          <span>⏎ Git · ↑↓ Gezin · ESC Kapat</span>
          <span className="flex items-center gap-1"><CommandIcon className="w-3 h-3"/> GökyüzüWebSpam Palette</span>
        </div>
      </div>
    </div>
  );
}
