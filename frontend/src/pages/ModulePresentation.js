/**
 * ModulePresentation — Kurulum Sonrası Modül Tanıtım Sunumu (Interaktif)
 * v43.99.19 · ~4-5 dakika · 24 modül tek tek animasyonlu tanıtım
 *
 * Kategoriler:
 *  · Bölüm 1: Çekirdek Motorlar (5)
 *  · Bölüm 2: Threat Defense (10)
 *  · Bölüm 3: Raporlama & Analitik (4)
 *  · Bölüm 4: Sistem Güvenliği (5)
 *
 * Otomatik oynatır · Duraklat · Geri / İleri · Sahne noktasından atlar · Tam Ekran · Kayıt Modu
 */
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import {
  Play, Pause, RotateCcw, Maximize2, ChevronLeft, ChevronRight,
  Shield, Brain, Radar, Bell, Server, Lock, KeyRound, Eye, Zap,
  Mail, TrendingUp, BarChart3, FileText, Activity, Users, Globe,
  Database, HardDrive, CheckCircle2, AlertTriangle, Bug, Fingerprint,
  Sparkles, Rocket, Cpu, Search, MousePointer2, Skull, Link2,
  Archive, RefreshCcw, ClipboardCheck, Home, Volume2, VolumeX,
} from "lucide-react";
import { useNarrator } from "@/hooks/useNarrator";

