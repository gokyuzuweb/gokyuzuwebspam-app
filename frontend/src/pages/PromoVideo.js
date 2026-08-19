/**
 * GökyüzüWebSpam · Sistem Tanıtım Videosu (Interaktif)
 * v43.99.16 — 10 sahne · ~90 saniye · Otomatik ilerler · Duraklat/Devam · Tam Ekran · Sosyal Paylaşım
 *
 * Bu bir gerçek video değil, framer-motion ile üretilen interaktif animasyon sunum.
 * OBS/Camtasia ile ekran kaydı alırsanız gerçek MP4/YouTube upload'a hazır olur.
 */
import { useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Play, Pause, RotateCcw, Maximize2, Volume2, VolumeX, Share2, Download,
  Shield, Zap, Users, Globe, Cpu, Radar, Bell, Award, Rocket, TrendingUp,
  CheckCircle2, X, ChevronRight, Sparkles, Server, KeyRound,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// SAHNE ŞABLONLARI (Her sahne farklı bir konsept: text-only, stat-grid, list-of-features, ...)
// ═══════════════════════════════════════════════════════════════

const SCENES = [
  // 1. Logo / Açılış
  {
    id: 1,
    duration: 5000,
    type: "logo",
    bg: "from-slate-950 via-indigo-950 to-slate-950",
    title: "GökyüzüWebSpam",
    subtitle: "cPanel/WHM Mail Güvenlik Suite",
    tag: "v43.99 · 2026",
  },
  // 2. Sorun ifadesi
  {
    id: 2,
    duration: 8000,
    type: "problem",
    bg: "from-rose-950 via-slate-950 to-slate-950",
    title: "SPAM. HER GÜN. HER YERDE.",
    stats: [
      { value: "%84", label: "Global e-postanın oranı spam" },
      { value: "$20.5M", label: "Ortalama şirket zararı/yıl" },
      { value: "10x", label: "Phishing artışı (2020→2026)" },
      { value: "6 dk", label: "Bir kullanıcının kandırılma süresi" },
    ],
  },
  // 3. Çözüm — Ana özet
  {
    id: 3,
    duration: 7000,
    type: "solution",
    bg: "from-emerald-950 via-slate-950 to-indigo-950",
    title: "GökyüzüWebSpam · Kurumsal Çözüm",
    features: [
      { icon: "🛡️", label: "62+ Modül · Katmanlı Savunma" },
      { icon: "⚡", label: "30 sn'de Kurulum · WHM/cPanel Native" },
      { icon: "🤖", label: "AI Destekli Sınıflandırma (Claude)" },
      { icon: "🌍", label: "Multi-Language · Multi-Tenant" },
    ],
  },
  // 4. Motor sahnesi — bir maili nasıl analiz eder
  {
    id: 4,
    duration: 9000,
    type: "engine_flow",
    bg: "from-slate-950 via-slate-900 to-cyan-950",
    title: "Mail Yolculuğu · 7 Katmanlı Analiz",
    stages: [
      { name: "SMTP Handshake",   status: "✓ SPF/DKIM/DMARC" },
      { name: "IP Reputation",    status: "✓ Spamhaus + RBL" },
      { name: "Content Scoring",  status: "✓ SpamAssassin 5.2" },
      { name: "Bulk Fingerprint", status: "✓ DCC/Razor/Pyzor" },
      { name: "Bayes Classifier", status: "✓ 87k token" },
      { name: "Virus/Malware",    status: "✓ ClamAV" },
      { name: "AI Verdict",       status: "✓ Claude · %98.7 doğru" },
    ],
    verdict: "PHISHING · Score 8.4 · Karantina",
  },
  // 5. Threat Defense Center — 28 modül grid
  {
    id: 5,
    duration: 8000,
    type: "threat_grid",
    bg: "from-fuchsia-950 via-slate-950 to-slate-950",
    title: "Threat Defense Center",
    subtitle: "28 gelişmiş savunma modülü tek panoda",
    modules: [
      "Phishing Simulator", "BEC Dedektörü", "Brand Impersonation",
      "DMARC Monitor", "Mail Continuity", "Dark Web Watch",
      "AI Assistants", "Homoglyph Detection", "Attachment Sandbox",
      "URL Rewrite", "Zero-Trust Auth", "Data Loss Prevention",
      "Impersonation Guard", "SPF/DKIM Auto-Fix", "Bounce Analyzer",
      "Reputation Score", "Compromised Account", "Rate Anomaly",
      "TLS Downgrade", "MX Poisoning", "SMTP Smuggling",
      "Executive Protection", "Insider Threat", "Compliance Audit",
      "GDPR Radar", "PCI-DSS Monitor", "Threat Intel Feed", "SOC Playbook",
    ],
  },
  // 6. Master vs Bayi (Multi-tenant)
  {
    id: 6,
    duration: 8000,
    type: "topology",
    bg: "from-indigo-950 via-slate-950 to-purple-950",
    title: "Tek Panelden. Sınırsız Bayı.",
    subtitle: "Master → 50 Bayı → 5000 cPanel Hesabı",
    nodes: {
      master: "MASTER",
      resellers: ["Bayi A", "Bayi B", "Bayi C", "Bayi D", "Bayi E"],
      customers: 50,
    },
  },
  // 7. Rakamlar — istatistik parlaması
  {
    id: 7,
    duration: 7000,
    type: "big_stats",
    bg: "from-emerald-950 via-slate-950 to-slate-950",
    title: "Rakamlar Konuşur",
    stats: [
      { value: "99.94%", label: "Spam yakalama oranı" },
      { value: "0.06%",  label: "False positive" },
      { value: "12 ms",  label: "Ortalama analiz süresi" },
      { value: "24/7",   label: "Otomatik güncellemeler" },
      { value: "3 dil",  label: "TR · EN · AR" },
      { value: "62",     label: "Aktif modül sayısı" },
    ],
  },
  // 8. Kurulum — 3 komut
  {
    id: 8,
    duration: 8000,
    type: "install",
    bg: "from-slate-950 via-cyan-950 to-slate-950",
    title: "3 Komutta Kurulum",
    commands: [
      "curl -fsSL install.sh -o /root/install.sh",
      "chmod +x /root/install.sh",
      "bash /root/install.sh",
    ],
    result: "✓ WHM'de MailShield ikonuna tıkla · 30 saniye sonra canlı",
  },
  // 9. Fiyat & CTA
  {
    id: 9,
    duration: 8000,
    type: "pricing",
    bg: "from-amber-950 via-slate-950 to-emerald-950",
    title: "Fiyatlandırma",
    plans: [
      { name: "STARTER",    price: "$29/ay",  tag: "5 hesap · Temel"  },
      { name: "PRO",        price: "$99/ay",  tag: "50 hesap · Popüler", featured: true },
      { name: "ENTERPRISE", price: "$299/ay", tag: "Sınırsız · AI"    },
    ],
  },
  // 10. Kapanış — CTA
  {
    id: 10,
    duration: 7000,
    type: "cta",
    bg: "from-indigo-950 via-purple-950 to-slate-950",
    title: "Hemen Başla",
    subtitle: "30 saniye kur · 14 gün ücretsiz dene",
    cta: "gokyuzuhosting.com",
    supportEmail: "destek@gokyuzuhosting.com",
  },
];

const TOTAL_DURATION = SCENES.reduce((sum, s) => sum + s.duration, 0);


// ═══════════════════════════════════════════════════════════════
// SAHNE RENDER'LARI
// ═══════════════════════════════════════════════════════════════

function LogoScene({ scene }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center px-8">
      <motion.div
        initial={{ scale: 0.4, opacity: 0, rotateY: -180 }}
        animate={{ scale: 1, opacity: 1, rotateY: 0 }}
        transition={{ duration: 1.2, type: "spring", stiffness: 60 }}
        className="w-28 h-28 rounded-2xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-rose-500 flex items-center justify-center shadow-2xl shadow-indigo-500/50 mb-6"
      >
        <Shield className="w-16 h-16 text-white" strokeWidth={2.5} />
      </motion.div>
      <motion.h1
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.8 }}
        className="text-6xl font-black text-white tracking-tight mb-3"
      >
        Gökyüzü<span className="text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 to-rose-400">WebSpam</span>
      </motion.h1>
      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.1, duration: 0.6 }}
        className="text-xl text-slate-300 font-light"
      >
        {scene.subtitle}
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 0.6 }}
        className="mt-8 text-[10px] uppercase tracking-[0.5em] text-indigo-300 font-bold"
      >
        {scene.tag}
      </motion.p>
    </div>
  );
}

