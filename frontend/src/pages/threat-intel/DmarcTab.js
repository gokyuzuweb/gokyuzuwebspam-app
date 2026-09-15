// v44.00.37 — Extracted from ThreatIntel.js
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, client } from "@/lib/api";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { RefreshCw, X, AlertTriangle, Loader2, Zap, FileCheck2, Mail } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

export function DmarcTab() {
  const qc = useQueryClient();
  // v44.00.29 — Sunucudaki (hosted) domain'lere filtrele + kapatma toggle
  const lk = () => (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) || "";
  const [onlyHosted, setOnlyHosted] = useState(true);
  const q = useQuery({
    queryKey: ["dmarc-summary", onlyHosted],
    queryFn: () => api.tiDmarcSummary(30, lk(), onlyHosted),
  });
  const seed = useMutation({
    mutationFn: () => api.tiDmarcSeedDemo(),
    onSuccess: (d) => { toast.success(`+${d.seeded} demo rapor eklendi (${d.domains} domain)`); qc.invalidateQueries({ queryKey: ["dmarc-summary"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const domains = q.data?.domains || [];
  const hostedCount = q.data?.hosted_count;
  const missing = q.data?.hosted_without_reports || [];
  const filtered = q.data?.filtered;
  const [drillDomain, setDrillDomain] = useState(null);
  const [wizardDomain, setWizardDomain] = useState(null);  // v44.00.35
  return (
    <Card>
      <CardHeader
        title="DMARC Aggregate Raporlar"
        subtitle={filtered
          ? `Sunucundaki ${hostedCount || 0} hosted domain · Son 30 gün agregat özet`
          : "Son 30 gün · Alıcı ISP'lerden gelen aggregate XML rapor özetleri"}
        right={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
              <input type="checkbox" checked={onlyHosted} onChange={e => setOnlyHosted(e.target.checked)}
                     data-testid="dmarc-only-hosted"
                     className="rounded border-slate-600 bg-slate-950" />
              Sadece sunucumdaki domain'ler
            </label>
            <Badge tone="info">{domains.length} domain</Badge>
          </div>
        }
      />
      <CardBody>
        {/* v44.00.30 — DMARC Dashboard: KPI ve kapsam metrikleri */}
        <DmarcDashboard domains={domains} hostedCount={hostedCount} missing={missing} filtered={filtered} />

        {/* v44.00.29 — Hosted ama DMARC raporu olmayan domain'ler için uyarı */}
        {filtered && missing.length > 0 && (
          <div className="mb-3 bg-amber-500/5 border border-amber-500/30 rounded p-3 text-xs">
            <div className="text-amber-300 font-semibold mb-1.5 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              DMARC Kaydı Olmayan {missing.length} Hosted Domain
            </div>
            <div className="text-slate-400 mb-2">
              Aşağıdaki domain'ler sunucunda mail gönderiyor ama DMARC raporu ALMIYOR — bu, DMARC/SPF/DKIM'in kurulmadığı ya da <span className="mono">rua=</span> adresinin yanlış tanımlandığı anlamına gelir. Bu domain'ler spoof'a açıktır. <b className="text-amber-200">Domain'e tıklayınca kopyala-yapıştırılabilir DNS record'ları görüntülenir.</b>
            </div>
            <div className="flex flex-wrap gap-1">
              {missing.slice(0, 15).map(d => (
                <button
                  key={d}
                  onClick={() => setWizardDomain(d)}
                  data-testid={`dmarc-wizard-open-${d}`}
                  className="mono text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-amber-500/30 text-amber-200 hover:bg-amber-500/20 hover:border-amber-500/60 transition cursor-pointer">
                  {d}
                </button>
              ))}
              {missing.length > 15 && <span className="text-[10px] text-slate-500">+{missing.length - 15} daha</span>}
            </div>
          </div>
        )}
        {wizardDomain && (
          <DmarcSetupWizard domain={wizardDomain} onClose={() => setWizardDomain(null)} />
        )}
        {domains.length === 0 ? (
          <div className="text-center py-10" data-testid="dmarc-empty">
            <FileCheck2 className="w-10 h-10 mx-auto text-slate-600 mb-3"/>
            <p className="text-sm text-slate-400">Henüz DMARC raporu alınmadı</p>
            <p className="text-xs text-slate-500 mt-1">DMARC rua= adresinizi <span className="mono text-indigo-400">mailto:dmarc@sizindomain.com</span> olarak ayarlayın</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                data-testid="dmarc-seed-demo"
                onClick={() => seed.mutate()}
                disabled={seed.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20 text-xs disabled:opacity-40">
                <Zap className="w-3.5 h-3.5" />
                {seed.isPending ? "Yükleniyor…" : "Demo Rapor Yükle (5 domain × 45 rapor)"}
              </button>
            </div>
            <p className="text-[10px] text-slate-600 mt-2">
              Demo veri, DMARC dashboard'unuzun nasıl görüneceğini önizlemek içindir. Gerçek raporlar geldiğinde otomatik gösterilir.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-3 py-1.5">Domain</th>
                <th className="text-right px-3 py-1.5">Raporlar</th>
                <th className="text-right px-3 py-1.5">Toplam Mail</th>
                <th className="text-right px-3 py-1.5">SPF</th>
                <th className="text-right px-3 py-1.5">DKIM</th>
                <th className="text-right px-3 py-1.5">DMARC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {domains.map(d => (
                <tr key={d.domain} data-testid={`dmarc-row-${d.domain}`}
                    onClick={() => setDrillDomain(d.domain)}
                    className="hover:bg-indigo-500/10 cursor-pointer transition-colors">
                  <td className="px-3 py-2 mono text-slate-100">
                    <span className="text-indigo-400 mr-1">▸</span>{d.domain}
                  </td>
                  <td className="px-3 py-2 text-right mono">{d.reports}</td>
                  <td className="px-3 py-2 text-right mono text-slate-300">{d.total_msgs.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right mono ${d.spf_pct >= 90 ? "text-emerald-300" : "text-amber-300"}`}>%{d.spf_pct}</td>
                  <td className={`px-3 py-2 text-right mono ${d.dkim_pct >= 90 ? "text-emerald-300" : "text-amber-300"}`}>%{d.dkim_pct}</td>
                  <td className={`px-3 py-2 text-right mono ${d.dmarc_pct >= 90 ? "text-emerald-300" : d.dmarc_pct >= 70 ? "text-amber-300" : "text-rose-300"}`}>%{d.dmarc_pct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
      {/* v44.00.25 — DMARC Domain Detail Drawer */}
      {drillDomain && <DmarcDomainDrill domain={drillDomain} onClose={() => setDrillDomain(null)} />}
    </Card>
  );
}

// v44.00.30 — DMARC Dashboard KPI'ları
function DmarcDashboard({ domains, hostedCount, missing, filtered }) {
  const totalMsgs = domains.reduce((s, d) => s + (d.total_msgs || 0), 0);
  const totalReports = domains.reduce((s, d) => s + (d.reports || 0), 0);
  const passWeighted = domains.reduce((s, d) => s + (d.total_msgs * d.dmarc_pct / 100), 0);
  const avgPassPct = totalMsgs > 0 ? Math.round(passWeighted / totalMsgs * 10) / 10 : 0;
  const failCount = totalMsgs - passWeighted;
  const totalHosted = filtered ? (hostedCount || 0) : domains.length;
  const covered = domains.length;
  const coveragePct = totalHosted > 0 ? Math.round(covered / totalHosted * 100) : 0;
  // En riskli 3 domain (en düşük DMARC pass %)
  const risky = [...domains]
    .filter(d => d.total_msgs >= 50)
    .sort((a, b) => a.dmarc_pct - b.dmarc_pct)
    .slice(0, 3);
  // En sağlıklı 3 domain
  const healthy = [...domains]
    .filter(d => d.total_msgs >= 50)
    .sort((a, b) => b.dmarc_pct - a.dmarc_pct)
    .slice(0, 3);

  const kpi = (label, val, sub, tone = "text-slate-100", icon = null) => (
    <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1">{icon}{label}</div>
      <div className={`mono text-2xl ${tone} mt-0.5`}>{val}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );

  if (domains.length === 0 && (missing?.length || 0) === 0) return null;

  return (
    <div className="mb-4 space-y-3" data-testid="dmarc-dashboard">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {filtered && kpi("Hosted Domain", totalHosted.toLocaleString("tr-TR"), "sunucunda barınan", "text-indigo-300", "🌐")}
        {kpi("DMARC Var", covered.toLocaleString("tr-TR"), filtered ? `%${coveragePct} kapsam` : "raporlu domain", "text-emerald-300", "✓")}
        {filtered && missing?.length > 0 && kpi("Rapor Yok", missing.length.toLocaleString("tr-TR"), "spoof riski", "text-rose-300", "⚠")}
        {kpi("Toplam Rapor", totalReports.toLocaleString("tr-TR"), "30 gün agregat", "text-cyan-300", "📄")}
        {kpi("Analiz Edilen Mail", totalMsgs.toLocaleString("tr-TR"), "toplam mesaj", "text-slate-100", "📬")}
        {kpi("Ort. DMARC Pass", `%${avgPassPct}`,
              avgPassPct >= 90 ? "harika" : avgPassPct >= 70 ? "iyileştir" : "kritik",
              avgPassPct >= 90 ? "text-emerald-300" : avgPassPct >= 70 ? "text-amber-300" : "text-rose-300", "🎯")}
        {failCount > 0 && kpi("Fail Mesaj", Math.round(failCount).toLocaleString("tr-TR"), "başarısız", "text-rose-300", "✕")}
      </div>

      {/* Kapsam Progress Bar */}
      {filtered && totalHosted > 0 && (
        <div className="p-2 bg-slate-950/40 border border-slate-800 rounded">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-slate-300">DMARC Kapsam Oranı</span>
            <span className={`mono ${coveragePct >= 80 ? "text-emerald-300" : coveragePct >= 40 ? "text-amber-300" : "text-rose-300"}`}>
              {covered} / {totalHosted} domain · %{coveragePct}
            </span>
          </div>
          <div className="h-2 bg-slate-900 rounded overflow-hidden">
            <div className={`h-full transition-all ${coveragePct >= 80 ? "bg-emerald-500" : coveragePct >= 40 ? "bg-amber-500" : "bg-rose-500"}`}
                 style={{ width: `${coveragePct}%` }} />
          </div>
        </div>
      )}

      {/* Top Risky + Top Healthy */}
      {(risky.length > 0 || healthy.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {risky.length > 0 && (
            <div className="p-2.5 rounded border border-rose-500/20 bg-rose-500/5">
              <div className="text-[10px] uppercase text-rose-300 mb-1.5 font-semibold flex items-center gap-1">
                ⚠ En Riskli Domain'ler (düşük DMARC pass)
              </div>
              <div className="space-y-1">
                {risky.map(d => (
                  <div key={d.domain} className="flex items-center gap-2 text-[11px]">
                    <span className="mono text-slate-200 flex-1 truncate">{d.domain}</span>
                    <span className="mono text-slate-500">{d.total_msgs.toLocaleString("tr-TR")} mail</span>
                    <span className="mono text-rose-300 font-bold w-12 text-right">%{d.dmarc_pct}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {healthy.length > 0 && (
            <div className="p-2.5 rounded border border-emerald-500/20 bg-emerald-500/5">
              <div className="text-[10px] uppercase text-emerald-300 mb-1.5 font-semibold flex items-center gap-1">
                ✓ En Sağlıklı Domain'ler (yüksek DMARC pass)
              </div>
              <div className="space-y-1">
                {healthy.map(d => (
                  <div key={d.domain} className="flex items-center gap-2 text-[11px]">
                    <span className="mono text-slate-200 flex-1 truncate">{d.domain}</span>
                    <span className="mono text-slate-500">{d.total_msgs.toLocaleString("tr-TR")} mail</span>
                    <span className="mono text-emerald-300 font-bold w-12 text-right">%{d.dmarc_pct}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// v44.00.25 — DMARC per-domain breakdown drawer
function DmarcDomainDrill({ domain, onClose }) {
  const q = useQuery({
    queryKey: ["dmarc-domain", domain],
    queryFn: () => client.get(`/threat-intel/dmarc/domain/${domain}?days=180`).then(r => r.data),
    enabled: !!domain,
  });
  const d = q.data;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={onClose} data-testid="dmarc-drill">
      <div className="bg-slate-950 border border-slate-800 rounded-lg max-w-4xl w-full max-h-[85vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-950">
          <div>
            <h3 className="text-lg font-bold text-slate-100 mono">{domain}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Son 180 gün DMARC breakdown</p>
          </div>
          <button onClick={onClose} data-testid="dmarc-drill-close"
                  className="p-2 rounded hover:bg-slate-800 text-slate-400"><X className="w-4 h-4"/></button>
        </div>
        {q.isLoading ? (
          <div className="p-10 text-center text-slate-500 text-sm">Yükleniyor…</div>
        ) : !d || d.count === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">Bu domain için rapor yok</div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded p-3">
                <div className="text-[10px] uppercase text-slate-500">Rapor Sayısı</div>
                <div className="mono text-2xl text-slate-100">{d.count}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded p-3">
                <div className="text-[10px] uppercase text-slate-500">Toplam Mail</div>
                <div className="mono text-2xl text-slate-100">{d.total_msgs.toLocaleString()}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded p-3">
                <div className="text-[10px] uppercase text-slate-500">DMARC Pass</div>
                <div className={`mono text-2xl ${d.dmarc_pass_pct >= 90 ? "text-emerald-300" : d.dmarc_pass_pct >= 70 ? "text-amber-300" : "text-rose-300"}`}>
                  %{d.dmarc_pass_pct}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded p-3">
                <div className="text-[10px] uppercase text-slate-500">Org Sayısı</div>
                <div className="mono text-2xl text-slate-100">{d.per_org?.length || 0}</div>
              </div>
            </div>

            {/* Reporting Orgs */}
            <div>
              <h4 className="text-sm font-semibold text-indigo-300 mb-2">Reporting Organizations</h4>
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase text-slate-500 border-b border-slate-800">
                  <tr>
                    <th className="text-left py-2 pr-2">ISP / Org</th>
                    <th className="text-right py-2 pr-2">Rapor</th>
                    <th className="text-right py-2 pr-2">Mesaj</th>
                    <th className="text-right py-2 pr-2">Pass</th>
                    <th className="text-right py-2 pr-2">Fail</th>
                    <th className="text-right py-2 pr-2">Oran</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {(d.per_org || []).map((o) => {
                    const pct = o.msgs > 0 ? Math.round((o.pass / o.msgs) * 100) : 0;
                    return (
                      <tr key={o.org} className="hover:bg-slate-900/40">
                        <td className="py-2 pr-2 text-slate-200">{o.org}</td>
                        <td className="py-2 pr-2 text-right mono text-slate-300">{o.reports}</td>
                        <td className="py-2 pr-2 text-right mono text-slate-300">{o.msgs.toLocaleString()}</td>
                        <td className="py-2 pr-2 text-right mono text-emerald-300">{o.pass.toLocaleString()}</td>
                        <td className="py-2 pr-2 text-right mono text-rose-300">{o.fail.toLocaleString()}</td>
                        <td className={`py-2 pr-2 text-right mono ${pct >= 90 ? "text-emerald-300" : pct >= 70 ? "text-amber-300" : "text-rose-300"}`}>%{pct}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Daily Trend */}
            {(d.per_day || []).length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-indigo-300 mb-2">Günlük Trend</h4>
                <div className="h-40">
                  <ResponsiveContainer>
                    <LineChart data={d.per_day}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false}/>
                      <XAxis dataKey="date" stroke="#475569" tick={{ fontSize: 10 }}/>
                      <YAxis stroke="#475569" tick={{ fontSize: 10 }}/>
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, fontSize: 11 }}/>
                      <Legend wrapperStyle={{ fontSize: 10 }}/>
                      <Line type="monotone" dataKey="pass" stroke="#10b981" strokeWidth={2} dot={false} name="Pass"/>
                      <Line type="monotone" dataKey="fail" stroke="#f43f5e" strokeWidth={2} dot={false} name="Fail"/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Failing IPs */}
            {(d.failing_ips || []).length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-rose-300 mb-2">En Sık Başarısız Kaynak IP'ler</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {d.failing_ips.map((f) => (
                    <div key={f.ip} className="bg-slate-900 border border-rose-500/20 rounded p-2 text-xs mono flex items-center justify-between">
                      <span className="text-slate-200">{f.ip}</span>
                      <span className="text-rose-300 font-bold">{f.count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// v44.00.35 — DMARC Setup Wizard: copy-paste DNS records + v44.00.36 canlı DNS doğrulama
function DmarcSetupWizard({ domain, onClose }) {
  const spfValue = "v=spf1 +a +mx +ip4:0.0.0.0/0 include:_spf.google.com -all"; // placeholder for user to customize
  const spfValueSimple = "v=spf1 +a +mx ~all";
  const dkimHost = "default._domainkey";
  const dkimNote = "DKIM anahtarınızı cPanel → Email Deliverability sayfasından oluşturup public key'i buraya girin.";
  const dmarcHost = "_dmarc";
  const dmarcValueStrict = `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; ruf=mailto:dmarc@${domain}; fo=1; pct=100; adkim=s; aspf=s`;
  const dmarcValueGentle = `v=DMARC1; p=none; rua=mailto:dmarc@${domain}; pct=100`;

  const [tab, setTab] = useState("dmarc");
  const copy = (v, label) => {
    navigator.clipboard.writeText(v).then(() => toast.success(`${label} kopyalandı`));
  };

  // v44.00.36 — Live DNS verification
  const verify = useMutation({
    mutationFn: async () => (await client.get(`/ai/dmarc-verify?domain=${encodeURIComponent(domain)}`)).data,
    onError: (e) => toast.error("DNS kontrolü başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
         onClick={(e) => e.target === e.currentTarget && onClose()}
         data-testid="dmarc-wizard">
      <div className="bg-slate-950 border border-slate-800 rounded-lg max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 bg-gradient-to-r from-amber-900/20 to-rose-900/20">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <div className="flex-1">
            <div className="text-sm font-bold text-amber-200">DMARC Kurulum Sihirbazı</div>
            <div className="text-[11px] text-slate-500 mono">{domain} — Kopyala-Yapıştır DNS Kayıtları</div>
          </div>
          {/* v44.00.36 — DNS'i Şimdi Kontrol Et */}
          <button
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
            data-testid="dmarc-wizard-verify"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-semibold disabled:opacity-50">
            {verify.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Sorgulanıyor…</>
                              : <>🔍 DNS'i Şimdi Kontrol Et</>}
          </button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
                  data-testid="dmarc-wizard-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {verify.data && (
          <div data-testid="dmarc-verify-result" className={`px-5 py-2.5 border-b border-slate-800 text-xs ${
            verify.data.all_ok ? "bg-emerald-500/10" : "bg-rose-500/5"
          }`}>
            <div className="flex items-center gap-4 flex-wrap mono">
              <span className={verify.data.spf.present ? "text-emerald-300" : "text-rose-300"}>
                {verify.data.spf.present ? "✓" : "✕"} SPF{verify.data.spf.policy ? ` (${verify.data.spf.policy})` : ""}
              </span>
              <span className={verify.data.dkim.present ? "text-emerald-300" : "text-rose-300"}>
                {verify.data.dkim.present ? "✓" : "✕"} DKIM (default)
              </span>
              <span className={verify.data.dmarc.present ? "text-emerald-300" : "text-rose-300"}>
                {verify.data.dmarc.present ? "✓" : "✕"} DMARC{verify.data.dmarc.policy ? ` (p=${verify.data.dmarc.policy})` : ""}
              </span>
              <span className="text-slate-500 ml-auto">
                {new Date(verify.data.checked_at).toLocaleTimeString("tr-TR")}
              </span>
            </div>
            {!verify.data.all_ok && (
              <div className="mt-1.5 text-[11px] text-amber-300">
                {[verify.data.spf.issue, verify.data.dkim.issue, verify.data.dmarc.issue]
                  .filter(Boolean).map((i, idx) => <div key={idx}>⚠ {i}</div>)}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-1 border-b border-slate-800 px-5">
          {[
            { k: "spf",   label: "1. SPF",   color: "emerald" },
            { k: "dkim",  label: "2. DKIM",  color: "sky" },
            { k: "dmarc", label: "3. DMARC", color: "amber" },
          ].map(t => (
            <button key={t.k}
              onClick={() => setTab(t.k)}
              data-testid={`dmarc-wizard-tab-${t.k}`}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
                tab === t.k ? `border-${t.color}-500 text-${t.color}-300` : "border-transparent text-slate-400 hover:text-slate-100"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === "spf" && (
            <>
              <p className="text-xs text-slate-300">
                <b className="text-emerald-300">SPF</b> (Sender Policy Framework), sunucundan mail göndermeye YETKİLİ IP/host'ları tanımlar.
                Aşağıdaki kaydı <span className="mono text-indigo-300">TXT</span> olarak DNS Zone'una ekle:
              </p>
              <DnsRecord label="Ad" value={spfHost} copy={copy} />
              <DnsRecord label="Tip" value="TXT" copy={copy} />
              <DnsRecord label="Değer (Basit — sadece sunucun)" value={spfValueSimple} copy={copy} multiline />
              <details className="text-xs text-slate-400">
                <summary className="cursor-pointer text-slate-300">Google Workspace de kullanıyorsan (gelişmiş)</summary>
                <DnsRecord label="Değer" value={spfValue.replace("+ip4:0.0.0.0/0 ", "")} copy={copy} multiline />
              </details>
              <div className="p-2.5 bg-slate-900 border border-slate-800 rounded text-[11px] text-slate-400">
                <b className="text-slate-200">Not:</b> <span className="mono">~all</span> yerine <span className="mono">-all</span> koyarsan
                yetkisiz göndericilerin mail'i reddedilir (daha katı, ama önce log'unu izle).
              </div>
            </>
          )}
          {tab === "dkim" && (
            <>
              <p className="text-xs text-slate-300">
                <b className="text-sky-300">DKIM</b> gönderilen mail'i cryptographic imza ile doğrular. cPanel'de:
              </p>
              <div className="p-3 bg-slate-900 border border-slate-800 rounded text-xs text-slate-300 space-y-1.5">
                <div>1. cPanel → <span className="mono text-sky-300">Email Deliverability</span></div>
                <div>2. <span className="mono">{domain}</span> için "Manage" &gt; DKIM "Install the Suggested Record"</div>
                <div>3. Public key otomatik olarak <span className="mono">default._domainkey.{domain}</span> TXT'ine yazılır</div>
              </div>
              <DnsRecord label="Ad" value={dkimHost} copy={copy} />
              <DnsRecord label="Tip" value="TXT" copy={copy} />
              <div className="p-2.5 bg-amber-500/5 border border-amber-500/30 rounded text-[11px] text-amber-200">
                {dkimNote}
              </div>
            </>
          )}
          {tab === "dmarc" && (
            <>
              <p className="text-xs text-slate-300">
                <b className="text-amber-300">DMARC</b>, SPF+DKIM sonucuna göre alıcı ISP'lere ne yapacaklarını söyler ve rapor gönderir.
                Aşağıdaki 2 şablondan birini seç:
              </p>
              <div className="p-3 border border-emerald-500/30 bg-emerald-500/5 rounded space-y-2">
                <div className="text-emerald-300 font-semibold text-xs">🟢 Başlangıç (Sadece İzle, Bloklamaz)</div>
                <DnsRecord label="Ad" value={dmarcHost} copy={copy} compact />
                <DnsRecord label="Tip" value="TXT" copy={copy} compact />
                <DnsRecord label="Değer" value={dmarcValueGentle} copy={copy} multiline highlight="emerald" />
                <p className="text-[11px] text-slate-400">
                  <span className="mono">p=none</span> → hiçbir mail reddedilmez, sadece rapor toplanır (2-4 hafta izleyin).
                </p>
              </div>
              <div className="p-3 border border-rose-500/30 bg-rose-500/5 rounded space-y-2">
                <div className="text-rose-300 font-semibold text-xs">🔴 Katı Politika (Karantina/Reject)</div>
                <DnsRecord label="Ad" value={dmarcHost} copy={copy} compact />
                <DnsRecord label="Tip" value="TXT" copy={copy} compact />
                <DnsRecord label="Değer" value={dmarcValueStrict} copy={copy} multiline highlight="rose" />
                <p className="text-[11px] text-slate-400">
                  <span className="mono">p=quarantine</span> → SPF/DKIM fail olan mail'ler alıcının spam kutusuna düşer. Test ettikten sonra <span className="mono">p=reject</span>'e geçirin.
                </p>
              </div>
              <div className="p-2.5 bg-slate-900 border border-slate-800 rounded text-[11px] text-slate-400 leading-relaxed">
                <b className="text-slate-200">📊 Rapor toplama:</b> DMARC ISP'lerden agregat rapor almak için <span className="mono">dmarc@{domain}</span> mail hesabını oluşturmanız gerekir.
                Bu hesap raporları otomatik alacak ve GökyüzüWebSpam DMARC dashboard'unda görüntülenecektir.
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            DNS değişiklikleri 5-60 dakika içinde etkin olur. Sonra <a href="https://dmarcian.com/dmarc-inspector/" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">dmarcian.com/dmarc-inspector</a> ile doğrulayın.
          </span>
          <button onClick={onClose}
            className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
            data-testid="dmarc-wizard-done">
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}

function DnsRecord({ label, value, copy, multiline, compact, highlight }) {
  const highlightBg = highlight === "emerald" ? "border-emerald-500/40 bg-emerald-500/5" :
                      highlight === "rose"    ? "border-rose-500/40 bg-rose-500/5" :
                      "border-slate-800 bg-slate-950";
  return (
    <div className={`flex items-start gap-2 ${compact ? "py-0.5" : ""}`}>
      <span className="text-[10px] uppercase text-slate-500 mono w-14 shrink-0 pt-1.5">{label}</span>
      <div className={`flex-1 flex items-start gap-2 ${highlightBg} border rounded px-2 py-1.5 min-w-0`}>
        <code className={`flex-1 mono text-xs ${multiline ? "break-all" : "truncate"} text-slate-100`}>{value}</code>
        <button onClick={() => copy(value, label)}
          className="shrink-0 p-1 rounded hover:bg-slate-800 text-indigo-300 hover:text-indigo-100"
          title="Kopyala">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

