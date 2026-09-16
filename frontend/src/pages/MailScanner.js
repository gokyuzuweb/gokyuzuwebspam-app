import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import { api, client } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { Filter, Brain, Sliders, Users, Trash2, Plus, Beaker, Link as LinkIcon, Sparkles, Info, TrendingUp, Mail, Globe2, Download } from "lucide-react";
import ModuleFooter from "@/components/ModuleFooter";

const LICKEY = () => (typeof window !== "undefined"
  ? (localStorage.getItem("gws.event_license") || "")
  : "");

const COLORS = ["#10b981", "#f59e0b", "#f43f5e", "#fb7185", "#8b5cf6", "#06b6d4"];

const HELP = {
  config: {
    what: "Bu modül tarama motorlarını, threshold (skorlama eşikleri), SPF/DKIM/DMARC zorunluluğunu ve greylist/RBL/ek tarama davranışını yönetir.",
    how: [
      "Spam Threshold (5.0 önerilir): bu skorun üstündeki mailler karantinaya alınır.",
      "High Spam Threshold (10.0 önerilir): 10 üstü mailler doğrudan reddedilir.",
      "SpamAssassin + Bayes + ClamAV mutlaka açık olsun.",
      "SPF Hard Fail açıksa domain sahtekârlığı otomatik reddedilir.",
      "Greylist gerçek spam gönderenlerin çoğunu ilk teslimatta durdurur.",
    ],
  },
  stats: {
    what: "Son 24 saatlik skor dağılımı, verdict pie chart ve motor bazlı yakalama oranları.",
    how: [
      "Histogramda 5-10 arası pik → threshold'u ayarlamayı düşün.",
      "Verdict pie'da 'clean' oranı %85 üzerinde olmalı.",
      "Motor tablosunda spam yakalama oranı düşükse (%20 altı) o motoru gözden geçir.",
    ],
  },
  rules: {
    what: "Kendi regex tabanlı SpamAssassin-vari kurallarınız. SA ile birlikte çalışır.",
    how: [
      "Regex ile bir alanı hedefle (subject / from / body / header).",
      "Skor pozitif ise (0 üstü) toplam skora eklenir → spam olma ihtimali artar.",
      "Örnek: `/tebrikler.*kazand[ıi]n/i` → skor 5.5 (subject).",
      "Kural adı benzersiz olmalı — güncellemek için aynı ismi kullan.",
    ],
  },
  bayes: {
    what: "Kendi Bayes classifier'ımız. Spam/ham örnek besleyerek dinamik istatistiksel motor.",
    how: [
      "En az 200 spam + 200 ham örnek besledikten sonra doğruluk artar.",
      "Örnek metin yapıştır → etiket seç → Eğit.",
      "Token sayısı 5000+ olduğunda Bayes 'active' rozeti alır.",
    ],
  },
  policy: {
    what: "Alıcı bazlı özel spam eşiği + aksiyon (karantina / reddet / etiket / teslim et).",
    how: [
      "VIP hesaplar için (CEO, muhasebe) threshold'u yüksek tut (7.0+).",
      "Yaygın hesaplar (info@, support@) için threshold'u düşük tut (3.5).",
      "'tag' → mail teslim edilir ama konu '[SPAM]' etiketiyle işaretlenir.",
    ],
  },
  url: {
    what: "URL rewriting + time-of-click analiz. Kısa token'a dönüştürülür, kullanıcı tıklayınca sistem kontrol eder.",
    how: [
      "Mail içindeki tüm URL'leri toplu rewrite et → /r/{token}.",
      "Token'ı kontrol edince heuristic (bit.ly, .zip, @ karakter) tespiti çalışır.",
      "Tıklama sayısı takip edilir — normal olmayan spike'ta alarm.",
    ],
  },
  sa: {
    what: "SpamAssassin cezalarını kural bazında ezerek false-positive'i azaltır. Türk kurumsal Postfix/qmail sunucuları genelde MISSING_MID, DOS_BODY_HIGH_NO_MID, RDNS_NONE gibi kurallara takılır — bu kuralları sıfırlayarak legit ihale/kurumsal maillerinin karantinaya düşmesini engellersin.",
    how: [
      "Hızlı Başlangıç: 'Türk Kurumsal Preset' butonuna bas — 7 kural otomatik yumuşatılır.",
      "Son 7 gün tablosundan hangi kuralın sık hitlediğini gör; override değeri boş bırakılırsa (null) kural devre dışıdır (0 puan).",
      "Bir kuralın override değerini örn. 0.5 yaparsan → skor tam ceza yerine 0.5 puan alır.",
      "Değişiklikler yalnızca YENİ ingest edilen mailleri etkiler; eski karantinayı yeniden puanlamak için Events → Rescore kullan.",
      "Sık hitliyor ama gerçekten spam değilse override et; gerçekten spam ise dokunma.",
    ],
  },
};

function HelpPanel({ tabKey }) {
  const h = HELP[tabKey];
  if (!h) return null;
  return (
    <div className="mt-3 border border-indigo-500/20 bg-indigo-500/5 rounded-md p-3 text-xs">
      <div className="text-indigo-300 font-semibold flex items-center gap-1 mb-1"><Info className="w-3.5 h-3.5"/>Nasıl çalışır?</div>
      <p className="text-slate-300 mb-2">{h.what}</p>
      <div className="text-indigo-300 font-semibold text-[11px] mb-1">Öneriler:</div>
      <ul className="list-disc list-inside space-y-0.5 text-slate-400">
        {h.how.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}

function AiAnalyzeCard() {
  const [report, setReport] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [ts, setTs] = useState(null);
  const [durationMs, setDurationMs] = useState(null);
  const [error, setError] = useState(null);
  const [progressPct, setProgressPct] = useState(0);
  const startRef = useRef(null);

  const run = useMutation({
    mutationFn: () => api.msAiAnalyze(LICKEY()),
    onMutate: () => {
      setError(null);
      setReport(null);
      setMetrics(null);
      setTs(null);
      setDurationMs(null);
      setProgressPct(5);
      startRef.current = Date.now();
      toast.info("🤖 Claude motoru MailScanner metriklerini okuyor…", { id: "ai-analyze" });
    },
    onSuccess: (d) => {
      const dur = Date.now() - (startRef.current || Date.now());
      setReport(d.report);
      setMetrics(d.metrics);
      setTs(d.generated_at);
      setDurationMs(dur);
      setProgressPct(100);
      toast.success(`✅ Rapor hazır (${(dur / 1000).toFixed(1)}sn)`, { id: "ai-analyze" });
    },
    onError: (e) => {
      setError(e?.response?.data?.detail || e.message || "Bilinmeyen hata");
      setProgressPct(0);
      toast.error("❌ Analiz başarısız — detay için karta bakın", { id: "ai-analyze" });
    },
  });

  // Yapay progress bar (Claude 8-15sn arası — kullanıcı beklerken canlı olsun)
  useEffect(() => {
    if (!run.isPending) return;
    const interval = setInterval(() => {
      setProgressPct((p) => {
        if (p < 92) return p + Math.max(1, Math.round((92 - p) / 15));
        return p;
      });
    }, 400);
    return () => clearInterval(interval);
  }, [run.isPending]);

  const wordCount = report ? report.trim().split(/\s+/).length : 0;

  return (
    <Card data-testid="ai-analyze-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-fuchsia-400"/> AI Sistem Analizi</span>}
        subtitle="Claude motoru MailScanner konfigürasyonunu ve son 24s metriklerini okur, aksiyon önerisi çıkarır"
        right={
          <button data-testid="ai-analyze-btn" onClick={() => run.mutate()} disabled={run.isPending}
                  className="text-xs px-3 py-1.5 rounded-md bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 hover:bg-fuchsia-500/30 disabled:opacity-40 inline-flex items-center gap-2">
            {run.isPending ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-fuchsia-400 border-t-transparent rounded-full animate-spin"/>
                Analiz ediliyor… %{progressPct}
              </>
            ) : (
              <>
                <Sparkles className="w-3 h-3"/>{report ? "Yeniden Analiz Et" : "Sistemi Analiz Et"}
              </>
            )}
          </button>
        }
      />
      {/* Progress bar canlı akış */}
      {run.isPending && (
        <div className="px-4 pb-3">
          <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-fuchsia-500 to-pink-500 transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[10px] text-slate-500 mono">
            <span>{progressPct < 30 ? "Motor durumu okunuyor..." : progressPct < 60 ? "Son 24 saat metrikleri işleniyor..." : progressPct < 90 ? "Claude Sonnet 4.6'ya soruluyor..." : "Rapor formatlanıyor..."}</span>
            <span>~10-15 sn</span>
          </div>
        </div>
      )}
      {/* Hata durumu */}
      {error && !run.isPending && (
        <CardBody className="pt-0">
          <div className="bg-rose-500/10 border border-rose-500/40 rounded p-3 text-sm text-rose-200" data-testid="ai-analyze-error">
            <div className="font-semibold mb-1">❌ Analiz Başarısız</div>
            <div className="text-xs text-rose-300/90 mono break-all">{error}</div>
            <div className="text-xs text-slate-400 mt-2">Sık nedenler: (1) Emergent LLM Key bakiyesi bitti (2) Backend'e ulaşılamıyor (3) Rate limit. Tekrar deneyin ya da 1-2 dk sonra yeniden çalıştırın.</div>
          </div>
        </CardBody>
      )}
      {(report || metrics) && !run.isPending && (
        <CardBody className="pt-0">
          {/* Başarılı özet çubuğu */}
          {report && (
            <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200" data-testid="ai-analyze-success">
              <span className="font-semibold">✅ Rapor hazır</span>
              {durationMs != null && <span className="text-slate-400">· {(durationMs / 1000).toFixed(1)}sn</span>}
              <span className="text-slate-400">· {wordCount} kelime</span>
              <span className="text-slate-400">· Claude Sonnet 4.6</span>
              {ts && <span className="text-slate-500 mono ml-auto">Üretildi: {new Date(ts).toLocaleString("tr-TR")}</span>}
            </div>
          )}
          {metrics && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <MetricPill label="Son 24s Spam" v={metrics.spam_24h} tone="text-amber-300"/>
              <MetricPill label="Son 24s Virüs" v={metrics.virus_24h} tone="text-fuchsia-300"/>
              <MetricPill label="Aktif Motor" v={metrics.active_engines?.length} tone="text-emerald-300"/>
              <MetricPill label="Açık Bulgu" v={metrics.findings} tone={metrics.findings ? "text-rose-300" : "text-slate-400"}/>
            </div>
          )}
          {report && (
            <div className="bg-slate-950 border border-slate-800 rounded p-3 text-sm text-slate-200 whitespace-pre-wrap leading-relaxed" data-testid="ai-analyze-report">
              {report}
            </div>
          )}
        </CardBody>
      )}
    </Card>
  );
}

