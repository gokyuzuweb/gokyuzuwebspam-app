import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import {
  Bug, ShieldAlert, MailX, Beaker, KeyRound, UserX, Inbox, ArrowUpRight,
  Link, Brain, Server, ShieldCheck, Play, XCircle, AlertTriangle,
} from "lucide-react";
import CountryBlockCard from "@/components/CountryBlockCard";
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
  const [tab, setTab] = useState("overview");
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
          {["overview", "exploit", "bec", "sandbox", "reputation", "geo"].map(k => (
            <button key={k} data-testid={`sec-tab-${k}`} onClick={() => setTab(k)}
                    className={`text-xs px-3 py-1.5 rounded transition-colors
                    ${tab === k ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400 hover:text-slate-100"}`}>
              {{overview: "Genel", exploit: "Exploit", bec: "BEC", sandbox: "Sandbox", reputation: "Reputation", geo: "Coğrafi"}[k]}
            </button>
          ))}
        </div>
      </div>

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

      {tab === "exploit" && (
        <>
          <Card>
            <CardHeader
              title="Exploit / Webshell Tarayıcı"
              subtitle="/var/www altında shell/eval/base64/backdoor imzaları · bulguya tıkla → detay"
              right={
                <button data-testid="run-exploit-scan" disabled={runScan.isPending} onClick={() => runScan.mutate()}
                        className="text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
                  <Play className="w-3 h-3 inline mr-1"/>{runScan.isPending ? "Taranıyor…" : "Tara"}
                </button>
              }
            />
            <CardBody>
              <div className="grid grid-cols-4 gap-3 mb-4">
                <Stat label="Son Tarama" value={(latest.data?.created_at || "-").slice(0, 16)} tone="text-slate-300"/>
                <Stat label="Kritik" value={latest.data?.critical ?? 0} tone="text-rose-400"/>
                <Stat label="Yüksek"  value={latest.data?.high ?? 0} tone="text-amber-400"/>
                <Stat label="Tarandı" value={latest.data?.scanned_files ?? 0} tone="text-slate-300"/>
              </div>
              <div className="space-y-2">
                {(findings.data?.items || []).map((f) => {
                  const isOpen = expandedFinding === f.id;
                  return (
                    <div key={f.id} data-testid={`finding-${f.id}`}
                         className={`border rounded-md overflow-hidden
                          ${f.severity === "critical" ? "border-rose-500/40 bg-rose-500/5" :
                            f.severity === "high" ? "border-amber-500/40 bg-amber-500/5" :
                            "border-slate-700 bg-slate-800/30"}`}>
                      <div className="p-3 flex items-start gap-3">
                        <button data-testid={`finding-toggle-${f.id}`} onClick={() => setExpandedFinding(isOpen ? null : f.id)}
                                className="text-slate-400 hover:text-slate-100 shrink-0">
                          <AlertTriangle className={`w-4 h-4 ${
                            f.severity === "critical" ? "text-rose-400" :
                            f.severity === "high" ? "text-amber-400" : "text-slate-400"}`}/>
                        </button>
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedFinding(isOpen ? null : f.id)}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-slate-100 mono truncate">{f.file_path}:{f.line}</span>
                            <Badge tone={f.severity === "critical" ? "danger" : f.severity === "high" ? "warning" : "default"}>{f.severity}</Badge>
                            <span className="text-[10px] mono text-slate-500">{f.signature} · {f.category}</span>
                            <span className="text-[10px] text-slate-400 ml-auto">{isOpen ? "▲ kapat" : "▼ detay"}</span>
                          </div>
                          {f.snippet && !isOpen && (
                            <div className="text-[11px] mono text-slate-400 mt-1 bg-slate-950 p-2 rounded truncate">{f.snippet}</div>
                          )}
                        </div>
                        <button onClick={() => dismiss.mutate(f.id)} title="Kapat"
                                data-testid={`dismiss-${f.id}`}
                                className="text-slate-500 hover:text-slate-100"><XCircle className="w-4 h-4"/></button>
                      </div>
                      {isOpen && (
                        <div className="border-t border-slate-700 bg-slate-950/60 p-4 space-y-3">
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <KV k="Dosya" v={f.file_path}/>
                            <KV k="Satır" v={f.line}/>
                            <KV k="İmza" v={f.signature}/>
                            <KV k="Kategori" v={f.category}/>
                            <KV k="Ciddiyet" v={f.severity}/>
                            <KV k="Bulundu" v={(f.created_at || "").slice(0, 19).replace("T", " ")}/>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Kod Örneği</div>
                            <pre className="text-[11px] mono text-rose-300 bg-slate-950 border border-slate-800 rounded p-3 overflow-x-auto whitespace-pre-wrap">{f.snippet}</pre>
                          </div>
                          <div className="text-[11px] text-slate-400 space-y-1">
                            <div className="text-slate-300 font-semibold text-xs">Öneriler:</div>
                            {f.severity === "critical" && <div>🚨 Dosyayı hemen sil veya karantinaya al; sunucuyu izole edip erişim logları incelenmeli.</div>}
                            {f.severity === "high" && <div>⚠️ Input validation ekleyin, `eval/system/passthru` fonksiyonlarını kaldırın.</div>}
                            {f.severity === "medium" && <div>ℹ️ Kodu gözden geçirin — obfuscated/karmaşık ifade meşru olabilir ama şüpheli.</div>}
                            <div>🔒 WHM'de dosya sahibi ve izinleri kontrol edin (ls -la {f.file_path})</div>
                            <div>📋 <a href={`https://owasp.org/www-community/attacks/${f.category}`} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">OWASP {f.category}</a> dokümanına bakın</div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {(findings.data?.items || []).length === 0 && (
                  <div className="text-center py-8 text-sm text-slate-500">Bulgu yok — sistem temiz görünüyor</div>
                )}
              </div>
            </CardBody>
          </Card>
          <ModuleFooter
            title="Exploit / Webshell Scanner — Nasıl Çalışır?"
            howItWorks="/var/www altındaki tüm PHP dosyaları 10 farklı imza (eval+base64, gzinflate, assert+POST, system(input), preg_replace/e, c99shell, obfuscated PHP...) için regex ile taranır. WHM daemonu heartbeat'te sonuçları push eder."
            technical={[
              "10 imza kategorisi: webshell / backdoor / rce / obfuscation / downloader",
              "Perl daemon (whm-plugin/scripts/) 30 dk'da bir tarar",
              "SaaS panel: POST /api/security/exploit-scan/submit endpoint",
              "Manuel: /api/security/exploit-scan/run (preview'da 3 demo finding)",
              "Findings persistent · dismiss ile kapatılabilir",
            ]}
            recommendations={[
              "Kritik bulguyu 24 saat içinde çöz",
              "Dosya bütünlüğü izleme (AIDE/Tripwire) ile eş çalıştır",
              "WAF (ModSecurity) ile ikinci savunma katmanı",
              "Bulgu görülünce alert kuralı ekle (webhook Slack)",
            ]}
          />
        </>
      )}

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