// ═════════════════════════════════════════════════════════════════
// MODÜL KATALOĞU (24 modül · her biri 10 sn)
// ═════════════════════════════════════════════════════════════════
const MODULES = [
  // ═══ BÖLÜM 1: ÇEKİRDEK MOTORLAR ═══
  {
    section: "core", sectionLabel: "Çekirdek Motorlar",
    icon: Cpu, name: "SpamAssassin",
    tag: "İçerik Tabanlı Skorlama",
    color: "cyan",
    what: "Her gelen mailin içeriğini 950+ kural ile analiz eder, spam skoru (0-10) çıkarır.",
    how: [
      "SMTP kabul aşamasında subject + body + header taranır",
      "Kelimeler, HTML yapısı, link davranışı skorlanır",
      "5.0+ skor → karantina, 7.0+ → reddedilir",
    ],
    stat: { value: "950+", label: "Aktif kural" },
  },
  {
    section: "core", sectionLabel: "Çekirdek Motorlar",
    icon: Bug, name: "ClamAV Antivirus",
    tag: "Malware / Virüs Taraması",
    color: "rose",
    what: "Her ek dosyayı gerçek zamanlı virüs veritabanı ile karşılaştırır. Trojan, ransomware, exploit içerikli attachment'lar anında yakalanır.",
    how: [
      "Ek dosya SMTP MIME parse edilir",
      "ClamAV daemon → 8.6M+ imza veritabanı",
      "Enfekte tespit edildiğinde mail bloklanır + admin uyarılır",
    ],
    stat: { value: "8.6M+", label: "Virüs imzası" },
  },
  {
    section: "core", sectionLabel: "Çekirdek Motorlar",
    icon: Fingerprint, name: "DCC + Razor + Pyzor",
    tag: "Bulk Mail Parmak İzi",
    color: "amber",
    what: "Toplu gönderilen (bulk) mailleri global fingerprint ağlarıyla eşleştirir. Aynı mailin başka sunuculara da gittiğini tespit eder.",
    how: [
      "Her mailin hash'i alınır ve global DCC ağına sorulur",
      "Aynı hash 1000+ kere görülmüşse → BULK etiketi",
      "Newsletter'lar allow-list ile korunur",
    ],
    stat: { value: "3", label: "Fingerprint ağı" },
  },
  {
    section: "core", sectionLabel: "Çekirdek Motorlar",
    icon: Shield, name: "SPF / DKIM / DMARC",
    tag: "Kimlik Doğrulama",
    color: "emerald",
    what: "Gelen mailin gerçekten iddia ettiği domain'den gelip gelmediğini kriptografik olarak doğrular. Spoofing/impersonation'ı sıfırlar.",
    how: [
      "SPF: Sender IP DNS TXT kaydında mı?",
      "DKIM: RSA imza mail header'ında geçerli mi?",
      "DMARC: SPF/DKIM sonuçlarına göre politika uygular",
    ],
    stat: { value: "%99.4", label: "Spoof engelleme" },
  },
  {
    section: "core", sectionLabel: "Çekirdek Motorlar",
    icon: Brain, name: "LLM AI Classifier",
    tag: "Yapay Zeka Sınıflandırıcı",
    color: "fuchsia",
    what: "Kural bazlı motorların şüpheli bulduğu maillere Claude/GPT modelleri final karar verir. Sosyal mühendislik + kontekst anlar.",
    how: [
      "SpamAssassin skoru 3.0-6.0 arası → LLM'e gönder",
      "Claude Sonnet mail'i okuyup 'PHISH/SPAM/HAM' verdict verir",
      "İnce sosyal mühendislik saldırılarını yakalar",
    ],
    stat: { value: "%98.7", label: "AI doğruluk" },
  },

  // ═══ BÖLÜM 2: THREAT DEFENSE ═══
  {
    section: "threat", sectionLabel: "Threat Defense Center",
    icon: Skull, name: "Phishing Simulator",
    tag: "Personel Farkındalık Testi",
    color: "rose",
    what: "Sahte phishing mailleri kendi personelinize gönderir, kim tıklıyor izler. HR raporlarıyla farkındalık eğitim ihtiyacını gösterir.",
    how: [
      "Şablon galerisinden (banka, kargo, IT) mail seç",
      "Sistem sizin domain'inizden gönderiyor gibi yollar",
      "Kim link tıkladı / veri girdi → dashboard'da liste",
    ],
    stat: { value: "38", label: "Hazır şablon" },
  },
  {
    section: "threat", sectionLabel: "Threat Defense Center",
    icon: Eye, name: "BEC Dedektörü",
    tag: "İş E-postası Ele Geçirme",
    color: "amber",
    what: "CEO adına gönderilen sahte havale/fatura maillerini yakalar. Bank fraud'un en yaygın vektörüdür.",
    how: [
      "Reply-to ≠ From adresi anomali sinyali",
      "Yönetici isimlerine ML fuzzy-match",
      "'Acil havale', 'gizli' kelimeleri → skor +4",
    ],
    stat: { value: "$47B", label: "Global yıllık BEC zararı" },
  },
  {
    section: "threat", sectionLabel: "Threat Defense Center",
    icon: Fingerprint, name: "Brand Impersonation",
    tag: "Marka Taklidi Tespiti",
    color: "cyan",
    what: "Amazon, Apple, PayPal gibi büyük markaları taklit eden phishing mailleri homoglyph + logo pattern analizi ile yakalar.",
    how: [
      "Sender domain'e homoglyph skoru (аmаzon.com → ⚠)",
      "HTML body'de logo hash karşılaştırma",
      "Marka whitelisted domain listesinden hızlı doğrulama",
    ],
    stat: { value: "500+", label: "Korunan marka" },
  },
  {
    section: "threat", sectionLabel: "Threat Defense Center",
    icon: BarChart3, name: "DMARC Monitor",
    tag: "Domain Politika İzleyici",
    color: "indigo",
    what: "Kendi domain'inizin DMARC aggregate raporlarını (RUA/RUF) toplar, kim adınıza mail gönderiyor haritasını çıkarır.",
    how: [
      "Google/Microsoft/Yahoo günlük DMARC raporu gönderir",
      "Sistem XML'leri parse edip görselleştirir",
      "Meşru göndericiler → SPF/DKIM önerisi",
    ],
    stat: { value: "24/7", label: "Otomatik toplama" },
  },
  {
    section: "threat", sectionLabel: "Threat Defense Center",
    icon: Archive, name: "Attachment Sandbox",
    tag: "İzole Ek Dosya Analizi",
    color: "violet",
    what: "Şüpheli ek dosyaları izole Docker sandbox'ta çalıştırır, davranışını (network, disk, registry) kaydeder.",
    how: [
      ".exe, .zip, .docm, .pdf → sandbox VM'e gönderilir",
      "60 sn içinde makro çalıştırma, dosya yazma izlenir",
      "Zararlı davranış tespit edilirse mail bloklanır",
    ],
    stat: { value: "60 sn", label: "Analiz süresi" },
  },
  {
    section: "threat", sectionLabel: "Threat Defense Center",
    icon: Link2, name: "URL Rewrite / Safe Links",
    tag: "Link Yeniden Yazma",
    color: "emerald",
    what: "Mail içindeki tüm linkleri güvenli proxy adresine çevirir. Kullanıcı tıkladığında önce sunucu URL'i tarar, sonra iletir.",
    how: [
      "Body'deki her http/https link → panel-proxy/safe/{hash}",
      "Tıklandığında canlı: virustotal + reputation kontrolü",
      "Şüpheli ise 'Devam Etmek İstediğinize Emin Misiniz?' uyarısı",
    ],
    stat: { value: "%76", label: "Kliksonrası engelleme" },
  },
  {
    section: "threat", sectionLabel: "Threat Defense Center",
    icon: RefreshCcw, name: "Bounce Digest Monitor",
    tag: "Bounce Analizi + Uyarı",
    color: "orange",
    what: "Sunucudan dönen bounce maillerini sınıflandırır (hard/soft, spam-block, mailbox-full). Reputation problemlerini erken yakalar.",
    how: [
      "Postfix bounce log'ları saatlik parse edilir",
      "SMTP kodları kategorize edilir (5.x.x hard, 4.x.x soft)",
      "Anomali (>%3 bounce oranı) → Slack/Telegram uyarısı",
    ],
    stat: { value: "%3", label: "Kritik bounce eşiği" },
  },
  {
    section: "threat", sectionLabel: "Threat Defense Center",
    icon: Radar, name: "RBL / DNSBL Yöneticisi",
    tag: "IP Kara Liste Kontrolü",
    color: "rose",
    what: "Kendi sunucu IP'nizi 50+ global RBL listesinde canlı sorgular. Listeye düşerseniz anında haber verir + delisting rehberi sunar.",
    how: [
      "Her 15 dk: Spamhaus, Barracuda, SpamCop... sorgusu",
      "Listede tespit → panel banner + e-posta uyarısı",
      "Otomatik delisting form açar + reputation önerileri",
    ],
    stat: { value: "50+", label: "İzlenen RBL" },
  },
  {
    section: "threat", sectionLabel: "Threat Defense Center",
    icon: Zap, name: "Mail Simulator",
    tag: "Canlı Test Enjekte",
    color: "amber",
    what: ".eml dosyalarını sisteme yapıştırarak tüm motorlara canlı test yaptırın. QA + audit için ideal.",
    how: [
      "Panel → Mail Simulator → .eml içeriği yapıştır",
      "Motor sonuçları saniyeler içinde ekranda listelenir",
      "SpamAssassin skoru, virüs sonucu, AI verdict tek panoda",
    ],
    stat: { value: "6", label: "Paralel motor" },
  },
  {
    section: "threat", sectionLabel: "Threat Defense Center",
    icon: Sparkles, name: "AI Assistant · Claude",
    tag: "Chat ile Mail Analizi",
    color: "fuchsia",
    what: "Şüpheli maili AI'ya yapıştır, doğal dilde açıklama iste. 'Bu mail neden phishing?' sorusunun cevabı 2 sn'de gelir.",
    how: [
      "Emergent LLM Key üzerinden Claude Sonnet 5",
      "Multi-turn chat: session ID ile hafıza korunur",
      "PII sızıntısı otomatik redakte edilir",
    ],
    stat: { value: "2 sn", label: "Ortalama yanıt" },
  },

  // ═══ BÖLÜM 3: RAPORLAMA ═══
  {
    section: "report", sectionLabel: "Raporlama & Analitik",
    icon: Activity, name: "Canlı Mail Trafiği",
    tag: "Real-Time Stream",
    color: "cyan",
    what: "WebSocket üzerinden saniye başı gelen/giden mail akışını izleyin. Anlık spike'lar + shadow-ban riskleri hemen görünür.",
    how: [
      "Backend → panel WebSocket bağlantısı",
      "Her mail: sender, subject hash, verdict + latency",
      "Sparkline grafiği + hız limit uyarısı",
    ],
    stat: { value: "<50ms", label: "Panel gecikmesi" },
  },
  {
    section: "report", sectionLabel: "Raporlama & Analitik",
    icon: TrendingUp, name: "Mail Aktivite Raporu",
    tag: "Detaylı Aktivite Analizi",
    color: "emerald",
    what: "Domain, kullanıcı, saat bazlı gönderim/spam oranı raporları. Sorunlu hesabı 5 sn'de tespit edin.",
    how: [
      "MongoDB aggregation pipeline (dashboards)",
      "Tarih, domain, verdict filtrelemesi",
      "CSV/PDF export · e-posta ile rapor gönderimi",
    ],
    stat: { value: "365 gün", label: "Retention (Enterprise)" },
  },
  {
    section: "report", sectionLabel: "Raporlama & Analitik",
    icon: FileText, name: "Multi-Language PDF Rapor",
    tag: "TR / EN / AR Otomatik PDF",
    color: "indigo",
    what: "Yönetici raporları PDF olarak 3 dilde otomatik üretilir. Türkçe karakter, RTL Arapça desteği tam çalışır.",
    how: [
      "ReportLab + DejaVu font (Türkçe ıŞğ karakterler)",
      "Server-side render · <5 sn üretim",
      "Kurulum rehberi + haftalık executive summary",
    ],
    stat: { value: "3 dil", label: "TR · EN · AR" },
  },
  {
    section: "report", sectionLabel: "Raporlama & Analitik",
    icon: Users, name: "Bayi Trafik Panosu",
    tag: "Multi-Tenant Overview",
    color: "violet",
    what: "Master hesabında tüm bayilerin canlı trafiği tek panoda. Kim ne kadar mail atıyor, spam oranı ne — anlık.",
    how: [
      "Reseller-scoped MongoDB collection'lar",
      "Cross-tenant aggregation (yalnızca master görebilir)",
      "Tıklandığında bayi paneline drill-down",
    ],
    stat: { value: "∞", label: "Bayi limiti" },
  },

  // ═══ BÖLÜM 4: SİSTEM GÜVENLİĞİ ═══
  {
    section: "system", sectionLabel: "Sistem Güvenliği",
    icon: KeyRound, name: "2FA · TOTP",
    tag: "İki Faktörlü Doğrulama",
    color: "emerald",
    what: "Google Authenticator / Authy TOTP kodu ile giriş. Kritik işlemlerde (webhook değişimi, master rotation) yeniden zorunlu.",
    how: [
      "PyOTP · RFC 6238 standardı",
      "Encrypted secret (Fernet) MongoDB'de saklanır",
      "8 backup recovery code — offline yedek erişim",
    ],
    stat: { value: "30 sn", label: "TOTP döngüsü" },
  },
  {
    section: "system", sectionLabel: "Sistem Güvenliği",
    icon: Lock, name: "Idle Auto-Lock",
    tag: "Otomatik Ekran Kilidi",
    color: "amber",
    what: "5 dk hareketsizlik sonrası panel otomatik kilitlenir. PIN ile açılır — masabaşından kalktığınızda mailinize kimse bakamaz.",
    how: [
      "Client-side idle detection (mousemove/keydown)",
      "Kilit ekranı: bcrypt hashed 4-6 haneli PIN",
      "3 hatalı deneme → hesap PIN reset zorunluluğu",
    ],
    stat: { value: "5 dk", label: "Varsayılan timeout" },
  },
  {
    section: "system", sectionLabel: "Sistem Güvenliği",
    icon: ClipboardCheck, name: "PIN Onay Sistemi",
    tag: "Bayi PIN Reset Onayı",
    color: "cyan",
    what: "Bayi PIN'ini unuttuğunda master'a onay isteği düşer. Master onayladığında bayi yeni PIN belirleyebilir — güvenli kurtarma.",
    how: [
      "Bayi 'PIN Unuttum' → master paneline istek",
      "Master 'Onay/Red' → e-posta bilgilendirmesi",
      "PIN history log'lanır (denetim kaydı)",
    ],
    stat: { value: "24s", label: "Onay süresi" },
  },
  {
    section: "system", sectionLabel: "Sistem Güvenliği",
    icon: HardDrive, name: "Otomatik DB Backup",
    tag: "Haftalık MongoDB Snapshot",
    color: "indigo",
    what: "Pazar 03:00'te MongoDB dump'ı otomatik alınır, 12 hafta saklanır. Disaster recovery için tek tıkla restore.",
    how: [
      "APScheduler haftalık cron",
      "mongodump → gzip → /app/backend/backups/",
      "Master paneli: son 12 snapshot listesi + tek tık restore",
    ],
    stat: { value: "12 hafta", label: "Retention" },
  },
  {
    section: "system", sectionLabel: "Sistem Güvenliği",
    icon: Globe, name: "Master / Bayi İzolasyon",
    tag: "Multi-Tenant Data Scoping",
    color: "fuchsia",
    what: "Her bayi kendi verisini görür. Master global görüş sahibi. Cross-tenant sızıntı olma ihtimali sıfır — collection prefix'i ile hard-isolate.",
    how: [
      "Her doc: reseller_id + scope filter zorunlu",
      "API middleware her sorguyu enjeksiyonla doğrular",
      "Auto-testing agent: cross-tenant leak testi geçer",
    ],
    stat: { value: "0", label: "Sızıntı raporu" },
  },
];

