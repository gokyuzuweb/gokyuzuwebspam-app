import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldAlert, ShieldCheck, Zap, Brain, Globe2, Radar, ArrowRight,
  CheckCircle2, Sparkles, Terminal, Server, Lock, Cpu, Mail, Activity,
  BadgeCheck, Rocket,
} from "lucide-react";
import { Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useI18n, useT } from "@/i18n";

const LANG_STRINGS = {
  tr: {
    hero_badge: "WHM / cPanel için ticari mail güvenliği",
    hero_title_a: "Sunucunuzdan",
    hero_title_b: "spam ve tehdit sızmasın.",
    hero_sub: "GökyüzüWebSpam; SpamAssassin, ClamAV, DCC, Vipul's Razor ve LLM tabanlı AI sınıflandırıcıyı tek arayüzde birleştirir. WHM'e 60 saniyede kurulur, karantina/whitelist/blacklist ve giden posta kontrolünü teker teker yönetir.",
    cta_primary: "Şimdi Satın Al",
    cta_secondary: "Canlı Demo",
    trusted: "IP-bazlı lisans · 7 gün ücretsiz demo · WHM AppConfig entegrasyonu",
    features_title: "Neden GökyüzüWebSpam?",
    features_sub: "Rakip pluginlerin (ConfigServer MailScanner, MagicSpam, MailScanner Pro) sunduğu her şey — üstüne modern UI, AI ve i18n.",
    f1_t: "5 Motor · Tek Arayüz",
    f1_d: "SpamAssassin + Rspamd + ClamAV + DCC + Razor. Aktif motoru tek tıkla değiştir, daemon otomatik yeniden başlar.",
    f2_t: "AI Kural Üretici",
    f2_d: "Yakalamak istediğiniz spam türünü Türkçe anlatın — Claude/GPT/Gemini regex kuralları üretir, tek tıkla ekleyin.",
    f3_t: "6 Dil Desteği",
    f3_d: "TR/EN/DE/FR/ES/AR. cPanel dilini otomatik algılar, kullanıcı deneyimini yerelleştirir.",
    f4_t: "IP-Bazlı Lisans",
    f4_d: "Perl heartbeat daemon her 5 dakikada license server'ı yoklar. İzinsiz IP'den ihlalde admin alarm alır.",
    f5_t: "Karantina + Bayes",
    f5_d: "Otomatik izole edilen mesajları toplu 'spam değil' işaretleyin — Bayes anında öğrenir, whitelist güncellenir.",
    f6_t: "Giden Posta Kontrolü",
    f6_d: "cPanel hesabı başına saatlik limit + kural ihlalinde otomatik kesim + admin bildirimi.",
    stats_title: "Sayılarla",
    stats_1: "spam engelleme oranı",
    stats_2: "dakika içinde kurulum",
    stats_3: "e-posta / saat işleme kapasitesi",
    stats_4: "dil desteği",
    how_title: "3 Adımda Aktif",
    how1_t: "1. Satın Al",
    how1_d: "Stripe üzerinden güvenli ödeme. Test/Live otomatik. Anahtar e-postanıza gelir.",
    how2_t: "2. Tek Komut Kur",
    how2_d: "WHM sunucunuza root SSH ile bağlanıp wget one-liner'ı çalıştırın. 60 saniye.",
    how3_t: "3. Aktif Et",
    how3_d: "WHM > Plugins > GökyüzüWebSpam. Lisansı gir, motorları seç, karantina çalışmaya başlar.",
    pricing_title: "Şeffaf Fiyatlandırma",
    pricing_sub: "Sunucu başına, IP değişikliği ücretsiz. İptal esnektir.",
    plans_loading: "Planlar yükleniyor…",
    per_month: "/ay",
    per_year: "/yıl",
    yearly_save: "iki ay bedava",
    pick_plan: "Bu Planı Al",
    faq_title: "Sıkça Sorulanlar",
    faq1_q: "cPanel/WHM sürümüm uyumlu mu?",
    faq1_a: "WHM/cPanel 110+ ile tam uyumlu. CentOS 7+, AlmaLinux 8+, Rocky 8+ üzerinde çalışır.",
    faq2_q: "Mevcut spam ayarlarımı bozar mı?",
    faq2_a: "Hayır. GökyüzüWebSpam SpamAssassin + Exim milter olarak yanına takılır. İstediğiniz zaman devre dışı bırakabilirsiniz.",
    faq3_q: "IP değişirse ne olur?",
    faq3_a: "Panelden 'Lisansı Sorgula' ile yeni IP'yi kaydedin. Ekstra ücret yok.",
    faq4_q: "AI kural üretici için ekstra bir API anahtarı lazım mı?",
    faq4_a: "Hayır. Emergent LLM anahtarı plugin ile birlikte gelir; Claude/GPT/Gemini üçünü de destekler.",
    footer_prod: "Ürün",
    footer_dev: "Geliştiriciler",
    footer_company: "Şirket",
    footer_features: "Özellikler",
    footer_pricing: "Fiyatlandırma",
    footer_demo: "Canlı Demo",
    footer_docs: "Dokümantasyon",
    footer_install: "Kurulum",
    footer_api: "API",
    footer_about: "Hakkımızda",
    footer_contact: "İletişim",
    footer_copyright: "© 2026 GökyüzüWebSpam. Tüm hakları saklıdır.",
    demo_badge: "🎬 Canlı Demo",
    demo_hint: "Kimlik doğrulama yok — panelde dilediğince gezinin",
  },
  en: {
    hero_badge: "Commercial mail security for WHM / cPanel",
    hero_title_a: "Keep spam and threats",
    hero_title_b: "out of your servers.",
    hero_sub: "GökyüzüWebSpam unifies SpamAssassin, ClamAV, DCC, Vipul's Razor and an LLM-based AI classifier in one interface. Installs on WHM in 60 seconds. Manage quarantine, whitelist/blacklist and outbound mail from a single panel.",
    cta_primary: "Buy Now",
    cta_secondary: "Live Demo",
    trusted: "IP-based licensing · 7-day free demo · WHM AppConfig integration",
    features_title: "Why GökyüzüWebSpam?",
    features_sub: "Everything competitor plugins (ConfigServer MailScanner, MagicSpam, MailScanner Pro) offer — plus a modern UI, AI, and i18n.",
    f1_t: "5 Engines · One UI",
    f1_d: "SpamAssassin + Rspamd + ClamAV + DCC + Razor. Switch active engine in one click; daemon auto-restarts.",
    f2_t: "AI Rule Generator",
    f2_d: "Describe the spam pattern — Claude/GPT/Gemini generates regex rules you can add with one click.",
    f3_t: "6 Languages",
    f3_d: "TR/EN/DE/FR/ES/AR. Auto-detects cPanel language; UX is localized end-to-end.",
    f4_t: "IP-based Licensing",
    f4_d: "Perl heartbeat daemon polls the license server every 5 min. Admins get alerts on unauthorized IPs.",
    f5_t: "Quarantine + Bayes",
    f5_d: "Bulk-mark 'not spam' — Bayes learns instantly, whitelist updates automatically.",
    f6_t: "Outbound Control",
    f6_d: "Hourly per-user limit + auto-cutoff on rule violation + admin notification.",
    stats_title: "By The Numbers",
    stats_1: "spam block rate",
    stats_2: "minutes to install",
    stats_3: "emails / hour throughput",
    stats_4: "languages",
    how_title: "Live in 3 Steps",
    how1_t: "1. Buy",
    how1_d: "Secure Stripe payment. Test/Live auto-detected. Key delivered via email.",
    how2_t: "2. One-line Install",
    how2_d: "SSH into your WHM as root, run our wget one-liner. Takes 60 seconds.",
    how3_t: "3. Activate",
    how3_d: "WHM > Plugins > GökyüzüWebSpam. Paste key, pick engines, quarantine kicks in.",
    pricing_title: "Transparent Pricing",
    pricing_sub: "Per server, free IP changes. Cancel anytime.",
    plans_loading: "Loading plans…",
    per_month: "/month",
    per_year: "/year",
    yearly_save: "2 months free",
    pick_plan: "Get This Plan",
    faq_title: "FAQ",
    faq1_q: "Is my cPanel/WHM version compatible?",
    faq1_a: "Fully compatible with WHM/cPanel 110+. Runs on CentOS 7+, AlmaLinux 8+, Rocky 8+.",
    faq2_q: "Will it break my current spam setup?",
    faq2_a: "No. It attaches to Exim as a milter beside SpamAssassin. Disable any time.",
    faq3_q: "What if my IP changes?",
    faq3_a: "Just hit 'Verify License' in the panel — new IP is registered. No extra fee.",
    faq4_q: "Do I need a separate API key for the AI rule generator?",
    faq4_a: "No. Emergent LLM key ships with the plugin; Claude/GPT/Gemini all supported.",
    footer_prod: "Product",
    footer_dev: "Developers",
    footer_company: "Company",
    footer_features: "Features",
    footer_pricing: "Pricing",
    footer_demo: "Live Demo",
    footer_docs: "Docs",
    footer_install: "Install",
    footer_api: "API",
    footer_about: "About",
    footer_contact: "Contact",
    footer_copyright: "© 2026 GökyüzüWebSpam. All rights reserved.",
    demo_badge: "🎬 Live Demo",
    demo_hint: "No auth — browse the panel freely",
  },
};

