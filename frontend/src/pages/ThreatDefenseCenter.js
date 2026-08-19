/**
 * Advanced Threat Defense Center — 28 modül tek panelde
 * v43.99.7 · Fix: focus loss, GET body, açıklama, bağlantılar
 */
import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Shield, Search, AlertTriangle, Globe, Fingerprint, Brain,
  Radio, TrendingUp, ShieldAlert, RotateCcw, Bug, MessageCircle,
  Wand2, ScanSearch, Award, Building2, Mail, Archive, Zap, Map,
  FlaskConical, Smartphone, Chrome, Layers, Network, WifiOff,
  Loader2, X, Send, ExternalLink, Info, Link2, BookOpen,
} from "lucide-react";
import { toast } from "sonner";

const API = process.env.REACT_APP_BACKEND_URL ? `${process.env.REACT_APP_BACKEND_URL}/api` : "/api";

// ---- Inline Button ----
const Btn = ({ children, onClick, disabled, variant = "primary", ...p }) => {
  const cls = variant === "ghost"
    ? "bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800"
    : "bg-indigo-500/15 border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/25";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded border text-sm mono font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
      {...p}
    >
      {children}
    </button>
  );
};

// ---- Stable Field component (OUTSIDE parent to prevent re-mount / focus loss) ----
const Field = ({ label, value, onChange, type = "text", placeholder = "", testid = "" }) => (
  <div className="space-y-1">
    <label className="block text-[11px] text-slate-400 font-medium">{label}</label>
    <input
      type={type}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testid}
      className="w-full bg-slate-950/60 border border-slate-700 rounded px-3 py-2 text-slate-100 text-sm focus:border-indigo-500 focus:outline-none transition-colors"
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
    />
  </div>
);

const TextArea = ({ label, value, onChange, placeholder = "", rows = 3, testid = "" }) => (
  <div className="space-y-1">
    {label && <label className="block text-[11px] text-slate-400 font-medium">{label}</label>}
    <textarea
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      data-testid={testid}
      className="w-full bg-slate-950/60 border border-slate-700 rounded px-3 py-2 text-slate-100 text-sm focus:border-indigo-500 focus:outline-none mono resize-y"
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
    />
  </div>
);

// ---- API caller — GET-safe ----
async function callThreatApi(path, method = "GET", body = null) {
  const url = `${API}/threat${path}`;
  const opts = { method, headers: { "Content-Type": "application/json" } };
  const mk = localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license");
  if (mk) opts.headers["X-Master-Key"] = mk;
  // GET/HEAD asla body gönderemez
  if (body && method !== "GET" && method !== "HEAD") {
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(t.slice(0, 200) || `HTTP ${r.status}`);
  }
  return r.json();
}