const SECTION_META = {
  core:   { label: "1 · Çekirdek Motorlar",     color: "from-cyan-500 to-blue-600",       accent: "cyan" },
  threat: { label: "2 · Threat Defense Center", color: "from-fuchsia-500 to-rose-500",    accent: "rose" },
  report: { label: "3 · Raporlama & Analitik",  color: "from-emerald-500 to-teal-500",    accent: "emerald" },
  system: { label: "4 · Sistem Güvenliği",      color: "from-amber-500 to-orange-500",    accent: "amber" },
};

const COLOR_CLASSES = {
  cyan:     { border: "border-cyan-500/40",    bg: "bg-cyan-500/10",    text: "text-cyan-300",    grad: "from-cyan-500 to-blue-600" },
  rose:     { border: "border-rose-500/40",    bg: "bg-rose-500/10",    text: "text-rose-300",    grad: "from-rose-500 to-pink-600" },
  amber:    { border: "border-amber-500/40",   bg: "bg-amber-500/10",   text: "text-amber-300",   grad: "from-amber-500 to-orange-600" },
  emerald:  { border: "border-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-300", grad: "from-emerald-500 to-teal-600" },
  fuchsia:  { border: "border-fuchsia-500/40", bg: "bg-fuchsia-500/10", text: "text-fuchsia-300", grad: "from-fuchsia-500 to-purple-600" },
  indigo:   { border: "border-indigo-500/40",  bg: "bg-indigo-500/10",  text: "text-indigo-300",  grad: "from-indigo-500 to-blue-600" },
  violet:   { border: "border-violet-500/40",  bg: "bg-violet-500/10",  text: "text-violet-300",  grad: "from-violet-500 to-purple-600" },
  orange:   { border: "border-orange-500/40",  bg: "bg-orange-500/10",  text: "text-orange-300",  grad: "from-orange-500 to-red-500" },
};