function ProblemScene({ scene }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8">
      <motion.h2
        initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="text-4xl md:text-5xl font-black text-rose-300 mb-12 text-center tracking-tight"
      >
        {scene.title}
      </motion.h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-5xl w-full">
        {scene.stats.map((s, i) => (
          <motion.div
            key={i}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 + i * 0.3, duration: 0.6, type: "spring" }}
            className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-5 text-center backdrop-blur"
          >
            <div className="text-5xl font-black text-rose-300 mb-2 font-mono">{s.value}</div>
            <div className="text-xs text-slate-400 leading-snug">{s.label}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SolutionScene({ scene }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="mb-3"
      >
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold tracking-wider uppercase">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Çözüm
        </div>
      </motion.div>
      <motion.h2
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.8 }}
        className="text-4xl md:text-5xl font-black text-white mb-14 text-center"
      >
        {scene.title}
      </motion.h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl w-full">
        {scene.features.map((f, i) => (
          <motion.div
            key={i}
            initial={{ x: i % 2 === 0 ? -60 : 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.7 + i * 0.25, duration: 0.6 }}
            className="flex items-center gap-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5"
          >
            <div className="text-4xl">{f.icon}</div>
            <div className="text-lg font-semibold text-white">{f.label}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function EngineFlowScene({ scene }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8">
      <motion.h2
        initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-3xl md:text-4xl font-black text-white mb-10 text-center"
      >
        {scene.title}
      </motion.h2>
      <div className="max-w-2xl w-full space-y-2.5">
        {scene.stages.map((st, i) => (
          <motion.div
            key={i}
            initial={{ x: -80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.4 + i * 0.6, duration: 0.4 }}
            className="flex items-center gap-4 bg-slate-800/60 border border-cyan-500/30 rounded-lg px-4 py-3"
          >
            <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/50 flex items-center justify-center text-cyan-300 font-bold text-xs">
              {i + 1}
            </div>
            <div className="flex-1 text-white font-semibold text-sm">{st.name}</div>
            <div className="text-emerald-400 text-xs font-mono">{st.status}</div>
          </motion.div>
        ))}
      </div>
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 5, duration: 0.8, type: "spring" }}
        className="mt-8 px-6 py-3 rounded-lg bg-rose-500/20 border-2 border-rose-500 text-rose-100 font-bold text-lg font-mono tracking-wide"
      >
        {scene.verdict}
      </motion.div>
    </div>
  );
}

function ThreatGridScene({ scene }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8">
      <motion.h2
        initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-4xl font-black text-white mb-2 text-center"
      >
        {scene.title}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="text-fuchsia-300 mb-8 text-sm"
      >
        {scene.subtitle}
      </motion.p>
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 max-w-6xl">
        {scene.modules.map((m, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              delay: 0.5 + (i * 0.05),
              duration: 0.4,
              type: "spring",
              stiffness: 200,
            }}
            className="aspect-square bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-lg p-2 flex items-center justify-center text-center"
          >
            <div className="text-[9px] font-semibold text-fuchsia-200 leading-tight">{m}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function TopologyScene({ scene }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8">
      <motion.h2
        initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-4xl font-black text-white mb-2 text-center"
      >
        {scene.title}
      </motion.h2>
      <p className="text-indigo-300 text-sm mb-12">{scene.subtitle}</p>
      {/* Master node */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.6, type: "spring" }}
        className="w-32 h-16 rounded-lg bg-gradient-to-br from-amber-500 to-rose-500 flex items-center justify-center text-white font-black text-lg shadow-2xl shadow-amber-500/30 mb-8"
      >
        {scene.nodes.master}
      </motion.div>
      {/* Reseller nodes */}
      <div className="flex gap-3 mb-6">
        {scene.nodes.resellers.map((r, i) => (
          <motion.div
            key={i}
            initial={{ y: -30, opacity: 0, scale: 0.7 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ delay: 1 + i * 0.25, duration: 0.4 }}
            className="w-24 h-12 rounded-lg bg-indigo-500/20 border border-indigo-500 text-indigo-200 flex items-center justify-center font-bold text-sm"
          >
            {r}
          </motion.div>
        ))}
      </div>
      {/* Customer grid */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 3, duration: 0.6 }}
        className="grid grid-cols-10 gap-1 max-w-2xl"
      >
        {Array.from({ length: 50 }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 3.2 + (i * 0.04), duration: 0.2 }}
            className="w-4 h-4 rounded bg-emerald-500/40 border border-emerald-500/60"
          />
        ))}
      </motion.div>
      <div className="text-[11px] mono text-slate-500 mt-3">↑ 5000 cPanel Hesabı</div>
    </div>
  );
}

