import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe2, TrendingUp, ShieldAlert, MapPin, Zap, Brain, Loader2, AlertTriangle, Sparkles } from "lucide-react";
import { Card, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

// Country → risk hue (spam ratio)
const spamRatio = (item) => {
  if (!item.mail_count) return 0;
  return (item.spam_count / item.mail_count) * 100;
};
const heatColor = (pct, risky) => {
  if (risky) return "bg-rose-500/25 border-rose-500/50 text-rose-200";
  if (pct >= 30) return "bg-rose-500/15 border-rose-500/30 text-rose-200";
  if (pct >= 15) return "bg-amber-500/15 border-amber-500/30 text-amber-200";
  if (pct >= 5) return "bg-yellow-500/10 border-yellow-500/30 text-yellow-200";
  return "bg-emerald-500/10 border-emerald-500/25 text-emerald-200";
};

export default function OutboundGeoHeatmap() {
  const [hours, setHours] = useState(24);
  const q = useQuery({
    queryKey: ["outbound-geo-stats", hours],
    queryFn: () => api.outboundGeoStats(hours),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const data = q.data;

  if (q.isLoading) {
    return (
      <Card data-testid="ob-geo-heatmap">
        <div className="p-6 text-center text-slate-500 text-sm">Coğrafi ısı haritası yükleniyor…</div>
      </Card>
    );
  }
  const empty = !data || data.total_mail === 0;
  return (
    <div className="space-y-4" data-testid="ob-geo-section">
      {/* v43.41 — AI Insights Panel */}
      <AIInsightsPanel hours={hours} />

      {/* v43.41 — Anomaly Alerts */}
      <AnomalyPanel />

      <Card data-testid="ob-geo-heatmap">
      <CardHeader
        title={<span className="flex items-center gap-2"><Globe2 className="w-4 h-4 text-indigo-400"/> Giden Trafik Coğrafi Isı Haritası</span>}
        subtitle={
          empty ? "Son 24 saatte outbound veri yok" :
          <span data-testid="ob-geo-subtitle">
            {nfmt(data.total_mail)} mail · {nfmt(data.total_domains)} alıcı domain · {data.countries.length} ülke
            {data.risky_tlds.length > 0 && (
              <span className="ml-2 text-rose-400">· {data.risky_tlds.length} yüksek riskli TLD</span>
            )}
          </span>
        }
        right={
          <div className="flex items-center gap-1">
            {[6, 24, 168].map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                data-testid={`ob-geo-range-${h}`}
                className={`text-[11px] px-2 py-1 rounded border ${
                  hours === h
                    ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
                    : "border-slate-800 text-slate-500 hover:text-slate-300"
                }`}
              >
                {h === 6 ? "6s" : h === 24 ? "24s" : "7g"}
              </button>
            ))}
          </div>
        }
      />
      {empty ? (
        <div className="p-8 text-center text-slate-500 text-xs">
          Henüz outbound mail yok — yukarıdaki <b>🧪 Demo Outbound Ekle</b> veya <b>⚡ Backfill</b> butonunu deneyin.
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Countries roll-up */}
          <div>
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1">
              <MapPin className="w-3 h-3"/> Ülke Bazlı Dağılım
            </div>
            <div className="space-y-1.5">
              {data.countries.slice(0, 10).map((c) => {
                const pct = spamRatio(c);
                const totalPct = data.total_mail ? (c.mail_count / data.total_mail) * 100 : 0;
                return (
                  <div
                    key={c.country}
                    data-testid={`ob-geo-country-${c.country}`}
                    className={`px-3 py-2 rounded border ${heatColor(pct, c.risky)} flex items-center gap-2`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium flex items-center gap-1.5 truncate">
                        {c.risky && <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0"/>}
                        <span className="truncate">{c.country}</span>
                      </div>
                      <div className="mt-0.5 h-1.5 bg-slate-900/60 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${c.risky ? "bg-rose-400" : pct >= 15 ? "bg-amber-400" : "bg-emerald-400"}`}
                          style={{ width: `${Math.max(totalPct, 3)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="mono text-xs">{nfmt(c.mail_count)}</div>
                      {c.spam_count > 0 && (
                        <div className="text-[9px] text-slate-400 mono">%{pct.toFixed(0)} spam</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top domains */}
          <div>
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1">
              <TrendingUp className="w-3 h-3"/> En Çok Mail Giden 10 Domain
            </div>
            <div className="border border-slate-800 rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-500 bg-slate-900/40">
                    <th className="text-left px-2 py-1.5">Domain</th>
                    <th className="text-left px-2 py-1.5">Ülke</th>
                    <th className="text-right px-2 py-1.5">Mail</th>
                    <th className="text-right px-2 py-1.5">Spam</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_domains.slice(0, 10).map((d) => {
                    const pct = spamRatio(d);
                    return (
                      <tr
                        key={d.domain}
                        data-testid={`ob-geo-domain-${d.domain}`}
                        className="border-t border-slate-800/60 hover:bg-slate-900/40 group"
                        title={d.sample_recipients.join(", ")}
                      >
                        <td className="px-2 py-1.5 mono text-slate-300 truncate max-w-[180px]">
                          {d.risk && <ShieldAlert className="w-2.5 h-2.5 inline mr-1 text-rose-400"/>}
                          {d.domain}
                        </td>
                        <td className="px-2 py-1.5 text-slate-400 truncate max-w-[140px]">
                          {d.country}
                        </td>
                        <td className="px-2 py-1.5 text-right mono text-slate-200">{nfmt(d.mail_count)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {d.spam_count > 0 ? (
                            <Badge tone={pct >= 30 ? "danger" : pct >= 15 ? "warning" : "info"}>
                              {d.spam_count} · %{pct.toFixed(0)}
                            </Badge>
                          ) : (
                            <span className="text-emerald-500 text-[10px]">temiz</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Risky TLD alerts */}
          {data.risky_tlds.length > 0 && (
            <div className="lg:col-span-2">
              <div className="rounded border border-rose-500/40 bg-rose-500/10 p-3 flex items-start gap-2">
                <Zap className="w-4 h-4 text-rose-400 shrink-0 mt-0.5"/>
                <div className="text-xs text-rose-200">
                  <div className="font-semibold text-rose-300 mb-0.5">⚠ Yüksek riskli TLD tespit edildi</div>
                  <div className="text-slate-300">
                    Sunucunuzdan şu TLD'lere posta gönderildi:{" "}
                    {data.risky_tlds.map((t) => (
                      <span key={t} className="mono text-rose-300 mr-1">.{t}</span>
                    ))}
                    — Bu domainler genelde spam/kötü amaçlı sitelerdir. Outbound listesinde manuel inceleyin.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      </Card>

      {/* v43.41 — World Map projection */}
      {!empty && <WorldMap countries={data.countries} totalMail={data.total_mail} hours={hours} />}
    </div>
  );
}

// ============================================================================
// v43.41 — AI Insights Panel (LLM tabanlı 3-aksiyon önerisi)
// ============================================================================
function AIInsightsPanel({ hours }) {
  const [triggered, setTriggered] = useState(false);
  const insights = useMutation({
    mutationFn: () => api.outboundAiInsights(hours),
    onSuccess: () => setTriggered(true),
    onError: (e) => toast.error(e?.response?.data?.detail || "LLM hata"),
  });
  const RISK_TONE = {
    low: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-300", label: "DÜŞÜK" },
    medium: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-300", label: "ORTA" },
    high: { bg: "bg-rose-500/10", border: "border-rose-500/30", text: "text-rose-300", label: "YÜKSEK" },
    critical: { bg: "bg-rose-500/20", border: "border-rose-500/50", text: "text-rose-200", label: "KRİTİK" },
    unknown: { bg: "bg-slate-800/50", border: "border-slate-700", text: "text-slate-400", label: "VERİ YOK" },
  };
  const data = insights.data;
  const rt = data ? (RISK_TONE[data.risk_level] || RISK_TONE.medium) : RISK_TONE.unknown;

  if (!triggered) {
    return (
      <Card data-testid="ob-ai-insights">
        <div className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
            <Brain className="w-5 h-5 text-indigo-300" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-100">AI Risk Analizi</div>
            <div className="text-xs text-slate-400">Claude Sonnet, son {hours} saatlik outbound trafiği analiz edip risk + 3 aksiyon önersin</div>
          </div>
          <button
            onClick={() => insights.mutate()}
            disabled={insights.isPending}
            data-testid="ob-ai-insights-btn"
            className="text-xs px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {insights.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Sparkles className="w-3.5 h-3.5"/>}
            {insights.isPending ? "Analiz ediliyor…" : "AI Analizi Başlat"}
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card data-testid="ob-ai-insights">
      <CardHeader
        title={<span className="flex items-center gap-2"><Brain className="w-4 h-4 text-indigo-400"/> AI Risk Analizi</span>}
        subtitle={`Son ${data.hours} saat · ${data.metrics?.total ?? "?"} mail incelendi`}
        right={
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded border mono ${rt.bg} ${rt.border} ${rt.text}`} data-testid="ob-ai-risk-badge">
              RİSK: {rt.label}
            </span>
            <button
              onClick={() => insights.mutate()}
              disabled={insights.isPending}
              className="text-[11px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200"
            >
              {insights.isPending ? "Yenileniyor…" : "Tekrar Analiz"}
            </button>
          </div>
        }
      />
      <div className="p-4 space-y-3">
        <div className={`rounded border ${rt.border} ${rt.bg} p-3`}>
          <div className="text-xs text-slate-300 leading-relaxed" data-testid="ob-ai-summary">{data.summary}</div>
        </div>
        {(data.actions || []).length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3 h-3"/> Önerilen Aksiyonlar
            </div>
            <ol className="space-y-1.5 list-decimal list-inside" data-testid="ob-ai-actions">
              {data.actions.map((a, i) => (
                <li key={i} className="text-sm text-slate-300 leading-relaxed pl-1">
                  <span className="text-indigo-300">{a}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// v43.41 — Outbound Anomaly Alerts Panel
// ============================================================================
function AnomalyPanel() {
  const q = useQuery({
    queryKey: ["ob-anomaly-status"],
    queryFn: api.outboundAnomalyStatus,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const run = useMutation({
    mutationFn: api.outboundAnomalyRunNow,
    onSuccess: (d) => toast.success(`${d.flagged} anomali tespit edildi (${d.licenses_scanned} lisans tarandı)`),
  });
  const data = q.data;
  const items = data?.recent || [];
  if (items.length === 0) return null;

  return (
    <Card data-testid="ob-anomaly-panel">
      <CardHeader
        title={<span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400"/> Outbound Anomali Tespitleri</span>}
        subtitle={data?.last_run_at ? `Son tarama: ${new Date(data.last_run_at).toLocaleString("tr-TR")}` : "Henüz tarama yapılmadı"}
        right={
          <button
            onClick={() => run.mutate()}
            disabled={run.isPending}
            data-testid="ob-anomaly-run"
            className="text-[11px] px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
          >
            {run.isPending ? "Taranıyor…" : "Şimdi Tara"}
          </button>
        }
      />
      <div className="divide-y divide-slate-800">
        {items.slice(0, 5).map((a) => (
          <div key={a.id} className="px-4 py-2.5 flex items-start gap-3" data-testid={`ob-anomaly-${a.user}`}>
            <ShieldAlert className={`w-4 h-4 shrink-0 mt-0.5 ${a.severity === "error" ? "text-rose-400" : "text-amber-400"}`}/>
            <div className="flex-1">
              <div className="text-sm text-slate-200 font-medium">{a.title}</div>
              <div className="text-xs text-slate-400 mt-0.5">{a.detail}</div>
              <div className="text-[10px] text-slate-600 mono mt-0.5">
                {a.created_at ? new Date(a.created_at).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                · baseline: {a.baseline_per_hour}/saat · şu an: {a.sent_last_hour}/saat
              </div>
            </div>
            <Badge tone={a.severity === "error" ? "danger" : "warning"}>{a.ratio}x</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ============================================================================
// v43.41 — World Map projection (basit SVG dünya haritası)
// ---------------------------------------------------------------------------
// Ülke isimlerini yaklaşık koordinatlarla nokta olarak yerleştiriyoruz.
// Amaç: full topographic dünya haritası değil, viral görsel etkisi için
// pinlerin dünyanın hangi bölgelerinden mail çekildiğini göstermek.
// ============================================================================
const COUNTRY_COORDS = {
  "Türkiye":            { x: 570, y: 195, code: "TR" },
  "Uluslararası":       { x: 490, y: 175, code: "🌐" },
  "Almanya":            { x: 500, y: 145, code: "DE" },
  "Fransa":             { x: 475, y: 160, code: "FR" },
  "Birleşik Krallık":   { x: 465, y: 130, code: "UK" },
  "Rusya":              { x: 640, y: 130, code: "RU" },
  "Çin":                { x: 760, y: 200, code: "CN" },
  "Japonya":            { x: 850, y: 200, code: "JP" },
  "Güney Kore":         { x: 830, y: 205, code: "KR" },
  "ABD":                { x: 220, y: 190, code: "US" },
  "Kanada":             { x: 220, y: 130, code: "CA" },
  "Meksika":            { x: 210, y: 235, code: "MX" },
  "Brezilya":           { x: 310, y: 320, code: "BR" },
  "İran":               { x: 620, y: 205, code: "IR" },
  "Suudi Arabistan":    { x: 605, y: 235, code: "SA" },
  "BAE":                { x: 630, y: 235, code: "AE" },
  "Mısır":              { x: 570, y: 225, code: "EG" },
  "İtalya":             { x: 510, y: 175, code: "IT" },
  "İspanya":            { x: 460, y: 175, code: "ES" },
  "Hollanda":           { x: 495, y: 140, code: "NL" },
  "Polonya":            { x: 530, y: 145, code: "PL" },
  "Ukrayna":            { x: 570, y: 155, code: "UA" },
  "Yunanistan":         { x: 540, y: 185, code: "GR" },
  "Bulgaristan":        { x: 550, y: 170, code: "BG" },
  "Romanya":            { x: 555, y: 160, code: "RO" },
  "Avustralya":         { x: 830, y: 350, code: "AU" },
  "Yeni Zelanda":       { x: 875, y: 380, code: "NZ" },
  "Hindistan":          { x: 700, y: 245, code: "IN" },
  "Pakistan":           { x: 680, y: 225, code: "PK" },
};

function WorldMap({ countries, totalMail, hours }) {
  const maxCount = Math.max(...countries.map((c) => c.mail_count), 1);
  // v43.62 — 3D Meteor Map: Turkey (Istanbul) server origin → countries
  const ORIGIN = { x: 560, y: 170 }; // TR (Istanbul)
  // Aktif ülkeler için meteor animation yolları
  const meteorPaths = countries
    .map((c) => ({ c, coord: COUNTRY_COORDS[c.country] }))
    .filter((x) => x.coord && x.c.mail_count > 0)
    .sort((a, b) => b.c.mail_count - a.c.mail_count)
    .slice(0, 12); // en yüksek trafikli 12 ülke için meteor animasyonu
  return (
    <Card data-testid="ob-world-map">
      <CardHeader
        title={<span className="flex items-center gap-2"><Globe2 className="w-4 h-4 text-sky-400"/> 3D Dünya Üzerinde Kayan Mail Trafiği</span>}
        subtitle={`${totalMail} mail · ${countries.length} ülke · son ${hours} saat · Türkiye orijinli meteor akışı`}
      />
      <div className="p-4">
        <div
          className="relative w-full aspect-[2/1] rounded-xl overflow-hidden"
          style={{
            perspective: "1400px",
            background: "radial-gradient(ellipse at 50% 40%, #0f172a 0%, #020617 60%, #000000 100%)",
          }}
          data-testid="ob-meteor-container"
        >
          {/* Twinkling stars background */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 900 450" preserveAspectRatio="none">
            {Array.from({ length: 60 }).map((_, i) => {
              const cx = (i * 137.5) % 900;
              const cy = ((i * 63.7) + 40) % 450;
              const r = 0.4 + ((i * 7) % 12) / 10;
              const dur = 2 + ((i * 3) % 5);
              return (
                <circle key={`star-${i}`} cx={cx} cy={cy} r={r} fill="#e2e8f0" opacity="0.7">
                  <animate attributeName="opacity"
                           values="0.15;0.9;0.15" dur={`${dur}s`}
                           repeatCount="indefinite" begin={`${(i * 0.13) % 3}s`} />
                </circle>
              );
            })}
          </svg>

          {/* 3D-tilted map layer (perspective transform) */}
          <div
            className="absolute inset-0"
            style={{
              transform: "rotateX(38deg) scale(1.05) translateY(6%)",
              transformOrigin: "center 55%",
              transformStyle: "preserve-3d",
            }}
          >
            <svg viewBox="0 0 900 450" className="w-full h-full" xmlns="http://www.w3.org/2000/svg" data-testid="ob-world-svg">
              <defs>
                {/* Meteor gradient (bright head → fading tail) */}
                <linearGradient id="meteor-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity="0"/>
                  <stop offset="60%" stopColor="#22d3ee" stopOpacity="0.7"/>
                  <stop offset="100%" stopColor="#f0f9ff" stopOpacity="1"/>
                </linearGradient>
                <linearGradient id="meteor-warn" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#f97316" stopOpacity="0"/>
                  <stop offset="60%" stopColor="#f97316" stopOpacity="0.7"/>
                  <stop offset="100%" stopColor="#fff7ed" stopOpacity="1"/>
                </linearGradient>
                <linearGradient id="meteor-danger" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity="0"/>
                  <stop offset="60%" stopColor="#f43f5e" stopOpacity="0.7"/>
                  <stop offset="100%" stopColor="#fef2f2" stopOpacity="1"/>
                </linearGradient>
                {/* Meteor head glow */}
                <radialGradient id="meteor-head" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="1"/>
                  <stop offset="40%" stopColor="#22d3ee" stopOpacity="0.8"/>
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity="0"/>
                </radialGradient>
                {/* Grid pattern (radar-like) */}
                <pattern id="grid-pattern" width="30" height="30" patternUnits="userSpaceOnUse">
                  <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e293b" strokeWidth="0.3" opacity="0.6"/>
                </pattern>
              </defs>

              {/* Grid overlay */}
              <rect width="900" height="450" fill="url(#grid-pattern)" opacity="0.4"/>

              {/* Continent silhouettes (darker + subtle glow) */}
              <g fill="#0f172a" stroke="#1e40af" strokeWidth="1.2" strokeOpacity="0.4"
                 style={{ filter: "drop-shadow(0 0 6px rgba(59,130,246,0.15))" }}>
                <path d="M 120 120 L 260 110 L 290 180 L 260 240 L 200 260 L 150 230 L 110 180 Z" />
                <path d="M 210 240 L 280 250 L 290 300 L 310 340 L 320 400 L 280 420 L 250 380 L 240 320 L 220 280 Z" />
                <path d="M 460 130 L 570 125 L 590 165 L 570 195 L 500 200 L 465 180 L 455 150 Z" />
                <path d="M 480 220 L 590 220 L 610 280 L 600 340 L 560 400 L 510 380 L 480 320 L 470 260 Z" />
                <path d="M 570 130 L 720 115 L 810 140 L 850 190 L 830 250 L 750 260 L 700 240 L 650 230 L 610 210 L 580 180 Z" />
                <path d="M 660 220 L 730 225 L 730 280 L 700 300 L 675 280 Z" />
                <path d="M 760 260 L 820 270 L 830 320 L 790 330 L 760 300 Z" />
                <path d="M 790 340 L 870 340 L 880 390 L 830 400 L 790 380 Z" />
              </g>

              {/* Equator + prime meridian */}
              <g stroke="#3b82f6" strokeWidth="0.5" strokeOpacity="0.3">
                <line x1="0" y1="225" x2="900" y2="225" strokeDasharray="4,8" />
                <line x1="450" y1="0" x2="450" y2="450" strokeDasharray="4,8" />
              </g>

              {/* Origin server marker — Türkiye pulsing beacon */}
              <g data-testid="ob-meteor-origin">
                <circle cx={ORIGIN.x} cy={ORIGIN.y} r="22" fill="#22d3ee" opacity="0.08">
                  <animate attributeName="r" values="22;35;22" dur="3s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.3;0;0.3" dur="3s" repeatCount="indefinite"/>
                </circle>
                <circle cx={ORIGIN.x} cy={ORIGIN.y} r="10" fill="#22d3ee" opacity="0.25">
                  <animate attributeName="r" values="10;16;10" dur="1.5s" repeatCount="indefinite"/>
                </circle>
                <circle cx={ORIGIN.x} cy={ORIGIN.y} r="5" fill="#f0f9ff" stroke="#22d3ee" strokeWidth="2">
                  <animate attributeName="opacity" values="1;0.6;1" dur="1.5s" repeatCount="indefinite"/>
                </circle>
                <text x={ORIGIN.x} y={ORIGIN.y - 26} textAnchor="middle" fill="#67e8f9" fontSize="11"
                      fontWeight="700" style={{ letterSpacing: "0.15em" }}>
                  ◉ SERVER TR
                </text>
              </g>

              {/* Meteor streaks — origin → destination */}
              {meteorPaths.map(({ c, coord }, i) => {
                const dx = coord.x - ORIGIN.x;
                const dy = coord.y - ORIGIN.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                const spamPct = c.spam_count / Math.max(c.mail_count, 1);
                const grad = c.risky ? "meteor-danger" : spamPct >= 0.2 ? "meteor-warn" : "meteor-grad";
                const dur = 1.6 + (i * 0.13);          // farklı hızlar için stagger
                const delay = (i * 0.4) % 3;
                const streakLen = 60;                    // meteor kuyruğu uzunluğu
                return (
                  <g key={`meteor-${c.country}`} data-testid={`ob-meteor-${coord.code}`}>
                    {/* Path curve (görünmez ama motion için) — bezier ile hafif eğri */}
                    <path
                      id={`meteor-path-${i}`}
                      d={`M ${ORIGIN.x} ${ORIGIN.y} Q ${(ORIGIN.x + coord.x) / 2} ${Math.min(ORIGIN.y, coord.y) - 40} ${coord.x} ${coord.y}`}
                      fill="none"
                      stroke="none"
                    />
                    {/* Meteor kuyruğu (fade line) */}
                    <line
                      x1={ORIGIN.x} y1={ORIGIN.y}
                      x2={ORIGIN.x + Math.cos(angle * Math.PI / 180) * streakLen}
                      y2={ORIGIN.y + Math.sin(angle * Math.PI / 180) * streakLen}
                      stroke={`url(#${grad})`}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      opacity="0.85"
                    >
                      <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${delay}s`}
                                     path={`M 0,0 L ${dx - Math.cos(angle * Math.PI / 180) * streakLen},${dy - Math.sin(angle * Math.PI / 180) * streakLen}`} />
                      <animate attributeName="opacity" values="0;0.85;0.85;0"
                               keyTimes="0;0.15;0.85;1" dur={`${dur}s`}
                               repeatCount="indefinite" begin={`${delay}s`} />
                    </line>
                    {/* Meteor başı (parlak nokta) */}
                    <circle r="4" fill="url(#meteor-head)">
                      <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${delay}s`}
                                     path={`M ${ORIGIN.x},${ORIGIN.y} Q ${(ORIGIN.x + coord.x) / 2},${Math.min(ORIGIN.y, coord.y) - 40} ${coord.x},${coord.y}`} />
                      <animate attributeName="opacity" values="0;1;1;0"
                               keyTimes="0;0.1;0.9;1" dur={`${dur}s`}
                               repeatCount="indefinite" begin={`${delay}s`} />
                    </circle>
                  </g>
                );
              })}

              {/* Country destinations */}
              {countries.map((c) => {
                const coord = COUNTRY_COORDS[c.country];
                if (!coord) return null;
                const r = 4 + (c.mail_count / maxCount) * 22;
                const spamPct = c.spam_count / Math.max(c.mail_count, 1);
                const fill = c.risky ? "#f43f5e"
                  : spamPct >= 0.3 ? "#f97316"
                  : spamPct >= 0.15 ? "#eab308"
                  : "#10b981";
                return (
                  <g key={c.country} data-testid={`ob-worldmap-${coord.code}`}>
                    {/* pulse ring */}
                    <circle cx={coord.x} cy={coord.y} r={r + 4} fill={fill} opacity="0.15">
                      <animate attributeName="r" values={`${r};${r + 10};${r}`} dur="2.5s" repeatCount="indefinite"/>
                      <animate attributeName="opacity" values="0.4;0;0.4" dur="2.5s" repeatCount="indefinite"/>
                    </circle>
                    {/* main dot with glow */}
                    <circle cx={coord.x} cy={coord.y} r={r} fill={fill} opacity="0.9"
                            stroke={fill} strokeWidth="1.5"
                            style={{ filter: `drop-shadow(0 0 ${r * 0.8}px ${fill})` }}>
                      <title>{c.country}: {c.mail_count} mail ({c.spam_count} spam)</title>
                    </circle>
                    {/* label */}
                    <text x={coord.x} y={coord.y - r - 6} textAnchor="middle" fill="#f1f5f9"
                          fontSize="10" fontWeight="700"
                          style={{ textShadow: "0 0 4px rgba(0,0,0,0.9)" }}>
                      {c.country === "Uluslararası" ? "🌐" : coord.code}
                    </text>
                    <text x={coord.x} y={coord.y + r + 12} textAnchor="middle" fill={fill}
                          fontSize="9" fontWeight="700"
                          style={{ textShadow: "0 0 4px rgba(0,0,0,0.9)" }}>
                      {c.mail_count}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Legend + stats overlay */}
          <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end pointer-events-none">
            <div className="text-[10px] mono text-slate-400 space-y-0.5 bg-slate-950/70 rounded px-2 py-1.5 backdrop-blur">
              <div className="text-cyan-300 font-semibold">🌊 CANLI AKIŞ</div>
              <div>{meteorPaths.length} rota aktif</div>
              <div className="text-slate-500">Türkiye → {countries.length} ülke</div>
            </div>
            <div className="flex gap-2 text-[10px] text-slate-300 mono bg-slate-950/70 rounded px-2 py-1.5 backdrop-blur">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400"/>Temiz</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400"/>~15%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500"/>~30%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500"/>Risk</span>
            </div>
          </div>

          {/* Corner accents (radar aesthetic) */}
          <div className="absolute top-2 left-2 w-8 h-8 border-l-2 border-t-2 border-cyan-500/40"/>
          <div className="absolute top-2 right-2 w-8 h-8 border-r-2 border-t-2 border-cyan-500/40"/>
          <div className="absolute bottom-2 left-2 w-8 h-8 border-l-2 border-b-2 border-cyan-500/40"/>
          <div className="absolute bottom-2 right-2 w-8 h-8 border-r-2 border-b-2 border-cyan-500/40"/>
        </div>
      </div>
    </Card>
  );
}