// ---- 28 Module catalog ----
// linkTo: sizin panelinizdeki mevcut sayfa (eşdeğer/tamamlayıcı modül)
const MODULES = [
  {
    id: "anti-phishing", icon: Shield, name: "Anti-Phishing Engine", color: "rose",
    desc: "URL phishing analizi — URLhaus IOC + homoglyph + shortener + IDN + şüpheli TLD tespiti.",
    how: [
      "URL'yi ayrıştırır (host, path, query, TLD, IP-host mı).",
      "URLhaus abuse.ch ücretsiz feed'inde arar (1400+ IOC).",
      "Marka domainleriyle Levenshtein uzaklık — homoglyph yakalar (micr0soft.com vs microsoft.com).",
      "Kısaltıcı, punycode/IDN, .tk .ml .cf gibi şüpheli TLD, IP-as-host, escape/obfuscation kontrolü.",
      "Skorlama 0-100; ≥60 phishing, ≥30 suspicious, altı safe.",
    ],
    linkTo: { label: "Tehdit Zekası", path: "/panel/threat-intel", note: "Mevcut Threat Intel modülünüz global feed'leri takip eder; Anti-Phishing tekil URL için derin analiz yapar." },
  },
  {
    id: "bec", icon: AlertTriangle, name: "BEC / CEO Fraud", color: "amber",
    desc: "Business Email Compromise — CEO taklidi, IBAN değişikliği, urgency baskısı tespiti.",
    how: [
      "Konu + body + display name üzerinde 7 sinyal ölçer: urgency (acil kelimeleri), finansal terim yoğunluğu, gizlilik vurgusu, yetki taklidi (CEO/CFO), yeni banka/hesap talebi, Reply-To ile From uyumsuzluğu, display name spoofing.",
      "Reply-To ≠ From: 25 puan (kimlik sahteciliği).",
      "Display Name'de 'CEO' ismi + yabancı domain: 25 puan.",
      "Yeni IBAN talebi tek başına: 20 puan.",
      "Skor ≥70: BEC saldırısı; ≥40: şüpheli.",
    ],
    linkTo: { label: "MailScanner", path: "/panel/mailscanner", note: "Şüpheli mailleri yakalayınca BEC analizi tetikleyip karantina/tag ekleyebilirsiniz." },
  },
  {
    id: "brand", icon: Building2, name: "Brand Impersonation", color: "indigo",
    desc: "Microsoft, Google, Apple, PayPal, Türk bankaları (Garanti, İş Bank, Ziraat vs.), e-Devlet taklit tespiti.",
    how: [
      "30+ ünlü marka için pattern kütüphanesi (micr0soft, g00gle, appl3, ziraatsecure vs).",
      "Gönderen domain'inde veya display name'de bu pattern'lar aranır.",
      "'Microsoft' body'de bahsediliyor ama gönderen microsoft.com değil → 'content-domain mismatch'.",
      "Her hit 40 puan, ≥60 impersonation.",
    ],
    linkTo: { label: "Kara/Beyaz Liste", path: "/panel/lists", note: "Impersonation tespit edilen domain'ler otomatik blacklist'e eklenebilir." },
  },
  {
    id: "url-deep", icon: ScanSearch, name: "URL Deep Analysis", color: "cyan",
    desc: "URL için DNS + WHOIS + redirect chain + IP + ASN + ülke bilgisi (hepsi ücretsiz).",
    how: [
      "socket.gethostbyname ile IP çözümleme.",
      "ipapi.co ücretsiz endpoint ile ASN + ülke.",
      "6 adıma kadar redirect chain takibi.",
      "Homoglyph benzerlik skoru + tüm URL feature'ları.",
    ],
    linkTo: { label: "Anti-Phishing Engine", path: "/panel/threat-defense", note: "Anti-Phishing yüzeysel skorlar, URL Deep Analysis kanıt toplar." },
  },
  {
    id: "sandbox-att", icon: Bug, name: "Attachment Sandbox", color: "orange",
    desc: "Ek dosya STATİK analiz — uzantı, boyut, hash, çift-uzantı tuzağı kontrolü.",
    how: [
      "Yüksek risk uzantılar: .exe .dll .bat .ps1 .js .vbs .msi .iso → 60 puan.",
      "Makro içerebilenler: .docm .xlsm → 25 puan.",
      "Arşivler: .zip .rar → 15 puan + boyut kontrolü.",
      "Çift uzantı hilesi: fatura.pdf.exe → 40 puan (malicious).",
      "NOT: Dinamik davranış izleme için dış sandbox gerekir (ücretsiz kısıtlı).",
    ],
    linkTo: { label: "Karantina", path: "/panel/quarantine", note: "Şüpheli ekler otomatik karantinaya alınır." },
  },
  {
    id: "sandbox-url", icon: Chrome, name: "URL Sandbox", color: "sky",
    desc: "urlscan.io ücretsiz public arama — bir URL için önceki taramaları getirir.",
    how: [
      "urlscan.io /api/v1/search endpoint'i (API key gerektirmez).",
      "Domain'in son 5 taramasını gösterir.",
      "Her tarama için malicious verdict + timestamp.",
    ],
    linkTo: { label: "URL Deep Analysis", path: "/panel/threat-defense", note: "URL Deep tek istek yapar, Sandbox geçmiş taramaları gösterir." },
  },
  {
    id: "dna", icon: Fingerprint, name: "Email DNA", color: "violet",
    desc: "Her mail için benzersiz fingerprint (SHA256) + geçmiş benzer mailleri sayar.",
    how: [
      "Subject + body clean + URL hostları ayrı hash'lenir, birleştirilir.",
      "Mevcut mail_dna koleksiyonunda aynı body_hash veya url_hash aranır.",
      "'Bu mail daha önce X benzer örnek ile eşleşti' cevabı verir.",
      "Yeni kampanyaları hızlı tanımak için ideal.",
    ],
    linkTo: { label: "Marketplace", path: "/panel/marketplace", note: "Sık görülen fingerprint'ler bayiler arası imza olarak paylaşılabilir." },
  },
  {
    id: "threat-intel", icon: Radio, name: "Global Threat Intel Store", color: "fuchsia",
    desc: "Merkezi IOC (Indicator of Compromise) veritabanı. IP / Domain / URL / Hash / Pattern.",
    how: [
      "Bayilerinizin tespit ettiği IOC'lar bu depoya girer.",
      "URLhaus feed'i otomatik senkron olur (1400+ ekstra IOC).",
      "Diğer modüller (Anti-Phishing, Retroactive Scanner vs.) buradan sorgu yapar.",
    ],
    linkTo: { label: "Tehdit Zekası", path: "/panel/threat-intel", note: "Mevcut Threat Intel sayfanız aynı depoyu kullanır — burada anlık ekleme yapabilirsiniz." },
  },
  {
    id: "reputation", icon: Award, name: "Sender Reputation", color: "emerald",
    desc: "IP / Domain / Sender için 0-100 reputation skoru.",
    how: [
      "IOC deposunda kaç kez rapor edilmiş: her hit -15 puan.",
      "Mail geçmişinde kaç kez görülmüş: bonus +20'ye kadar.",
      "Base skor 90'dan başlar.",
    ],
    linkTo: { label: "IP Blacklist Çıkışı", path: "/panel/blacklist", note: "Düşük reputation IP'ler için RBL delisting talebi başlatılabilir." },
  },
  {
    id: "compromise", icon: WifiOff, name: "Account Compromise Detection", color: "red",
    desc: "Son N saatte olağandışı outbound aktivite gösteren hesaplar (ele geçirilme şüphesi).",
    how: [
      "mail_events koleksiyonundan outbound saati ile from adresi grupla.",
      "Saatlik gönderim ≥100 → 'suspicious', ≥500 → 'compromised'.",
      "≥1000/saat → critical severity — hesap dondurulmalı.",
    ],
    linkTo: { label: "Giden Posta", path: "/panel/outbound", note: "Compromise tespit edilen hesabı Giden Posta'dan hold'a alabilirsiniz." },
  },
  {
    id: "incidents", icon: ShieldAlert, name: "Incident Response Center", color: "rose",
    desc: "Her saldırıya bir Incident ID atanır (INC-YYYYMMDD-XXXXX). Tek panelden aksiyon.",
    how: [
      "threat_type, affected_users, source_ips, urls kaydedilir.",
      "actions_taken listesine her adım (IP block, quarantine, notify) yazılır.",
      "Severity + status (open/investigating/resolved) takibi.",
    ],
    linkTo: { label: "Audit Log", path: "/panel/audit-log", note: "Incident aksiyonları Audit Log'a yansır." },
  },
  {
    id: "retroactive", icon: RotateCcw, name: "Retroactive Mail Scanner", color: "amber",
    desc: "Yeni bir IOC (kötü domain/IP) tespit edildiğinde, geçmiş X gün maillerini yeniden tarar.",
    how: [
      "mail_dna koleksiyonunda url_hosts veya from field'ında yeni IOC'yi arar.",
      "Eşleşen mailleri döner (aksiyon: karantina, delete, notify).",
      "'Son 30 günde X mail bu IOC ile eşleşti' cevabı.",
    ],
    linkTo: { label: "Karantina", path: "/panel/quarantine", note: "Retroactive tarama sonucu bulunan mailler karantinaya taşınabilir." },
  },
  {
    id: "ai-ask", icon: Brain, name: "AI Security Assistant", color: "indigo",
    desc: "Doğal dilde güvenlik sorusu sorun, LLM (Claude/GPT) yanıtlar.",
    how: [
      "Emergent LLM Key ile OpenAI/Claude'a gider (dahili anahtar).",
      "System prompt: Türkçe mail güvenlik analisti.",
      "'Bugün spam neden arttı?', 'phishing nasıl tanınır?' gibi sorular.",
    ],
    linkTo: { label: "AI Rule Generator", path: "/panel/threat-defense", note: "AI'a soru sorup gelen tavsiyeyi doğal dilde kurala çevirebilirsiniz." },
  },
  {
    id: "ai-rule", icon: Wand2, name: "AI Rule Generator", color: "violet",
    desc: "Doğal dilde 'X ise Y yap' cümlesini JSON kural haline getirir.",
    how: [
      "LLM'e {name, if:{field,op,value}, then:{action}} şemasını verir.",
      "Örnek: 'Microsoft taklidi + DMARC fail = karantina'.",
      "Üretilen kural test edilebilir, sonra Kurallar sayfasında aktifleştirilir.",
    ],
    linkTo: { label: "Kurallar", path: "/panel/rules", note: "AI ürettiği kuralı Kurallar sayfasında test/simulate/activate edin." },
  },
  {
    id: "search", icon: Search, name: "Global Search", color: "slate",
    desc: "Sistemde her yerde arama — IP, domain, email, lisans, incident.",
    how: [
      "Aynı sorgu ile 4 koleksiyon paralel taranır: threat_iocs, mail_dna, incidents, licenses.",
      "Her koleksiyondan 3 örnek + toplam sayı döner.",
    ],
    linkTo: { label: "Lisanslar", path: "/panel/licenses", note: "Bir müşteri IP'sini/mail'ini arayınca ilgili lisansı da bulur." },
  },
  {
    id: "mail-score", icon: TrendingUp, name: "Mail Security Score", color: "emerald",
    desc: "Bir domain için SPF + DKIM + DMARC + MX skorlaması (canlı DNS sorgusu).",
    how: [
      "SPF TXT kaydı sorgulanır.",
      "_dmarc.<domain> TXT — DMARC var mı?",
      "5 selector denenir (default/google/mail/s1/selector1) — DKIM.",
      "MX kaydı var mı?",
      "Toplam skor = ortalama.",
    ],
    linkTo: { label: "Mail Sağlık", path: "/panel/mail-health", note: "Mevcut Mail Sağlık sayfanız aynı kayıtları izler; bu ekran tek domain için ANLIK skor verir." },
  },
  {
    id: "domain-security", icon: Building2, name: "Domain Security Center", color: "cyan",
    desc: "Domain başına birleşik güvenlik dashboard'u — auth + reputation + spam sayaç.",
    how: [
      "Mail Security Score (DNS auth) çağrılır.",
      "Sender Reputation (IOC hits) eklenir.",
      "mail_events'ten incoming/outgoing spam sayıları alınır.",
    ],
    linkTo: { label: "Mail Sağlık", path: "/panel/mail-health", note: "Bu, Mail Sağlık'ın domain başına özet halidir." },
  },
  {
    id: "continuity", icon: Mail, name: "Mail Continuity", color: "sky",
    desc: "Ana mail sunucusu düşerse mailleri kuyrukta tutan güvenlik ağı.",
    how: [
      "continuity_queue koleksiyonunda pending status ile bekletilir.",
      "Sunucu geri gelince replay endpoint'i çağrılır.",
      "Şu an sadece durum sayacı — tam replay yakında.",
    ],
    linkTo: { label: "DB Bakım", path: "/panel/maintenance", note: "Kuyruğu temizleme/replay burada yapılır." },
  },
  {
    id: "archive", icon: Archive, name: "Enterprise Mail Archive", color: "slate",
    desc: "Uzun süreli mail arşivi — full-text arama, from/to/subject filtresi.",
    how: [
      "mail_dna koleksiyonu geriye dönük saklama.",
      "Subject regex + from/to + tarih aralığı ile arama.",
      "Sonuçlar 500 kayıta kadar limitli.",
    ],
    linkTo: { label: "Karantina", path: "/panel/quarantine", note: "Karantinadaki mailler otomatik arşive alınır." },
  },
  {
    id: "soar", icon: Zap, name: "SOAR Lite", color: "orange",
    desc: "IF/THEN otomasyon kuralları — 'X olursa Y yap' zincirleri.",
    how: [
      "Kural: {if:{condition}, then:[actions]}.",
      "Örnek: outbound>500/saat + bounce>%10 → suspend + incident + admin notify.",
      "Her kural hit_count ile popülerlik izlenir.",
    ],
    linkTo: { label: "Alarm Kuralları", path: "/panel/alerts", note: "Alarm Kuralları basit bildirim; SOAR birden fazla aksiyon zinciri." },
  },
  {
    id: "attack-map", icon: Map, name: "Global Attack Map", color: "rose",
    desc: "Son N saatte hangi ülkelerden ne kadar saldırı geldi — coğrafi ısı haritası verisi.",
    how: [
      "threat_iocs koleksiyonunda kind:ip olanlar ülkeye göre gruplanır.",
      "Her ülke için toplam + örnek IP listesi.",
      "Frontend Dashboard'daki haritaya feed olur.",
    ],
    linkTo: { label: "Kontrol Paneli", path: "/panel", note: "Ana Dashboard'daki tehdit haritası bu veriyi kullanır." },
  },
  {
    id: "simulator", icon: FlaskConical, name: "Advanced Mail Simulator", color: "violet",
    desc: "Bir .eml dosyasını tüm motorlardan geçirir — 'bu mail neden bloklanır?' cevabı verir.",
    how: [
      "Python email modülü ile .eml parse edilir.",
      "Anti-Phishing + BEC + Brand Impersonation çağrılır.",
      "Toplam skor + action (allow/tag/quarantine) döner.",
    ],
    linkTo: { label: "Kurallar", path: "/panel/rules", note: "Bir kural yazmadan önce Simulator'da test edin." },
  },
  {
    id: "mobile-soc", icon: Smartphone, name: "Mobile SOC", color: "indigo",
    desc: "PWA — telefondan critical/compromised/phishing sayaçlarını izleme.",
    how: [
      "Tek endpoint ile 3 metrik: kritik incident, compromise, son 24h phishing.",
      "Frontend PWA olarak paketlenir (manifest.json).",
      "Web Push ile alarm bildirimi.",
    ],
    linkTo: { label: "Bildirim Kutusu", path: "/panel/notifications", note: "PWA push bildirimi Bildirim Kutusu'na da yansır." },
  },
  {
    id: "web-spam", icon: MessageCircle, name: "Web Spam Protection", color: "amber",
    desc: "İletişim formu, WordPress yorum, kayıt formu için spam heuristik.",
    how: [
      "excess_links (link yoğunluğu), CAPS oran, bot kelimeleri (viagra/casino/kredi vs).",
      "Kısa body + obfuscation (a.b.c) tuzakları.",
      "Skor ≥50 → spam.",
    ],
    linkTo: null,
  },
  {
    id: "webshield", icon: Shield, name: "WebShield", color: "red",
    desc: "PHP/webshell kaynak kod tespiti — cPanel hesaplarınızdaki .php dosyaları için.",
    how: [
      "eval(), base64_decode(), system(), shell_exec() çağrıları sayılır.",
      "Obfuscated değişken isimleri ($aA1B2c3D4e5F6g7H8i9J10) tespit.",
      "Bilinen backdoor imzaları: c99shell, r57, wso, webshell.",
      "Skor ≥60 → malicious.",
    ],
    linkTo: { label: "Güvenlik", path: "/panel/security", note: "Sunucu güvenlik modülü ile birlikte çalışır." },
  },
  {
    id: "wp-security", icon: Layers, name: "WordPress Security Connector", color: "cyan",
    desc: "cPanel hesaplarındaki WordPress sitelerini uzaktan kontrol (public HTTP).",
    how: [
      "/readme.html — WP sürüm sızıntısı.",
      "/xmlrpc.php — XML-RPC açık mı (brute-force riski).",
      "/wp-config.php.bak — yedek dosya sızıntısı (kritik).",
      "/wp-login.php erişilebilir mi.",
      "Risk skoru döndürülür.",
    ],
    linkTo: { label: "Kullanıcılar", path: "/panel/users", note: "cPanel hesap listesinden site URL'lerini alıp toplu tarama yapılabilir." },
  },
  {
    id: "multiplatform", icon: Network, name: "Multi-Platform Status", color: "emerald",
    desc: "Şu an hangi platformlar destekleniyor — cPanel, DirectAdmin, Plesk, M365, Google Workspace.",
    how: [
      "Statik bilgi endpoint'i — planning/beta/stable statusları.",
      "cPanel + Exim TAM DESTEK.",
      "DirectAdmin + Postfix BETA.",
      "Diğerleri roadmap'te.",
    ],
    linkTo: { label: "Dokümantasyon", path: "/panel/docs", note: "Her platform için kurulum rehberi Dokümantasyon'da." },
  },
  {
    id: "network", icon: Globe, name: "Gökyüzü Global Threat Network", color: "fuchsia",
    desc: "Tüm bayilerinizden gelen anonim IOC'lar + fingerprint'ler — kolektif zeka.",
    how: [
      "Toplam IOC sayısı + katkı yapan bayi sayısı + fingerprint sayısı.",
      "URLhaus feed'i otomatik senkron.",
      "KVKK/GDPR uyumlu — sadece anonim hash paylaşımı.",
    ],
    linkTo: { label: "Marketplace", path: "/panel/marketplace", note: "Marketplace'de bayilerinizin ürettiği imzalar bu ağa dahildir." },
  },
];

