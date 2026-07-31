import { useState } from "react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import {
  BookOpen, Filter, Bug, Globe2, Inbox, Mail, ArrowUpRight, Bell, BellRing,
  Cpu, Wrench, Radar, Terminal, Users, PackageOpen, Settings2, Key, Beaker,
  ShieldCheck, Brain, Server, LinkIcon, UserX, Activity, X, Search,
} from "lucide-react";

const MODULES = [
  {
    key: "dashboard", cat: "Ana", label: "Dashboard", Icon: Activity, tone: "sky",
    what: "Sistemin genel sağlık kontrolü. 7 tab (Genel Bakış · Coğrafi · Trafik · Karantina · Sağlık · Canlı · Tümü). Üstteki 6 renkli kart 'Advanced Control Bar' → tıklanabilir.",
    features: [
      "Kuyrukta Bekleyen kartına tıkla → Exim kuyruk modalı açılır (toplu sil/ilet/dondur)",
      "Trafik tab'ında IP çubuğuna tıkla → o IP'nin son 50 maili sağ drawer'da açılır",
      "Coğrafi tab → canlı saldırı haritası (hover'da IP, from, to, ülke, verdict)",
    ],
    how: [
      "Her 15 sn'de bir metrikler otomatik yenilenir.",
      "Tab bar'daki 'Tümünü Göster' ile her şeyi tek ekranda gör.",
      "Onboarding wizard ilk kurulumda üstte çıkar (SMTP, brand vb).",
    ],
    testid: "docs-module-dashboard",
  },
  {
    key: "mailscanner", cat: "Motor", label: "MailScanner (Bağımsız)", Icon: Filter, tone: "indigo",
    what: "ConfigServer'a bağlı olmayan kendi geliştirdiğimiz mail tarama motoru. SpamAssassin uyumlu regex kuralları + Bayes classifier + BEC + URL koruma + kullanıcı politikaları.",
    features: [
      "6 tab: Yapılandırma · İstatistik · Kurallar · Bayes · Kullanıcı Politika · URL Koruma",
      "AI Sistem Analizi butonu (Claude) → mevcut konfigi analiz eder, aksiyon önerisi verir",
      "Bayes trainer: spam/ham örnek yapıştır → dinamik istatistiksel motor",
      "Kural editörü: regex + hedef alan (subject/from/body/header) + skor",
      "URL rewrite: /r/{token} time-of-click analiz",
    ],
    how: [
      "Yapılandırma tab'ında threshold ve motor toggle'ları yönet.",
      "Bayes 5000+ token'a ulaşana kadar 'training' modunda kabul et.",
      "Rules tab'ında `/tebrikler.*kazand[ıi]n/i` gibi regex ekle, skor 5+ ver.",
      "URL Koruma: outbound mail içine token bas, tıklandığında sunucu doğrular.",
    ],
    testid: "docs-module-mailscanner",
  },
  {
    key: "security", cat: "Güvenlik", label: "Güvenlik Merkezi", Icon: Bug, tone: "rose",
    what: "11 modül birleşik pano: Antivirüs · Spam/Phish · Sandbox · SPF/DKIM/DMARC · BEC · Karantina · Outbound · URL · AI · SIEM · Exploit Scanner.",
    features: [
      "Overview: her modülün rozeti (active/ready/warn/off) + detay",
      "Exploit tab: shell/eval/base64/backdoor imza tarayıcı — WHM daemon veya manuel scan",
      "BEC tab: lookalike domain + display-name + urgency heuristic testi",
      "Sandbox tab: şüpheli ekler için VM detonation queue (WHM VM ile entegre)",
      "Reputation tab: Spamhaus/UCEPROTECT durum kontrolü",
      "Coğrafi tab: 113 ülke bloklama · zaman-tabanlı · brute-force otomatik",
    ],
    how: [
      "Exploit tab'da 'Tara' → 1500+ dosya taranır, kritik/high/medium bulgular listelenir.",
      "BEC tab'da 'CEO Ahmet' + info@sikertim.com + korunan domain='sirketim.com' dene → BEC HIGH döner.",
      "Coğrafi Brute-Force: 60dk pencere · 50 spam eşiği · 180dk TTL — 'Tara ve Blokla' butonu.",
    ],
    testid: "docs-module-security",
  },
  {
    key: "quarantine", cat: "Karantina", label: "Karantina", Icon: Inbox, tone: "amber",
    what: "İzole edilmiş şüpheli maillerin merkezi paneli. Her mail için: release, delete, whitelist, mark-spam, AI 'neden spam?' açıklaması.",
    features: [
      "Filtre: tüm/spam/high_spam/virüs/phishing",
      "AI açıklama (Claude): 'Neden spam?' butonu",
      "Bulk seç + release/delete",
      "cPanel quarantine sync (WHM daemon eşliği)",
    ],
    how: [
      "Her satır → detail drawer → tam body/header/attachment",
      "release → kullanıcıya teslim, whitelist → 30 gün domain izin, delete → kalıcı",
    ],
    testid: "docs-module-quarantine",
  },
  {
    key: "geoblocking", cat: "Güvenlik", label: "Coğrafi Bloklama", Icon: Globe2, tone: "emerald",
    what: "Ülke bazlı block/allow list + zaman kısıtları + brute-force otomatik ekleme.",
    features: [
      "113 ülke katalog · arama · toplu seçim",
      "Zaman-tabanlı: aktif saatler (0-23) + günler (Pzt-Paz)",
      "TTL: kural belirtilen dakika sonra otomatik silinir",
      "Brute-force otomatik: son N dakikada M spam eşiği aşan ülke bloklanır",
    ],
    how: [
      "Ülke Seç tab → seçim yap → aksiyon (block/allow) → TTL dakika (0=süresiz) → Kaydet",
      "Zaman-Tabanlı: 'yalnızca gece 00-06 arası CN,RU blokla' senaryosu",
      "Brute-Force: 60dk / 50 spam / 180dk TTL öntanımlı",
    ],
    testid: "docs-module-geoblocking",
  },
  {
    key: "queue", cat: "İşlem", label: "Kuyruk Yönetimi", Icon: Server, tone: "sky",
    what: "Exim kuyruğunda bekleyen mailleri listeler; toplu sil/ilet/dondur/döndür işlemleri.",
    features: [
      "Yalnızca donmuş filtresi",
      "6 aksiyon: remove · deliver · retry · freeze · thaw · bounce",
      "Audit log — her işlem MongoDB'ye kayıt",
    ],
    how: [
      "Dashboard'daki 'Kuyrukta Bekleyen' kartına tıkla",
      "Satırları seç → aksiyon butonu",
      "Gerçek exim yoksa preview'da mock döner (WHM'de gerçek exim çalışır)",
    ],
    testid: "docs-module-queue",
  },
  {
    key: "ai", cat: "AI", label: "AI Self-Training", Icon: Brain, tone: "fuchsia",
    what: "Sistem kendi kendine öğrenir. Saatlik cron: son 1 saatteki high_spam/clean mailleri otomatik Bayes'e besler. LLM (Claude) yeni SA regex kural önerisi üretir.",
    features: [
      "AI Sistem Analizi: mevcut konfig + metrik → Türkçe rapor + aksiyon",
      "Weekly Report (Pazartesi 07:00 UTC): son 7 gün özet",
      "AI Batch Prewarm: high_spam ingest → arka planda açıklama üretilir, cache'lenir",
      "Rule Suggestions: AI önerdiği kurallar 'onay' bekler — sen apply edersin",
    ],
    how: [
      "MailScanner sayfasında 'Sistemi Analiz Et' → 15-30sn'de rapor",
      "Self-Training log: her saat kaç örneğin eğitildiğini gösterir",
      "Öneriler kutusunda regex + skor gör → Onayla/Reddet",
    ],
    testid: "docs-module-ai",
  },
  {
    key: "alerts", cat: "Uyarı", label: "Uyarı Kuralları", Icon: BellRing, tone: "orange",
    what: "Webhook tabanlı uyarı motoru: spam trafiği eşik aştığında dış sisteme (Slack/Discord/SIEM) POST atar.",
    features: [
      "Kural editörü: metrik + operatör + eşik + zaman penceresi",
      "Webhook + Slack + Discord + Email hedefleri",
      "SIEM formatı: CEF · LEEF · JSON çıktı",
      "Timeline chart: son fire'lar",
    ],
    how: [
      "Kural: 'spam count > 100 in 5min' → webhook",
      "SIEM export: /api/mailscanner/siem/export?format=cef&hours=24",
    ],
    testid: "docs-module-alerts",
  },
  {
    key: "compliance", cat: "Rapor", label: "Uyumluluk / Rapor", Icon: BookOpen, tone: "indigo",
    what: "KVKK/GDPR uyumluluk snapshot + PDF export.",
    features: [
      "Health Score gösterge (0-100)",
      "Compliance PDF: son 30 günün spam/virus/karantina özeti",
      "Multi-server ribbon: hangi cPanel host aktif",
    ],
    how: [
      "Dashboard → Sağlık tab → 'PDF İndir'",
      "Rapor: verdict dağılımı + top senders + engine breakdown",
    ],
    testid: "docs-module-compliance",
  },
];

