import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { Filter, Brain, Sliders, Users, Trash2, Plus, Beaker, Link as LinkIcon, Sparkles, Info } from "lucide-react";
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
  const run = useMutation({
    mutationFn: () => api.msAiAnalyze(LICKEY()),
    onSuccess: (d) => { setReport(d.report); setMetrics(d.metrics); setTs(d.generated_at); toast.success("Yapay zeka raporu hazır"); },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  return (
    <Card data-testid="ai-analyze-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-fuchsia-400"/> AI Sistem Analizi</span>}
        subtitle="Claude motoru MailScanner konfigürasyonunu ve son 24s metriklerini okur, aksiyon önerisi çıkarır"
        right={
          <button data-testid="ai-analyze-btn" onClick={() => run.mutate()} disabled={run.isPending}
                  className="text-xs px-3 py-1.5 rounded-md bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 hover:bg-fuchsia-500/30 disabled:opacity-40">
            <Sparkles className="w-3 h-3 inline mr-1"/>{run.isPending ? "Analiz ediliyor…" : "Sistemi Analiz Et"}
          </button>
        }
      />
      {(report || metrics) && (
        <CardBody className="pt-0">
          {metrics && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <MetricPill label="Son 24s Spam" v={metrics.spam_24h} tone="text-amber-300"/>
              <MetricPill label="Son 24s Virüs" v={metrics.virus_24h} tone="text-fuchsia-300"/>
              <MetricPill label="Aktif Motor" v={metrics.active_engines?.length} tone="text-emerald-300"/>
              <MetricPill label="Açık Bulgu" v={metrics.findings} tone={metrics.findings ? "text-rose-300" : "text-slate-400"}/>
            </div>
          )}
          {report && (
            <div className="bg-slate-950 border border-slate-800 rounded p-3 text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
              {report}
            </div>
          )}
          {ts && <div className="text-[10px] mono text-slate-500 mt-2">Üretildi: {ts}</div>}
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
  const [tab, setTab] = useState("config");
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <Filter className="w-5 h-5 text-indigo-400"/> Bağımsız MailScanner Modülü
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Kendi motorumuz · SpamAssassin ayarları · Bayes eğitimi · Kullanıcı politikaları</p>
        </div>
        <div className="flex gap-1 bg-slate-800/50 rounded p-1">
          {[
            { k: "config", l: "Yapılandırma", i: Sliders },
            { k: "stats", l: "İstatistik", i: BarChart },
            { k: "rules", l: "Kurallar", i: Filter },
            { k: "bayes", l: "Bayes", i: Brain },
            { k: "policy", l: "Kullanıcı Politika", i: Users },
            { k: "url", l: "URL Koruma", i: LinkIcon },
            { k: "learn", l: "AI Öğrenme", i: Sparkles },
          ].map(({ k, l, i: Icon }) => (
            <button key={k} data-testid={`ms-tab-${k}`} onClick={() => setTab(k)}
                    className={`text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1
                    ${tab === k ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400 hover:text-slate-100"}`}>
              <Icon className="w-3 h-3"/>{l}
            </button>
          ))}
        </div>
      </div>

      <AiAnalyzeCard/>

      {tab === "config" && <><ConfigTab/><HelpPanel tabKey="config"/></>}
      {tab === "stats"  && <><StatsTab/><HelpPanel tabKey="stats"/></>}
      {tab === "rules"  && <><RulesTab/><HelpPanel tabKey="rules"/></>}
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
  if (!q.data) return <SkeletonCard/>;
  const s = q.data;
  const pie = Object.entries(s.verdicts || {}).map(([name, value]) => ({ name, value }));
  // v43.31 — Detay metrikler
  const totalScanned = s.total_scanned || 0;
  const spam = (s.verdicts?.spam || 0) + (s.verdicts?.high_spam || 0);
  const clean = s.verdicts?.clean || 0;
  const virus = (s.verdicts?.virus || 0) + (s.verdicts?.phishing || 0);
  const spamRate = totalScanned ? ((spam / totalScanned) * 100).toFixed(1) : "0.0";
  const bayesTrainedHam = bayes.data?.ham_learned || 0;
  const bayesTrainedSpam = bayes.data?.spam_learned || 0;
  const activeEngines = (health.data?.engines || []).filter(e => e.enabled).length;
  const totalEngines = (health.data?.engines || []).length;
  return (
    <div className="space-y-4">
      {/* v43.31 — 6 KPI kartı */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MSKpi label="Toplam Taranan" value={totalScanned} tone="text-indigo-300" icon="📧" sub={`Son ${s.hours}h`}/>
        <MSKpi label="Spam Yakalanan" value={spam} tone="text-amber-300" icon="🛡️" sub={`% ${spamRate} oran`}/>
        <MSKpi label="Temiz Teslim" value={clean} tone="text-emerald-300" icon="✓" sub="Kullanıcıya iletildi"/>
        <MSKpi label="Virüs/Phishing" value={virus} tone="text-rose-300" icon="☠"/>
        <MSKpi label="Aktif Motor" value={`${activeEngines}/${totalEngines || 6}`} tone="text-cyan-300" icon="⚙️" sub="Tarama motorları"/>
        <MSKpi label="Bayes Eğitilen" value={bayesTrainedHam + bayesTrainedSpam} tone="text-fuchsia-300" icon="🧠"
               sub={`${bayesTrainedHam} ham · ${bayesTrainedSpam} spam`}/>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-6">
          <CardHeader title="Skor Histogramı" subtitle={`Son ${s.hours} saat · ${s.total_scanned} mail`}/>
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
        <Card className="col-span-12 lg:col-span-6">
          <CardHeader title="Verdict Dağılımı"/>
          <CardBody>
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" outerRadius={90} innerRadius={40}>
                    {pie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6 }}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
        <Card className="col-span-12">
          <CardHeader title="Motor Aktivitesi" subtitle="Her motorun bu pencerede kaç mail'e vurduğu + spam yakalama oranı"/>
          <CardBody>
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-widest text-slate-500">
                <tr><th className="text-left px-3 py-1.5">Motor</th><th className="text-right px-3 py-1.5">Toplam</th><th className="text-right px-3 py-1.5">Spam Yakalama</th><th className="text-right px-3 py-1.5">Oran</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {(s.engines || []).map(e => (
                  <tr key={e.engine} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 mono text-slate-300">{e.engine}</td>
                    <td className="px-3 py-2 text-right mono">{e.total}</td>
                    <td className="px-3 py-2 text-right mono text-rose-300">{e.spam}</td>
                    <td className="px-3 py-2 text-right text-slate-500 text-xs">%{e.total ? Math.round(e.spam / e.total * 100) : 0}</td>
                  </tr>
                ))}
                {(s.engines || []).length === 0 && (
                  <tr><td colSpan={4} className="text-center py-8 text-slate-500">Motor verisi yok</td></tr>
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
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
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Token Sayısı" value={status.data?.total_tokens ?? 0}/>
            <Stat label="Spam Örnekler" value={status.data?.spam_samples ?? 0} tone="text-rose-300"/>
            <Stat label="Ham Örnekler" value={status.data?.ham_samples ?? 0} tone="text-emerald-300"/>
          </div>
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
  const items = suggs.data?.items || [];
  const allIds = items.map((s) => s.id);
  const toggleSel = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected((prev) => {
    if (prev.size === items.length && items.length > 0) return new Set();
    return new Set(allIds);
  });
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 lg:col-span-6">
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-fuchsia-400"/> AI Öğrenme Günlüğü</span>}
            subtitle="Sistem her saat kendini eğitir: high_spam → Bayes, clean → Bayes"
            right={
              <button data-testid="selftrain-run" onClick={() => run.mutate()} disabled={run.isPending}
                      className="text-xs px-3 py-1.5 rounded-md bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 hover:bg-fuchsia-500/30 disabled:opacity-40">
                {run.isPending ? "Çalışıyor..." : "Şimdi Çalıştır"}
              </button>
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
            {items.length > 0 && (
              <div data-testid="bulk-toolbar" className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-800">
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <input type="checkbox"
                    data-testid="bulk-select-all"
                    checked={selected.size === items.length && items.length > 0}
                    onChange={toggleAll}
                    className="rounded border-slate-600 bg-slate-950" />
                  Tümünü seç ({items.length})
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
              {items.map(s => {
                const isQua = s.source === "quarantine_pattern";
                const borderCls = isQua ? "border-cyan-500/30 bg-cyan-500/5" : "border-fuchsia-500/30 bg-fuchsia-500/5";
                const sourceLabel = isQua
                  ? (s.sub_source === "sender_domain" ? "Karantina · Gönderen Domain"
                     : s.sub_source === "sender_tld" ? "Karantina · TLD"
                     : "Karantina · Konu Kelimesi")
                  : "Öz-eğitim · Konu";
                const isSel = selected.has(s.id);
                return (
                  <div key={s.id} data-testid={`suggestion-${s.id}`}
                       className={`border ${borderCls} rounded p-3 ${isSel ? "ring-1 ring-indigo-400" : ""}`}>
                    <div className="flex justify-between items-start gap-3 mb-1">
                      <label className="flex items-start gap-2 flex-1 cursor-pointer">
                        <input type="checkbox"
                          data-testid={`suggestion-check-${s.id}`}
                          checked={isSel}
                          onChange={() => toggleSel(s.id)}
                          className="mt-1 rounded border-slate-600 bg-slate-950" />
                        <span className="text-sm text-slate-100 truncate">{s.name}</span>
                      </label>
                      <div className="flex items-center gap-1 shrink-0">
                        {s.hit_count ? (
                          <Badge tone="info">{s.hit_count} hit</Badge>
                        ) : null}
                        <Badge tone="warning">{(s.score || 0).toFixed(1)}</Badge>
                      </div>
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{sourceLabel}</div>
                    <div className="text-[11px] mono text-slate-400 truncate mb-1">
                      <span className="text-slate-500">{s.target}:</span> /{s.pattern}/
                    </div>
                    <div className="text-[11px] text-slate-400 mb-2">{s.description}</div>
                    {Array.isArray(s.sample_subjects) && s.sample_subjects.length > 0 && (
                      <div className="text-[10px] text-slate-500 mb-2 border-l-2 border-slate-700 pl-2 space-y-0.5">
                        {s.sample_subjects.slice(0, 3).map((ss, i) => (
                          <div key={i} className="truncate italic">"{ss}"</div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button data-testid={`suggestion-apply-${s.id}`} onClick={() => apply.mutate(s.id)}
                              className="text-[11px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30">
                        Onayla
                      </button>
                      <button data-testid={`suggestion-reject-${s.id}`} onClick={() => reject.mutate(s.id)}
                              className="text-[11px] px-2 py-1 rounded bg-rose-500/10 text-rose-300 border border-rose-500/40 hover:bg-rose-500/20">
                        Reddet
                      </button>
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && (
                <div className="text-slate-500 text-center py-8 text-sm">
                  AI önerisi yok — <span className="text-fuchsia-300">Öz-eğitim</span> veya <span className="text-cyan-300">Karantinayı Tara</span> çalıştır
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
      <div className="col-span-12">
        <div className="border border-indigo-500/20 bg-indigo-500/5 rounded-md p-3 text-xs">
          <div className="text-indigo-300 font-semibold flex items-center gap-1 mb-1"><Info className="w-3.5 h-3.5"/>Sistem-Genelinde Otomatik AI</div>
          <ul className="list-disc list-inside space-y-0.5 text-slate-400">
            <li>Her saat başı background job: son 1 saatteki high_spam/clean mailleri Bayes'e besler</li>
            <li>5+ spam örnek biriktiğinde Claude LLM yeni SA regex kuralı önerir (subject pattern)</li>
            <li><span className="text-cyan-300">🔎 Karantinayı Tara</span>: son 7 gün karantina kayıtlarından gönderen domain, TLD ve konu kelime kalıplarını yerel istatistikle çıkarır (LLM'siz, ücretsiz)</li>
            <li>Öneriler bu tab'da görünür — otomatik apply değil, sen onaylarsın (güvenlik)</li>
            <li>AI Batch Prewarm: yüksek riskli mailler için "Neden spam?" açıklaması ingest sırasında üretilip cache'lenir</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