const COLOR_MAP = {
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  indigo: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
  cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  orange: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  fuchsia: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  red: "border-red-500/30 bg-red-500/10 text-red-300",
  slate: "border-slate-500/30 bg-slate-500/10 text-slate-300",
};

// ---- Module runners — as functions returning JSX ----
function AntiPhishingRunner({ input, setField, run }) {
  return (
    <>
      <TextArea label="URL veya text (birden fazla URL desteklenir)"
        value={input.text} onChange={v => setField("text", v)}
        placeholder="https://micr0soft-secure.tk/login veya mail body..." rows={4} testid="input-anti-phishing" />
      <Btn onClick={() => run("/anti-phishing/scan", "POST", { text: input.text })} data-testid="btn-anti-phishing">
        Analiz Et
      </Btn>
    </>
  );
}

function BecRunner({ input, setField, run }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From (isim)" value={input.from_name} onChange={v => setField("from_name", v)} testid="bec-from-name" />
        <Field label="From (email)" value={input.from_email} onChange={v => setField("from_email", v)} testid="bec-from-email" />
        <Field label="Reply-To" value={input.reply_to} onChange={v => setField("reply_to", v)} testid="bec-reply-to" />
        <Field label="Subject" value={input.subject} onChange={v => setField("subject", v)} testid="bec-subject" />
      </div>
      <TextArea label="Body" value={input.body} onChange={v => setField("body", v)} rows={4} testid="bec-body" />
      <Btn onClick={() => run("/bec/analyze", "POST", input)} data-testid="btn-bec">BEC Analiz</Btn>
    </div>
  );
}

