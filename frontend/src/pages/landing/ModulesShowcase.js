import { useState, useEffect } from "react";
import {
  ShieldCheck, MailWarning, Ban, ArrowUpRight, Globe, Activity,
  Zap, Database, Radio, Sparkles, Users, Server, Cpu, Lock, Layers, GitBranch,
  Play, Bell, FileCheck2, Bookmark, Filter,
} from "lucide-react";

/**
 * Modules Showcase — Landing page section
 * Modern, self-contained; no external images needed. Uses SVG mockups + Tailwind
 * for a distinctive dark aesthetic with subtle grain/blur effects.
 */

const MODULES = [
  {
    id: "quarantine",
    title: "Karantina Yönetimi",
    subtitle: "Gelen / Giden ayrımlı",
    icon: ShieldCheck,
    color: "emerald",
    highlights: [
      "In/Out direction tab filter",
      "SA-normalized scoring (0-30 clamp)",
      "3-kolon skor karşılaştırma",
      "Bayes eğitim + whitelist tek tık",
      "CSV/JSON export · Saved Filters",
    ],
    testid: "landing-mod-quarantine",
  },
  {
    id: "outbound",
    title: "Giden Mail Filtreleme",
    subtitle: "v43 Bulk Detection",
    icon: ArrowUpRight,
    color: "amber",
    highlights: [
      "Otomatik toplu tespit (200/saat/user)",
      "Auto-throttle + dedupe alert",
      "MAILER-DAEMON bounce ayrımı",
      "Regex from/to/subject/IP arama",
      "Manuel throttle · User kısıtlama",
    ],
    testid: "landing-mod-outbound",
  },
  {
    id: "livemail",
    title: "Canlı Mail Trafiği",
    subtitle: "5000 kayıt · debounce arama",
    icon: Activity,
    color: "cyan",
    highlights: [
      "5sn refresh · WebSocket bar",
      "Debounced regex arama",
      "Min/Max skor + tarih aralığı",
      "Skor histogramı + trend chart",
      "Ülke bazlı sender IP haritası",
    ],
    testid: "landing-mod-livemail",
  },
  {
    id: "threat-intel",
    title: "Global Tehdit Zekası",
    subtitle: "6 feed · IOC + DMARC",
    icon: Globe,
    color: "fuchsia",
    highlights: [
      "Auto-sync (15dk-24sa arası)",
      "Spamhaus, URLhaus, PhishTank+",
      "IOC: IP/Domain/URL/Hash/Email",
      "DMARC aggregate raporlar",
      "Uyumluluk skor kartı",
    ],
    testid: "landing-mod-threat-intel",
  },
  {
    id: "plugin-health",
    title: "Plugin Sağlık",
    subtitle: "Uzak izleme & auto-retry",
    icon: Radio,
    color: "rose",
    highlights: [
      "Tüm bayilerde normalize oranı",
      "Uzak plugin güncelleme (3-retry)",
      "Kritik/uyarı/sağlıklı badge",
      "Push notification + ✓ ikonlar",
      "Uyarı eşiği ayarlanabilir",
    ],
    testid: "landing-mod-plugin-health",
  },
  {
    id: "master-reseller",
    title: "Bayi Sistemi",
    subtitle: "Multi-tenant izolasyonu",
    icon: Users,
    color: "indigo",
    highlights: [
      "Master → Bayi impersonation",
      "Plan bazlı özellik kilidi",
      "Tenant scope tek merkezden",
      "Bayi paneli · fatura · Havale",
      "Public checkout + Stripe",
    ],
    testid: "landing-mod-reseller",
  },
  {
    id: "cache",
    title: "Redis Cache Katmanı",
    subtitle: "Horizontal scale",
    icon: Database,
    color: "emerald",
    highlights: [
      "9 endpoint cache'lendi",
      "TTL 4sn-5dk · per-tenant key",
      "$facet aggregation · %90 DB↓",
      "Auto-fallback in-memory",
      "Multi-instance sync",
    ],
    testid: "landing-mod-cache",
  },
  {
    id: "notifications",
    title: "Bildirim Sistemi",
    subtitle: "Type-icon · redirection",
    icon: Bell,
    color: "amber",
    highlights: [
      "Master alerts (threat, plugin, bulk)",
      "Type-icon (✓ ✗ ⚠️ 🔔)",
      "Tıklayınca doğru sayfaya yönlendir",
      "Session-aware badge count",
      "Toast + drawer + WebSocket",
    ],
    testid: "landing-mod-notifications",
  },
  {
    id: "saved-filters",
    title: "Kayıtlı Filtreler",
    subtitle: "Karantina · Canlı · Outbound",
    icon: Bookmark,
    color: "indigo",
    highlights: [
      "Kompleks filtre kombinasyonları",
      "Per-lisans kaydet",
      "Chip UI · tek tık uygula",
      "Modül başına ayrı saklama",
      "Klavye kısayolları",
    ],
    testid: "landing-mod-saved-filters",
  },
  {
    id: "score-engine",
    title: "ConfigServer-Parite Skor",
    subtitle: "SA + Bayes + ClamAV",
    icon: Cpu,
    color: "rose",
    highlights: [
      "SA skoru primary source",
      "Total_score clamp (0-30)",
      "Verdict re-classify",
      "Per-license eşik",
      "3-kolon karşılaştırma",
    ],
    testid: "landing-mod-score",
  },
  {
    id: "exim-parse",
    title: "Exim Log Parse",
    subtitle: "WHM Perl daemon",
    icon: Server,
    color: "cyan",
    highlights: [
      "Real-time logtail-mainlog",
      "U=<user> outbound detect",
      "MID map · pending-actions",
      "5-retry queue executor",
      "systemd + heartbeat",
    ],
    testid: "landing-mod-exim",
  },
  {
    id: "security",
    title: "Güvenlik & İzolasyon",
    subtitle: "Master-key + rate limit",
    icon: Lock,
    color: "fuchsia",
    highlights: [
      "X-Master-Key header auth",
      "Tenant scope helpers (tenant.py)",
      "Plan gate enforcement",
      "Impersonation cookie",
      "CORS + CSRF hardened",
    ],
    testid: "landing-mod-security",
  },
];