const CATEGORIES = [...new Set(MODULES.map(m => m.cat))];

const TONE_MAP = {
  sky: "text-sky-300 bg-sky-500/10 border-sky-500/40",
  indigo: "text-indigo-300 bg-indigo-500/10 border-indigo-500/40",
  rose: "text-rose-300 bg-rose-500/10 border-rose-500/40",
  amber: "text-amber-300 bg-amber-500/10 border-amber-500/40",
  emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-500/40",
  fuchsia: "text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/40",
  orange: "text-orange-300 bg-orange-500/10 border-orange-500/40",
};

export default function Docs() {
  const [active, setActive] = useState(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const filtered = MODULES.filter(m => {
    if (category !== "all" && m.cat !== category) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return m.label.toLowerCase().includes(q) || m.what.toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-400"/> Modül Dokümantasyonu
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">{MODULES.length} modül · kart tıkla → detaylı kullanım kılavuzu</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Ara..." data-testid="docs-search"
                   className="pl-8 pr-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100 w-48"/>
          </div>
          <select value={category} onChange={e => setCategory(e.target.value)} data-testid="docs-category"
                  className="px-2 py-2 bg-slate-800 border border-slate-700 rounded text-sm">
            <option value="all">Tüm Kategoriler</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="docs-grid">
        {filtered.map(m => (
          <button
            key={m.key} onClick={() => setActive(m)}
            data-testid={m.testid}
            className={`text-left border rounded-lg p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg ${TONE_MAP[m.tone]}`}
          >
            <div className="flex items-start justify-between">
              <m.Icon className="w-6 h-6 opacity-80"/>
              <span className="text-[10px] mono uppercase tracking-widest opacity-70">{m.cat}</span>
            </div>
            <div className="mt-3 text-base font-semibold">{m.label}</div>
            <div className="text-[11px] opacity-80 mt-1 line-clamp-2">{m.what}</div>
            <div className="text-[10px] opacity-60 mt-2">{m.features.length} özellik · nasıl kullanılır +</div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-3 text-center py-12 text-slate-500 text-sm">Sonuç yok</div>
        )}
      </div>

      {active && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-2 sm:p-6" onClick={() => setActive(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-t-xl sm:rounded-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl"
               data-testid="docs-detail" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg border ${TONE_MAP[active.tone]}`}>
                  <active.Icon className="w-6 h-6"/>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">{active.cat}</div>
                  <h2 className="text-slate-100 text-xl font-semibold">{active.label}</h2>
                </div>
              </div>
              <button onClick={() => setActive(null)} data-testid="docs-close"
                      className="p-2 rounded hover:bg-slate-800 text-slate-400"><X className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-5">
              {/* Preview visual — SVG mock */}
              <div className={`rounded-lg p-4 border ${TONE_MAP[active.tone]} bg-slate-950/50`}>
                <MockPreview module_key={active.key}/>
              </div>
              <section>
                <h3 className="text-slate-100 font-semibold text-sm mb-2">Ne yapar?</h3>
                <p className="text-slate-300 text-sm leading-relaxed">{active.what}</p>
              </section>
              <section>
                <h3 className="text-slate-100 font-semibold text-sm mb-2">Öne çıkan özellikler</h3>
                <ul className="text-slate-300 text-sm space-y-1.5">
                  {active.features.map((f, i) => (
                    <li key={i} className="flex gap-2 items-start">
                      <span className="text-indigo-400 mt-1">▸</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="text-slate-100 font-semibold text-sm mb-2">Nasıl kullanılır?</h3>
                <ol className="text-slate-300 text-sm space-y-1.5 list-decimal list-inside">
                  {active.how.map((h, i) => <li key={i}>{h}</li>)}
                </ol>
              </section>
              <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
                <span>Modül anahtarı: <span className="mono text-slate-400">{active.key}</span></span>
                <span>Kategori: <Badge>{active.cat}</Badge></span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Basit SVG mockup — modul için tema-uyumlu görsel placeholder
function MockPreview({ module_key }) {
  // Her modul için farklı görsel
  if (module_key === "dashboard") {
    return (
      <svg viewBox="0 0 400 100" className="w-full h-24">
        {[0,1,2,3,4,5].map(i => (
          <rect key={i} x={i*64+10} y={20} width={54} height={60} rx={6}
                fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.6}/>
        ))}
        <text x="10" y="15" fontSize="8" fill="currentColor" opacity={0.7}>Control Bar · 6 kart</text>
      </svg>
    );
  }
  if (module_key === "queue") {
    return (
      <svg viewBox="0 0 400 100" className="w-full h-24">
        {[0,1,2,3,4].map(i => (
          <g key={i}>
            <rect x={10} y={i*17+5} width={12} height={12} rx={2} fill="currentColor" opacity={0.3}/>
            <line x1={30} y1={i*17+11} x2={380} y2={i*17+11} stroke="currentColor" strokeWidth="0.5" opacity={0.4}/>
          </g>
        ))}
      </svg>
    );
  }
  if (module_key === "geoblocking") {
    return (
      <svg viewBox="0 0 400 100" className="w-full h-24">
        {["TR","US","CN","RU","DE","GB"].map((cc, i) => (
          <g key={cc} transform={`translate(${i*60+20},50)`}>
            <circle r="14" fill="currentColor" opacity="0.15"/>
            <text textAnchor="middle" y="4" fontSize="10" fill="currentColor" fontFamily="JetBrains Mono">{cc}</text>
          </g>
        ))}
      </svg>
    );
  }
  if (module_key === "ai") {
    return (
      <svg viewBox="0 0 400 100" className="w-full h-24">
        <circle cx="80" cy="50" r="30" fill="currentColor" opacity="0.15"/>
        <text x="80" y="55" textAnchor="middle" fontSize="18" fill="currentColor">AI</text>
        <path d="M120,50 L200,50" stroke="currentColor" strokeWidth="1" markerEnd="url(#arr)" opacity="0.6"/>
        <rect x="210" y="30" width="170" height="40" rx="4" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6"/>
        <text x="220" y="45" fontSize="8" fill="currentColor" opacity="0.7">Bayes · Rules · Analysis</text>
        <text x="220" y="60" fontSize="8" fill="currentColor" opacity="0.7">Turkish LLM · Claude</text>
      </svg>
    );
  }
  // default
  return (
    <svg viewBox="0 0 400 100" className="w-full h-24">
      <rect x="10" y="10" width="380" height="80" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
      <text x="200" y="55" textAnchor="middle" fontSize="14" fill="currentColor" opacity="0.7">modül önizleme</text>
    </svg>
  );
}
