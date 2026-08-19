/**
 * Advanced Threat Defense Center — 28 modül tek panelde
 * v43.99.6
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardBody, Badge } from "@/components/ui-primitives";
import {
  Shield, Search, AlertTriangle, Globe, Fingerprint, Brain, Bot,
  Radio, TrendingUp, ShieldAlert, RotateCcw, Bug, MessageCircle,
  Wand2, ScanSearch, Award, Building2, Mail, Archive, Zap, Map,
  FlaskConical, Smartphone, Wifi, WifiOff, Chrome, Layers, Network,
  Loader2, Check, X, ExternalLink, RefreshCw, Send,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

const API = process.env.REACT_APP_BACKEND_URL ? `${process.env.REACT_APP_BACKEND_URL}/api` : "/api";

// Simple inline button
const Button = ({ children, onClick, disabled, ...p }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 text-sm hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors mono font-semibold"
    {...p}
  >
    {children}
  </button>
);

// ---- 28 module catalog ----
const MODULES = [
  { id: "anti-phishing", icon: Shield, name: "Anti-Phishing Engine", desc: "URL phishing analizi, homoglyph, redirect chain", color: "rose" },
  { id: "bec", icon: AlertTriangle, name: "BEC / CEO Fraud", desc: "CEO taklidi, IBAN değişikliği, urgency baskısı", color: "amber" },
  { id: "brand", icon: Building2, name: "Brand Impersonation", desc: "Microsoft/Google/Apple/banka taklit tespiti", color: "indigo" },
  { id: "url-deep", icon: ScanSearch, name: "URL Deep Analysis", desc: "DNS, WHOIS, redirect, IP, ASN, country", color: "cyan" },
  { id: "sandbox-att", icon: Bug, name: "Attachment Sandbox", desc: "Ek dosya statik analiz + hash reputation", color: "orange" },
  { id: "sandbox-url", icon: Chrome, name: "URL Sandbox", desc: "urlscan.io ücretsiz sandbox arama", color: "sky" },
  { id: "dna", icon: Fingerprint, name: "Email DNA", desc: "Mail için benzersiz fingerprint, benzerlik", color: "violet" },
  { id: "threat-intel", icon: Radio, name: "Global Threat Intel", desc: "Merkezi IOC deposu, ağ katkısı", color: "fuchsia" },
  { id: "reputation", icon: Award, name: "Sender Reputation", desc: "IP/Domain/Sender reputation skoru", color: "emerald" },
  { id: "compromise", icon: WifiOff, name: "Account Compromise", desc: "Ele geçirilmiş mailbox tespiti", color: "red" },
  { id: "incidents", icon: ShieldAlert, name: "Incident Response", desc: "Saldırıları merkezi yönet", color: "rose" },
  { id: "retroactive", icon: RotateCcw, name: "Retroactive Scanner", desc: "Yeni IOC ile eski mailleri tara", color: "amber" },
  { id: "ai-ask", icon: Brain, name: "AI Security Assistant", desc: "Doğal dilde sorgulama (LLM)", color: "indigo" },
  { id: "ai-rule", icon: Wand2, name: "AI Rule Generator", desc: "Doğal dilde kural üretme", color: "violet" },
  { id: "search", icon: Search, name: "Global Search", desc: "Sistemde her yerde arama", color: "slate" },
  { id: "mail-score", icon: TrendingUp, name: "Mail Security Score", desc: "SPF/DKIM/DMARC/BIMI puan", color: "emerald" },
  { id: "domain-security", icon: Building2, name: "Domain Security Center", desc: "Domain başına detaylı skor", color: "cyan" },
  { id: "continuity", icon: Mail, name: "Mail Continuity", desc: "Sunucu düşerse mail kuyruğu", color: "sky" },
  { id: "archive", icon: Archive, name: "Enterprise Archive", desc: "Uzun süreli mail arşivi + arama", color: "slate" },
  { id: "soar", icon: Zap, name: "SOAR Lite", desc: "IF/THEN otomasyon kuralları", color: "orange" },
  { id: "attack-map", icon: Map, name: "Global Attack Map", desc: "Dünya haritası saldırı verisi", color: "rose" },
  { id: "simulator", icon: FlaskConical, name: "Mail Simulator", desc: ".eml yükle → tüm motorları test et", color: "violet" },
  { id: "mobile-soc", icon: Smartphone, name: "Mobile SOC", desc: "PWA — telefondan izleme", color: "indigo" },
  { id: "web-spam", icon: MessageCircle, name: "Web Spam Protection", desc: "Form/comment/bot spam", color: "amber" },
  { id: "webshield", icon: Shield, name: "WebShield", desc: "PHP/webshell tespiti", color: "red" },
  { id: "wp-security", icon: Layers, name: "WordPress Security", desc: "WP site tarama", color: "cyan" },
  { id: "multiplatform", icon: Network, name: "Multi-Platform", desc: "cPanel/DA/Plesk/M365/Workspace", color: "emerald" },
  { id: "network", icon: Globe, name: "Global Threat Network", desc: "Gökyüzü topluluk ağı istatistikleri", color: "fuchsia" },
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

// ---- API helpers ----
async function callThreatApi(path, method = "GET", body = null) {
  const url = `${API}/threat${path}`;
  const opts = { method, headers: { "Content-Type": "application/json" } };
  const mk = localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license");
  if (mk) opts.headers["X-Master-Key"] = mk;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---- Module renderers ----
function ModuleRunner({ mod, onClose }) {
  const [output, setOutput] = useState(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState({});
  const set = (k, v) => setInput(p => ({ ...p, [k]: v }));

  async function run(path, method = "POST", body = null) {
    setLoading(true);
    try {
      const res = await callThreatApi(path, method, body || input);
      setOutput(res);
      toast.success("Tamamlandı");
    } catch (e) {
      toast.error(`Hata: ${e.message}`);
      setOutput({ error: e.message });
    } finally {
      setLoading(false);
    }
  }

  const RUN = {
    "anti-phishing": () => (
      <Runner label="URL veya text girin (birden fazla URL desteklenir)">
        <textarea value={input.text || ""} onChange={e => set("text", e.target.value)}
          className="w-full h-24 bg-slate-950/60 border border-slate-700 rounded p-2 text-slate-100 text-sm mono"
          placeholder="https://micr0soft-secure.tk/login veya mail body..." data-testid="input-anti-phishing" />
        <Button onClick={() => run("/anti-phishing/scan", "POST", { text: input.text })} data-testid="btn-anti-phishing">
          Analiz Et
        </Button>
      </Runner>
    ),
    "bec": () => (
      <Runner label="Mail bilgilerini gir">
        <Field label="From (isim)" v={input.from_name} on={v => set("from_name", v)} />
        <Field label="From (email)" v={input.from_email} on={v => set("from_email", v)} />
        <Field label="Reply-To" v={input.reply_to} on={v => set("reply_to", v)} />
        <Field label="Subject" v={input.subject} on={v => set("subject", v)} />
        <textarea value={input.body || ""} onChange={e => set("body", e.target.value)}
          className="w-full h-20 bg-slate-950/60 border border-slate-700 rounded p-2 text-slate-100 text-sm" placeholder="Mail body..." />
        <Button onClick={() => run("/bec/analyze")} data-testid="btn-bec">BEC Analiz</Button>
      </Runner>
    ),
    "brand": () => (
      <Runner label="Marka taklit tespiti">
        <Field label="From (email)" v={input.from_email} on={v => set("from_email", v)} />
        <Field label="From (isim)" v={input.from_name} on={v => set("from_name", v)} />
        <Field label="Subject" v={input.subject} on={v => set("subject", v)} />
        <textarea value={input.body || ""} onChange={e => set("body", e.target.value)}
          className="w-full h-16 bg-slate-950/60 border border-slate-700 rounded p-2 text-slate-100 text-sm" placeholder="Mail body..." />
        <Button onClick={() => run("/brand-impersonation/check")} data-testid="btn-brand">Marka Kontrolü</Button>
      </Runner>
    ),
    "url-deep": () => (
      <Runner label="URL derin analiz">
        <Field label="URL" v={input.url} on={v => set("url", v)} placeholder="https://example.com" />
        <Button onClick={() => run("/url-deep/analyze")} data-testid="btn-url-deep">Analiz</Button>
      </Runner>
    ),
    "sandbox-att": () => (
      <Runner label="Ek dosya statik analiz">
        <Field label="Dosya adı" v={input.filename} on={v => set("filename", v)} placeholder="fatura.pdf.exe" />
        <Field label="Boyut (byte)" v={input.size} on={v => set("size", v)} type="number" />
        <Field label="SHA256 (opsiyonel)" v={input.sha256} on={v => set("sha256", v)} />
        <Button onClick={() => run("/sandbox/attachment")}>Analiz Et</Button>
      </Runner>
    ),
    "sandbox-url": () => (
      <Runner label="URL sandbox (urlscan.io)">
        <Field label="URL" v={input.url} on={v => set("url", v)} placeholder="https://example.com" />
        <Button onClick={() => run("/sandbox/url")}>Sandbox Ara</Button>
      </Runner>
    ),
    "dna": () => (
      <Runner label="Email DNA fingerprint">
        <Field label="From" v={input.from_email} on={v => set("from_email", v)} />
        <Field label="Subject" v={input.subject} on={v => set("subject", v)} />
        <textarea value={input.body || ""} onChange={e => set("body", e.target.value)}
          className="w-full h-20 bg-slate-950/60 border border-slate-700 rounded p-2 text-slate-100 text-sm" placeholder="Body..." />
        <Button onClick={() => run("/dna/fingerprint")}>DNA Üret</Button>
      </Runner>
    ),
    "threat-intel": () => (
      <div className="space-y-3">
        <Button onClick={() => run("/threat-intel/iocs", "GET")}>IOC Listele</Button>
        <div className="border-t border-slate-800 pt-3">
          <div className="text-xs text-slate-400 mb-2">Yeni IOC ekle:</div>
          <Field label="Kind (ip/domain/url/hash)" v={input.kind} on={v => set("kind", v)} />
          <Field label="Value" v={input.value} on={v => set("value", v)} />
          <Field label="Reason" v={input.reason} on={v => set("reason", v)} />
          <Button onClick={() => run("/threat-intel/report")}>Ekle</Button>
        </div>
      </div>
    ),
    "reputation": () => (
      <Runner label="Reputation sorgu">
        <Field label="Email" v={input.email} on={v => set("email", v)} />
        <Field label="Domain" v={input.domain} on={v => set("domain", v)} />
        <Field label="IP" v={input.ip} on={v => set("ip", v)} />
        <Button onClick={() => {
          const q = new URLSearchParams(Object.fromEntries(Object.entries(input).filter(([, v]) => v))).toString();
          run("/reputation/sender?" + q, "GET");
        }}>Sorgula</Button>
      </Runner>
    ),
    "compromise": () => (
      <Runner label="Son 24 saatte compromise şüphesi">
        <Field label="Saat penceresi" v={input.hours || 24} on={v => set("hours", v)} type="number" />
        <Button onClick={() => run(`/compromise/detect?hours=${input.hours || 24}`, "GET")}>Tespit Et</Button>
      </Runner>
    ),
    "incidents": () => (
      <div className="space-y-3">
        <Button onClick={() => run("/incidents", "GET")}>Açık Incident'ları Listele</Button>
        <div className="border-t border-slate-800 pt-3">
          <div className="text-xs text-slate-400 mb-2">Manuel Incident oluştur:</div>
          <Field label="Threat Type" v={input.threat_type} on={v => set("threat_type", v)} />
          <Field label="Severity" v={input.severity} on={v => set("severity", v)} />
          <Field label="Notes" v={input.notes} on={v => set("notes", v)} />
          <Button onClick={() => run("/incidents")}>Oluştur</Button>
        </div>
      </div>
    ),
    "retroactive": () => (
      <Runner label="Yeni IOC ile geriye dönük tarama">
        <Field label="Kind (domain/ip)" v={input.kind} on={v => set("kind", v)} />
        <Field label="Value" v={input.value} on={v => set("value", v)} />
        <Field label="Gün" v={input.days || 30} on={v => set("days", v)} type="number" />
        <Button onClick={() => run("/retroactive/scan")}>Tara</Button>
      </Runner>
    ),
    "ai-ask": () => (
      <Runner label="AI'a güvenlik sorusu sor">
        <textarea value={input.question || ""} onChange={e => set("question", e.target.value)}
          className="w-full h-20 bg-slate-950/60 border border-slate-700 rounded p-2 text-slate-100 text-sm"
          placeholder="Bugün spam neden arttı?" data-testid="input-ai-question" />
        <Button onClick={() => run("/ai/ask")} data-testid="btn-ai-ask">
          <Send className="w-3 h-3" /> Sor
        </Button>
      </Runner>
    ),
    "ai-rule": () => (
      <Runner label="Doğal dilde kural yaz">
        <textarea value={input.prompt || ""} onChange={e => set("prompt", e.target.value)}
          className="w-full h-20 bg-slate-950/60 border border-slate-700 rounded p-2 text-slate-100 text-sm"
          placeholder="Microsoft taklidi yapan ve DMARC başarısız olan mailleri karantinaya al" />
        <Button onClick={() => run("/ai/generate-rule")}>Kural Üret</Button>
      </Runner>
    ),
    "search": () => (
      <Runner label="Global arama">
        <Field label="Arama sorgusu (IP, domain, email...)" v={input.q} on={v => set("q", v)} />
        <Button onClick={() => run(`/global-search?q=${encodeURIComponent(input.q || "")}`, "GET")}>Ara</Button>
      </Runner>
    ),
    "mail-score": () => (
      <Runner label="Domain mail güvenlik skoru">
        <Field label="Domain" v={input.domain} on={v => set("domain", v)} placeholder="example.com" />
        <Button onClick={() => run(`/mail-security-score?domain=${input.domain || ""}`, "GET")}>Skor Al</Button>
      </Runner>
    ),
    "domain-security": () => (
      <Runner label="Domain güvenlik merkezi">
        <Field label="Domain" v={input.domain} on={v => set("domain", v)} />
        <Button onClick={() => run(`/domain-security/${input.domain || "example.com"}`, "GET")}>Analiz</Button>
      </Runner>
    ),
    "continuity": () => (
      <Runner label="Kuyruk durumu">
        <Button onClick={() => run("/continuity/queue-status", "GET")}>Durumu Getir</Button>
      </Runner>
    ),
    "archive": () => (
      <Runner label="Arşiv arama">
        <Field label="Konu içerir" v={input.q} on={v => set("q", v)} />
        <Field label="From" v={input.from_addr} on={v => set("from_addr", v)} />
        <Field label="Gün" v={input.days || 30} on={v => set("days", v)} type="number" />
        <Button onClick={() => {
          const q = new URLSearchParams(input).toString();
          run(`/archive/search?${q}`, "GET");
        }}>Ara</Button>
      </Runner>
    ),
    "soar": () => (
      <div className="space-y-3">
        <Button onClick={() => run("/soar/rules", "GET")}>Kuralları Listele</Button>
      </div>
    ),
    "attack-map": () => (
      <Runner label="Global saldırı haritası">
        <Field label="Saat penceresi" v={input.hours || 24} on={v => set("hours", v)} type="number" />
        <Button onClick={() => run(`/attack-map?hours=${input.hours || 24}`, "GET")}>Yükle</Button>
      </Runner>
    ),
    "simulator": () => (
      <Runner label=".eml içeriğini yapıştır">
        <textarea value={input.eml || ""} onChange={e => set("eml", e.target.value)}
          className="w-full h-32 bg-slate-950/60 border border-slate-700 rounded p-2 text-slate-100 text-sm mono"
          placeholder="From: ...\nSubject: ...\n\nBody..." />
        <Button onClick={() => run("/simulator/eml")}>Simüle Et</Button>
      </Runner>
    ),
    "mobile-soc": () => (
      <Runner label="Mobile SOC özet">
        <Button onClick={() => run("/mobile-soc/summary", "GET")}>Özet Getir</Button>
      </Runner>
    ),
    "web-spam": () => (
      <Runner label="Web/Form spam kontrolü">
        <textarea value={input.text || ""} onChange={e => set("text", e.target.value)}
          className="w-full h-20 bg-slate-950/60 border border-slate-700 rounded p-2 text-slate-100 text-sm" />
        <Field label="IP (ops.)" v={input.ip} on={v => set("ip", v)} />
        <Button onClick={() => run("/web-spam/check")}>Kontrol</Button>
      </Runner>
    ),
    "webshield": () => (
      <Runner label="PHP kaynak kod webshell tespit">
        <textarea value={input.code || ""} onChange={e => set("code", e.target.value)}
          className="w-full h-32 bg-slate-950/60 border border-slate-700 rounded p-2 text-slate-100 text-sm mono"
          placeholder="<?php eval(base64_decode(...)); ?>" />
        <Button onClick={() => run("/webshield/scan-hints")}>Tara</Button>
      </Runner>
    ),
    "wp-security": () => (
      <Runner label="WordPress site kontrolü">
        <Field label="Site URL" v={input.site} on={v => set("site", v)} placeholder="https://ornek.com" />
        <Button onClick={() => run(`/wp-security/scan?site=${encodeURIComponent(input.site || "")}`, "GET")}>Tara</Button>
      </Runner>
    ),
    "multiplatform": () => (
      <Runner label="Desteklenen platformlar">
        <Button onClick={() => run("/multiplatform/status", "GET")}>Getir</Button>
      </Runner>
    ),
    "network": () => (
      <Runner label="Global Threat Network istatistikleri">
        <Button onClick={() => run("/network/stats", "GET")}>Getir</Button>
        <Button onClick={() => run("/feed/refresh", "POST")}>URLhaus Feed Yenile</Button>
      </Runner>
    ),
  };

  const Runner = ({ label, children }) => (
    <div className="space-y-2.5">
      <div className="text-xs text-slate-400">{label}</div>
      {children}
    </div>
  );

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded border ${COLOR_MAP[mod.color]} text-xs font-semibold`}>
            <mod.icon className="w-3.5 h-3.5" />
            {mod.name}
          </div>
          <div className="text-xs text-slate-400 mt-2">{mod.desc}</div>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="border-t border-slate-800 pt-4">
        {RUN[mod.id] ? RUN[mod.id]() : (
          <div className="text-xs text-slate-500">Bu modül için çalıştırıcı yakında.</div>
        )}
      </div>
      {loading && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Çalıştırılıyor...</div>}
      {output && (
        <div className="border-t border-slate-800 pt-3">
          <div className="text-xs text-slate-400 mb-1.5 font-semibold">Sonuç</div>
          <pre className="bg-slate-950/60 border border-slate-800 rounded p-3 text-[11px] text-slate-200 mono overflow-auto max-h-96">
{JSON.stringify(output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

const Field = ({ label, v, on, type = "text", placeholder = "" }) => (
  <div>
    <label className="block text-[11px] text-slate-500 mb-1">{label}</label>
    <input type={type} value={v || ""} onChange={e => on(e.target.value)}
      className="w-full bg-slate-950/60 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 text-sm"
      placeholder={placeholder} />
  </div>
);

// ---- Main hub page ----
export default function ThreatDefenseCenter() {
  const [active, setActive] = useState(null);
  const [filter, setFilter] = useState("");
  const netQ = useQuery({ queryKey: ["threat-network"], queryFn: () => callThreatApi("/network/stats", "GET"),
                          refetchInterval: 60000 });

  const filtered = MODULES.filter(m =>
    !filter || m.name.toLowerCase().includes(filter.toLowerCase())
             || m.desc.toLowerCase().includes(filter.toLowerCase())
  );

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
            28 gelişmiş güvenlik modülü — hepsi ücretsiz altyapı ile · v43.99.6
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-slate-500">Global IOC Ağı</div>
            <div className="text-lg font-bold text-emerald-300 mono">
              {netQ.data ? netQ.data.total_iocs.toLocaleString() : "..."}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Mail Fingerprint</div>
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
          onChange={e => setFilter(e.target.value)}
          placeholder="Modüllerde ara: 'phishing', 'ai', 'domain'..."
          data-testid="module-search"
          className="w-full pl-10 pr-4 py-2.5 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100 text-sm focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {/* Modules grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map((m, i) => (
          <button
            key={m.id}
            onClick={() => setActive(m)}
            data-testid={`module-card-${m.id}`}
            className={`group relative text-left p-4 rounded-lg border transition-all
                        ${active?.id === m.id
                          ? `${COLOR_MAP[m.color]} scale-[1.02] shadow-lg`
                          : "border-slate-800 bg-slate-900/40 hover:bg-slate-900/70 hover:border-slate-700"}`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-md flex items-center justify-center ${COLOR_MAP[m.color]}`}>
                <m.icon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-100 truncate">{m.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{m.desc}</div>
              </div>
              <div className="text-[10px] text-slate-600 mono">#{String(i+1).padStart(2, "0")}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Runner Drawer */}
      {active && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
             onClick={() => setActive(null)}>
          <div
            className="w-full sm:max-w-3xl max-h-[85vh] overflow-auto bg-slate-950 border border-slate-800 rounded-t-xl sm:rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <ModuleRunner mod={active} onClose={() => setActive(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