function BrandRunner({ input, setField, run }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From (email)" value={input.from_email} onChange={v => setField("from_email", v)} />
        <Field label="From (isim)" value={input.from_name} onChange={v => setField("from_name", v)} />
      </div>
      <Field label="Subject" value={input.subject} onChange={v => setField("subject", v)} />
      <TextArea label="Body" value={input.body} onChange={v => setField("body", v)} rows={3} />
      <Btn onClick={() => run("/brand-impersonation/check", "POST", input)}>Marka Kontrolü</Btn>
    </div>
  );
}

function UrlDeepRunner({ input, setField, run }) {
  return (
    <>
      <Field label="URL" value={input.url} onChange={v => setField("url", v)} placeholder="https://example.com" testid="url-deep-input" />
      <Btn onClick={() => run("/url-deep/analyze", "POST", input)}>Derin Analiz</Btn>
    </>
  );
}

function AttachmentRunner({ input, setField, run }) {
  return (
    <div className="space-y-3">
      <Field label="Dosya adı" value={input.filename} onChange={v => setField("filename", v)} placeholder="fatura.pdf.exe" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Boyut (byte)" value={input.size} onChange={v => setField("size", v)} type="number" />
        <Field label="SHA256 (ops.)" value={input.sha256} onChange={v => setField("sha256", v)} />
      </div>
      <Btn onClick={() => run("/sandbox/attachment", "POST", input)}>Analiz Et</Btn>
    </div>
  );
}