function BigStatsScene({ scene }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8">
      <motion.h2
        initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-4xl md:text-5xl font-black text-white mb-14 text-center"
      >
        {scene.title}
      </motion.h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-8 max-w-4xl w-full">
        {scene.stats.map((s, i) => (
          <motion.div
            key={i}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 + i * 0.2, duration: 0.6, type: "spring" }}
            className="text-center"
          >
            <div className="text-6xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-b from-emerald-300 to-emerald-500 font-mono">
              {s.value}
            </div>
            <div className="text-xs text-slate-400 mt-1 uppercase tracking-wider font-semibold">{s.label}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function InstallScene({ scene }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8">
      <motion.h2
        initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-4xl md:text-5xl font-black text-white mb-8 text-center"
      >
        {scene.title}
      </motion.h2>
      {/* Terminal window */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="w-full max-w-3xl bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl"
      >
        <div className="bg-slate-800 px-4 py-2 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-rose-500" />
          <div className="w-3 h-3 rounded-full bg-amber-500" />
          <div className="w-3 h-3 rounded-full bg-emerald-500" />
          <span className="text-slate-400 text-xs ml-2 mono">root@server ~</span>
        </div>
        <div className="p-6 font-mono text-sm space-y-2">
          {scene.commands.map((c, i) => (
            <motion.div
              key={i}
              initial={{ x: -30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.8 + i * 1.5, duration: 0.4 }}
              className="text-emerald-300"
            >
              <span className="text-slate-500">$ </span>
              {c}
            </motion.div>
          ))}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 5.5, duration: 0.5 }}
            className="text-cyan-300 pt-3 border-t border-slate-800 mt-3"
          >
            {scene.result}
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

function PricingScene({ scene }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8">
      <motion.h2
        initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="text-4xl md:text-5xl font-black text-white mb-12 text-center"
      >
        {scene.title}
      </motion.h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl w-full">
        {scene.plans.map((p, i) => (
          <motion.div
            key={i}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 + i * 0.3, duration: 0.6, type: "spring" }}
            className={`rounded-xl p-6 text-center border-2 ${
              p.featured
                ? "bg-gradient-to-br from-amber-500/20 to-rose-500/20 border-amber-500 scale-105"
                : "bg-slate-800/60 border-slate-700"
            }`}
          >
            {p.featured && (
              <div className="inline-block px-3 py-0.5 rounded-full bg-amber-500 text-slate-900 text-[10px] font-black uppercase tracking-wider mb-2">
                En Popüler
              </div>
            )}
            <div className={`text-xs font-bold uppercase tracking-widest mb-2 ${
              p.featured ? "text-amber-300" : "text-slate-400"
            }`}>{p.name}</div>
            <div className={`text-4xl font-black mb-1 ${
              p.featured ? "text-white" : "text-slate-200"
            }`}>{p.price}</div>
            <div className="text-xs text-slate-500 mb-4">{p.tag}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function CtaScene({ scene }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8 text-center">
      <motion.div
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, type: "spring", stiffness: 80 }}
        className="w-24 h-24 rounded-2xl bg-gradient-to-br from-emerald-400 via-cyan-400 to-indigo-500 flex items-center justify-center mb-6 shadow-2xl shadow-emerald-500/40"
      >
        <Rocket className="w-14 h-14 text-white" />
      </motion.div>
      <motion.h2
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="text-6xl md:text-7xl font-black text-white mb-4"
      >
        {scene.title}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 0.6 }}
        className="text-xl text-slate-300 mb-12"
      >
        {scene.subtitle}
      </motion.p>
      <motion.a
        href={`https://${scene.cta}`}
        target="_blank" rel="noreferrer"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.6 }}
        whileHover={{ scale: 1.05 }}
        className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 text-white text-lg font-bold shadow-2xl shadow-emerald-500/40"
      >
        {scene.cta}
        <ChevronRight className="w-5 h-5" />
      </motion.a>
      <motion.p
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ delay: 2.5, duration: 0.5 }}
        className="text-sm text-slate-500 mt-8"
      >
        Destek: <span className="text-slate-300 mono">{scene.supportEmail}</span>
      </motion.p>
    </div>
  );
}