const SLIDE_DURATION = 10000; // 10 sn her modül

// ═════════════════════════════════════════════════════════════════
// SAHNE BİLEŞENLERİ
// ═════════════════════════════════════════════════════════════════
function ModuleSlide({ mod, isActive }) {
  const Icon = mod.icon;
  const cc = COLOR_CLASSES[mod.color] || COLOR_CLASSES.cyan;
  const sectionMeta = SECTION_META[mod.section];

  return (
    <div className="w-full h-full flex flex-col justify-center px-4 sm:px-8 md:px-16 py-6">
      {/* Section badge */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={isActive ? { y: 0, opacity: 1 } : {}}
        transition={{ duration: 0.5 }}
        className={`inline-flex self-start items-center gap-2 px-3 py-1 rounded-full ${cc.bg} ${cc.border} border ${cc.text} text-[10px] uppercase tracking-widest font-bold mb-4`}
      >
        <Sparkles className="w-3 h-3" /> {sectionMeta.label}
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-start">
        {/* Icon */}
        <motion.div
          initial={{ scale: 0.4, rotate: -30, opacity: 0 }}
          animate={isActive ? { scale: 1, rotate: 0, opacity: 1 } : {}}
          transition={{ duration: 0.7, type: "spring", stiffness: 90 }}
          className={`w-24 h-24 md:w-32 md:h-32 rounded-2xl bg-gradient-to-br ${cc.grad} flex items-center justify-center shadow-2xl`}
          style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
        >
          <Icon className="w-12 h-12 md:w-16 md:h-16 text-white" strokeWidth={2} />
        </motion.div>

        {/* Text */}
        <div className="min-w-0">
          <motion.div
            initial={{ x: 40, opacity: 0 }}
            animate={isActive ? { x: 0, opacity: 1 } : {}}
            transition={{ delay: 0.3, duration: 0.5 }}
            className={`text-[10px] uppercase tracking-[0.3em] font-bold ${cc.text} mb-2`}
          >
            {mod.tag}
          </motion.div>
          <motion.h2
            initial={{ x: 40, opacity: 0 }}
            animate={isActive ? { x: 0, opacity: 1 } : {}}
            transition={{ delay: 0.4, duration: 0.5 }}
            className="text-3xl md:text-5xl font-black text-white leading-tight tracking-tight mb-4"
          >
            {mod.name}
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={isActive ? { opacity: 1 } : {}}
            transition={{ delay: 0.7, duration: 0.6 }}
            className="text-base md:text-lg text-slate-300 leading-relaxed max-w-2xl"
          >
            {mod.what}
          </motion.p>
        </div>
      </div>

      {/* How + Stat */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-6 mt-8">
        <div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={isActive ? { opacity: 1 } : {}}
            transition={{ delay: 1.2 }}
            className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2"
          >
            Nasıl çalışır?
          </motion.div>
          <ul className="space-y-2">
            {mod.how.map((h, i) => (
              <motion.li
                key={i}
                initial={{ x: -20, opacity: 0 }}
                animate={isActive ? { x: 0, opacity: 1 } : {}}
                transition={{ delay: 1.4 + i * 0.4, duration: 0.4 }}
                className="flex items-start gap-2 text-[13px] md:text-sm text-slate-300"
              >
                <div className={`w-5 h-5 rounded-full ${cc.bg} ${cc.border} border flex items-center justify-center shrink-0 mt-0.5`}>
                  <CheckCircle2 className={`w-3 h-3 ${cc.text}`} />
                </div>
                <span>{h}</span>
              </motion.li>
            ))}
          </ul>
        </div>
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={isActive ? { scale: 1, opacity: 1 } : {}}
          transition={{ delay: 2.8, type: "spring", stiffness: 120 }}
          className={`${cc.bg} ${cc.border} border-2 rounded-xl p-5 text-center self-start`}
        >
          <div className={`text-4xl md:text-5xl font-black ${cc.text} font-mono leading-none mb-1`}>
            {mod.stat.value}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
            {mod.stat.label}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// Bölüm başlığı sahnesi (her section başında)
function SectionIntroSlide({ section, isActive }) {
  const meta = SECTION_META[section];
  const cc = COLOR_CLASSES[meta.accent];
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center px-8">
      <motion.div
        initial={{ scale: 0.3, opacity: 0 }}
        animate={isActive ? { scale: 1, opacity: 1 } : {}}
        transition={{ duration: 1, type: "spring", stiffness: 60 }}
        className={`w-32 h-32 rounded-2xl bg-gradient-to-br ${meta.color} flex items-center justify-center shadow-2xl mb-8`}
      >
        <Sparkles className="w-16 h-16 text-white" />
      </motion.div>
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={isActive ? { y: 0, opacity: 1 } : {}}
        transition={{ delay: 0.5, duration: 0.6 }}
        className={`text-[11px] uppercase tracking-[0.5em] font-bold ${cc.text} mb-3`}
      >
        Bölüm
      </motion.div>
      <motion.h1
        initial={{ y: 20, opacity: 0 }}
        animate={isActive ? { y: 0, opacity: 1 } : {}}
        transition={{ delay: 0.8, duration: 0.7 }}
        className="text-5xl md:text-6xl font-black text-white tracking-tight"
      >
        {meta.label.split(" · ")[1]}
      </motion.h1>
    </div>
  );
}

// Açılış + kapanış
function IntroSlide({ isActive }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center px-8">
      <motion.div
        initial={{ scale: 0.4, opacity: 0, rotateY: -180 }}
        animate={isActive ? { scale: 1, opacity: 1, rotateY: 0 } : {}}
        transition={{ duration: 1.2, type: "spring", stiffness: 60 }}
        className="w-32 h-32 rounded-2xl bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-rose-500 flex items-center justify-center shadow-2xl mb-8"
      >
        <Shield className="w-20 h-20 text-white" strokeWidth={2.5} />
      </motion.div>
      <motion.h1
        initial={{ y: 30, opacity: 0 }}
        animate={isActive ? { y: 0, opacity: 1 } : {}}
        transition={{ delay: 0.7, duration: 0.7 }}
        className="text-5xl md:text-7xl font-black text-white tracking-tight mb-4"
      >
        Modül Turu
      </motion.h1>
      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={isActive ? { y: 0, opacity: 1 } : {}}
        transition={{ delay: 1.1, duration: 0.6 }}
        className="text-xl md:text-2xl text-slate-300 max-w-2xl leading-relaxed"
      >
        Kurulum tamamlandı. Şimdi sisteminizin <b className="text-fuchsia-300">24 kritik modülünü</b> tek tek görelim.
      </motion.p>
      <motion.div
        initial={{ opacity: 0 }}
        animate={isActive ? { opacity: 1 } : {}}
        transition={{ delay: 1.7, duration: 0.6 }}
        className="mt-8 flex items-center gap-6 text-[11px] uppercase tracking-widest font-bold"
      >
        <div><span className="text-cyan-300 text-2xl mono">5</span> <span className="text-slate-400">Motor</span></div>
        <div><span className="text-rose-300 text-2xl mono">10</span> <span className="text-slate-400">Threat</span></div>
        <div><span className="text-emerald-300 text-2xl mono">4</span> <span className="text-slate-400">Rapor</span></div>
        <div><span className="text-amber-300 text-2xl mono">5</span> <span className="text-slate-400">Sistem</span></div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={isActive ? { opacity: 1 } : {}}
        transition={{ delay: 2.4, duration: 0.6 }}
        className="mt-10 text-[10px] uppercase tracking-[0.5em] text-slate-500 font-bold flex items-center gap-2"
      >
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        4 dakika · 24 modül · Otomatik ilerler
      </motion.div>
    </div>
  );
}

function OutroSlide({ isActive }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-center px-8">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={isActive ? { scale: 1, opacity: 1 } : {}}
        transition={{ duration: 1, type: "spring" }}
        className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shadow-2xl mb-6"
      >
        <CheckCircle2 className="w-14 h-14 text-white" />
      </motion.div>
      <motion.h1
        initial={{ y: 20, opacity: 0 }}
        animate={isActive ? { y: 0, opacity: 1 } : {}}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="text-5xl md:text-6xl font-black text-white mb-4"
      >
        Hepsi bu kadar 🎉
      </motion.h1>
      <motion.p
        initial={{ opacity: 0 }}
        animate={isActive ? { opacity: 1 } : {}}
        transition={{ delay: 1, duration: 0.6 }}
        className="text-xl text-slate-300 max-w-2xl leading-relaxed mb-8"
      >
        24 modülün genel akışını gördünüz. Şimdi panelinize dönüp keşfe başlayabilirsiniz.
      </motion.p>
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={isActive ? { y: 0, opacity: 1 } : {}}
        transition={{ delay: 1.5, duration: 0.5 }}
        className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl w-full"
      >
        <Link
          to="/panel/"
          className="px-5 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm inline-flex items-center justify-center gap-2 transition"
        >
          <Home className="w-4 h-4" /> Dashboard
        </Link>
        <Link
          to="/panel/threat-defense"
          className="px-5 py-3 rounded-lg bg-fuchsia-500 hover:bg-fuchsia-600 text-white font-bold text-sm inline-flex items-center justify-center gap-2 transition"
        >
          <Shield className="w-4 h-4" /> Threat Defense
        </Link>
        <Link
          to="/panel/docs"
          className="px-5 py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm inline-flex items-center justify-center gap-2 transition"
        >
          <FileText className="w-4 h-4" /> Dokümanlar
        </Link>
      </motion.div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// SLIDE ZİNCİRİ ÜRETİMİ (Intro + section intros + modules + outro)
// ═════════════════════════════════════════════════════════════════
function buildSlideChain() {
  const slides = [];
  slides.push({ kind: "intro", id: "intro", duration: 6500 });
  let lastSection = null;
  for (const m of MODULES) {
    if (m.section !== lastSection) {
      slides.push({ kind: "section", id: `section-${m.section}`, section: m.section, duration: 4500 });
      lastSection = m.section;
    }
    slides.push({ kind: "module", id: m.name, module: m, duration: SLIDE_DURATION });
  }
  slides.push({ kind: "outro", id: "outro", duration: 8000 });
  return slides;
}

// v44.00.03 — Slaytlar için Türkçe seslendirme metni üretici (browser TTS)
function buildNarrationText(slide) {
  if (!slide) return "";
  if (slide.kind === "intro") {
    return "GökyüzüWebSpam modül turuna hoş geldiniz. Yaklaşık dört dakika boyunca yirmi dört modülün ne yaptığını sırayla anlatacağız.";
  }
  if (slide.kind === "outro") {
    return "Modül turu tamamlandı. Panele geri dönerek istediğiniz modülü hemen kullanmaya başlayabilirsiniz.";
  }
  if (slide.kind === "section") {
    const meta = SECTION_META[slide.section];
    return `Bölüm ${meta?.label || slide.section}.`;
  }
  if (slide.kind === "module" && slide.module) {
    const m = slide.module;
    // 5 saniyeye sığdır: sadece ad + kısa tanım
    return `${m.name}. ${m.what}`;
  }
  return "";
}

// ═════════════════════════════════════════════════════════════════
// ANA BİLEŞEN
// ═════════════════════════════════════════════════════════════════
export default function ModulePresentation() {
  const slides = useRef(buildSlideChain()).current;
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [recordMode, setRecordMode] = useState(false);
  const containerRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const rafRef = useRef(null);
  const slide = slides[idx];

  // v44.00.03 — Ücretsiz tarayıcı-tabanlı Türkçe seslendirme (Web Speech API)
  const narrator = useNarrator({ lang: "tr-TR", rate: 1.0, pitch: 1.0 });

  // v43.99.20 — Public route (no /panel/ prefix) → standalone fullscreen mode
  const isPublic = typeof window !== "undefined" && !window.location.pathname.startsWith("/panel/");

  // v44.00.03 — Slayt değiştiğinde ilgili anlatımı söyle (mute'lı değilse)
  useEffect(() => {
    if (!narrator.supported) return;
    // Play only when actively playing (not paused) and not in record mode
    if (!playing || recordMode) { narrator.cancel(); return; }
    const text = buildNarrationText(slide);
    if (text) narrator.speak(text);
    return () => narrator.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, playing, recordMode, narrator.muted, narrator.ready]);

  // Auto-advance
  useEffect(() => {
    if (!playing) return;
    startTimeRef.current = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const p = Math.min(100, (elapsed / slide.duration) * 100);
      setProgress(p);
      if (elapsed >= slide.duration) {
        if (idx < slides.length - 1) {
          setIdx(i => i + 1);
        } else {
          setPlaying(false);
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [idx, playing, slide.duration, slides.length]);

  // ESC → çıkış kayıt modu
  useEffect(() => {
    if (!recordMode) return;
    const onKey = (e) => { if (e.key === "Escape") setRecordMode(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recordMode]);

  const restart = () => { setIdx(0); setProgress(0); setPlaying(true); startTimeRef.current = Date.now(); };
  const jumpTo = (i) => { setIdx(i); setProgress(0); startTimeRef.current = Date.now(); };
  const next = () => idx < slides.length - 1 && jumpTo(idx + 1);
  const prev = () => idx > 0 && jumpTo(idx - 1);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen?.();
      setFullscreen(true);
    } else {
      await document.exitFullscreen?.();
      setFullscreen(false);
    }
  };

  const startRecordMode = () => {
    setRecordMode(true); setIdx(0); setProgress(0); setPlaying(true);
    startTimeRef.current = Date.now();
    toast.success("🎬 Kayıt Modu · UI gizlendi. OBS ile ~4 dakika kaydedin");
  };

  const totalDuration = slides.reduce((s, x) => s + x.duration, 0);
  const totalProgress = ((slides.slice(0, idx).reduce((s, x) => s + x.duration, 0) + (progress / 100) * slide.duration) / totalDuration) * 100;

  const currentModuleColor = slide.kind === "module"
    ? (COLOR_CLASSES[slide.module.color]?.grad || "from-slate-800 to-slate-950")
    : slide.kind === "section"
      ? SECTION_META[slide.section].color
      : "from-indigo-900 via-slate-950 to-fuchsia-950";

  return (
    <div
      ref={containerRef}
      data-testid="module-presentation"
      className={`relative bg-slate-950 text-white overflow-hidden ${
        fullscreen || isPublic ? "w-screen h-screen" : "w-full h-[calc(100vh-3rem)] rounded-xl"
      }`}
    >
      {/* Animated backgrounds */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${slide.id}-bg`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
          className={`absolute inset-0 bg-gradient-to-br ${currentModuleColor}`}
          style={{ filter: "brightness(0.5)" }}
        />
      </AnimatePresence>

      {/* Grid overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:60px_60px] pointer-events-none" />

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={slide.id}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          transition={{ duration: 0.6 }}
          className="absolute inset-0 flex items-center justify-center overflow-y-auto"
        >
          {slide.kind === "intro" && <IntroSlide isActive />}
          {slide.kind === "section" && <SectionIntroSlide section={slide.section} isActive />}
          {slide.kind === "module" && <ModuleSlide mod={slide.module} isActive />}
          {slide.kind === "outro" && <OutroSlide isActive />}
        </motion.div>
      </AnimatePresence>

      {/* Watermark */}
      {!recordMode && (
        <div className="absolute top-4 right-4 flex items-center gap-2 text-white/40 text-[10px] uppercase tracking-widest font-bold z-20">
          <Shield className="w-3 h-3" />
          GökyüzüWebSpam · Modül Turu
        </div>
      )}

      {/* Top-left buttons */}
      {!recordMode && (
        <div className="absolute top-4 left-4 flex items-center gap-2 z-30">
          {isPublic ? (
            <Link
              to="/"
              data-testid="mp-back-home"
              className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold inline-flex items-center gap-1.5 backdrop-blur"
            >
              ← Ana Sayfa
            </Link>
          ) : (
            <Link
              to="/panel/tanitim"
              className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold inline-flex items-center gap-1.5 backdrop-blur"
            >
              ← Ürün Tanıtımı
            </Link>
          )}
          <button
            onClick={startRecordMode}
            data-testid="mp-record-mode"
            className="px-3 py-1.5 rounded-md bg-rose-500/80 hover:bg-rose-500 text-white text-[11px] font-bold inline-flex items-center gap-1.5 backdrop-blur"
          >
            🔴 Kayıt Modu
          </button>
        </div>
      )}

      {recordMode && (
        <button
          onClick={() => setRecordMode(false)}
          className="absolute top-2 left-2 z-30 opacity-20 hover:opacity-100 transition-opacity px-2 py-1 rounded bg-black/40 text-white/60 text-[10px]"
        >
          esc
        </button>
      )}

      {/* Bottom controls */}
      {!recordMode && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 to-transparent px-6 pb-4 pt-8 z-20">
          {/* Progress */}
          <div className="mb-3">
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-rose-400"
                style={{ width: `${totalProgress}%` }}
              />
            </div>
            {/* Section dots */}
            <div className="flex gap-1 mt-2">
              {slides.map((s, i) => (
                <button
                  key={i}
                  onClick={() => jumpTo(i)}
                  data-testid={`mp-slide-dot-${i}`}
                  className={`h-1 flex-1 rounded-full transition-all ${
                    i === idx ? "bg-white" : i < idx ? "bg-white/60" : "bg-white/20"
                  }`}
                  title={s.kind === "module" ? s.module.name : s.kind === "section" ? SECTION_META[s.section].label : s.kind === "intro" ? "Giriş" : "Kapanış"}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={prev}
                disabled={idx === 0}
                data-testid="mp-prev"
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed"
                title="Önceki"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPlaying(p => !p)}
                data-testid="mp-play-pause"
                className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                title={playing ? "Duraklat" : "Devam Et"}
              >
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>
              <button
                onClick={next}
                disabled={idx >= slides.length - 1}
                data-testid="mp-next"
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed"
                title="Sonraki"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={restart}
                data-testid="mp-restart"
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                title="Baştan Başlat"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <div className="text-white/70 text-xs ml-2 font-mono">
                {idx + 1} / {slides.length}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* v44.00.03 — Türkçe seslendirme aç/kapat (ücretsiz Web Speech API) */}
              {narrator.supported && (
                <button
                  onClick={() => narrator.setMuted(!narrator.muted)}
                  data-testid="mp-narrator-toggle"
                  className={`w-9 h-9 rounded-full flex items-center justify-center transition ${
                    narrator.muted
                      ? "bg-white/5 hover:bg-white/10 text-white/40"
                      : "bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-100 ring-1 ring-indigo-400/50"
                  }`}
                  title={narrator.muted ? "Seslendirmeyi Aç (Türkçe)" : "Seslendirmeyi Kapat"}
                >
                  {narrator.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                data-testid="mp-fullscreen"
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
                title="Tam Ekran"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="text-center text-[10px] text-white/40 mt-2">
            💡 Sahne noktalarına tıklayarak istediğiniz modüle atlayabilirsiniz · ~4 dk toplam süre
            {narrator.supported && (
              <span className="ml-2 text-indigo-300/70">
                · 🎙️ Türkçe seslendirme {narrator.muted ? "kapalı" : "açık"} (ücretsiz, sunucusuz)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