const COLOR_CLASSES = {
  emerald: { border: "border-emerald-500/30", bg: "bg-emerald-500/5", text: "text-emerald-300", ring: "shadow-emerald-500/20" },
  amber:   { border: "border-amber-500/30",   bg: "bg-amber-500/5",   text: "text-amber-300",   ring: "shadow-amber-500/20" },
  cyan:    { border: "border-cyan-500/30",    bg: "bg-cyan-500/5",    text: "text-cyan-300",    ring: "shadow-cyan-500/20" },
  fuchsia: { border: "border-fuchsia-500/30", bg: "bg-fuchsia-500/5", text: "text-fuchsia-300", ring: "shadow-fuchsia-500/20" },
  rose:    { border: "border-rose-500/30",    bg: "bg-rose-500/5",    text: "text-rose-300",    ring: "shadow-rose-500/20" },
  indigo:  { border: "border-indigo-500/30",  bg: "bg-indigo-500/5",  text: "text-indigo-300",  ring: "shadow-indigo-500/20" },
};

function ModuleCard({ mod }) {
  const Icon = mod.icon;
  const cc = COLOR_CLASSES[mod.color];
  return (
    <div
      data-testid={mod.testid}
      className={`group relative border ${cc.border} ${cc.bg} rounded-xl p-5 hover:shadow-lg ${cc.ring} transition-all duration-300 hover:-translate-y-1 backdrop-blur`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg ${cc.bg} border ${cc.border} flex items-center justify-center shrink-0`}>
          <Icon className={`w-5 h-5 ${cc.text}`} />
        </div>
        <div>
          <h3 className="text-slate-100 font-semibold text-sm leading-tight">{mod.title}</h3>
          <p className={`${cc.text} text-[11px] uppercase tracking-wider mono mt-0.5`}>{mod.subtitle}</p>
        </div>
      </div>
      <ul className="space-y-1.5 mt-3">
        {mod.highlights.map((h, i) => (
          <li key={i} className="text-[12px] text-slate-400 flex items-start gap-1.5 leading-relaxed">
            <span className={`${cc.text} shrink-0`}>▸</span>
            <span>{h}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- ANIMATED DEMO: Simulated live event flow ---------------------------
function AnimatedDemo() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => (v + 1) % 100), 100);
    return () => clearInterval(t);
  }, []);

  const events = [
    { id: 1, from: "spammer@fake.com",     verdict: "spam",  score: 12.4, tone: "amber" },
    { id: 2, from: "info@newsletter.io",   verdict: "clean", score: 0.8,  tone: "emerald" },
    { id: 3, from: "attack@malware.ru",    verdict: "virus", score: 24.7, tone: "rose" },
    { id: 4, from: "phish@paypal-fake.co", verdict: "phish", score: 18.2, tone: "rose" },
    { id: 5, from: "system@bank.tr",       verdict: "clean", score: 1.2,  tone: "emerald" },
    { id: 6, from: "promo@sale.com",       verdict: "spam",  score: 8.1,  tone: "amber" },
  ];
  const toneCls = {
    emerald: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
    amber:   "text-amber-300 border-amber-500/40 bg-amber-500/10",
    rose:    "text-rose-300 border-rose-500/40 bg-rose-500/10",
  };

  return (
    <div className="relative rounded-xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 md:p-8 overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 opacity-30 pointer-events-none"
           style={{
             background: "radial-gradient(circle at 20% 30%, rgba(99,102,241,0.15), transparent 50%), radial-gradient(circle at 80% 70%, rgba(244,63,94,0.15), transparent 50%)",
           }}/>
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"/>
            <span className="text-[11px] uppercase tracking-widest text-slate-400 mono">
              Canlı Mail Trafiği · WebSocket
            </span>
          </div>
          <span className="text-[11px] mono text-slate-500">
            Motor: <span className="text-emerald-400">SA</span> · <span className="text-cyan-400">Bayes</span> · <span className="text-fuchsia-400">ClamAV</span>
          </span>
        </div>

        <div className="space-y-2">
          {events.map((e, idx) => {
            const active = Math.floor(tick / 15) === idx;
            const cc = toneCls[e.tone];
            return (
              <div key={e.id}
                   className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all duration-500 ${
                     active
                       ? `${cc} scale-[1.01] shadow-lg`
                       : "border-slate-800 bg-slate-900/40 text-slate-500"
                   }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-white animate-ping" : "bg-slate-700"}`}/>
                <span className="mono text-[11px] flex-1 truncate">{e.from}</span>
                <span className="mono text-xs">skor: <span className={active ? "text-white font-bold" : ""}>{e.score.toFixed(1)}</span></span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase mono tracking-wider ${active ? "" : "opacity-60"}`}>
                  {e.verdict}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-5 pt-4 border-t border-slate-800 grid grid-cols-3 gap-3 text-center">
          {[
            { label: "Bugün taranan", val: (12470 + Math.floor(tick * 3)).toLocaleString("tr-TR") },
            { label: "Bloklanan", val: (2384 + Math.floor(tick / 2)).toLocaleString("tr-TR") },
            { label: "Karantina", val: (167 + Math.floor(tick / 8)).toLocaleString("tr-TR") },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mono">{s.label}</div>
              <div className="text-xl font-bold mono text-slate-100 mt-1">{s.val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- MAIN SECTION -------------------------------------------------------
export default function ModulesShowcase({ t }) {
  return (
    <section
      id="modules"
      data-testid="landing-modules"
      className="py-24 border-t border-slate-800/60 relative overflow-hidden"
    >
      {/* Ambient background */}
      <div className="absolute inset-0 opacity-20 pointer-events-none"
           style={{
             background: "radial-gradient(1200px 400px at 50% 0%, rgba(99,102,241,0.15), transparent 70%)",
           }}/>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/5 text-indigo-300 text-[11px] uppercase tracking-widest mb-4 mono">
            <Sparkles className="w-3 h-3" /> {t?.modules_badge || "12+ Modül · Production-ready"}
          </div>
          <h2 className="text-3xl sm:text-5xl font-bold text-slate-100 mb-4 tracking-tight">
            {t?.modules_title || "Enterprise sınıfı mail güvenlik platformu"}
          </h2>
          <p className="text-slate-400 text-lg leading-relaxed">
            {t?.modules_sub || "Her WHM/cPanel sunucusu için bulut ölçekli filtreleme, canlı tehdit istihbaratı, çok-kiracılı bayi yönetimi ve tam otomasyon."}
          </p>
        </div>

        {/* Animated Live Demo */}
        <div className="mb-16">
          <div className="max-w-2xl mx-auto mb-6 text-center">
            <div className="inline-flex items-center gap-2 text-xs text-slate-400 mono">
              <Play className="w-3.5 h-3.5 text-emerald-400" />
              <span className="uppercase tracking-widest">Canlı simülasyon · Panel her 100ms güncellenir</span>
            </div>
          </div>
          <AnimatedDemo />
        </div>

        {/* Module cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map((mod) => (
            <ModuleCard key={mod.id} mod={mod} />
          ))}
        </div>

        {/* Tech-stack ribbon */}
        <div className="mt-16 rounded-xl border border-slate-800 bg-slate-900/30 p-6 text-center backdrop-blur">
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mono mb-3">
            Altyapı Stack
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            {[
              "React 19", "FastAPI", "MongoDB", "Redis", "WebSocket", "Docker",
              "SpamAssassin", "ClamAV", "Bayes ML", "Exim MTA",
            ].map((tech) => (
              <span key={tech} className="mono text-slate-400 hover:text-indigo-300 transition-colors">
                {tech}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