function UrlSandboxRunner({ input, setField, run }) {
  return (
    <>
      <Field label="URL" value={input.url} onChange={v => setField("url", v)} placeholder="https://example.com" />
      <Btn onClick={() => run("/sandbox/url", "POST", input)}>urlscan.io'da Ara</Btn>
    </>
  );
}

function DnaRunner({ input, setField, run }) {
  return (
    <div className="space-y-3">
      <Field label="From" value={input.from_email} onChange={v => setField("from_email", v)} />
      <Field label="Subject" value={input.subject} onChange={v => setField("subject", v)} />
      <TextArea label="Body" value={input.body} onChange={v => setField("body", v)} rows={4} />
      <Btn onClick={() => run("/dna/fingerprint", "POST", input)}>DNA Üret</Btn>
    </div>
  );
}

function ThreatIntelRunner({ input, setField, run }) {
  return (
    <div className="space-y-3">
      <Btn onClick={() => run("/threat-intel/iocs", "GET")}>Tüm IOC'ları Listele</Btn>
      <div className="border-t border-slate-800 pt-3">
        <div className="text-xs text-slate-400 mb-2 font-semibold">Yeni IOC ekle:</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind (ip/domain/url/hash)" value={input.kind} onChange={v => setField("kind", v)} />
          <Field label="Value" value={input.value} onChange={v => setField("value", v)} />
        </div>
        <Field label="Reason" value={input.reason} onChange={v => setField("reason", v)} />
        <div className="mt-2">
          <Btn onClick={() => run("/threat-intel/report", "POST", input)}>IOC Ekle</Btn>
        </div>
      </div>
    </div>
  );
}

