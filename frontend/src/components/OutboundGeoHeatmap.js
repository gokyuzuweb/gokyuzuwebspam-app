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
  return (
    <Card data-testid="ob-world-map">
      <CardHeader
        title={<span className="flex items-center gap-2"><Globe2 className="w-4 h-4 text-sky-400"/> Dünya Üzerinde Outbound Trafik</span>}
        subtitle={`${totalMail} mail · ${countries.length} ülke · son ${hours} saat`}
      />
      <div className="p-4">
        <div className="relative w-full aspect-[2/1] bg-slate-950/60 border border-slate-800 rounded overflow-hidden">
          {/* Basit continent silüetleri (SVG paths) */}
          <svg viewBox="0 0 900 450" className="w-full h-full" xmlns="http://www.w3.org/2000/svg" data-testid="ob-world-svg">
            {/* Kıtalar — simplified paths */}
            <g fill="#1e293b" stroke="#334155" strokeWidth="0.8">
              {/* North America */}
              <path d="M 120 120 L 260 110 L 290 180 L 260 240 L 200 260 L 150 230 L 110 180 Z" />
              {/* Central + South America */}
              <path d="M 210 240 L 280 250 L 290 300 L 310 340 L 320 400 L 280 420 L 250 380 L 240 320 L 220 280 Z" />
              {/* Europe */}
              <path d="M 460 130 L 570 125 L 590 165 L 570 195 L 500 200 L 465 180 L 455 150 Z" />
              {/* Africa */}
              <path d="M 480 220 L 590 220 L 610 280 L 600 340 L 560 400 L 510 380 L 480 320 L 470 260 Z" />
              {/* Asia */}
              <path d="M 570 130 L 720 115 L 810 140 L 850 190 L 830 250 L 750 260 L 700 240 L 650 230 L 610 210 L 580 180 Z" />
              {/* South Asia + India */}
              <path d="M 660 220 L 730 225 L 730 280 L 700 300 L 675 280 Z" />
              {/* Southeast Asia */}
              <path d="M 760 260 L 820 270 L 830 320 L 790 330 L 760 300 Z" />
              {/* Australia */}
              <path d="M 790 340 L 870 340 L 880 390 L 830 400 L 790 380 Z" />
            </g>
            {/* Grid lat/long lines */}
            <g stroke="#1e293b" strokeWidth="0.4" opacity="0.5">
              <line x1="0" y1="225" x2="900" y2="225" strokeDasharray="2,4" />
              <line x1="450" y1="0" x2="450" y2="450" strokeDasharray="2,4" />
            </g>
            {/* Country dots — sized by mail_count */}
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
                  {/* main dot */}
                  <circle cx={coord.x} cy={coord.y} r={r} fill={fill} opacity="0.75" stroke={fill} strokeWidth="1.5">
                    <title>{c.country}: {c.mail_count} mail ({c.spam_count} spam)</title>
                  </circle>
                  {/* label */}
                  <text x={coord.x} y={coord.y - r - 4} textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="600">
                    {c.country === "Uluslararası" ? "🌐" : coord.code}
                  </text>
                  <text x={coord.x} y={coord.y + r + 12} textAnchor="middle" fill={fill} fontSize="9" fontWeight="700">
                    {c.mail_count}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="absolute bottom-2 right-2 flex gap-2 text-[10px] text-slate-400 mono">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400"/>Temiz</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400"/>~15%</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500"/>~30%</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500"/>Yüksek risk</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