function useLandingStrings() {
  const { effective } = useI18n();
  return LANG_STRINGS[effective] || LANG_STRINGS.en;
}

function GridBackdrop() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(99,102,241,0.2),transparent_40%),radial-gradient(circle_at_80%_60%,rgba(244,63,94,0.15),transparent_45%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:44px_44px]" />
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-indigo-500/10 blur-[120px]" />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-rose-500/10 blur-[120px]" />
    </div>
  );
}

function NavBar() {
  const { effective, setLang } = useI18n();
  const langs = ["tr", "en", "de", "fr", "es", "ar"];
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/60 bg-slate-950/70 backdrop-blur-md" data-testid="landing-nav">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="relative w-9 h-9 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-slate-100 font-bold tracking-tight text-[17px]">Gökyüzü<span className="text-indigo-400">WebSpam</span></div>
            <div className="text-[9px] uppercase tracking-widest text-slate-500 mono">WHM / cPanel · v1.3</div>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-slate-400">
          <a href="#features" className="hover:text-slate-100 transition-colors">Features</a>
          <a href="#how" className="hover:text-slate-100 transition-colors">How it works</a>
          <a href="#pricing" className="hover:text-slate-100 transition-colors">Pricing</a>
          <a href="#faq" className="hover:text-slate-100 transition-colors">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          <select
            data-testid="landing-lang"
            value={effective}
            onChange={(e) => setLang(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-md px-2 py-1 text-xs mono text-slate-300 focus:outline-none focus:border-indigo-500/40"
          >
            {langs.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
          <Link to="/reseller" data-testid="landing-reseller-cta" className="hidden lg:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border border-slate-700 bg-slate-900 text-slate-300 text-sm hover:border-slate-600 transition-colors">
            Reseller Portal
          </Link>
          <Link to="/panel" data-testid="landing-demo-cta" className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border border-slate-700 bg-slate-900 text-slate-200 text-sm hover:border-slate-600 transition-colors">
            Live Demo
          </Link>
          <Link to="/shop" data-testid="landing-buy-cta" className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-600 text-white text-sm font-medium shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-shadow">
            Buy <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const s = useLandingStrings();
  return (
    <section className="relative pt-20 pb-24 md:pt-28 md:pb-32" data-testid="landing-hero">
      <GridBackdrop />
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-4xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs mono uppercase tracking-widest mb-6">
            <Sparkles className="w-3 h-3" /> {s.hero_badge}
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-100 mb-6 leading-[1.05]">
            {s.hero_title_a} <span className="bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-rose-400 bg-clip-text text-transparent">{s.hero_title_b}</span>
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mb-8 leading-relaxed">
            {s.hero_sub}
          </p>
          <div className="flex flex-wrap gap-3 mb-8">
            <Link to="/shop" data-testid="hero-cta-buy" className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-medium shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/50 transition-shadow">
              {s.cta_primary} <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/panel" data-testid="hero-cta-demo" className="inline-flex items-center gap-2 px-5 py-3 rounded-md border border-slate-700 bg-slate-900/60 text-slate-100 hover:border-slate-600 transition-colors">
              <Rocket className="w-4 h-4" /> {s.cta_secondary}
            </Link>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mono">
            <BadgeCheck className="w-3.5 h-3.5 text-emerald-400" /> {s.trusted}
          </div>
        </div>

        {/* Panel preview mock */}
        <div className="mt-16 rounded-xl border border-slate-800 bg-slate-900/60 shadow-2xl shadow-indigo-900/20 overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-slate-800 bg-slate-950/60">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
            <span className="mono text-[10px] text-slate-500 ml-3">whm.example.com / GökyüzüWebSpam</span>
          </div>
          <div className="grid grid-cols-4 gap-3 p-4">
            {[
              { icon: Activity, label: "Scanned", val: "12,481", tone: "text-indigo-400" },
              { icon: ShieldCheck, label: "Blocked", val: "2,147", tone: "text-rose-400" },
              { icon: Radar, label: "Quarantine", val: "319", tone: "text-amber-400" },
              { icon: Mail, label: "Delivered", val: "10,015", tone: "text-emerald-400" },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 mb-1">
                  <k.icon className={`w-3 h-3 ${k.tone}`} /> {k.label}
                </div>
                <div className={`text-2xl mono font-bold ${k.tone}`}>{k.val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: Cpu, key: "f1", tone: "indigo" },
  { icon: Brain, key: "f2", tone: "fuchsia" },
  { icon: Globe2, key: "f3", tone: "emerald" },
  { icon: Lock, key: "f4", tone: "amber" },
  { icon: Radar, key: "f5", tone: "rose" },
  { icon: Zap, key: "f6", tone: "sky" },
];
const TONE_MAP = {
  indigo: "border-indigo-500/30 bg-indigo-500/5 text-indigo-300",
  fuchsia: "border-fuchsia-500/30 bg-fuchsia-500/5 text-fuchsia-300",
  emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/5 text-rose-300",
  sky: "border-sky-500/30 bg-sky-500/5 text-sky-300",
};

function Features() {
  const s = useLandingStrings();
  return (
    <section id="features" className="py-24 border-t border-slate-800/60" data-testid="landing-features">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-2xl mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-3 tracking-tight">{s.features_title}</h2>
          <p className="text-slate-400 leading-relaxed">{s.features_sub}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div key={f.key} className="group relative rounded-xl border border-slate-800 bg-slate-900/40 p-6 hover:border-slate-700 transition-colors">
              <div className={`w-11 h-11 rounded-md border flex items-center justify-center mb-4 ${TONE_MAP[f.tone]}`}>
                <f.icon className="w-5 h-5" strokeWidth={1.75} />
              </div>
              <h3 className="text-lg font-semibold text-slate-100 mb-2">{s[`${f.key}_t`]}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{s[`${f.key}_d`]}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stats() {
  const s = useLandingStrings();
  const items = [
    { val: "99.7%", label: s.stats_1 },
    { val: "60s", label: s.stats_2 },
    { val: "50K+", label: s.stats_3 },
    { val: "6", label: s.stats_4 },
  ];
  return (
    <section className="py-16 border-y border-slate-800/60 bg-slate-950/60">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8">
        {items.map((it) => (
          <div key={it.label} className="text-center">
            <div className="text-4xl font-bold bg-gradient-to-b from-slate-100 to-slate-400 bg-clip-text text-transparent mono mb-2">{it.val}</div>
            <div className="text-xs uppercase tracking-widest text-slate-500">{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const s = useLandingStrings();
  const steps = [
    { icon: Sparkles, t: s.how1_t, d: s.how1_d },
    { icon: Terminal, t: s.how2_t, d: s.how2_d },
    { icon: Rocket, t: s.how3_t, d: s.how3_d },
  ];
  return (
    <section id="how" className="py-24 border-t border-slate-800/60" data-testid="landing-how">
      <div className="max-w-7xl mx-auto px-6">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-14 tracking-tight">{s.how_title}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {steps.map((st) => (
            <div key={st.t} className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
              <div className="w-10 h-10 rounded-md bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mb-4">
                <st.icon className="w-5 h-5 text-indigo-300" />
              </div>
              <h3 className="text-lg font-semibold text-slate-100 mb-2">{st.t}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{st.d}</p>
            </div>
          ))}
        </div>

        {/* Terminal preview */}
        <div className="mt-10 rounded-xl border border-emerald-500/30 bg-slate-950/80 overflow-hidden shadow-lg shadow-emerald-500/5">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-950">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 mono">
              <Terminal className="w-3 h-3 text-emerald-400" /> root@whm.yoursrv.com
            </div>
            <Badge tone="success">SSH</Badge>
          </div>
          <pre className="p-5 mono text-[12px] text-slate-300 overflow-x-auto leading-relaxed">
{`# One-line install (60 seconds)
$ wget -O gws.tar.gz "https://gokyuzuwebspam.com/plugin/download" && \\
  tar -xzf gws.tar.gz && cd gokyuzuwebspam && \\
  chmod +x install.sh && ./install.sh --license=MS-XXXX...

`}<span className="text-emerald-400">{`✔ Registered WHM AppConfig
✔ SpamAssassin milter attached to Exim
✔ ClamAV / DCC / Razor helpers ready
✔ mailshield-api + heartbeat systemd running
→ Open WHM > Plugins > GökyüzüWebSpam`}</span>
          </pre>
        </div>
      </div>
    </section>
  );
}

const PLAN_ORDER = ["starter", "pro", "enterprise"];
const PLAN_HIGHLIGHT = "pro";

function Pricing() {
  const s = useLandingStrings();
  const pricing = useQuery({ queryKey: ["pricing-public"], queryFn: api.pricingPublic });
  const plans = pricing.data?.plans || [];
  const sorted = [...plans].sort((a, b) => PLAN_ORDER.indexOf(a.code) - PLAN_ORDER.indexOf(b.code));

  return (
    <section id="pricing" className="py-24 border-t border-slate-800/60" data-testid="landing-pricing">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-3 tracking-tight">{s.pricing_title}</h2>
          <p className="text-slate-400 leading-relaxed">{s.pricing_sub}</p>
        </div>
        {sorted.length === 0 ? (
          <div className="text-center text-slate-500">{s.plans_loading}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {sorted.map((p) => {
              const featured = p.code === PLAN_HIGHLIGHT;
              return (
                <div key={p.code}
                  data-testid={`plan-card-${p.code}`}
                  className={`relative rounded-xl border p-6 flex flex-col ${
                    featured
                      ? "border-indigo-500/60 bg-gradient-to-b from-indigo-500/10 to-slate-900/40 shadow-xl shadow-indigo-500/10"
                      : "border-slate-800 bg-slate-900/40"
                  }`}>
                  {featured && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] uppercase tracking-widest mono border border-indigo-500/60 bg-indigo-500/30 text-indigo-100">
                      Most popular
                    </div>
                  )}
                  <div className="text-lg font-bold text-slate-100 mb-1">{p.name}</div>
                  <div className="text-xs text-slate-500 uppercase tracking-widest mono mb-5">{p.code}</div>
                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-4xl font-bold text-slate-100 mono">${p.monthly}</span>
                    <span className="text-slate-500 text-sm">{s.per_month}</span>
                  </div>
                  <div className="text-xs text-slate-500 mb-6">
                    ${p.yearly} <span className="text-slate-600">{s.per_year}</span>
                    <span className="ml-1.5 text-emerald-400 mono">({s.yearly_save})</span>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-300 mb-6 flex-1">
                    {(p.features || []).map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to={`/shop?plan=${p.code}`}
                    data-testid={`landing-plan-cta-${p.code}`}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
                      featured
                        ? "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40"
                        : "border border-slate-700 bg-slate-900/60 text-slate-100 hover:border-slate-600"
                    }`}>
                    {s.pick_plan} <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function FAQ() {
  const s = useLandingStrings();
  const items = [
    { q: s.faq1_q, a: s.faq1_a },
    { q: s.faq2_q, a: s.faq2_a },
    { q: s.faq3_q, a: s.faq3_a },
    { q: s.faq4_q, a: s.faq4_a },
  ];
  return (
    <section id="faq" className="py-24 border-t border-slate-800/60" data-testid="landing-faq">
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-10 tracking-tight text-center">{s.faq_title}</h2>
        <div className="space-y-3">
          {items.map((it, i) => (
            <details key={i} className="group rounded-lg border border-slate-800 bg-slate-900/40 p-5 open:border-slate-700 transition-colors">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-slate-100 font-medium">
                {it.q}
                <span className="text-slate-500 group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">{it.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTABottom() {
  const s = useLandingStrings();
  return (
    <section className="py-20 border-t border-slate-800/60 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.15),transparent_60%)]" />
      <div className="max-w-4xl mx-auto px-6 text-center relative">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-4 tracking-tight">
          Ready to <span className="text-indigo-400">block 99.7%</span> of spam?
        </h2>
        <p className="text-slate-400 mb-8">
          Start with a 7-day free demo — no credit card, no surprises.
        </p>
        <div className="flex justify-center gap-3 flex-wrap">
          <Link to="/shop" data-testid="bottom-cta-buy" className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-medium shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-shadow">
            {s.cta_primary} <ArrowRight className="w-4 h-4" />
          </Link>
          <Link to="/panel" data-testid="bottom-cta-demo" className="inline-flex items-center gap-2 px-5 py-3 rounded-md border border-slate-700 bg-slate-900/60 text-slate-100 hover:border-slate-600 transition-colors">
            <Rocket className="w-4 h-4" /> {s.cta_secondary}
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const s = useLandingStrings();
  return (
    <footer className="border-t border-slate-800/60 bg-slate-950">
      <div className="max-w-7xl mx-auto px-6 py-14 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-white" />
            </div>
            <div className="text-slate-100 font-bold">Gökyüzü<span className="text-indigo-400">WebSpam</span></div>
          </div>
          <div className="text-xs text-slate-500 leading-relaxed">
            WHM/cPanel commercial mail security.<br />
            Made with ❤️ for hosting operators.
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-3 font-semibold">{s.footer_prod}</div>
          <ul className="space-y-2 text-sm text-slate-400">
            <li><a href="#features" className="hover:text-slate-100">{s.footer_features}</a></li>
            <li><a href="#pricing" className="hover:text-slate-100">{s.footer_pricing}</a></li>
            <li><Link to="/panel" className="hover:text-slate-100">{s.footer_demo}</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-3 font-semibold">{s.footer_dev}</div>
          <ul className="space-y-2 text-sm text-slate-400">
            <li><Link to="/panel/install" className="hover:text-slate-100">{s.footer_install}</Link></li>
            <li><a href="/api/plugin/install-info" className="hover:text-slate-100">{s.footer_api}</a></li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-3 font-semibold">{s.footer_company}</div>
          <ul className="space-y-2 text-sm text-slate-400">
            <li><a href="#faq" className="hover:text-slate-100">FAQ</a></li>
            <li><a href="mailto:destek@gokyuzuwebspam.com" className="hover:text-slate-100">{s.footer_contact}</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-800/60 py-5 text-center text-xs text-slate-600 mono">
        {s.footer_copyright}
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" data-testid="landing-page">
      <NavBar />
      <Hero />
      <Features />
      <Stats />
      <HowItWorks />
      <Pricing />
      <FAQ />
      <CTABottom />
      <Footer />
    </div>
  );
}