function ReputationRunner({ input, setField, run }) {
  return (
    <div className="space-y-3">
      <Field label="Email" value={input.email} onChange={v => setField("email", v)} placeholder="user@example.com" />
      <Field label="Domain" value={input.domain} onChange={v => setField("domain", v)} placeholder="example.com" />
      <Field label="IP" value={input.ip} onChange={v => setField("ip", v)} placeholder="1.2.3.4" />
      <Btn onClick={() => {
        const parts = [];
        if (input.email) parts.push(`email=${encodeURIComponent(input.email)}`);
        if (input.domain) parts.push(`domain=${encodeURIComponent(input.domain)}`);
        if (input.ip) parts.push(`ip=${encodeURIComponent(input.ip)}`);
        run(`/reputation/sender?${parts.join("&")}`, "GET");
      }}>Reputation Sorgula</Btn>
    </div>
  );
}

function CompromiseRunner({ input, setField, run }) {
  return (
    <div className="space-y-3">
      <Field label="Saat penceresi" value={input.hours || "24"} onChange={v => setField("hours", v)} type="number" />
      <Btn onClick={() => run(`/compromise/detect?hours=${input.hours || 24}`, "GET")}>Şüpheli Hesap Tara</Btn>
    </div>
  );
}

function IncidentsRunner({ input, setField, run }) {
  return (
    <div className="space-y-3">
      <Btn onClick={() => run("/incidents", "GET")}>Incident'ları Listele</Btn>
      <div className="border-t border-slate-800 pt-3">
        <div className="text-xs text-slate-400 mb-2 font-semibold">Manuel Incident:</div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Threat Type" value={input.threat_type} onChange={v => setField("threat_type", v)} placeholder="BEC, phishing..." />
          <Field label="Severity" value={input.severity} onChange={v => setField("severity", v)} placeholder="critical/high/medium" />
        </div>
        <Field label="Notes" value={input.notes} onChange={v => setField("notes", v)} />
        <div className="mt-2"><Btn onClick={() => run("/incidents", "POST", input)}>Oluştur</Btn></div>
      </div>
    </div>
  );
}

function RetroRunner({ input, setField, run }) {
  return (
    <div className="space-y-3">
      <Field label="Kind (domain/ip)" value={input.kind || "domain"} onChange={v => setField("kind", v)} />
      <Field label="Value" value={input.value} onChange={v => setField("value", v)} placeholder="badsite.com" />
      <Field label="Gün" value={input.days || "30"} onChange={v => setField("days", v)} type="number" />
      <Btn onClick={() => run("/retroactive/scan", "POST", input)}>Geriye Dönük Tara</Btn>
    </div>
  );
}

function AiAskRunner({ input, setField, run }) {
  return (
    <>
      <TextArea label="Sorunuz" value={input.question} onChange={v => setField("question", v)}
        rows={3} placeholder="Bugün spam neden arttı?" testid="ai-question" />
      <Btn onClick={() => run("/ai/ask", "POST", input)} data-testid="btn-ai-ask">
        <Send className="w-3 h-3" /> AI'a Sor
      </Btn>
    </>
  );
}

function AiRuleRunner({ input, setField, run }) {
  return (
    <>
      <TextArea label="Kural cümlesi (Türkçe)" value={input.prompt} onChange={v => setField("prompt", v)}
        rows={3} placeholder="Microsoft taklidi + DMARC fail = karantina" />
      <Btn onClick={() => run("/ai/generate-rule", "POST", input)}>Kural Üret</Btn>
    </>
  );
}

function SearchRunner({ input, setField, run }) {
  return (
    <>
      <Field label="Arama sorgusu" value={input.q} onChange={v => setField("q", v)}
        placeholder="185.22.44.18 veya user@example.com" />
      <Btn onClick={() => run(`/global-search?q=${encodeURIComponent(input.q || "")}`, "GET")}>Ara</Btn>
    </>
  );
}

function MailScoreRunner({ input, setField, run }) {
  return (
    <>
      <Field label="Domain" value={input.domain} onChange={v => setField("domain", v)}
        placeholder="microsoft.com" testid="mail-score-domain" />
      <Btn onClick={() => run(`/mail-security-score?domain=${encodeURIComponent(input.domain || "")}`, "GET")}
        data-testid="btn-mail-score">Skor Al</Btn>
    </>
  );
}

function DomainSecurityRunner({ input, setField, run }) {
  return (
    <>
      <Field label="Domain" value={input.domain} onChange={v => setField("domain", v)} placeholder="example.com" />
      <Btn onClick={() => run(`/domain-security/${encodeURIComponent(input.domain || "example.com")}`, "GET")}>Analiz</Btn>
    </>
  );
}

function ContinuityRunner({ run }) {
  return (
    <div className="space-y-2">
      <Btn onClick={() => run("/continuity/queue-status", "GET")}>Kuyruk Durumu</Btn>
    </div>
  );
}

