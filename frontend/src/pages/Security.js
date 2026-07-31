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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="modules-grid">
          {(modules.data?.modules || []).map((m) => {
            const Icon = ICONS[m.icon] || ShieldCheck;
            const tone = STATUS_TONE[m.status] || STATUS_TONE.off;
            return (
              <div key={m.key} data-testid={`module-${m.key}`} className={`border rounded-lg p-4 ${tone} transition-all hover:-translate-y-0.5`}>
                <div className="flex items-start justify-between">
                  <Icon className="w-5 h-5 opacity-80"/>
                  <span className="text-[10px] mono uppercase tracking-widest opacity-75">{m.status}</span>
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-100">{m.label}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{m.detail}</div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "exploit" && (
        <Card>
          <CardHeader
            title="Exploit / Webshell Tarayıcı"
            subtitle="/var/www altında shell/eval/base64/backdoor imzaları"
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
              {(findings.data?.items || []).map((f) => (
                <div key={f.id} data-testid={`finding-${f.id}`}
                     className={`border rounded-md p-3 flex items-start gap-3
                      ${f.severity === "critical" ? "border-rose-500/40 bg-rose-500/5" :
                        f.severity === "high" ? "border-amber-500/40 bg-amber-500/5" :
                        "border-slate-700 bg-slate-800/30"}`}>
                  <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${
                    f.severity === "critical" ? "text-rose-400" :
                    f.severity === "high" ? "text-amber-400" : "text-slate-400"}`}/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-100 mono truncate">{f.file_path}:{f.line}</span>
                      <Badge tone={f.severity === "critical" ? "danger" : f.severity === "high" ? "warning" : "default"}>{f.severity}</Badge>
                      <span className="text-[10px] mono text-slate-500">{f.signature} · {f.category}</span>
                    </div>
                    {f.snippet && <div className="text-[11px] mono text-slate-400 mt-1 bg-slate-950 p-2 rounded truncate">{f.snippet}</div>}
                  </div>
                  <button onClick={() => dismiss.mutate(f.id)} title="Kapat"
                          data-testid={`dismiss-${f.id}`}
                          className="text-slate-500 hover:text-slate-100"><XCircle className="w-4 h-4"/></button>
                </div>
              ))}
              {(findings.data?.items || []).length === 0 && (
                <div className="text-center py-8 text-sm text-slate-500">Bulgu yok — sistem temiz görünüyor</div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {tab === "bec" && <BecTester onCheck={(p) => bec.mutate(p)} result={bec.data} pending={bec.isPending}/>}

      {tab === "sandbox" && (
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
      )}

      {tab === "reputation" && (
        <Card>
          <CardHeader title="IP Reputation" subtitle="Spamhaus · UCEPROTECT durum kontrolü"/>
          <CardBody>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <Stat label="IP" value={reputation.data?.ip || "-"} tone="text-slate-300"/>
              <Stat label="Skor" value={reputation.data?.score ?? "-"} tone={reputation.data?.score > 70 ? "text-emerald-300" : "text-amber-300"}/>
              <Stat label="Listed" value={(reputation.data?.listed || []).length} tone={(reputation.data?.listed || []).length ? "text-rose-300" : "text-emerald-300"}/>
              <Stat label="Spam 24s" value={reputation.data?.outbound_spam_24h ?? 0} tone="text-slate-300"/>
            </div>
            {(reputation.data?.listed || []).length > 0 && (
              <div className="space-y-1">
                {reputation.data.listed.map((l, i) => (
                  <div key={i} className="text-xs mono border border-rose-500/40 bg-rose-500/5 text-rose-300 rounded p-2">
                    {l.list} · {l.reason}
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "geo" && <CountryBlockCard/>}
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