const SCENE_COMPONENTS = {
  logo: LogoScene,
  problem: ProblemScene,
  solution: SolutionScene,
  engine_flow: EngineFlowScene,
  threat_grid: ThreatGridScene,
  topology: TopologyScene,
  big_stats: BigStatsScene,
  install: InstallScene,
  pricing: PricingScene,
  cta: CtaScene,
};


// ═══════════════════════════════════════════════════════════════
// ANA PLAYER BİLEŞENİ
// ═══════════════════════════════════════════════════════════════

export default function PromoVideo() {
  const [sceneIdx, setSceneIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);  // 0-100
  const [fullscreen, setFullscreen] = useState(false);
  const [audio, setAudio] = useState(false);
  const containerRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const rafRef = useRef(null);
  const audioCtxRef = useRef(null);
  const oscRef = useRef(null);

  const scene = SCENES[sceneIdx];

  // Progress + auto-advance
  useEffect(() => {
    if (!playing) return;
    startTimeRef.current = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const p = Math.min(100, (elapsed / scene.duration) * 100);
      setProgress(p);
      if (elapsed >= scene.duration) {
        if (sceneIdx < SCENES.length - 1) {
          setSceneIdx(i => i + 1);
        } else {
          setPlaying(false);
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [sceneIdx, playing, scene.duration]);

  // Simple ambient audio (WebAudio synth - can be replaced with real music)
  useEffect(() => {
    if (audio && !audioCtxRef.current) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const gain = ctx.createGain();
        gain.gain.value = 0.06;
        gain.connect(ctx.destination);
        const osc1 = ctx.createOscillator();
        osc1.type = "sine";
        osc1.frequency.value = 220;
        const osc2 = ctx.createOscillator();
        osc2.type = "triangle";
        osc2.frequency.value = 330;
        osc1.connect(gain); osc2.connect(gain);
        osc1.start(); osc2.start();
        audioCtxRef.current = ctx;
        oscRef.current = [osc1, osc2, gain];
      } catch (e) {
        console.warn("Audio init failed:", e);
      }
    } else if (!audio && audioCtxRef.current) {
      try {
        oscRef.current?.[2].gain.setValueAtTime(0.06, audioCtxRef.current.currentTime);
        oscRef.current?.[2].gain.exponentialRampToValueAtTime(0.001, audioCtxRef.current.currentTime + 0.3);
        setTimeout(() => {
          audioCtxRef.current?.close();
          audioCtxRef.current = null;
        }, 400);
      } catch (e) {}
    }
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    };
  }, [audio]);

  const restart = () => {
    setSceneIdx(0);
    setProgress(0);
    setPlaying(true);
    startTimeRef.current = Date.now();
  };

  const jumpTo = (i) => {
    setSceneIdx(i);
    setProgress(0);
    startTimeRef.current = Date.now();
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen?.();
      setFullscreen(true);
    } else {
      await document.exitFullscreen?.();
      setFullscreen(false);
    }
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "GökyüzüWebSpam · Sistem Tanıtımı",
          text: "cPanel/WHM için kurumsal mail güvenlik suite",
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Tanıtım linki kopyalandı — paylaşabilirsiniz");
      }
    } catch (e) {}
  };

  const SceneComp = SCENE_COMPONENTS[scene.type] || (() => <div>?</div>);
  const totalProgress = ((sceneIdx * 100) + progress) / SCENES.length;

  return (
    <div
      ref={containerRef}
      data-testid="promo-video"
      className={`relative bg-slate-950 text-white overflow-hidden ${
        fullscreen ? "w-screen h-screen" : "w-full h-[calc(100vh-3rem)] rounded-xl"
      }`}
    >
      {/* Animated background gradient per scene */}
      <AnimatePresence mode="wait">
        <motion.div
          key={scene.id + "-bg"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
          className={`absolute inset-0 bg-gradient-to-br ${scene.bg}`}
        />
      </AnimatePresence>

      {/* Grid overlay for tech aesthetic */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:60px_60px] pointer-events-none" />

      {/* Scene content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={scene.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <SceneComp scene={scene} />
        </motion.div>
      </AnimatePresence>

      {/* Watermark */}
      <div className="absolute top-4 right-4 flex items-center gap-2 text-white/40 text-[10px] uppercase tracking-widest font-bold">
        <Shield className="w-3 h-3" />
        GökyüzüWebSpam · v43.99
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-6 pb-4 pt-8">
        {/* Progress bar (total video) */}
        <div className="mb-3">
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-rose-400"
              style={{ width: `${totalProgress}%` }}
            />
          </div>
          {/* Scene dots */}
          <div className="flex gap-1 mt-2">
            {SCENES.map((s, i) => (
              <button
                key={i}
                onClick={() => jumpTo(i)}
                data-testid={`scene-dot-${i}`}
                className={`h-1 flex-1 rounded-full transition-all ${
                  i === sceneIdx ? "bg-white" : i < sceneIdx ? "bg-white/60" : "bg-white/20"
                }`}
                title={`Sahne ${i + 1}: ${s.title}`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPlaying(p => !p)}
              data-testid="promo-play-pause"
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              title={playing ? "Duraklat" : "Devam Et"}
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <button
              onClick={restart}
              data-testid="promo-restart"
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              title="Baştan Başlat"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <div className="text-white/70 text-xs ml-2 font-mono">
              Sahne {sceneIdx + 1}/{SCENES.length}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAudio(a => !a)}
              data-testid="promo-audio"
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                audio ? "bg-emerald-500/30" : "bg-white/10 hover:bg-white/20"
              }`}
              title="Ambient Ses"
            >
              {audio ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button
              onClick={share}
              data-testid="promo-share"
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              title="Paylaş"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <button
              onClick={toggleFullscreen}
              data-testid="promo-fullscreen"
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              title="Tam Ekran"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Kayıt Rehberi (küçük yardım metni) */}
        <div className="text-center text-[10px] text-white/40 mt-2">
          💡 MP4/YouTube upload için: OBS Studio veya ekran kaydı yazılımı ile bu sayfayı tam ekran modda kaydedin (~90 sn)
        </div>
      </div>
    </div>
  );
}
