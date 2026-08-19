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
  CheckCircle2, XCircle, AlertCircle, Clock, MapPin, Hash, Users,
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

// ---- Smart Result Renderer ----
const VERDICT_STYLES = {
  safe: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-300", icon: CheckCircle2, label: "GÜVENLİ" },
  clean: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-300", icon: CheckCircle2, label: "TEMİZ" },
  ok: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-300", icon: CheckCircle2, label: "OK" },
  suspicious: { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-300", icon: AlertCircle, label: "ŞÜPHELİ" },
  phishing: { bg: "bg-rose-500/15", border: "border-rose-500/40", text: "text-rose-300", icon: AlertTriangle, label: "PHISHING" },
  malicious: { bg: "bg-rose-500/15", border: "border-rose-500/40", text: "text-rose-300", icon: XCircle, label: "KÖTÜCÜL" },
  brand_impersonation: { bg: "bg-rose-500/15", border: "border-rose-500/40", text: "text-rose-300", icon: AlertTriangle, label: "MARKA TAKLİDİ" },
  bec_attack: { bg: "bg-rose-500/15", border: "border-rose-500/40", text: "text-rose-300", icon: AlertTriangle, label: "BEC SALDIRISI" },
  spam: { bg: "bg-orange-500/15", border: "border-orange-500/40", text: "text-orange-300", icon: XCircle, label: "SPAM" },
  compromised: { bg: "bg-rose-500/15", border: "border-rose-500/40", text: "text-rose-300", icon: WifiOff, label: "ELE GEÇİRİLDİ" },
  quarantine: { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-300", icon: Archive, label: "KARANTİNA" },
  allow: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-300", icon: CheckCircle2, label: "İZİN VER" },
  tag_suspicious: { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-300", icon: AlertCircle, label: "ETİKETLE" },
};

function Verdict({ value }) {
  const key = String(value || "").toLowerCase();
  const s = VERDICT_STYLES[key] || { bg: "bg-slate-500/15", border: "border-slate-500/40", text: "text-slate-300", icon: Info, label: String(value).toUpperCase() };
  const Icon = s.icon;
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border ${s.bg} ${s.border} ${s.text} text-xs font-bold`}>
      <Icon className="w-3.5 h-3.5" />
      {s.label}
    </div>
  );
}

function ScoreBar({ score, max = 100 }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  const color = score >= 70 ? "bg-rose-500" : score >= 40 ? "bg-amber-500" : "bg-emerald-500";
  const textColor = score >= 70 ? "text-rose-300" : score >= 40 ? "text-amber-300" : "text-emerald-300";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Skor</span>
        <span className={`text-2xl font-black mono ${textColor}`}>{score}<span className="text-slate-500 text-sm">/{max}</span></span>
      </div>
      <div className="h-2 bg-slate-800 rounded overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatRow({ label, value, color = "slate", mono = false }) {
  const colorMap = { slate: "text-slate-200", emerald: "text-emerald-300", amber: "text-amber-300", rose: "text-rose-300", indigo: "text-indigo-300" };
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800/60 last:border-0">
      <span className="text-[12px] text-slate-400">{label}</span>
      <span className={`text-[13px] ${mono ? "mono" : ""} font-semibold ${colorMap[color] || colorMap.slate}`}>{value}</span>
    </div>
  );
}

function BreakdownBars({ breakdown }) {
  const entries = Object.entries(breakdown || {});
  return (
    <div className="space-y-2.5">
      {entries.map(([k, v]) => {
        const pct = Math.max(0, Math.min(100, Number(v) || 0));
        const color = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500";
        return (
          <div key={k} className="space-y-1">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-slate-400 uppercase tracking-wider font-semibold">{k}</span>
              <span className="mono font-bold text-slate-200">{pct}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
              <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReasonsList({ items, tone = "amber" }) {
  const toneMap = { amber: "text-amber-300", rose: "text-rose-300", emerald: "text-emerald-300", slate: "text-slate-300" };
  const Icon = tone === "emerald" ? CheckCircle2 : tone === "rose" ? XCircle : AlertCircle;
  return (
    <ul className="space-y-1.5">
      {(items || []).map((r, i) => (
        <li key={i} className={`flex items-start gap-2 text-[13px] ${toneMap[tone]}`}>
          <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{r}</span>
        </li>
      ))}
    </ul>
  );
}

function KeyValueGrid({ data, cols = 2 }) {
  const entries = Object.entries(data || {}).filter(([k, v]) => v !== null && v !== undefined && v !== "" && !Array.isArray(v) && typeof v !== "object");
  if (!entries.length) return null;
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-${cols} gap-2.5`}>
      {entries.map(([k, v]) => (
        <div key={k} className="bg-slate-900/40 border border-slate-800 rounded px-3 py-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-0.5">{k.replace(/_/g, " ")}</div>
          <div className="text-[13px] text-slate-200 mono break-all">{String(v)}</div>
        </div>
      ))}
    </div>
  );
}

function DataTable({ rows, columns }) {
  if (!rows || !rows.length) return <div className="text-xs text-slate-500 italic py-4 text-center">Kayıt bulunamadı</div>;
  const cols = columns || Object.keys(rows[0]).filter(k => typeof rows[0][k] !== "object");
  return (
    <div className="overflow-auto border border-slate-800 rounded">
      <table className="w-full text-[12px]">
        <thead className="bg-slate-900/60 border-b border-slate-800">
          <tr>
            {cols.map(c => (
              <th key={c} className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400 font-bold">{c.replace(/_/g, " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((r, i) => (
            <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-900/40">
              {cols.map(c => (
                <td key={c} className="px-3 py-2 text-slate-200 mono">
                  {typeof r[c] === "boolean" ? (r[c] ? "✓" : "—") : (r[c] === null || r[c] === undefined ? "—" : String(r[c]))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 20 && <div className="text-[10px] text-slate-500 text-center py-2">+{rows.length - 20} kayıt daha</div>}
    </div>
  );
}

function Section({ title, icon: Ico = Info, children }) {
  return (
    <div className="border border-slate-800 rounded-lg bg-slate-900/30">
      <div className="px-3 py-2 border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-400 font-bold flex items-center gap-2">
        <Ico className="w-3.5 h-3.5" />
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function ResultView({ data, modId }) {
  if (!data) return null;
  if (data.error) {
    return (
      <div className="border border-rose-500/40 bg-rose-500/10 rounded-lg p-4 text-rose-200 text-sm flex items-start gap-2">
        <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <div className="font-bold mb-1">Hata</div>
          <div className="text-rose-300 text-[13px]">{data.error}</div>
        </div>
      </div>
    );
  }

  // Anti-Phishing: results array
  if (modId === "anti-phishing" && Array.isArray(data.results)) {
    return (
      <div className="space-y-3">
        {data.results.map((r, i) => (
          <div key={i} className="border border-slate-800 rounded-lg p-4 space-y-3 bg-slate-900/30">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="text-[13px] text-slate-200 mono break-all flex-1 min-w-0">{r.url}</div>
              <Verdict value={r.verdict} />
            </div>
            <ScoreBar score={r.score} />
            <Section title="Tespit Nedenleri" icon={AlertCircle}>
              <ReasonsList items={r.reasons} tone={r.score >= 60 ? "rose" : r.score >= 30 ? "amber" : "emerald"} />
            </Section>
            {r.homoglyph && r.homoglyph.distance <= 3 && (
              <Section title="Homoglyph Benzerlik" icon={ScanSearch}>
                <StatRow label="En benzer marka" value={r.homoglyph.most_similar} color="rose" mono />
                <StatRow label="Uzaklık" value={r.homoglyph.distance} mono />
                <StatRow label="Benzerlik" value={`%${r.homoglyph.similarity}`} color="rose" mono />
              </Section>
            )}
          </div>
        ))}
      </div>
    );
  }

  // BEC / Brand: score + verdict + reasons + signals
  if ((modId === "bec" || modId === "brand" || modId === "web-spam" || modId === "webshield") && data.verdict !== undefined) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Verdict value={data.verdict} />
          <div className="text-xs text-slate-400 mono">{data.checked_at?.slice(0, 19).replace("T", " ")}</div>
        </div>
        <ScoreBar score={data.score} />
        {data.reasons && data.reasons.length > 0 && (
          <Section title="Tespit Nedenleri" icon={AlertCircle}>
            <ReasonsList items={data.reasons} tone={data.score >= 70 ? "rose" : data.score >= 40 ? "amber" : "emerald"} />
          </Section>
        )}
        {data.signals && (
          <Section title="Sinyal Detayları" icon={Hash}>
            <KeyValueGrid data={data.signals} cols={3} />
          </Section>
        )}
        {data.brand_hits && data.brand_hits.length > 0 && (
          <Section title="Marka Eşleşmeleri" icon={Building2}>
            <DataTable rows={data.brand_hits} />
          </Section>
        )}
      </div>
    );
  }

  // Mail Security Score & Domain Security
  if (modId === "mail-score" || modId === "domain-security") {
    const scoreData = modId === "domain-security" ? data.authentication : data;
    if (scoreData && scoreData.total_score !== undefined) {
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Domain</div>
              <div className="text-base font-bold text-slate-100 mono">{scoreData.domain}</div>
            </div>
            <ScoreBar score={scoreData.total_score} />
          </div>
          {scoreData.breakdown && (
            <Section title="Kayıt Detayları" icon={Shield}>
              <BreakdownBars breakdown={scoreData.breakdown} />
            </Section>
          )}
          {scoreData.reasons && (
            <Section title="Notlar" icon={Info}>
              <ReasonsList items={scoreData.reasons} tone={scoreData.total_score >= 70 ? "emerald" : "amber"} />
            </Section>
          )}
          {modId === "domain-security" && (
            <>
              {data.reputation && Object.keys(data.reputation).length > 0 && (
                <Section title="İtibar" icon={Award}>
                  <KeyValueGrid data={data.reputation} />
                </Section>
              )}
              <Section title="Spam İstatistikleri" icon={TrendingUp}>
                <StatRow label="Gelen spam" value={data.incoming_spam ?? 0} color="rose" mono />
                <StatRow label="Giden spam" value={data.outgoing_spam ?? 0} color="amber" mono />
              </Section>
            </>
          )}
        </div>
      );
    }
  }

  // URL Deep Analysis
  if (modId === "url-deep") {
    return (
      <div className="space-y-3">
        <Section title="Genel Bilgi" icon={Globe}>
          <StatRow label="URL" value={data.url} mono />
          <StatRow label="Son URL" value={data.final_url} mono />
          <StatRow label="HTTP durumu" value={data.status} color={data.status >= 200 && data.status < 300 ? "emerald" : "amber"} mono />
          <StatRow label="IP" value={data.ip || "—"} mono />
          <StatRow label="Ülke" value={data.country || "—"} />
          <StatRow label="ASN" value={data.asn || "—"} mono />
        </Section>
        {data.features && (
          <Section title="URL Özellikleri" icon={ScanSearch}>
            <KeyValueGrid data={data.features} cols={3} />
          </Section>
        )}
        {data.redirect_chain && data.redirect_chain.length > 0 && (
          <Section title={`Yönlendirme Zinciri (${data.redirect_chain.length} adım)`} icon={RotateCcw}>
            <DataTable rows={data.redirect_chain} />
          </Section>
        )}
        {data.homoglyph && (
          <Section title="Marka Benzerlik" icon={Building2}>
            <StatRow label="En yakın" value={data.homoglyph.most_similar} color="amber" mono />
            <StatRow label="Uzaklık" value={data.homoglyph.distance} mono />
          </Section>
        )}
      </div>
    );
  }

  // Attachment sandbox
  if (modId === "sandbox-att") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Verdict value={data.verdict} />
        </div>
        <ScoreBar score={data.score} />
        <Section title="Dosya" icon={Hash}>
          <StatRow label="Ad" value={data.filename} mono />
          <StatRow label="Uzantı" value={"." + data.extension} color="amber" mono />
          <StatRow label="Boyut" value={`${(data.size / 1024).toFixed(1)} KB`} mono />
          {data.sha256 && <StatRow label="SHA256" value={data.sha256.slice(0, 32) + "..."} mono />}
        </Section>
        <Section title="Nedenler" icon={AlertCircle}>
          <ReasonsList items={data.reasons} tone={data.score >= 60 ? "rose" : data.score >= 30 ? "amber" : "emerald"} />
        </Section>
        {data.note && (
          <div className="text-[11px] text-slate-500 italic border-l-2 border-slate-700 pl-3">{data.note}</div>
        )}
      </div>
    );
  }

  // URL Sandbox — urlscan
  if (modId === "sandbox-url" && Array.isArray(data.results)) {
    return (
      <div className="space-y-3">
        <Section title="urlscan.io Sonuçları" icon={Chrome}>
          <StatRow label="Domain" value={data.domain} mono />
          <StatRow label="Toplam tarama" value={data.total ?? 0} mono />
          <StatRow label="Sağlayıcı" value={data.provider || "urlscan.io"} />
        </Section>
        {data.results.length > 0 ? (
          <Section title="Geçmiş Taramalar" icon={Clock}>
            <DataTable rows={data.results.map(r => ({ url: r.url, time: r.time?.slice(0, 19) || "-", malicious: r.verdict }))} />
          </Section>
        ) : (
          <div className="text-xs text-slate-500 italic text-center py-3">Bu domain için geçmiş tarama bulunmuyor.</div>
        )}
      </div>
    );
  }

  // Email DNA
  if (modId === "dna") {
    return (
      <div className="space-y-3">
        <Section title="Fingerprint" icon={Fingerprint}>
          <StatRow label="DNA" value={data.dna?.slice(0, 40) + "..."} mono color="indigo" />
          <StatRow label="Benzer görülme" value={`${data.similar_seen ?? 0} kez`} color={data.similar_seen > 0 ? "amber" : "emerald"} mono />
        </Section>
        {data.components && (
          <Section title="Bileşenler" icon={Hash}>
            <KeyValueGrid data={{
              "Subject Hash": data.components.subject?.slice(0, 16) + "...",
              "Body Hash": data.components.body?.slice(0, 16) + "...",
              "URL Hash": data.components.urls?.slice(0, 16) + "...",
            }} cols={1} />
          </Section>
        )}
        {data.note && <div className="text-[13px] text-slate-300 border-l-2 border-indigo-500 pl-3 italic">{data.note}</div>}
      </div>
    );
  }

  // Threat Intel IOCs
  if (modId === "threat-intel" && (data.iocs || data.counts)) {
    return (
      <div className="space-y-3">
        {data.counts && (
          <Section title="IOC Sayaçları" icon={Radio}>
            <KeyValueGrid data={data.counts} cols={5} />
            <div className="mt-2 pt-2 border-t border-slate-800">
              <StatRow label="Toplam" value={data.total ?? 0} color="fuchsia" mono />
            </div>
          </Section>
        )}
        {data.iocs && data.iocs.length > 0 && (
          <Section title="Son IOC'lar" icon={Radio}>
            <DataTable rows={data.iocs} />
          </Section>
        )}
      </div>
    );
  }

  // Reputation
  if (modId === "reputation") {
    return (
      <div className="space-y-3">
        {["sender", "domain", "ip"].map(k => data[k] && (
          <Section key={k} title={k.toUpperCase()} icon={Award}>
            {Object.entries(data[k]).map(([kk, vv]) => (
              <StatRow key={kk} label={kk.replace(/_/g, " ")} value={vv} mono
                       color={kk.includes("reputation") ? (vv >= 70 ? "emerald" : vv >= 40 ? "amber" : "rose") : "slate"} />
            ))}
          </Section>
        ))}
      </div>
    );
  }

  // Compromise detection
  if (modId === "compromise" && data.suspicious_accounts) {
    return (
      <div className="space-y-3">
        <Section title={`Şüpheli Hesaplar (${data.suspicious_accounts.length})`} icon={WifiOff}>
          {data.suspicious_accounts.length === 0
            ? <div className="text-xs text-slate-500 italic text-center py-3">Son {data.window_hours} saatte şüpheli aktivite yok ✓</div>
            : <DataTable rows={data.suspicious_accounts} />
          }
        </Section>
      </div>
    );
  }

  // Incidents
  if (modId === "incidents" && data.incidents) {
    return (
      <div className="space-y-3">
        <Section title={`Incident'lar (${data.incidents.length})`} icon={ShieldAlert}>
          <DataTable rows={data.incidents.map(i => ({
            id: i.id, type: i.threat_type, severity: i.severity, status: i.status,
            messages: i.message_count, at: i.at?.slice(0, 19),
          }))} />
        </Section>
      </div>
    );
  }
  if (modId === "incidents" && data.id) {
    // Yeni incident yaratıldı
    return (
      <Section title="Incident Oluşturuldu" icon={CheckCircle2}>
        <StatRow label="ID" value={data.id} mono color="emerald" />
        <StatRow label="Threat" value={data.threat_type} />
        <StatRow label="Severity" value={data.severity} color="amber" />
        <StatRow label="Status" value={data.status} color="emerald" />
      </Section>
    );
  }

  // Retroactive scan
  if (modId === "retroactive") {
    return (
      <Section title="Geriye Dönük Tarama" icon={RotateCcw}>
        <StatRow label="IOC" value={data.ioc} mono color="rose" />
        <StatRow label="Türü" value={data.kind} />
        <StatRow label="Gün" value={data.days} mono />
        <StatRow label="Eşleşen mail" value={data.matched_mails ?? 0} mono color={data.matched_mails > 0 ? "rose" : "emerald"} />
        {data.note && <div className="text-[13px] text-slate-300 mt-2 italic">{data.note}</div>}
      </Section>
    );
  }

  // AI Ask
  if (modId === "ai-ask") {
    return (
      <div className="space-y-3">
        <Section title="Soru" icon={Brain}>
          <div className="text-[13px] text-slate-300">{data.question}</div>
        </Section>
        <Section title="AI Cevabı" icon={Brain}>
          <div className="text-[13px] text-slate-200 whitespace-pre-wrap leading-relaxed">{data.answer}</div>
          <div className="mt-2 pt-2 border-t border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
            Sağlayıcı: {data.provider}
          </div>
        </Section>
      </div>
    );
  }

  // AI Rule generator
  if (modId === "ai-rule") {
    return (
      <div className="space-y-3">
        <Section title="Prompt" icon={Wand2}>
          <div className="text-[13px] text-slate-300">{data.prompt}</div>
        </Section>
        <Section title="Üretilen Kural" icon={Zap}>
          <pre className="text-[12px] text-emerald-200 mono whitespace-pre-wrap">{typeof data.rule === "string" ? data.rule : JSON.stringify(data.rule, null, 2)}</pre>
        </Section>
        {data.note && <div className="text-[11px] text-amber-300 italic">⚠ {data.note}</div>}
      </div>
    );
  }

  // Global Search
  if (modId === "search" && data.hits) {
    const hits = Object.entries(data.hits);
    return (
      <div className="space-y-3">
        <Section title={`Sonuçlar (${hits.length} kategori)`} icon={Search}>
          {hits.length === 0
            ? <div className="text-xs text-slate-500 italic text-center py-3">"{data.query}" için sonuç bulunamadı.</div>
            : hits.map(([cat, h]) => (
              <div key={cat} className="mb-3 last:mb-0">
                <div className="text-[11px] text-indigo-300 uppercase tracking-wider font-bold mb-1.5">{cat} ({h.count})</div>
                {h.sample && <DataTable rows={h.sample} />}
              </div>
            ))
          }
        </Section>
      </div>
    );
  }

  // Continuity
  if (modId === "continuity") {
    return (
      <Section title="Kuyruk Durumu" icon={Mail}>
        <StatRow label="Bekleyen" value={data.pending ?? 0} color="amber" mono />
        <StatRow label="Yeniden gönderilen" value={data.replayed ?? 0} color="emerald" mono />
      </Section>
    );
  }

  // Archive
  if (modId === "archive") {
    return (
      <div className="space-y-3">
        <Section title={`Arşiv Sonuçları (${data.total ?? 0})`} icon={Archive}>
          {(!data.items || data.items.length === 0)
            ? <div className="text-xs text-slate-500 italic text-center py-3">Eşleşen mail yok.</div>
            : <DataTable rows={data.items.map(i => ({
                subject: i.subject_preview?.slice(0, 60), from: i.from, at: i.at?.slice(0, 19),
              }))} />
          }
        </Section>
      </div>
    );
  }

  // SOAR rules
  if (modId === "soar" && data.rules) {
    return (
      <Section title={`SOAR Kuralları (${data.rules.length})`} icon={Zap}>
        {data.rules.length === 0
          ? <div className="text-xs text-slate-500 italic text-center py-3">Henüz kural yok — ilk kuralı ekleyin.</div>
          : <DataTable rows={data.rules.map(r => ({ name: r.name, enabled: r.enabled, hits: r.hit_count, at: r.at?.slice(0, 19) }))} />
        }
      </Section>
    );
  }

  // Attack map
  if (modId === "attack-map" && data.countries) {
    return (
      <Section title={`Ülke Bazlı Saldırılar (${data.window_hours}h)`} icon={Map}>
        {data.countries.length === 0
          ? <div className="text-xs text-slate-500 italic text-center py-3">Bu pencerede coğrafi veri yok.</div>
          : (
            <div className="space-y-2">
              {data.countries.map((c, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-slate-800/50 last:border-0">
                  <MapPin className="w-3.5 h-3.5 text-rose-400" />
                  <div className="flex-1 text-[13px] text-slate-200 font-semibold">{c.country}</div>
                  <div className="text-[13px] mono font-bold text-rose-300">{c.count}</div>
                </div>
              ))}
            </div>
          )
        }
      </Section>
    );
  }

  // Mail simulator
  if (modId === "simulator" && data.final_score !== undefined) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Karar</div>
            <Verdict value={data.action} />
          </div>
          <ScoreBar score={data.final_score} />
        </div>
        <Section title="Mail Bilgileri" icon={Mail}>
          <StatRow label="From" value={data.from} mono />
          <StatRow label="Subject" value={data.subject} />
          <StatRow label="To" value={data.to} mono />
        </Section>
        <Section title="Motor Sonuçları" icon={Shield}>
          <StatRow label="Phishing" value={data.phishing?.score ?? 0} color={data.phishing?.score >= 60 ? "rose" : "slate"} mono />
          <StatRow label="BEC" value={data.bec?.score ?? 0} color={data.bec?.score >= 70 ? "rose" : "slate"} mono />
          <StatRow label="Brand Impersonation" value={data.brand?.score ?? 0} color={data.brand?.score >= 60 ? "rose" : "slate"} mono />
        </Section>
        {data.why_blocked && data.why_blocked.length > 0 && (
          <Section title="Neden Bloklandı" icon={AlertCircle}>
            <ReasonsList items={data.why_blocked} tone="rose" />
          </Section>
        )}
      </div>
    );
  }

  // Mobile SOC
  if (modId === "mobile-soc") {
    return (
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Kritik Incident", data.critical_incidents, "rose"],
          ["Ele geçirilmiş", data.compromised_accounts, "amber"],
          ["Phishing 24h", data.phishing_24h, "orange"],
        ].map(([label, val, color]) => (
          <div key={label} className="border border-slate-800 rounded-lg p-4 text-center bg-slate-900/40">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{label}</div>
            <div className={`text-3xl font-black mono text-${color}-300`}>{val ?? 0}</div>
          </div>
        ))}
      </div>
    );
  }

  // WP Security
  if (modId === "wp-security" && data.checks) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <StatRow label="Site" value={data.site} mono />
          <ScoreBar score={data.risk_score} />
        </div>
        <Section title="Güvenlik Kontrolleri" icon={Shield}>
          {Object.entries(data.checks).map(([k, v]) => (
            <StatRow key={k} label={k.replace(/_/g, " ")}
                     value={typeof v === "boolean" ? (v ? "✓ Açık" : "✗ Kapalı") : String(v)}
                     color={typeof v === "boolean" ? (v ? (k.includes("expose") || k.includes("open") ? "rose" : "emerald") : "emerald") : "slate"} />
          ))}
        </Section>
      </div>
    );
  }

  // Multi-platform
  if (modId === "multiplatform" && data.supported) {
    return (
      <Section title="Desteklenen Platformlar" icon={Network}>
        <DataTable rows={data.supported} />
        {data.note && <div className="text-[11px] text-slate-500 italic mt-2 pl-3 border-l-2 border-slate-700">{data.note}</div>}
      </Section>
    );
  }

  // Network stats
  if (modId === "network" && (data.total_iocs !== undefined || data.urlhaus)) {
    if (data.urlhaus) {
      return (
        <Section title="URLhaus Feed" icon={Radio}>
          <StatRow label="IOC sayısı" value={data.urlhaus.count} mono color="fuchsia" />
          <StatRow label="Yaş (saniye)" value={data.urlhaus.age_seconds} mono />
          <StatRow label="Taze" value={data.urlhaus.fresh ? "✓" : "—"} color={data.urlhaus.fresh ? "emerald" : "amber"} />
        </Section>
      );
    }
    return (
      <div className="grid grid-cols-2 gap-3">
        {[
          ["Toplam IOC", data.total_iocs, "fuchsia"],
          ["Katkı Yapan Bayi", data.contributing_resellers, "emerald"],
          ["Mail Fingerprint", data.mail_fingerprints, "cyan"],
          ["Incident'lar", data.incidents_tracked, "rose"],
        ].map(([label, val, color]) => (
          <div key={label} className="border border-slate-800 rounded-lg p-4 bg-slate-900/40">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{label}</div>
            <div className={`text-2xl font-black mono text-${color}-300`}>{(val ?? 0).toLocaleString()}</div>
          </div>
        ))}
        {data.note && (
          <div className="col-span-2 text-[11px] text-slate-500 italic pl-3 border-l-2 border-slate-700 mt-2">{data.note}</div>
        )}
      </div>
    );
  }

  // Feed refresh / status
  if (data.ok !== undefined && data.urlhaus_hosts !== undefined) {
    return (
      <Section title="Feed Yenilendi" icon={CheckCircle2}>
        <StatRow label="URLhaus host sayısı" value={data.urlhaus_hosts} color="emerald" mono />
      </Section>
    );
  }

  // Generic IOC add
  if (data.ok && data.id) {
    return (
      <Section title="Eklendi" icon={CheckCircle2}>
        <StatRow label="ID" value={data.id} mono color="emerald" />
      </Section>
    );
  }

  // Fallback — key/value
  return (
    <div className="space-y-3">
      <Section title="Sonuç" icon={Info}>
        <KeyValueGrid data={data} />
      </Section>
    </div>
  );
}

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
          <div className="p-4 bg-slate-950/40">
            <ResultView data={output} modId={mod.id} />
          </div>
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