function ArchiveRunner({ input, setField, run }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Konu içerir" value={input.q} onChange={v => setField("q", v)} />
        <Field label="From" value={input.from_addr} onChange={v => setField("from_addr", v)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="To" value={input.to} onChange={v => setField("to", v)} />
        <Field label="Gün" value={input.days || "30"} onChange={v => setField("days", v)} type="number" />
      </div>
      <Btn onClick={() => {
        const p = new URLSearchParams();
        Object.entries(input).forEach(([k, v]) => v && p.append(k, v));
        run(`/archive/search?${p.toString()}`, "GET");
      }}>Arşivde Ara</Btn>
    </div>
  );
}

function SoarRunner({ run }) {
  return <Btn onClick={() => run("/soar/rules", "GET")}>SOAR Kurallarını Listele</Btn>;
}

function AttackMapRunner({ input, setField, run }) {
  return (
    <>
      <Field label="Saat penceresi" value={input.hours || "24"} onChange={v => setField("hours", v)} type="number" />
      <Btn onClick={() => run(`/attack-map?hours=${input.hours || 24}`, "GET")}>Harita Verisi</Btn>
    </>
  );
}

function SimulatorRunner({ input, setField, run }) {
  return (
    <>
      <TextArea label=".eml içeriği (From/Subject/Body dahil)" value={input.eml} onChange={v => setField("eml", v)}
        rows={8} placeholder={"From: ceo@fake.xyz\nSubject: Acil ödeme\n\nYeni IBAN'a acil transfer yapmalısınız..."} />
      <Btn onClick={() => run("/simulator/eml", "POST", input)}>Simüle Et</Btn>
    </>
  );
}

function MobileSocRunner({ run }) {
  return <Btn onClick={() => run("/mobile-soc/summary", "GET")}>Mobile SOC Özet</Btn>;
}

function WebSpamRunner({ input, setField, run }) {
  return (
    <>
      <TextArea label="Form/yorum içeriği" value={input.text} onChange={v => setField("text", v)} rows={3}
        placeholder="Ucuz kredi imkanı! Şimdi tıklayın..." />
      <Field label="IP (ops.)" value={input.ip} onChange={v => setField("ip", v)} />
      <Btn onClick={() => run("/web-spam/check", "POST", input)}>Spam Kontrolü</Btn>
    </>
  );
}

function WebshieldRunner({ input, setField, run }) {
  return (
    <>
      <TextArea label="PHP kaynak kodu" value={input.code} onChange={v => setField("code", v)}
        rows={6} placeholder="<?php eval(base64_decode($_POST['x'])); ?>" />
      <Btn onClick={() => run("/webshield/scan-hints", "POST", input)}>Kod Tara</Btn>
    </>
  );
}

function WpSecurityRunner({ input, setField, run }) {
  return (
    <>
      <Field label="Site URL" value={input.site} onChange={v => setField("site", v)} placeholder="https://ornek.com" />
      <Btn onClick={() => run(`/wp-security/scan?site=${encodeURIComponent(input.site || "")}`, "GET")}>WP Tara</Btn>
    </>
  );
}

function MultiplatformRunner({ run }) {
  return <Btn onClick={() => run("/multiplatform/status", "GET")}>Desteklenen Platformlar</Btn>;
}

function NetworkRunner({ run }) {
  return (
    <div className="space-y-2">
      <Btn onClick={() => run("/network/stats", "GET")}>Ağ İstatistikleri</Btn>
      <Btn onClick={() => run("/feed/refresh", "POST", {})} variant="ghost">URLhaus Feed Yenile</Btn>
      <Btn onClick={() => run("/feed/status", "GET")} variant="ghost">Feed Durumu</Btn>
    </div>
  );
}

const RUNNERS = {
  "anti-phishing": AntiPhishingRunner,
  "bec": BecRunner,
  "brand": BrandRunner,
  "url-deep": UrlDeepRunner,
  "sandbox-att": AttachmentRunner,
  "sandbox-url": UrlSandboxRunner,
  "dna": DnaRunner,
  "threat-intel": ThreatIntelRunner,
  "reputation": ReputationRunner,
  "compromise": CompromiseRunner,
  "incidents": IncidentsRunner,
  "retroactive": RetroRunner,
  "ai-ask": AiAskRunner,
  "ai-rule": AiRuleRunner,
  "search": SearchRunner,
  "mail-score": MailScoreRunner,
  "domain-security": DomainSecurityRunner,
  "continuity": ContinuityRunner,
  "archive": ArchiveRunner,
  "soar": SoarRunner,
  "attack-map": AttackMapRunner,
  "simulator": SimulatorRunner,
  "mobile-soc": MobileSocRunner,
  "web-spam": WebSpamRunner,
  "webshield": WebshieldRunner,
  "wp-security": WpSecurityRunner,
  "multiplatform": MultiplatformRunner,
  "network": NetworkRunner,
};