function MetricPill({ label, v, tone }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mono text-lg ${tone}`}>{v ?? "-"}</div>
    </div>
  );
}

export default function MailScanner() {
  const [tab, setTab] = useState(() => localStorage.getItem("gws.ms.tab") || "config");
  const choose = (id) => { setTab(id); try { localStorage.setItem("gws.ms.tab", id); } catch {} };

  const TABS = [
    { k: "config", l: "Yapılandırma",     i: Sliders,  t: "indigo" },
    { k: "stats",  l: "İstatistik",        i: BarChart, t: "cyan" },
    { k: "rules",  l: "Kurallar",          i: Filter,   t: "emerald" },
    { k: "sa",     l: "SA Skor Ayarı",     i: Sliders,  t: "cyan" },
    { k: "bayes",  l: "Bayes",             i: Brain,    t: "amber" },
    { k: "policy", l: "Kullanıcı Politika", i: Users,   t: "fuchsia" },
    { k: "url",    l: "URL Koruma",        i: LinkIcon, t: "rose" },
    { k: "learn",  l: "AI Öğrenme",        i: Sparkles, t: "indigo" },
  ];
  const tones = {
    indigo:  "border-indigo-500/50 bg-indigo-500/15 text-indigo-200",
    cyan:    "border-cyan-500/50 bg-cyan-500/15 text-cyan-200",
    emerald: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
    amber:   "border-amber-500/50 bg-amber-500/15 text-amber-200",
    fuchsia: "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200",
    rose:    "border-rose-500/50 bg-rose-500/15 text-rose-200",
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
          <Filter className="w-5 h-5 text-indigo-400"/> Bağımsız MailScanner Modülü
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">Kendi motorumuz · SpamAssassin ayarları · Bayes eğitimi · Kullanıcı politikaları</p>
      </div>

      {/* v43.93 — Tab Bar (Settings/Reports ile aynı stil) */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3 sticky top-14 bg-slate-950/80 backdrop-blur z-10" data-testid="ms-tabs">
        {TABS.map(({ k, l, i: Icon, t }) => {
          const active = tab === k;
          return (
            <button
              key={k}
              data-testid={`ms-tab-${k}`}
              type="button"
              onClick={() => choose(k)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-all ${
                active ? tones[t] + " shadow-md" : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}
            >
              <Icon className="w-4 h-4" />
              {l}
            </button>
          );
        })}
      </div>

      <AiAnalyzeCard/>

      {tab === "config" && <><ConfigTab/><HelpPanel tabKey="config"/></>}
      {tab === "stats"  && <><StatsTab/><HelpPanel tabKey="stats"/></>}
      {tab === "rules"  && <><RulesTab/><HelpPanel tabKey="rules"/></>}
      {tab === "sa"     && <><SaOverridesTab/><HelpPanel tabKey="sa"/></>}
      {tab === "bayes"  && <><BayesTab/><HelpPanel tabKey="bayes"/></>}
      {tab === "policy" && <><PolicyTab/><HelpPanel tabKey="policy"/></>}
      {tab === "url"    && <><UrlTab/><HelpPanel tabKey="url"/></>}
      {tab === "learn"  && <LearnTab/>}

      <ModuleFooter
        title="MailScanner — Bağımsız Motor"
        howItWorks="ConfigServer'a bağlı olmayan kendi geliştirdiğimiz mail tarama motoru. SpamAssassin + Bayes + ClamAV + Rspamd ML + AI (Claude) katmanları birlikte çalışır. Her mail için heuristic + engine skoru + AI predict → verdict (clean/spam/high_spam/virus)."
        technical={[
          "Threshold: spam 5.0 · high_spam 10.0 (config)",
          "8 motor toggle: SA/Bayes/ClamAV/DCC/Razor/Pyzor/Rspamd_ML/Sender_Rep",
          "Bayes: kendi tokenizer + counter (mailscanner_bayes)",
          "AI Analyze: LLM raporu (~15sn) · AI Self-Training: saatlik cron",
          "Auto-Quarantine + Rule Auto-Apply: eşik-tabanlı (config)",
        ]}
        recommendations={[
          "SPF Hard Fail + DKIM Required'ı aç (kimlik doğrulama)",
          "En az 200 spam + 200 ham örnek ile Bayes'i besle",
          "AI Auto-Quarantine'i test ortamında dene (threshold 8+)",
          "URL Koruma tab: outbound maildeki URL'leri /r/{token}'a çevir",
          "Haftada 1 AI Sistem Analizi'ni çalıştır — proaktif öneriler alacaksın",
        ]}
      />
    </div>
  );
}

function ConfigTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ms-config"], queryFn: () => api.msConfig(LICKEY()) });
  const save = useMutation({
    mutationFn: (payload) => api.msConfigPut(LICKEY(), payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ms-config"] }); toast.success("Kaydedildi"); },
  });
  if (!q.data) return <SkeletonCard/>;
  const cfg = q.data;
  const engines = cfg.engines || {};
  return (
    <Card>
      <CardHeader title="Yapılandırma" subtitle="Threshold, engine on/off, DMARC/SPF/DKIM zorunluluk"/>
      <CardBody className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <NumField label="Spam Threshold" value={cfg.spam_threshold} onSave={(v) => save.mutate({ spam_threshold: v })}/>
          <NumField label="High Spam Threshold" value={cfg.high_spam_threshold} onSave={(v) => save.mutate({ high_spam_threshold: v })}/>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Tarama Motorları</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(engines).map(([k, v]) => (
              <button key={k} data-testid={`ms-engine-${k}`}
                onClick={() => save.mutate({ engines: { ...engines, [k]: !v } })}
                className={`text-xs px-3 py-2 rounded-md border transition-colors
                  ${v ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/40"
                      : "bg-slate-800 text-slate-500 border-slate-700"}`}>
                {v ? "● " : "○ "}{k}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Kimlik Doğrulama Zorunluluğu</div>
          <div className="flex flex-wrap gap-2">
            <Toggle testid="ms-spf" label="SPF Hard Fail" value={cfg.spf_hard_fail} onChange={(v) => save.mutate({ spf_hard_fail: v })}/>
            <Toggle testid="ms-dkim" label="DKIM Zorunlu" value={cfg.dkim_required} onChange={(v) => save.mutate({ dkim_required: v })}/>
            <Toggle testid="ms-greylist" label="Greylist" value={cfg.greylist?.enabled} onChange={(v) => save.mutate({ greylist: { ...cfg.greylist, enabled: v } })}/>
            <Toggle testid="ms-rbl" label="RBL" value={cfg.rbl?.enabled} onChange={(v) => save.mutate({ rbl: { ...cfg.rbl, enabled: v } })}/>
            <Toggle testid="ms-attach" label="Ek Tarama" value={cfg.attachment_scan?.enabled} onChange={(v) => save.mutate({ attachment_scan: { ...cfg.attachment_scan, enabled: v } })}/>
          </div>
        </div>

        {/* AI Auto Actions */}
        <div className="pt-4 border-t border-slate-800">
          <div className="text-[11px] uppercase tracking-widest text-fuchsia-400 mb-2">🤖 AI Otomatik Aksiyonlar</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-md bg-fuchsia-500/5 border border-fuchsia-500/30">
              <div className="text-sm text-slate-100 font-medium mb-2">AI Auto-Quarantine</div>
              <p className="text-[11px] text-slate-400 mb-2">
                predicted_score ≥ eşik → otomatik karantina/tag/reject
              </p>
              <Toggle testid="ms-auto-quarantine" label="Aktif" value={cfg.ai_auto_quarantine?.enabled}
                      onChange={(v) => save.mutate({ ai_auto_quarantine: { ...(cfg.ai_auto_quarantine || {}), enabled: v } })}/>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[10px] text-slate-400 space-y-0.5 block">
                  <div>Eşik (0-15)</div>
                  <input type="number" step="0.5" min="0" max="15"
                         data-testid="ms-auto-quarantine-threshold"
                         value={cfg.ai_auto_quarantine?.threshold ?? 6.0}
                         onChange={(e) => save.mutate({ ai_auto_quarantine: { ...(cfg.ai_auto_quarantine || {}), threshold: Number(e.target.value) } })}
                         className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs mono"/>
                </label>
                <label className="text-[10px] text-slate-400 space-y-0.5 block">
                  <div>Aksiyon</div>
                  <select data-testid="ms-auto-quarantine-action"
                          value={cfg.ai_auto_quarantine?.action ?? "quarantine"}
                          onChange={(e) => save.mutate({ ai_auto_quarantine: { ...(cfg.ai_auto_quarantine || {}), action: e.target.value } })}
                          className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs">
                    <option value="quarantine">Karantina</option>
                    <option value="tag">Etiketle</option>
                    <option value="reject">Reddet</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="p-3 rounded-md bg-indigo-500/5 border border-indigo-500/30">
              <div className="text-sm text-slate-100 font-medium mb-2">AI Rule Auto-Apply</div>
              <p className="text-[11px] text-slate-400 mb-2">
                LLM önerileri skor ≥ eşikse otomatik kural eklenir
              </p>
              <Toggle testid="ms-rule-auto-apply" label="Aktif" value={cfg.ai_rule_auto_apply?.enabled}
                      onChange={(v) => save.mutate({ ai_rule_auto_apply: { ...(cfg.ai_rule_auto_apply || {}), enabled: v } })}/>
              <label className="text-[10px] text-slate-400 space-y-0.5 block mt-2">
                <div>Min. Skor Eşiği (LLM önerisi için)</div>
                <input type="number" step="0.5" min="0" max="15"
                       data-testid="ms-rule-auto-apply-score"
                       value={cfg.ai_rule_auto_apply?.min_score ?? 4.5}
                       onChange={(e) => save.mutate({ ai_rule_auto_apply: { ...(cfg.ai_rule_auto_apply || {}), min_score: Number(e.target.value) } })}
                       className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs mono"/>
              </label>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-slate-500 italic">
            ⚠️ Otomatik aksiyonlar açıkken sistem yardımınız olmadan kural ekleyip mail karantinalayabilir. Test ortamında dene.
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function StatsTab() {
  const q = useQuery({ queryKey: ["ms-stats"], queryFn: () => api.msStats(LICKEY(), 24), refetchInterval: 30000 });
  const bayes = useQuery({ queryKey: ["ms-bayes"], queryFn: () => api.msBayesStatus(LICKEY()) });
  const health = useQuery({ queryKey: ["ms-health"], queryFn: () => api.msHealth(LICKEY()) });
  const cfg = useQuery({ queryKey: ["ms-config"], queryFn: () => api.msConfig(LICKEY()) });
  if (!q.data) return <SkeletonCard/>;
  const s = q.data;
  const pie = Object.entries(s.verdicts || {}).map(([name, value]) => ({ name, value }));
  const totalScanned = s.total_scanned || 0;
  const spam = (s.verdicts?.spam || 0) + (s.verdicts?.high_spam || 0);
  const clean = s.verdicts?.clean || 0;
  const virus = s.virus_24h ?? ((s.verdicts?.virus || 0) + (s.verdicts?.phishing || 0));
  const phishing = s.phishing_24h ?? 0;
  const countryBlocked = s.country_blocked_24h ?? (s.verdicts?.country_blocked || 0);
  const spamRate = totalScanned ? ((spam / totalScanned) * 100).toFixed(1) : "0.0";
  const bayesTrainedHam = bayes.data?.ham_samples || 0;
  const bayesTrainedSpam = bayes.data?.spam_samples || 0;
  const bayesTokens = bayes.data?.total_tokens || 0;
  // v44.00.24 — Aktif motor sayısı için config kaynağı (health endpoint flat string dönüyor)
  const enginesMap = cfg.data?.engines || {};
  const activeEngines = Object.values(enginesMap).filter(v => v).length;
  const totalEngines = Object.keys(enginesMap).length || 8;
  return (
    <div className="space-y-4">
      {/* KPI kartları */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MSKpi label="Toplam Taranan" value={totalScanned} tone="text-indigo-300" icon="📧" sub={`Son ${s.hours}h`}/>
        <MSKpi label="Spam Yakalanan" value={spam} tone="text-amber-300" icon="🛡️" sub={`% ${spamRate} oran`}/>
        <MSKpi label="Temiz Teslim" value={clean} tone="text-emerald-300" icon="✓" sub="Kullanıcıya iletildi"/>
        <MSKpi label="Virüs/Phishing" value={virus + phishing} tone="text-rose-300" icon="☠"
               sub={phishing > 0 ? `${virus} virüs · ${phishing} phish` : `${virus} tespit`}/>
        <MSKpi label="Ülke Engelli" value={countryBlocked} tone="text-pink-300" icon="🌐"
               sub={(s.top_blocked_countries || []).slice(0,3).map(c => c.name || c.value).join(" · ") || "Engel yok"}/>
        <MSKpi label="Aktif Motor" value={`${activeEngines}/${totalEngines}`} tone="text-cyan-300" icon="⚙️"
               sub={Object.entries(enginesMap).filter(([,v])=>v).slice(0,3).map(([k])=>k).join(" · ") || "Motor yok"}/>
        <MSKpi label="Bayes Eğitilen" value={bayesTrainedHam + bayesTrainedSpam} tone="text-fuchsia-300" icon="🧠"
               sub={`${bayesTokens.toLocaleString("tr-TR")} token · ${bayesTrainedHam} ham · ${bayesTrainedSpam} spam`}/>
      </div>

      {/* v44.00.24 — Saatlik trend line chart */}
      {(s.hourly_trend || []).length > 0 && (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-cyan-400"/> Saatlik Trafik Trendi</span>}
            subtitle={`Son ${s.hours} saatte verdict bazlı gelen mail akışı`}
          />
          <CardBody>
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={s.hourly_trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false}/>
                  <XAxis dataKey="h" stroke="#475569" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }}
                         interval={Math.max(0, Math.floor(s.hourly_trend.length / 12))}/>
                  <YAxis stroke="#475569" tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}/>
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, fontSize: 12 }}/>
                  <Legend wrapperStyle={{ fontSize: 11 }}/>
                  <Line type="monotone" dataKey="clean" stroke="#10b981" strokeWidth={2} dot={false} name="Temiz"/>
                  <Line type="monotone" dataKey="spam"  stroke="#f59e0b" strokeWidth={2} dot={false} name="Spam"/>
                  <Line type="monotone" dataKey="virus" stroke="#f43f5e" strokeWidth={2} dot={false} name="Virüs"/>
                  <Line type="monotone" dataKey="phishing" stroke="#ec4899" strokeWidth={2} dot={false} name="Phishing"/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Skor Histogramı + Verdict Pie */}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-7">
          <CardHeader title="Skor Histogramı" subtitle={`Son ${s.hours} saat · ${s.total_scanned} mail · 0-20 skor dağılımı`}/>
          <CardBody>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={s.score_histogram || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false}/>
                  <XAxis dataKey="bin" stroke="#475569" tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}/>
                  <YAxis stroke="#475569" tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}/>
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6 }}/>
                  <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
        <Card className="col-span-12 lg:col-span-5">
          <CardHeader title="Verdict Dağılımı" subtitle="Verdict → adet"/>
          <CardBody>
            <div className="h-64 flex items-center">
              <div className="flex-1 h-full">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pie} dataKey="value" nameKey="name" outerRadius={80} innerRadius={40} paddingAngle={2}>
                      {pie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6 }}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-32 space-y-1">
                {pie.slice(0, 6).map((p, i) => (
                  <div key={p.name} className="flex items-center gap-1.5 text-[10px] mono">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }}/>
                    <span className="text-slate-300 truncate flex-1">{p.name}</span>
                    <span className="text-slate-500">{p.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Top Senders / Recipients / Domains */}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 md:col-span-4">
          <CardHeader title={<span className="flex items-center gap-2"><Mail className="w-4 h-4 text-amber-400"/>En Çok Spam Gönderen</span>} subtitle="from_addr · verdict ∈ {spam, virus, phishing}"/>
          <CardBody>
            <TopList items={s.top_senders} emptyMsg="Kayıt yok" mono/>
          </CardBody>
        </Card>
        <Card className="col-span-12 md:col-span-4">
          <CardHeader title={<span className="flex items-center gap-2"><Globe2 className="w-4 h-4 text-cyan-400"/>Spam Kaynağı Domain</span>} subtitle="from_addr@domain (right-side)"/>
          <CardBody>
            <TopList items={s.top_sender_domains} emptyMsg="Domain verisi yok" mono/>
          </CardBody>
        </Card>
        <Card className="col-span-12 md:col-span-4">
          <CardHeader title={<span className="flex items-center gap-2"><Users className="w-4 h-4 text-emerald-400"/>Hedef Alıcılar</span>} subtitle="Spam'in ulaştığı iç kullanıcılar"/>
          <CardBody>
            <TopList items={s.top_recipients} emptyMsg="Kayıt yok" mono/>
          </CardBody>
        </Card>
      </div>

      {/* v44.00.25 — Country-blocked breakdown */}
      {(s.top_blocked_countries || []).length > 0 && (
        <Card>
          <CardHeader title={<span className="flex items-center gap-2">🌐 Ülke Bazlı Engellenenler</span>}
                      subtitle={`${countryBlocked} mail engellendi · verdict=country_blocked`}/>
          <CardBody>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {s.top_blocked_countries.map(c => (
                <div key={c.value} className="bg-pink-500/5 border border-pink-500/20 rounded p-3">
                  <div className="text-xs text-slate-400 mb-1">{c.name}</div>
                  <div className="mono text-2xl text-pink-300">{c.count}</div>
                  <div className="text-[10px] mono text-slate-500">{c.value}</div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Motor Aktivitesi" subtitle="Her motorun bu pencerede kaç mail'e vurduğu · spam yakalama oranı · son vuruş"/>
        <CardBody>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-3 py-1.5">Motor</th>
                <th className="text-right px-3 py-1.5">Toplam Hit</th>
                <th className="text-right px-3 py-1.5">Spam Yakalama</th>
                <th className="text-right px-3 py-1.5">Oran</th>
                <th className="text-right px-3 py-1.5">Son Vuruş</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {(s.engines || []).map(e => (
                <tr key={e.engine} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 mono text-slate-300">{e.engine}</td>
                  <td className="px-3 py-2 text-right mono">{e.total}</td>
                  <td className="px-3 py-2 text-right mono text-rose-300">{e.spam}</td>
                  <td className="px-3 py-2 text-right text-xs">
                    <span className={`mono ${(e.spam / (e.total || 1)) > 0.3 ? "text-rose-300" : "text-slate-500"}`}>
                      %{e.total ? Math.round(e.spam / e.total * 100) : 0}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-[10px] mono text-slate-500">
                    {e.last_hit_at ? new Date(e.last_hit_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—"}
                  </td>
                </tr>
              ))}
              {(s.engines || []).length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-slate-500">Motor verisi yok — motorlar henüz vurmadı</td></tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

// v44.00.24 — Top list yardımcı bileşeni
function TopList({ items, emptyMsg = "Kayıt yok", mono = false }) {
  if (!items || items.length === 0) {
    return <div className="text-slate-500 text-sm text-center py-6">{emptyMsg}</div>;
  }
  const max = Math.max(...items.map(i => i.count));
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={it.value + i} className="relative">
          <div className="flex items-center gap-2">
            <div className={`flex-1 min-w-0 truncate text-xs ${mono ? "mono" : ""} text-slate-200`} title={it.value}>{it.value}</div>
            <span className="mono text-xs text-slate-400 shrink-0">{it.count}</span>
          </div>
          <div className="mt-1 h-1 bg-slate-800 rounded overflow-hidden">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500"
                 style={{ width: `${(it.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MSKpi({ label, value, tone, icon, sub }) {
  return (
    <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 hover:border-indigo-500/30 transition-colors">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
        <span className="text-base opacity-70">{icon}</span>
      </div>
      <div className={`text-2xl font-bold mono ${tone}`}>{typeof value === "number" ? new Intl.NumberFormat("tr-TR").format(value) : value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function RulesTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ms-rules"], queryFn: () => api.msRules(LICKEY()) });
  const [form, setForm] = useState({ name: "", pattern: "", target: "subject", score: 3.0, description: "" });
  const upsert = useMutation({
    mutationFn: (r) => api.msRuleUpsert(LICKEY(), r),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ms-rules"] }); toast.success("Kural kaydedildi"); setForm({ name: "", pattern: "", target: "subject", score: 3.0, description: "" }); },
  });
  const del = useMutation({
    mutationFn: (id) => api.msRuleDelete(LICKEY(), id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ms-rules"] }); toast.success("Silindi"); },
  });
  return (
    <Card>
      <CardHeader title="Özel SpamAssassin Kuralları" subtitle="Regex tabanlı skorlama — SA ile birlikte çalışır"/>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 p-3 bg-slate-950/50 border border-slate-800 rounded-md">
          <input data-testid="rule-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Kural adı" className="col-span-2 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm"/>
          <input data-testid="rule-pattern" value={form.pattern} onChange={e => setForm({ ...form, pattern: e.target.value })} placeholder="regex" className="col-span-2 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
          <select data-testid="rule-target" value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm">
            {["subject", "from", "body", "header", "to"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input data-testid="rule-score" type="number" step="0.5" value={form.score} onChange={e => setForm({ ...form, score: Number(e.target.value) })} className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
          <button data-testid="rule-save" onClick={() => upsert.mutate(form)}
                  disabled={!form.name || !form.pattern}
                  className="col-span-6 text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
            <Plus className="w-3 h-3 inline mr-1"/>Kural Ekle / Güncelle
          </button>
        </div>
        <div className="space-y-1">
          {(q.data?.items || []).map(r => (
            <div key={r.id} data-testid={`rule-row-${r.id}`} className="border border-slate-800 rounded-md p-2 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-100">{r.name}</div>
                <div className="text-[11px] mono text-slate-500 truncate">/{r.pattern}/ · {r.target}</div>
              </div>
              <Badge tone={r.score >= 5 ? "danger" : r.score >= 3 ? "warning" : "default"}>{r.score.toFixed(1)}</Badge>
              <button onClick={() => del.mutate(r.id)} className="text-slate-500 hover:text-rose-400"><Trash2 className="w-4 h-4"/></button>
            </div>
          ))}
          {(q.data?.items || []).length === 0 && <div className="text-sm text-slate-500 text-center py-6">Henüz kural yok</div>}
        </div>
      </CardBody>
    </Card>
  );
}

// v44.00.39 — SpamAssassin Rule Score Overrides Tab
function SaOverridesTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["ms-sa-overrides"],
    queryFn: () => api.msSaOverrides(LICKEY()),
  });
  const [draft, setDraft] = useState({}); // {name: {value, enabled}}
  const [newRule, setNewRule] = useState({ name: "", value: 0 });

  // Server datasi degistiginde draft'i initialize et
  useEffect(() => {
    if (!q.data) return;
    const d = {};
    Object.entries(q.data.overrides || {}).forEach(([k, v]) => {
      d[k] = { value: v === null ? "" : String(v), enabled: v !== null };
    });
    setDraft(d);
  }, [q.data]);

  const putMut = useMutation({
    mutationFn: (overrides) => api.msSaOverridesPut(LICKEY(), overrides),
    onSuccess: (r) => {
      toast.success(`${r.count} override kaydedildi`);
      qc.invalidateQueries({ queryKey: ["ms-sa-overrides"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kaydedilemedi"),
  });

  const presetMut = useMutation({
    mutationFn: ({ preset, merge }) => api.msSaOverridesPreset(LICKEY(), preset, merge),
    onSuccess: (r) => {
      toast.success(`${r.preset} preset uygulandı — ${r.count} kural`);
      qc.invalidateQueries({ queryKey: ["ms-sa-overrides"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Preset uygulanamadı"),
  });

  const save = () => {
    const payload = {};
    Object.entries(draft).forEach(([k, v]) => {
      if (!v.enabled) {
        payload[k] = null;
      } else {
        const n = Number(v.value);
        if (!Number.isNaN(n)) payload[k] = n;
      }
    });
    putMut.mutate(payload);
  };

  const addRule = () => {
    const name = (newRule.name || "").trim().toUpperCase().replace(/\s+/g, "_");
    if (!/^[A-Z0-9_]{3,64}$/.test(name)) {
      toast.error("Kural adı A-Z, 0-9, _ karakterlerinden oluşmalı (3-64)");
      return;
    }
    setDraft({ ...draft, [name]: { value: String(newRule.value), enabled: true } });
    setNewRule({ name: "", value: 0 });
  };

  const removeRule = (name) => {
    const d = { ...draft };
    delete d[name];
    setDraft(d);
  };

  const seen = q.data?.seen_rules_7d || [];

  return (
    <div className="space-y-3" data-testid="sa-overrides-tab">
      {/* v44.00.40 — Phishing / From-name Spoof Info Card */}
      <Card>
        <CardHeader
          title="🎭 Kimlik Taklidi (From-name Spoof) Koruması"
          subtitle="Yeni! Panel artık `sirketiniz.com <saldirgan@evil.com>` gibi klasik phishing paternini otomatik yakalıyor (+5.5 puan)"
        />
        <CardBody className="space-y-3">
          <div className="text-xs text-slate-300 leading-relaxed">
            <p className="mb-2">
              <b>Sorun:</b> Saldırgan, From header'ın display name'ine alıcının kendi domain'ini
              yazarak (ör. <span className="mono text-amber-300">sirketiniz.com &lt;saldirgan@evil.com&gt;</span>)
              kullanıcıyı kandırıyor. SA sadece 3-4 puan verip mail Gelen Kutusu'na düşüyor.
            </p>
            <p className="mb-2">
              <b>Panel çözümü (otomatik):</b> Ingest sırasında bu paterni tespit edip
              <b className="text-emerald-300"> +5.5 puan</b> ekliyoruz → mail Karantina'ya taşınıyor
              ve <b>🎭 GWS_FROM_SPOOF_RECIPIENT_DOMAIN</b> etiketiyle işaretleniyor.
            </p>
            <p className="mb-3">
              <b>Mail sunucu çözümü (pre-delivery blok):</b> Aşağıdaki custom SpamAssassin
              kural dosyasını sunucunuza kopyalarsanız, mail INBOX'a düşmeden önce
              SA seviyesinde bloklanır.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-950/60 border border-cyan-500/30 rounded-md">
            <a
              data-testid="sa-cf-download"
              href="/api/mailscanner/sa-custom-rules.cf"
              download
              className="text-xs px-3 py-1.5 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30"
            >
              <Download className="w-3 h-3 inline mr-1" />GokyuzuWebSpam.cf İndir
            </a>
            <div className="text-[11px] text-slate-400 flex-1">
              Sunucuda: <span className="mono">/etc/mail/spamassassin/GokyuzuWebSpam.cf</span>
              &nbsp;→&nbsp;<span className="mono">systemctl restart spamassassin</span>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="SpamAssassin Kural Skor Ayarları"
          subtitle="Türk kurumsal MTA'lardan (Postfix/qmail) gelen legit mailleri false-positive yapan SA kurallarını yumuşat"
        />
        <CardBody className="space-y-4">
          {/* Preset butonlari */}
          <div className="flex flex-wrap gap-2 p-3 bg-slate-950/50 border border-slate-800 rounded-md">
            <button
              data-testid="sa-preset-tr-corp"
              onClick={() => presetMut.mutate({ preset: "turkish-corp", merge: false })}
              disabled={presetMut.isPending}
              className="text-xs px-3 py-1.5 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 disabled:opacity-40"
            >
              <Sparkles className="w-3 h-3 inline mr-1" />Türk Kurumsal Preset Uygula
            </button>
            <button
              data-testid="sa-preset-tr-corp-merge"
              onClick={() => presetMut.mutate({ preset: "turkish-corp", merge: true })}
              disabled={presetMut.isPending}
              className="text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40"
            >
              + Mevcut Üzerine Ekle
            </button>
            <button
              data-testid="sa-preset-off"
              onClick={() => {
                if (window.confirm("Tüm override'lar silinecek. Emin misin?")) {
                  presetMut.mutate({ preset: "off", merge: false });
                }
              }}
              disabled={presetMut.isPending}
              className="text-xs px-3 py-1.5 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3 inline mr-1" />Tümünü Kaldır
            </button>
            <div className="flex-1"></div>
            <button
              data-testid="sa-save"
              onClick={save}
              disabled={putMut.isPending}
              className="text-xs px-3 py-1.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40"
            >
              Değişiklikleri Kaydet
            </button>
          </div>

          {/* Aktif overrides */}
          <div>
            <div className="text-xs text-slate-400 font-semibold mb-2">
              Aktif Override'lar ({Object.keys(draft).length})
            </div>
            {Object.keys(draft).length === 0 && (
              <div className="text-sm text-slate-500 text-center py-4 border border-dashed border-slate-800 rounded-md">
                Henüz override yok. Bir preset uygula veya aşağıdan manuel ekle.
              </div>
            )}
            <div className="space-y-1">
              {Object.entries(draft).map(([name, cfg]) => (
                <div
                  key={name}
                  data-testid={`sa-override-row-${name}`}
                  className="flex items-center gap-2 border border-slate-800 rounded-md p-2 bg-slate-950/40"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-100 mono">{name}</div>
                  </div>
                  <label className="flex items-center gap-1 text-[11px] text-slate-400">
                    <input
                      type="checkbox"
                      data-testid={`sa-enabled-${name}`}
                      checked={cfg.enabled}
                      onChange={(e) =>
                        setDraft({ ...draft, [name]: { ...cfg, enabled: e.target.checked } })
                      }
                    />
                    Skorla
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    disabled={!cfg.enabled}
                    data-testid={`sa-value-${name}`}
                    value={cfg.value}
                    onChange={(e) =>
                      setDraft({ ...draft, [name]: { ...cfg, value: e.target.value } })
                    }
                    className="w-20 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-sm mono disabled:opacity-40"
                    placeholder="0.0"
                  />
                  <button
                    onClick={() => removeRule(name)}
                    className="text-slate-500 hover:text-rose-400"
                    data-testid={`sa-remove-${name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Manuel ekle */}
          <div className="flex items-center gap-2 p-3 bg-slate-950/50 border border-slate-800 rounded-md">
            <input
              data-testid="sa-new-name"
              value={newRule.name}
              onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
              placeholder="RULE_NAME (örn: MISSING_MID)"
              className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono uppercase"
            />
            <input
              type="number"
              step="0.1"
              data-testid="sa-new-value"
              value={newRule.value}
              onChange={(e) => setNewRule({ ...newRule, value: Number(e.target.value) })}
              placeholder="0.0"
              className="w-24 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"
            />
            <button
              data-testid="sa-new-add"
              onClick={addRule}
              className="text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30"
            >
              <Plus className="w-3 h-3 inline mr-1" />Kural Ekle
            </button>
          </div>
        </CardBody>
      </Card>

      {/* Son 7 gunde gorulen kurallar */}
      <Card>
        <CardHeader
          title="Son 7 Gün — En Sık Hitleyen Kurallar"
          subtitle="Buradan hızlı ekleme yapabilirsiniz. 'Override et' butonuyla kuralı listeye ekleyin."
        />
        <CardBody>
          {seen.length === 0 && (
            <div className="text-sm text-slate-500 text-center py-4">
              Bu lisans için son 7 günde SA kuralı hit'i bulunamadı.
            </div>
          )}
          {seen.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="sa-seen-table">
                <thead className="text-[11px] text-slate-500 uppercase">
                  <tr className="border-b border-slate-800">
                    <th className="text-left p-2">Kural</th>
                    <th className="text-right p-2">Hit (7g)</th>
                    <th className="text-right p-2">Ort. Skor</th>
                    <th className="text-right p-2">Durum</th>
                    <th className="text-right p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {seen.map((r) => (
                    <tr key={r.name} className="border-b border-slate-900 hover:bg-slate-900/40">
                      <td className="p-2 mono text-slate-100">{r.name}</td>
                      <td className="p-2 text-right text-slate-300">{r.hits}</td>
                      <td className="p-2 text-right text-slate-300 mono">{r.avg_score?.toFixed(1)}</td>
                      <td className="p-2 text-right">
                        {r.overridden ? (
                          <Badge tone="success">
                            {r.override_value === null ? "off" : r.override_value.toFixed(1)}
                          </Badge>
                        ) : (
                          <Badge tone="default">orijinal</Badge>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {!r.overridden && (
                          <button
                            data-testid={`sa-quick-add-${r.name}`}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                [r.name]: { value: "0", enabled: true },
                              })
                            }
                            className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25"
                          >
                            Override
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function BayesTab() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["bayes-status"], queryFn: () => api.msBayesStatus(LICKEY()) });
  const [text, setText] = useState("");
  const [label, setLabel] = useState("spam");
  const train = useMutation({
    mutationFn: () => api.msBayesTrain(LICKEY(), label, [text]),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bayes-status"] }); toast.success("Bayes eğitildi"); setText(""); },
  });
  // v43.33 — Toplu eğitim (satır başına 1 örnek)
  const [bulkText, setBulkText] = useState("");
  const [bulkKind, setBulkKind] = useState("spam");
  const bulkTrain = useMutation({
    mutationFn: () => api.bayesTrainManual(bulkKind, bulkText.split(/\n---+\n|\n\n\n/).map(s => s.trim()).filter(Boolean)),
    onSuccess: (d) => {
      toast.success(`${d.added} ${d.kind} örneği eğitim kuyruğuna eklendi — bayilere de push edilecek`);
      qc.invalidateQueries({ queryKey: ["bayes-status"] });
      setBulkText("");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const bulkCount = bulkText.split(/\n---+\n|\n\n\n/).map(s => s.trim()).filter(Boolean).length;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Bayes Trainer (Kendi motor)" subtitle="Token counter — spam/ham örnek besleyin"/>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Token Sayısı" value={(status.data?.total_tokens ?? 0).toLocaleString("tr-TR")}/>
            <Stat label="Spam Örnekler" value={status.data?.spam_samples ?? 0} tone="text-rose-300"/>
            <Stat label="Ham Örnekler" value={status.data?.ham_samples ?? 0} tone="text-emerald-300"/>
            <Stat label="Denge Skoru" value={`% ${Math.round((status.data?.balance ?? 0) * 100)}`}
                  tone={(status.data?.balance ?? 0) > 0.5 ? "text-emerald-300" : "text-amber-300"}/>
          </div>
          {(status.data?.total_tokens ?? 0) < 500 && (
            <div className="text-[11px] p-2 rounded border border-amber-500/30 bg-amber-500/5 text-amber-300">
              ⚠ En az 500 token (200+ spam + 200+ ham örnek) beslendikten sonra Bayes anlamlı sonuç verir.
              Şu an <b>{(status.data?.total_tokens ?? 0).toLocaleString("tr-TR")}</b> token var.
            </div>
          )}
          <textarea data-testid="bayes-sample" value={text} onChange={e => setText(e.target.value)} rows={4}
                    placeholder="Örnek e-posta metni yapıştırın..."
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm"/>
          <div className="flex items-center gap-2">
            <select data-testid="bayes-label" value={label} onChange={e => setLabel(e.target.value)}
                    className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm">
              <option value="spam">spam</option><option value="ham">ham</option>
            </select>
            <button data-testid="bayes-train" disabled={!text || train.isPending} onClick={() => train.mutate()}
                    className="text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
              <Brain className="w-3 h-3 inline mr-1"/>Tek Örnek Eğit
            </button>
          </div>
        </CardBody>
      </Card>

      {/* v44.00.24 — Top spam/ham token discriminatorlar (Bayes'in ne öğrendiğini gör) */}
      {(status.data?.top_spam_tokens?.length > 0 || status.data?.top_ham_tokens?.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader title="🔴 En Ayırt Edici Spam Kelimeleri"
                        subtitle="En az %65 spam oranı olan token'lar — Bayes'in spam işareti olarak öğrendikleri"/>
            <CardBody>
              <TokenList items={status.data?.top_spam_tokens || []} kind="spam"/>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="🟢 En Ayırt Edici Ham Kelimeleri"
                        subtitle="Meşru mail sinyali olarak öğrenilen kelimeler"/>
            <CardBody>
              <TokenList items={status.data?.top_ham_tokens || []} kind="ham"/>
            </CardBody>
          </Card>
        </div>
      )}

      {/* v43.33 — Toplu Bayes Eğitim (bayilere de push eder) */}
      <Card>
        <CardHeader
          title="🧠 Toplu Bayes Eğitim (Master → Bayilere Push)"
          subtitle="Her mail örneğini boş satırla ayırın (--- veya ⏎⏎⏎). Master DB'ye kaydedilir + bayi plugin daemon'lara sa-learn için push edilir."
        />
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">Etiket:</label>
            <select value={bulkKind} onChange={e => setBulkKind(e.target.value)}
                    data-testid="bayes-bulk-kind"
                    className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs">
              <option value="spam">spam (kötü örnekler)</option>
              <option value="ham">ham (temiz örnekler)</option>
            </select>
            <span className="text-[11px] text-slate-500 ml-auto mono">{bulkCount} örnek hazır</span>
          </div>
          <textarea
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            rows={10}
            data-testid="bayes-bulk-textarea"
            placeholder={`Subject: Kazandın!\nSelam Ahmet, bugün 5000TL kazandın, tıkla al...\n\n---\n\nSubject: Fatura no 123\nDeğerli müşterimiz, faturanız hazır...`}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-xs mono text-slate-200 focus:border-indigo-500/40 focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-slate-500">
              📌 Ayrıca "spam değildir"/"spam" işaretlediğiniz her karantina otomatik olarak Bayes'e eklenir.
            </div>
            <button
              data-testid="bayes-bulk-train"
              disabled={bulkCount === 0 || bulkTrain.isPending}
              onClick={() => bulkTrain.mutate()}
              className="text-xs px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <Brain className="w-3 h-3"/>
              {bulkTrain.isPending ? "Yükleniyor…" : `${bulkCount} Örneği Eğit`}
            </button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function PolicyTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ms-policies"], queryFn: () => api.msPolicies(LICKEY()) });
  const [form, setForm] = useState({ user_email: "", spam_threshold: 5.0, action_on_spam: "quarantine" });
  const save = useMutation({
    mutationFn: () => api.msPolicyPut(LICKEY(), form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ms-policies"] }); toast.success("Politika kaydedildi"); setForm({ user_email: "", spam_threshold: 5.0, action_on_spam: "quarantine" }); },
  });
  return (
    <Card>
      <CardHeader title="Kullanıcı Bazlı Politikalar" subtitle="Alıcı e-postaya göre spam eşiği ve aksiyon"/>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 bg-slate-950/50 border border-slate-800 rounded-md">
          <input data-testid="policy-email" value={form.user_email} onChange={e => setForm({ ...form, user_email: e.target.value })} placeholder="user@sirketim.com" className="col-span-2 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
          <input data-testid="policy-threshold" type="number" step="0.5" value={form.spam_threshold} onChange={e => setForm({ ...form, spam_threshold: Number(e.target.value) })} className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
          <select data-testid="policy-action" value={form.action_on_spam} onChange={e => setForm({ ...form, action_on_spam: e.target.value })} className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm">
            {["quarantine", "reject", "tag", "deliver"].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button data-testid="policy-save" onClick={() => save.mutate()} disabled={!form.user_email}
                  className="col-span-4 text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
            Kaydet
          </button>
        </div>
        <div className="space-y-1">
          {(q.data?.items || []).map((p, i) => (
            <div key={i} className="border border-slate-800 rounded-md p-2 flex items-center gap-3 text-sm">
              <span className="mono flex-1 text-slate-100">{p.user_email}</span>
              <span className="mono text-slate-400">threshold: {p.spam_threshold}</span>
              <Badge tone={p.action_on_spam === "reject" ? "danger" : "default"}>{p.action_on_spam}</Badge>
            </div>
          ))}
          {(q.data?.items || []).length === 0 && <div className="text-sm text-slate-500 text-center py-6">Politika yok</div>}
        </div>
      </CardBody>
    </Card>
  );
}

function UrlTab() {
  const [urls, setUrls] = useState("");
  const [rewritten, setRewritten] = useState([]);
  const rewrite = useMutation({
    mutationFn: () => api.msUrlRewrite(LICKEY(), urls.split(/\s+/).filter(Boolean)),
    onSuccess: (d) => { setRewritten(d.items || []); toast.success(`${d.items.length} URL kısaltıldı`); },
  });
  const [token, setToken] = useState("");
  const inspect = useMutation({
    mutationFn: () => api.msUrlInspect(token),
    onSuccess: (d) => toast[d.verdict === "safe" ? "success" : "warning"](`${d.verdict}: ${d.url}`),
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader title="URL Rewrite" subtitle="URL'i /r/{token}'a dönüştür (time-of-click)"/>
        <CardBody className="space-y-3">
          <textarea data-testid="url-input" value={urls} onChange={e => setUrls(e.target.value)} rows={4}
                    placeholder="https://example.com&#10;https://malicious.zip" className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
          <button data-testid="url-rewrite-btn" onClick={() => rewrite.mutate()} disabled={!urls || rewrite.isPending}
                  className="text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
            Kısalt
          </button>
          {rewritten.length > 0 && (
            <div className="space-y-1">
              {rewritten.map((r, i) => (
                <div key={i} className="text-[11px] mono bg-slate-950 p-2 rounded border border-slate-800">
                  <div className="text-slate-400 truncate">{r.original}</div>
                  <div className="text-indigo-300">→ {r.wrapped}</div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="URL Inspect" subtitle="Token → verdict analizi"/>
        <CardBody className="space-y-3">
          <input data-testid="url-inspect-token" value={token} onChange={e => setToken(e.target.value)}
                 placeholder="token (10 karakter)" className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
          <button data-testid="url-inspect-btn" onClick={() => inspect.mutate()} disabled={!token || inspect.isPending}
                  className="text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
            Kontrol Et
          </button>
        </CardBody>
      </Card>
    </div>
  );
}

function NumField({ label, value, onSave }) {
  const [v, setV] = useState(value);
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="flex gap-2">
        <input type="number" step="0.5" value={v} onChange={e => setV(Number(e.target.value))}
               className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
        <button onClick={() => onSave(v)} className="text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30">Kaydet</button>
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange, testid }) {
  // v43.25 — Label'ı value-aware yap: "Aktif" / "Pasif" net görünsün
  const stateLabel = value ? "Aktif" : "Pasif";
  const displayLabel = label && label !== "Aktif" ? `${label}: ${stateLabel}` : stateLabel;
  return (
    <button data-testid={testid} onClick={() => onChange(!value)}
            data-state={value ? "on" : "off"}
            className={`text-xs px-3 py-1.5 rounded-md border transition-colors font-semibold
              ${value ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/50 hover:bg-emerald-500/25"
                     : "bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200"}`}>
      {value ? "● " : "○ "}{displayLabel}
    </button>
  );
}

function Stat({ label, value, tone = "text-slate-100" }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-md p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">{label}</div>
      <div className={`mono text-lg ${tone}`}>{value}</div>
    </div>
  );
}

// v44.00.24 — Bayes en iyi discriminator token listesi
function TokenList({ items, kind = "spam" }) {
  if (!items || items.length === 0) {
    return <div className="text-slate-500 text-xs text-center py-4">Yeterli örnek yok</div>;
  }
  const barColor = kind === "spam" ? "bg-rose-500" : "bg-emerald-500";
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={it.token + i}>
          <div className="flex items-center justify-between gap-2">
            <span className="mono text-xs text-slate-200 truncate flex-1" title={it.token}>{it.token}</span>
            <span className="text-[10px] mono text-slate-400 shrink-0">
              <span className="text-rose-300">{it.spam}</span>/<span className="text-emerald-300">{it.ham}</span>
              <span className="text-slate-500 ml-1">·%{Math.round(it.ratio * 100)}</span>
            </span>
          </div>
          <div className="mt-0.5 h-1 bg-slate-800 rounded overflow-hidden">
            <div className={`h-full ${barColor}`} style={{ width: `${it.ratio * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonCard() {
  return <Card><CardBody className="h-32 flex items-center justify-center text-slate-500 text-sm">Yükleniyor…</CardBody></Card>;
}

function LearnTab() {
  const qc = useQueryClient();
  const log = useQuery({ queryKey: ["ms-selftrain-log"], queryFn: () => api.msSelfTrainLog(30), refetchInterval: 30000 });
  const suggs = useQuery({ queryKey: ["ms-suggestions", false], queryFn: () => api.msSuggestions(LICKEY(), false) });
  const run = useMutation({
    mutationFn: () => api.msSelfTrainRun(),
    onSuccess: (d) => {
      toast.success(`Öğrenme çalıştı: spam ${d.trained_spam}, ham ${d.trained_ham}, öneri ${d.rules_suggested}`);
      qc.invalidateQueries({ queryKey: ["ms-selftrain-log"] });
      qc.invalidateQueries({ queryKey: ["ms-suggestions"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const quaScan = useMutation({
    mutationFn: () => api.msQuarantineRecommend(LICKEY(), 7, 3),
    onSuccess: (d) => {
      if (d.scanned === 0) {
        toast.info("Son 7 günde karantinada kayıt yok — önce spam yakalamak gerekiyor.");
      } else if (d.suggested === 0) {
        toast(`Tarandı: ${d.scanned} kayıt · Yeni öneri yok (${d.skipped_existing} kural halihazırda mevcut)`, { icon: "🔎" });
      } else {
        toast.success(`Karantina taraması: ${d.scanned} kayıt → ${d.suggested} yeni kural önerisi`);
      }
      qc.invalidateQueries({ queryKey: ["ms-suggestions"] });
      qc.invalidateQueries({ queryKey: ["ms-selftrain-log"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const apply = useMutation({
    mutationFn: (id) => api.msSuggestionApply(LICKEY(), id),
    onSuccess: () => { toast.success("Kural onaylandı ve aktif edildi"); qc.invalidateQueries({ queryKey: ["ms-suggestions"] }); },
  });
  const reject = useMutation({
    mutationFn: (id) => api.msSuggestionReject(LICKEY(), id),
    onSuccess: () => { toast.success("Öneri reddedildi"); qc.invalidateQueries({ queryKey: ["ms-suggestions"] }); },
  });
  // v43.81 — Bulk apply / reject
  const [selected, setSelected] = useState(() => new Set());
  const bulkApply = useMutation({
    mutationFn: (ids) => api.msBulkApply(LICKEY(), ids),
    onSuccess: (d) => {
      toast.success(`${d.applied} öneri onaylandı${d.skipped ? ` · ${d.skipped} atlandı` : ""}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["ms-suggestions"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const bulkReject = useMutation({
    mutationFn: (ids) => api.msBulkReject(LICKEY(), ids),
    onSuccess: (d) => {
      toast.success(`${d.rejected} öneri reddedildi`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["ms-suggestions"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  // v43.85 — Weekly PDF Email Trigger
  const weeklyReport = useMutation({
    mutationFn: () => api.msWeeklyReport(),
    onSuccess: (d) => {
      if (d.email_sent) {
        toast.success(`Rapor gönderildi: ${d.total_new_suggestions} öneri · ${d.active_licenses} bayi · PDF ${(d.pdf_size_bytes / 1024).toFixed(1)}KB`);
      } else {
        toast.warning(`Rapor üretildi ama email atılamadı: ${d.email_error || "admin_email boş"}`);
      }
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Rapor tetiklenemedi"),
  });
  const items = suggs.data?.items || [];
  // v43.82 — Öneri filtreleri: source + min_score
  const [sourceFilter, setSourceFilter] = useState("all"); // all | quarantine | selftrain
  const [minScore, setMinScore] = useState(0);
  // v43.83 — Öneri arama
  const [searchQ, setSearchQ] = useState("");
  const filteredItems = items.filter((s) => {
    if (sourceFilter === "quarantine" && s.source !== "quarantine_pattern") return false;
    if (sourceFilter === "selftrain" && s.source !== "ai_self_training") return false;
    if ((s.score || 0) < minScore) return false;
    const q = searchQ.trim().toLowerCase();
    if (q) {
      const hay = [
        s.name || "",
        s.pattern || "",
        s.description || "",
        s.target || "",
        ...(Array.isArray(s.sample_subjects) ? s.sample_subjects : []),
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const allIds = filteredItems.map((s) => s.id);
  const toggleSel = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((prev) => {
    if (prev.size === filteredItems.length && filteredItems.length > 0) return new Set();
    return new Set(allIds);
  });

  // v43.84 — Arama vurgulama: query eşleşen tüm oluşumları <mark> ile boyar
  const highlight = (txt) => {
    const q = searchQ.trim();
    if (!q || !txt) return txt;
    const parts = String(txt).split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((p, i) => {
      if (p.toLowerCase() === q.toLowerCase()) {
        return <mark key={i} className="bg-amber-500/40 text-amber-100 px-0.5 rounded">{p}</mark>;
      }
      return <span key={i}>{p}</span>;
    });
  };
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 lg:col-span-6">
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-fuchsia-400"/> AI Öğrenme Günlüğü</span>}
            subtitle="Sistem her saat kendini eğitir: high_spam → Bayes, clean → Bayes"
            right={
              <div className="flex items-center gap-1.5">
                <a
                  data-testid="weekly-pdf-download"
                  href={`${process.env.REACT_APP_BACKEND_URL}/api/mailscanner/ai/quarantine-recommend/weekly-report.pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Haftalık raporu PDF olarak indir"
                  className="text-xs px-2.5 py-1.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/25 whitespace-nowrap">
                  📄 PDF
                </a>
                <button
                  data-testid="weekly-report-send"
                  onClick={() => weeklyReport.mutate()}
                  disabled={weeklyReport.isPending}
                  title="Haftalık raporu master admin_email adresine PDF ek ile gönder"
                  className="text-xs px-2.5 py-1.5 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/40 hover:bg-rose-500/25 disabled:opacity-40 whitespace-nowrap">
                  ✉ {weeklyReport.isPending ? "Yollanıyor…" : "Rapor Yolla"}
                </button>
                <button data-testid="selftrain-run" onClick={() => run.mutate()} disabled={run.isPending}
                        className="text-xs px-3 py-1.5 rounded-md bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 hover:bg-fuchsia-500/30 disabled:opacity-40">
                  {run.isPending ? "Çalışıyor..." : "Şimdi Çalıştır"}
                </button>
              </div>
            }
          />
          <CardBody>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {(log.data?.items || []).map(r => (
                <div key={r.id} className="text-xs mono border border-slate-800 rounded p-2 bg-slate-950/50">
                  <div className="text-slate-400 flex justify-between">
                    <span>{r.run_at.slice(0, 19).replace("T", " ")}</span>
                    <Badge tone="success">{r.rules_suggested} öneri</Badge>
                  </div>
                  <div className="mt-1 text-slate-500">
                    spam: <span className="text-rose-300">{r.trained_spam}</span> ·
                    ham: <span className="text-emerald-300">{r.trained_ham}</span> ·
                    lisans: <span className="text-slate-300">{r.licenses}</span>
                  </div>
                </div>
              ))}
              {(log.data?.items || []).length === 0 && (
                <div className="text-slate-500 text-center py-8 text-sm">Henüz self-training çalışması yok</div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
      <div className="col-span-12 lg:col-span-6">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2">AI Kural Önerileri {selected.size > 0 && <Badge tone="info">{selected.size} seçili</Badge>}</span>}
            subtitle="Checkbox ile seç · Toplu onayla/reddet veya tek tek işlem yap"
            right={
              <button data-testid="quarantine-scan-run" onClick={() => quaScan.mutate()} disabled={quaScan.isPending}
                      title="Son 7 gün karantina kayıtlarını tarayıp regex önerisi üret"
                      className="text-[11px] px-2.5 py-1 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/25 disabled:opacity-40 whitespace-nowrap">
                {quaScan.isPending ? "Taranıyor…" : "🔎 Karantinayı Tara"}
              </button>
            }
          />
          <CardBody>
            {/* v43.82 — Öneri filtreleri */}
            <div data-testid="learn-filters" className="flex flex-wrap items-center gap-3 mb-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-1">
                {[
                  { k: "all", lbl: `Tümü (${items.length})`, tone: "slate" },
                  { k: "quarantine", lbl: `🔎 Karantina (${items.filter(i => i.source === "quarantine_pattern").length})`, tone: "cyan" },
                  { k: "selftrain", lbl: `✨ Öz-eğitim (${items.filter(i => i.source === "ai_self_training").length})`, tone: "fuchsia" },
                ].map((f) => {
                  const active = sourceFilter === f.k;
                  const activeCls = active
                    ? (f.tone === "cyan" ? "bg-cyan-500/25 text-cyan-200 border-cyan-500/60"
                       : f.tone === "fuchsia" ? "bg-fuchsia-500/25 text-fuchsia-200 border-fuchsia-500/60"
                       : "bg-slate-700 text-slate-100 border-slate-500")
                    : "bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-800";
                  return (
                    <button
                      key={f.k}
                      data-testid={`learn-filter-${f.k}`}
                      onClick={() => setSourceFilter(f.k)}
                      className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${activeCls}`}
                    >
                      {f.lbl}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <input
                  type="search"
                  placeholder="🔍 Ara (pattern/konu/açıklama)…"
                  data-testid="learn-search"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  className="text-[11px] bg-slate-950 border border-slate-800 focus:border-indigo-500/60 rounded-md px-2.5 py-1 w-52 mono text-slate-200 outline-none"
                />
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Min skor</label>
                <input
                  type="range" min={0} max={6} step={0.5}
                  data-testid="learn-min-score"
                  value={minScore}
                  onChange={(e) => setMinScore(parseFloat(e.target.value))}
                  className="w-32 accent-amber-500"
                />
                <span className="text-xs mono text-amber-300 min-w-[2ch]">{minScore.toFixed(1)}</span>
              </div>
            </div>
            {filteredItems.length > 0 && (
              <div data-testid="bulk-toolbar" className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-800">
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <input type="checkbox"
                    data-testid="bulk-select-all"
                    checked={selected.size === filteredItems.length && filteredItems.length > 0}
                    onChange={toggleAll}
                    className="rounded border-slate-600 bg-slate-950" />
                  Tümünü seç ({filteredItems.length})
                </label>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    data-testid="bulk-apply"
                    disabled={selected.size === 0 || bulkApply.isPending}
                    onClick={() => bulkApply.mutate([...selected])}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40">
                    ✓ Toplu Onayla
                  </button>
                  <button
                    data-testid="bulk-reject"
                    disabled={selected.size === 0 || bulkReject.isPending}
                    onClick={() => bulkReject.mutate([...selected])}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/40 hover:bg-rose-500/20 disabled:opacity-40">
                    ✕ Toplu Reddet
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredItems.map(s => {
                const isQua = s.source === "quarantine_pattern";
                const borderCls = isQua ? "border-cyan-500/30 bg-cyan-500/5" : "border-fuchsia-500/30 bg-fuchsia-500/5";
                const sourceLabel = isQua
                  ? (s.sub_source === "sender_domain" ? "Karantina · Gönderen Domain"
                     : s.sub_source === "sender_tld" ? "Karantina · TLD"
                     : "Karantina · Konu Kelimesi")
                  : "Öz-eğitim · Konu";
                const isSel = selected.has(s.id);
                const sc = Math.max(0, Math.min(6, Number(s.score) || 0));
                const hue = 180 - (sc / 6) * 180;
                const heatColor = sc < 0.1 ? "#475569" : `hsl(${hue.toFixed(0)}, 85%, 55%)`;
                // v44.00.24 — Net domain/tld/keyword badge
                const pKindColor = { domain: "#22d3ee", tld: "#ec4899", keyword: "#f59e0b" }[s.pattern_kind] || "#94a3b8";
                const pKindLabel = { domain: "🌐 Domain", tld: "🏷 TLD", keyword: "🔑 Kelime" }[s.pattern_kind] || "?";
                return (
                  <div key={s.id} data-testid={`suggestion-${s.id}`}
                       className={`border ${borderCls} rounded p-3 pl-4 relative ${isSel ? "ring-1 ring-indigo-400" : ""}`}>
                    <div
                      data-testid={`suggestion-heat-${s.id}`}
                      title={`Skor: ${sc.toFixed(1)} / 6.0`}
                      className="absolute left-0 top-1 bottom-1 w-1 rounded-l"
                      style={{ backgroundColor: heatColor, boxShadow: sc >= 5 ? `0 0 8px ${heatColor}` : "none" }}
                    />
                    <div className="flex justify-between items-start gap-3 mb-1">
                      <label className="flex items-start gap-2 flex-1 cursor-pointer">
                        <input type="checkbox"
                          data-testid={`suggestion-check-${s.id}`}
                          checked={isSel}
                          onChange={() => toggleSel(s.id)}
                          className="mt-1 rounded border-slate-600 bg-slate-950" />
                        <span className="text-sm text-slate-100 truncate">{highlight(s.name)}</span>
                      </label>
                      <div className="flex items-center gap-1 shrink-0">
                        {s.hit_count ? (
                          <Badge tone="info">{s.hit_count} hit</Badge>
                        ) : null}
                        <Badge tone="warning">{(s.score || 0).toFixed(1)}</Badge>
                      </div>
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-2 flex-wrap">
                      <span>{sourceLabel}</span>
                      {s.pattern_value && (
                        <span className="inline-flex items-center gap-1 text-[10px] mono uppercase px-1.5 py-0.5 rounded font-bold"
                              style={{ background: pKindColor + "22", color: pKindColor }}
                              title="Kuralın hedeflediği tam değer">
                          {pKindLabel}: <span className="normal-case">{highlight(s.pattern_value)}</span>
                        </span>
                      )}
                    </div>
                    <details className="text-[11px] mono text-slate-500 mb-1 group">
                      <summary className="cursor-pointer hover:text-slate-300"><span className="text-slate-500">{s.target}:</span> /{highlight(s.pattern)}/</summary>
                    </details>
                    <div className="text-[11px] text-slate-400 mb-2">{highlight(s.description)}</div>
                    {/* v44.00.24 — Örnek göndericiler (canlı bağlam) */}
                    {Array.isArray(s.sample_senders) && s.sample_senders.length > 0 && (
                      <div className="text-[10px] mb-2 border-l-2 border-cyan-500/40 pl-2">
                        <div className="text-cyan-400 uppercase tracking-wider mb-0.5">Örnek Göndericiler ({s.sample_senders.length})</div>
                        {s.sample_senders.map((sd, i) => (
                          <div key={i} className="mono text-slate-300 truncate">→ {highlight(sd)}</div>
                        ))}
                      </div>
                    )}
                    {Array.isArray(s.sample_subjects) && s.sample_subjects.length > 0 && (
                      <div className="text-[10px] text-slate-500 mb-2 border-l-2 border-slate-700 pl-2 space-y-0.5">
                        <div className="text-slate-400 uppercase tracking-wider mb-0.5">Örnek Konular</div>
                        {s.sample_subjects.slice(0, 3).map((ss, i) => (
                          <div key={i} className="truncate italic">"{highlight(ss)}"</div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button data-testid={`suggestion-apply-${s.id}`} onClick={() => apply.mutate(s.id)}
                              className="text-[11px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30">
                        ✓ Onayla → Kural Ekle
                      </button>
                      <button data-testid={`suggestion-reject-${s.id}`} onClick={() => reject.mutate(s.id)}
                              className="text-[11px] px-2 py-1 rounded bg-rose-500/10 text-rose-300 border border-rose-500/40 hover:bg-rose-500/20">
                        ✕ Reddet
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredItems.length === 0 && (
                <div className="text-slate-500 text-center py-8 text-sm">
                  {items.length === 0
                    ? <>AI önerisi yok — <span className="text-fuchsia-300">Öz-eğitim</span> veya <span className="text-cyan-300">Karantinayı Tara</span> çalıştır</>
                    : <>Bu filtreye uyan öneri yok — filtreleri temizleyin (Tümü / min skor 0)</>}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
      <div className="col-span-12">
        <RulePerformanceCard/>
      </div>
      <div className="col-span-12">
        <div className="border border-indigo-500/20 bg-indigo-500/5 rounded-md p-3 text-xs">
          <div className="text-indigo-300 font-semibold flex items-center gap-1 mb-1"><Info className="w-3.5 h-3.5"/>Sistem-Genelinde Otomatik AI</div>
          <ul className="list-disc list-inside space-y-0.5 text-slate-400">
            <li>Her saat başı background job: son 1 saatteki high_spam/clean mailleri Bayes'e besler</li>
            <li>5+ spam örnek biriktiğinde Claude LLM yeni SA regex kuralı önerir (subject pattern)</li>
            <li><span className="text-cyan-300">🔎 Karantinayı Tara</span>: son 7 gün karantina kayıtlarından gönderen domain, TLD ve konu kelime kalıplarını yerel istatistikle çıkarır (LLM'siz, ücretsiz)</li>
            <li><span className="text-pink-300">📉 Kural Performans Loop</span>: Onaylanan kuralların 7+ gün sonraki hit sayısı ölçülür → 0 hit → "kaldırma önerisi" oluşur (v44.00.25)</li>
            <li>Öneriler bu tab'da görünür — otomatik apply değil, sen onaylarsın (güvenlik)</li>
            <li>AI Batch Prewarm: yüksek riskli mailler için "Neden spam?" açıklaması ingest sırasında üretilip cache'lenir</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// v44.00.25/26 — AI Rule Performance Loop UI + Auto-Disable Config
function RulePerformanceCard() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["ms-rule-perf"],
    queryFn: () => api.msRulePerfList(LICKEY()),
  });
  const scan = useMutation({
    mutationFn: () => api.msRulePerfScan(LICKEY(), 7, 7),
    onSuccess: (d) => {
      toast.success(`📊 ${d.scanned} kural tarandı · ${d.zero_hit} sıfır hit · ${d.new_removal_suggestions} yeni kaldırma önerisi`);
      qc.invalidateQueries({ queryKey: ["ms-rule-perf"] });
      qc.invalidateQueries({ queryKey: ["ms-suggestions"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const remove = useMutation({
    mutationFn: (ruleId) => api.msRuleRemove(LICKEY(), ruleId),
    onSuccess: () => {
      toast.success("Kural kaldırıldı");
      qc.invalidateQueries({ queryKey: ["ms-rule-perf"] });
      qc.invalidateQueries({ queryKey: ["ms-rules"] });
    },
  });
  // v44.00.26 — Auto-disable config
  const configMut = useMutation({
    mutationFn: (payload) => client.post(
      `/mailscanner/ai/rule-performance/config?license_key=${encodeURIComponent(LICKEY())}`, payload
    ).then(r => r.data),
    onSuccess: () => {
      toast.success("Otomatik disable ayarı kaydedildi");
      qc.invalidateQueries({ queryKey: ["ms-rule-perf"] });
    },
  });
  const reEnable = useMutation({
    mutationFn: (ruleId) => client.post(
      `/mailscanner/ai/rule-performance/enable/${ruleId}?license_key=${encodeURIComponent(LICKEY())}`
    ).then(r => r.data),
    onSuccess: () => {
      toast.success("Kural tekrar aktif edildi");
      qc.invalidateQueries({ queryKey: ["ms-rule-perf"] });
    },
  });

  const [showAll, setShowAll] = useState(false);
  const [showDisabled, setShowDisabled] = useState(false);
  const items = list.data?.items || [];
  const cfg = list.data?.config || { auto_disable_enabled: true, auto_disable_days: 14 };
  const [localCfg, setLocalCfg] = useState(cfg);
  useEffect(() => { setLocalCfg(cfg); }, [cfg.auto_disable_enabled, cfg.auto_disable_days]);

  const enabledItems = items.filter(r => r.enabled);
  const autoDisabled = items.filter(r => !r.enabled && r.auto_disabled_at);
  const zeroHit = enabledItems.filter(r => (r.hits_last_check || 0) === 0 && r.hits_last_check_at);
  let visible;
  if (showDisabled) visible = autoDisabled;
  else if (showAll) visible = enabledItems;
  else visible = zeroHit;

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-amber-400"/> Kural Performans Loop</span>}
        subtitle={`${list.data?.total || 0} kural · ${list.data?.enabled || 0} aktif · ${list.data?.healthy || 0} sağlıklı · ${list.data?.zero_hit || 0} sıfır-hit · ${list.data?.auto_disabled || 0} otomatik-disable`}
        right={
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button onClick={() => { setShowAll(!showAll); setShowDisabled(false); }} data-testid="rule-perf-toggle"
                    className="text-[11px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">
              {showAll ? "Sadece 0-hit" : "Tümünü göster"}
            </button>
            <button onClick={() => { setShowDisabled(!showDisabled); setShowAll(false); }} data-testid="rule-perf-disabled"
                    className={`text-[11px] px-2 py-1 rounded border ${
                      showDisabled ? "bg-rose-500/20 text-rose-300 border-rose-500/40" : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                    }`}>
              🚫 Auto-Disabled ({list.data?.auto_disabled || 0})
            </button>
            <button onClick={() => scan.mutate()} disabled={scan.isPending} data-testid="rule-perf-scan"
                    className="text-xs px-2.5 py-1.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40">
              📊 {scan.isPending ? "Ölçülüyor…" : "7 Günü Ölç"}
            </button>
          </div>
        }
      />
      <CardBody>
        {/* v44.00.26 — Auto-Disable Config Bar */}
        <div className="mb-3 p-2.5 rounded border border-amber-500/20 bg-amber-500/5 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <input type="checkbox" data-testid="rule-perf-auto-toggle"
                   checked={!!localCfg.auto_disable_enabled}
                   onChange={e => setLocalCfg({ ...localCfg, auto_disable_enabled: e.target.checked })}
                   className="rounded border-slate-600 bg-slate-950" />
            <span className="text-slate-200 font-semibold">Otomatik Disable</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-400">
            <span>0-hit süresi:</span>
            <input type="number" min="1" max="365" data-testid="rule-perf-days"
                   value={localCfg.auto_disable_days ?? 14}
                   onChange={e => setLocalCfg({ ...localCfg, auto_disable_days: parseInt(e.target.value || "14") })}
                   disabled={!localCfg.auto_disable_enabled}
                   className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-0.5 mono text-center disabled:opacity-40" />
            <span>gün</span>
          </div>
          <button data-testid="rule-perf-config-save"
                  onClick={() => configMut.mutate({ enabled: !!localCfg.auto_disable_enabled, days: parseInt(localCfg.auto_disable_days || 14) })}
                  disabled={configMut.isPending || (localCfg.auto_disable_enabled === cfg.auto_disable_enabled && localCfg.auto_disable_days === cfg.auto_disable_days)}
                  className="ml-auto text-[11px] px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40">
            💾 Kaydet
          </button>
          <span className="text-[10px] text-slate-500 basis-full">
            {localCfg.auto_disable_enabled
              ? `${localCfg.auto_disable_days || 14}+ gündür 0-hit olan kurallar günlük cron tarafından otomatik disable edilir (silme değil, revert edilebilir).`
              : "Otomatik disable KAPALI — kurallar manuel yönetilecek."}
          </span>
        </div>

        {list.isLoading ? (
          <div className="text-slate-500 text-sm text-center py-4">Yükleniyor…</div>
        ) : items.length === 0 ? (
          <div className="text-slate-500 text-sm text-center py-6">Henüz onaylanmış kural yok — AI önerilerini onaylayınca burada takip edilecek.</div>
        ) : visible.length === 0 ? (
          <div className="text-emerald-400 text-sm text-center py-4">
            {showDisabled ? "Auto-disabled kural yok" : "✓ Tüm kurallar aktif hit alıyor — 0-hit kural yok"}
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase text-slate-500 sticky top-0 bg-slate-950">
                <tr>
                  <th className="text-left px-2 py-1.5">Kural</th>
                  <th className="text-left px-2 py-1.5">Pattern</th>
                  <th className="text-right px-2 py-1.5">Skor</th>
                  <th className="text-right px-2 py-1.5">7g Hit</th>
                  <th className="text-right px-2 py-1.5">Durum</th>
                  <th className="text-right px-2 py-1.5">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {visible.map(r => {
                  const zero = (r.hits_last_check || 0) === 0;
                  const disabledRow = !r.enabled;
                  return (
                    <tr key={r.id} data-testid={`rule-perf-row-${r.id}`}
                        className={disabledRow ? "bg-rose-500/10 opacity-70" : zero ? "bg-amber-500/5" : "hover:bg-slate-800/40"}>
                      <td className="px-2 py-1.5 text-slate-200 truncate max-w-[180px]" title={r.name}>{r.name}</td>
                      <td className="px-2 py-1.5 mono text-slate-500 text-[10px] truncate max-w-[220px]" title={r.pattern}>{r.pattern}</td>
                      <td className="px-2 py-1.5 text-right mono text-slate-300">{(r.score || 0).toFixed(1)}</td>
                      <td className={`px-2 py-1.5 text-right mono ${zero ? "text-rose-300" : "text-emerald-300"}`}>{r.hits_last_check || 0}</td>
                      <td className="px-2 py-1.5 text-right text-[10px]">
                        {disabledRow ? (
                          <span className="mono text-rose-300" title={r.auto_disable_reason}>
                            🚫 Auto-disabled
                            {r.auto_disabled_at && <div className="text-slate-500 text-[9px]">{new Date(r.auto_disabled_at).toLocaleDateString("tr-TR")}</div>}
                          </span>
                        ) : (
                          <span className="mono text-slate-500">
                            {r.hits_last_check_at ? new Date(r.hits_last_check_at).toLocaleDateString("tr-TR") : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {disabledRow ? (
                          <button onClick={() => reEnable.mutate(r.id)} data-testid={`rule-perf-reenable-${r.id}`}
                                  className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30">
                            ↺ Tekrar Aktif
                          </button>
                        ) : zero && (
                          <button onClick={() => window.confirm(`"${r.name}" kaldırılsın mı?`) && remove.mutate(r.id)}
                                  data-testid={`rule-perf-remove-${r.id}`}
                                  className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30">
                            Kaldır
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