// ---- Module Runner Drawer ----
function ModuleDrawer({ mod, onClose }) {
  const [input, setInput] = useState({});
  const [output, setOutput] = useState(null);
  const [loading, setLoading] = useState(false);

  // useCallback ile stable — child re-render'da input focus kaybolmasın
  const setField = useCallback((k, v) => {
    setInput(prev => ({ ...prev, [k]: v }));
  }, []);

  const run = useCallback(async (path, method = "GET", body = null) => {
    setLoading(true);
    setOutput(null);
    try {
      const res = await callThreatApi(path, method, body);
      setOutput(res);
      toast.success("Tamamlandı");
    } catch (e) {
      setOutput({ error: e.message });
      toast.error(`Hata: ${e.message.slice(0, 80)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const Runner = RUNNERS[mod.id];

  return (
    <div className="p-6 space-y-5" data-testid={`drawer-${mod.id}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border ${COLOR_MAP[mod.color]} text-xs font-bold`}>
            <mod.icon className="w-3.5 h-3.5" />
            {mod.name}
          </div>
          <div className="text-sm text-slate-300 mt-2.5 leading-relaxed">{mod.desc}</div>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300"
                data-testid="drawer-close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Nasıl Çalışır */}
      <div className="border border-slate-800 bg-slate-900/40 rounded-lg p-4">
        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-bold uppercase tracking-wider mb-2">
          <BookOpen className="w-3.5 h-3.5" />
          Nasıl Çalışır
        </div>
        <ul className="space-y-1.5">
          {mod.how.map((h, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-slate-300">
              <span className="text-indigo-400 mono shrink-0">{i + 1}.</span>
              <span>{h}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Bağlantı önerisi */}
      {mod.linkTo && (
        <div className="border border-emerald-500/30 bg-emerald-500/5 rounded-lg p-4">
          <div className="flex items-center gap-2 text-[11px] text-emerald-300 font-bold uppercase tracking-wider mb-2">
            <Link2 className="w-3.5 h-3.5" />
            Mevcut Modülünüzle Bağlantı
          </div>
          <div className="text-[13px] text-slate-200 mb-2.5">
            <b className="text-emerald-300">{mod.linkTo.label}</b> — {mod.linkTo.note}
          </div>
          <a href={mod.linkTo.path}
             className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25">
            <ExternalLink className="w-3 h-3" />
            {mod.linkTo.label} sayfasına git
          </a>
        </div>
      )}

      {/* Interactive runner */}
      <div className="border border-indigo-500/30 bg-indigo-500/5 rounded-lg p-4">
        <div className="flex items-center gap-2 text-[11px] text-indigo-300 font-bold uppercase tracking-wider mb-3">
          <Wand2 className="w-3.5 h-3.5" />
          Deneyin
        </div>
        <div className="space-y-3">
          {Runner ? <Runner input={input} setField={setField} run={run} /> : (
            <div className="text-xs text-slate-500">Çalıştırıcı yakında.</div>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Analiz çalıştırılıyor...
        </div>
      )}

      {output && (
        <div className="border border-slate-800 rounded-lg overflow-hidden" data-testid="drawer-output">
          <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/60 text-[11px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-2">
            <Info className="w-3.5 h-3.5" />
            Sonuç
          </div>
          <pre className="bg-slate-950/80 p-3 text-[11px] text-slate-200 mono overflow-auto max-h-[400px] whitespace-pre-wrap">
{JSON.stringify(output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---- Main hub ----
export default function ThreatDefenseCenter() {
  const [active, setActive] = useState(null);
  const [filter, setFilter] = useState("");
  const netQ = useQuery({
    queryKey: ["threat-network"],
    queryFn: () => callThreatApi("/network/stats", "GET"),
    refetchInterval: 60000,
  });

  const filtered = useMemo(() =>
    MODULES.filter(m =>
      !filter
      || m.name.toLowerCase().includes(filter.toLowerCase())
      || m.desc.toLowerCase().includes(filter.toLowerCase())
    ), [filter]);

  return (
    <div className="p-6 space-y-6" data-testid="threat-defense-center">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <Shield className="w-6 h-6 text-rose-400" />
            Advanced Threat Defense Center
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            28 gelişmiş güvenlik modülü — hepsi ücretsiz altyapı ile · v43.99.7
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Global IOC Ağı</div>
            <div className="text-lg font-bold text-emerald-300 mono">
              {netQ.data ? netQ.data.total_iocs.toLocaleString() : "..."}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Mail DNA</div>
            <div className="text-lg font-bold text-cyan-300 mono">
              {netQ.data ? netQ.data.mail_fingerprints.toLocaleString() : "..."}
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Modüllerde ara: 'phishing', 'ai', 'domain', 'sandbox'..."
          data-testid="module-search"
          className="w-full pl-10 pr-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100 text-sm focus:border-indigo-500 focus:outline-none"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map((m, i) => (
          <button
            key={m.id}
            onClick={() => setActive(m)}
            data-testid={`module-card-${m.id}`}
            className="group relative text-left p-4 rounded-lg border border-slate-800 bg-slate-900/40 hover:bg-slate-900/70 hover:border-slate-700 transition-all"
          >
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-md flex items-center justify-center ${COLOR_MAP[m.color]} shrink-0`}>
                <m.icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-100 truncate">{m.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{m.desc}</div>
              </div>
              <div className="text-[10px] text-slate-600 mono shrink-0">#{String(i + 1).padStart(2, "0")}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Empty */}
      {filtered.length === 0 && (
        <div className="text-center py-12 text-sm text-slate-500">
          Aradığınız modül bulunamadı.
        </div>
      )}

      {/* Drawer */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setActive(null)}
        >
          <div
            className="w-full sm:max-w-3xl max-h-[90vh] overflow-auto bg-slate-950 border border-slate-800 rounded-t-xl sm:rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <ModuleDrawer mod={active} onClose={() => setActive(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
