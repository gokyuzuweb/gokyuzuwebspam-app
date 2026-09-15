import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, client } from "@/lib/api";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import {
  Globe, Radar, ShieldCheck, FileCheck2, RefreshCw, Plus, X, Zap,
  AlertTriangle, TrendingUp, Award, ChevronDown, ChevronRight, Mail, Loader2,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import ModuleFooter from "@/components/ModuleFooter";

export default function ThreatIntel() {
  const [tab, setTab] = useState("ioc");
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <Globe className="w-5 h-5 text-indigo-400"/> Global Tehdit Zekası
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">IOC feed · DMARC agregat · Global Blocklist Sync · Uyumluluk Skoru</p>
        </div>
        <div className="flex gap-1 bg-slate-800/50 rounded p-1">
          {[
            { k: "ioc", l: "IOC Feed", i: Radar },
            { k: "dmarc", l: "DMARC", i: FileCheck2 },
            { k: "feeds", l: "Global Feeds", i: RefreshCw },
            { k: "usom", l: "USOM (TR)", i: AlertTriangle },
            { k: "compliance", l: "Uyumluluk", i: ShieldCheck },
          ].map(({ k, l, i: Icon }) => (
            <button key={k} data-testid={`ti-tab-${k}`} onClick={() => setTab(k)}
                    className={`text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1
                    ${tab === k ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400 hover:text-slate-100"}`}>
              <Icon className="w-3 h-3"/>{l}
            </button>
          ))}
        </div>
      </div>
      {tab === "ioc" && <IocTab/>}
      {tab === "dmarc" && <DmarcTab/>}
      {tab === "feeds" && <FeedsTab/>}
      {tab === "usom" && <UsomTab/>}
      {tab === "compliance" && <ComplianceTab/>}

      <ModuleFooter
        title="Global Tehdit Zekası — Nasıl Çalışır?"
        howItWorks="4 alt-modül: (1) IOC feed — IP/domain/URL/hash/email tehdit göstergeleri, (2) DMARC aggregate — ISP'lerden gelen SPF/DKIM/DMARC raporları, (3) Global Feeds — URLhaus/Spamhaus/PhishTank vs. gerçek fetch, (4) Compliance — KVKK/GDPR/HIPAA/SOC2 auto-detection. IOC listesi ingest sırasında otomatik enforce olur (blocked verdict + ioc_hit metadata)."
        technical={[
          "URLhaus gerçek API: 20 URL/sync · 14 gün TTL",
          "Spamhaus ZEN: son 24s'te top spam IP'ler için DNS lookup",
          "IOC auto-block: /api/events/ingest içinde _ioc_enforce hook",
          "DMARC XML parse: ingest endpoint (JSON pre-parsed) · rua= receiver şu an mock",
          "Compliance: 11 item sistem state'inden otomatik (AUTO rozeti)",
        ]}
        recommendations={[
          "URLhaus + Spamhaus feed'lerini 30dk peryotla senkronize et (WHM cron)",
          "IOC'lere manuel IP/domain ekleyerek özel blok listesi oluştur",
          "DMARC rua= adresini `dmarc@sizindomain.com` yap",
          "Compliance %80+ hedefiyle manuel item'ları da tikle",
          "SIEM export ile Splunk/QRadar'a IOC feed'i push et",
        ]}
      />
    </div>
  );
}

function IocTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ type: "ip", value: "", tag: "spam", confidence: 80, source: "manual" });
  const q = useQuery({ queryKey: ["ti-ioc"], queryFn: () => api.tiIocList({ limit: 200 }), refetchInterval: 30000 });
  const add = useMutation({
    mutationFn: () => api.tiIocAdd(form),
    onSuccess: () => { toast.success("IOC eklendi"); qc.invalidateQueries({ queryKey: ["ti-ioc"] }); setForm({ ...form, value: "" }); },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const del = useMutation({
    mutationFn: (id) => api.tiIocDelete(id),
    onSuccess: () => { toast.success("Silindi"); qc.invalidateQueries({ queryKey: ["ti-ioc"] }); },
  });
  const seedDemo = useMutation({
    mutationFn: () => api.tiIocSeedDemoCategories(),
    onSuccess: (d) => {
      toast.success(`${d.inserted} demo IOC yüklendi (Domain/Hash/Email kategorileri)`);
      qc.invalidateQueries({ queryKey: ["ti-ioc"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const extractDomains = useMutation({
    mutationFn: () => api.tiIocExtractDomainsFromUrls(),
    onSuccess: (d) => {
      toast.success(`+${d.extracted} gerçek domain URL feed'lerinden çıkartıldı · toplam Domain: ${d.total_domains_now}`);
      qc.invalidateQueries({ queryKey: ["ti-ioc"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const items = q.data?.items || [];
  const counts = q.data?.counts || {};
  const emptyCat = (counts.domain ?? 0) === 0 || (counts.hash ?? 0) === 0 || (counts.email ?? 0) === 0;
  return (
    <Card>
      <CardHeader
        title="Tehdit Göstergeleri (IOC)"
        subtitle="IP · Domain · URL · Hash · Email — otomatik SpamAssassin ile senkron"
        right={<div className="text-xs mono text-slate-500">Toplam: {counts.total ?? 0}</div>}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <StatCounter label="IP" value={counts.ip ?? 0} tone="text-sky-300"/>
          <StatCounter label="Domain" value={counts.domain ?? 0} tone="text-indigo-300"/>
          <StatCounter label="URL" value={counts.url ?? 0} tone="text-fuchsia-300"/>
          <StatCounter label="Hash" value={counts.hash ?? 0} tone="text-amber-300"/>
          <StatCounter label="Email" value={counts.email ?? 0} tone="text-rose-300"/>
        </div>
        {emptyCat && (
          <div data-testid="ioc-empty-cat-banner" className="p-3 rounded-lg border-l-4 border-amber-500 bg-amber-500/5 flex items-start gap-3">
            <div className="text-2xl">💡</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-amber-200">
                {["Domain", "Hash", "Email"].filter((_, i) => [counts.domain, counts.hash, counts.email][i] === 0).join(" · ")} kategorileri boş
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                URLhaus/PhishTank sadece URL, Spamhaus/Barracuda sadece IP döner. Domain için <b>URL feed'lerinden gerçek domain çıkart</b> (yeşil buton) veya demo yükleyin.
              </div>
            </div>
            <div className="shrink-0 flex flex-col gap-1.5">
            <button
              data-testid="ioc-seed-demo-btn"
              onClick={() => seedDemo.mutate()}
              disabled={seedDemo.isPending}
              className="shrink-0 text-xs px-3 py-1.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40"
            >
              {seedDemo.isPending ? "Yükleniyor…" : "🌱 Demo Verilerini Yükle"}
            </button>
            <button
              data-testid="ioc-extract-domains-btn"
              onClick={() => extractDomains.mutate()}
              disabled={extractDomains.isPending}
              className="shrink-0 text-xs px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40"
              title="URLhaus/PhishTank URL feed'lerinden gerçek domain'leri çıkart"
            >
              {extractDomains.isPending ? "Çıkartılıyor…" : "🔗 URL'lerden Gerçek Domain Çıkart"}
            </button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 p-3 bg-slate-950/50 border border-slate-800 rounded">
          <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} data-testid="ioc-type"
                  className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm">
            {["ip", "domain", "url", "hash", "email"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder="Değer" data-testid="ioc-value"
                 className="col-span-2 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
          <select value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} data-testid="ioc-tag"
                  className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm">
            {["spam", "phishing", "malware", "c2", "ransomware"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="number" value={form.confidence} onChange={e => setForm({ ...form, confidence: Number(e.target.value) })}
                 min={0} max={100} placeholder="Güven"
                 className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
          <button data-testid="ioc-add" onClick={() => add.mutate()} disabled={!form.value || add.isPending}
                  className="text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
            <Plus className="w-3 h-3 inline mr-1"/>Ekle
          </button>
        </div>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {items.map(it => (
            <IocRow key={it.id} it={it} onDelete={() => del.mutate(it.id)} />
          ))}
          {items.length === 0 && <div className="text-center py-8 text-slate-500 text-sm">Henüz IOC yok</div>}
        </div>
      </CardBody>
    </Card>
  );
}

// v44.00.23 — IOC satırı: tıklanınca "neden karalistede?" panelini açar.
// /threat-intel/ioc/{id}/hits çağrısıyla o göstergeye uyan son mail'leri
// (gönderici / konu / alıcı / verdict / zaman) alt panelde listeler.
function IocRow({ it, onDelete }) {
  const [open, setOpen] = useState(false);
  const hitsQ = useQuery({
    queryKey: ["ti-ioc-hits", it.id],
    queryFn: () => client.get(`/threat-intel/ioc/${it.id}/hits?limit=10`).then(r => r.data),
    enabled: open,
    staleTime: 30000,
  });
  const hits = hitsQ.data?.hits || [];
  const total = hitsQ.data?.hit_count ?? 0;
  return (
    <div data-testid={`ioc-${it.id}`} className="border border-slate-800 rounded bg-slate-950/30">
      <div className="flex items-center gap-3 p-2 text-xs">
        <button onClick={() => setOpen(!open)} data-testid={`ioc-toggle-${it.id}`}
                className="text-slate-500 hover:text-indigo-300 shrink-0" title="Bu göstergeye uyan mail'leri gör">
          {open ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronRight className="w-3.5 h-3.5"/>}
        </button>
        <Badge tone={it.tag === "ransomware" || it.tag === "malware" ? "danger" : it.tag === "phishing" ? "warning" : "default"}>{it.tag}</Badge>
        <span className="mono text-slate-400 w-14 text-[10px]">{it.type}</span>
        <button onClick={() => setOpen(!open)} className="mono text-slate-100 flex-1 truncate text-left hover:text-indigo-300"
                title="Detayları aç/kapa">{it.value}</button>
        <span className="mono text-slate-500 text-[10px]">güven: %{it.confidence}</span>
        <span className="mono text-slate-600 text-[10px]">{it.source}</span>
        <button onClick={onDelete} className="text-slate-500 hover:text-rose-400"><X className="w-3 h-3"/></button>
      </div>
      {open && (
        <div data-testid={`ioc-hits-${it.id}`} className="border-t border-slate-800 bg-slate-950/60 px-3 py-2">
          {hitsQ.isLoading ? (
            <div className="text-[11px] text-slate-500 py-2">Yükleniyor…</div>
          ) : it.type === "hash" ? (
            <div className="text-[11px] text-slate-500 py-2">Hash IOC'lar için mail eşleşmesi tutulmuyor — ClamAV/AV tarama sonucu ayrıca loglanır.</div>
          ) : hits.length === 0 ? (
            <div className="text-[11px] text-slate-500 py-2 flex items-center gap-2">
              <Mail className="w-3 h-3"/>
              Bu göstergeye uyan lokal mail kaydı yok — <span className="text-slate-400">gösterge global feed'ten geldi (henüz sunucunuza vurmadı)</span>.
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-2 mb-1">
                <Mail className="w-3 h-3"/> Neden karalistede? · Son {hits.length} eşleşme
                {total > hits.length && <span className="text-slate-600">(toplam {total.toLocaleString()})</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-[9px] uppercase text-slate-600 border-b border-slate-800">
                      <th className="text-left py-1 pr-2">Zaman</th>
                      <th className="text-left py-1 pr-2">Gönderici</th>
                      <th className="text-left py-1 pr-2">Alıcı</th>
                      <th className="text-left py-1 pr-2">Konu</th>
                      <th className="text-left py-1 pr-2">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hits.map((h, i) => (
                      <tr key={h.id || i} className="border-b border-slate-900/60 hover:bg-slate-900/40">
                        <td className="mono text-slate-500 py-1 pr-2 whitespace-nowrap">
                          {h.ts ? new Date(h.ts).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "-"}
                        </td>
                        <td className="mono text-slate-100 py-1 pr-2 truncate max-w-[200px]" title={h.from_addr}>
                          {h.from_addr || <span className="text-slate-600">(bilinmeyen)</span>}
                        </td>
                        <td className="mono text-slate-400 py-1 pr-2 truncate max-w-[180px]" title={h.to_addr}>{h.to_addr || "-"}</td>
                        <td className="text-slate-300 py-1 pr-2 truncate max-w-[260px]" title={h.subject}>{h.subject || <span className="text-slate-600">(konusuz)</span>}</td>
                        <td className="py-1 pr-2">
                          {h.verdict && (
                            <span className={`mono text-[9px] uppercase px-1.5 py-0.5 rounded ${
                              h.verdict === "spam" || h.verdict === "malware" || h.verdict === "phishing"
                                ? "bg-rose-500/20 text-rose-300"
                                : h.verdict === "clean" ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-slate-700 text-slate-300"
                            }`}>{h.verdict}</span>
                          )}
                          {h.score != null && (
                            <span className="mono text-slate-500 text-[9px] ml-1">{Number(h.score).toFixed(1)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DmarcTab() {
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

function FeedsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ti-feeds"], queryFn: () => api.tiFeeds(), refetchInterval: 30000 });
  const autoSyncQ = useQuery({ queryKey: ["ti-auto-sync"], queryFn: () => api.tiAutoSyncGet(), refetchInterval: 30000 });
  const sync = useMutation({
    mutationFn: (key) => api.tiFeedSync(key),
    onSuccess: (d) => { toast.success(`${d.feed} · +${d.added} IOC senkronize edildi`); qc.invalidateQueries({ queryKey: ["ti-feeds"] }); qc.invalidateQueries({ queryKey: ["ti-ioc"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const syncAll = useMutation({
    mutationFn: () => api.tiAutoSyncRunNow(),
    onSuccess: (d) => { toast.success(`Tüm feed'ler senkronize edildi · +${d.total_added} yeni IOC`); qc.invalidateQueries({ queryKey: ["ti-feeds"] }); qc.invalidateQueries({ queryKey: ["ti-ioc"] }); qc.invalidateQueries({ queryKey: ["ti-auto-sync"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const setAuto = useMutation({
    mutationFn: (cfg) => api.tiAutoSyncSet(cfg),
    onSuccess: (d) => { toast.success(d.enabled ? "Otomatik senkronizasyon başlatıldı" : "Otomatik senkronizasyon durduruldu"); qc.invalidateQueries({ queryKey: ["ti-auto-sync"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const auto = autoSyncQ.data || { enabled: false, interval_min: 60 };
  return (
    <div className="space-y-3">
      {/* Auto-Sync Kontrol Paneli */}
      <div data-testid="ti-auto-sync-panel"
           className="border border-slate-800 bg-slate-900/40 rounded-lg p-4 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100 mb-1">
            <span className={`w-2 h-2 rounded-full ${auto.enabled ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`}></span>
            Otomatik Senkronizasyon
          </div>
          <div className="text-[11px] text-slate-500">
            {auto.enabled
              ? `Aktif — her ${auto.interval_min} dk'da tüm feed'ler otomatik güncellenir`
              : "Kapalı — manuel senkronizasyon gerekli"}
            {auto.last_run_at && (
              <span className="ml-2">· Son çalışma: <span className="mono text-slate-400">{new Date(auto.last_run_at).toLocaleString("tr-TR")}</span> · +{auto.last_added || 0} IOC</span>
            )}
          </div>
        </div>
        <select
          data-testid="ti-auto-sync-interval"
          value={auto.interval_min}
          onChange={(e) => setAuto.mutate({ enabled: auto.enabled, interval_min: Number(e.target.value) })}
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200">
          <option value={15}>Her 15 dk</option>
          <option value={30}>Her 30 dk</option>
          <option value={60}>Her 1 saat</option>
          <option value={180}>Her 3 saat</option>
          <option value={360}>Her 6 saat</option>
          <option value={720}>Her 12 saat</option>
          <option value={1440}>Her 24 saat</option>
        </select>
        <button
          data-testid="ti-sync-all-now"
          onClick={() => syncAll.mutate()}
          disabled={syncAll.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 text-xs disabled:opacity-40">
          <Zap className="w-3.5 h-3.5" />
          {syncAll.isPending ? "Senkronize ediliyor…" : "Şimdi Tümünü Senkronize Et"}
        </button>
        <button
          data-testid="ti-auto-sync-toggle"
          onClick={() => setAuto.mutate({ enabled: !auto.enabled, interval_min: auto.interval_min })}
          disabled={setAuto.isPending}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition ${
            auto.enabled
              ? "border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
              : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
          } disabled:opacity-40`}>
          {auto.enabled ? "Durdur" : "Otomatik Başlat"}
        </button>
      </div>

      {/* Feed Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {(q.data?.items || []).map(f => {
        // v44.00.30 — Genişletilmiş status: ok / clean / stale / error / never_synced
        const statusStyle = {
          ok:           { tone: "success", label: "AKTİF",   help: "Sync başarılı, eşleşme var" },
          clean:        { tone: "info",    label: "TEMİZ",   help: "Sync başarılı, sunucunda eşleşme yok — bu iyi bir işaret" },
          stale:        { tone: "warning", label: "GÜNCEL DEĞİL", help: "24 saatten uzun süredir sync olmadı" },
          error:        { tone: "danger",  label: "HATA",    help: "Son sync başarısız oldu" },
          never_synced: { tone: "danger",  label: "SYNC BEKLEMEDE", help: "Henüz hiç sync olmadı — 'Şimdi Senkronize Et' butonuna basın" },
        }[f.status] || { tone: "danger", label: f.status, help: "" };
        return (
        <div key={f.key} data-testid={`feed-${f.key}`} className="border border-slate-800 bg-slate-900/40 rounded-lg p-4 hover:border-indigo-500/40 transition-colors">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-slate-100 font-semibold text-sm">{f.name}</div>
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-[10px] mono text-indigo-400 hover:underline">{f.url}</a>
            </div>
            <Badge tone={statusStyle.tone} title={statusStyle.help}>{statusStyle.label}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] mono mb-3">
            <div><span className="text-slate-500">IOC:</span> <span className="text-slate-100">{f.ioc_count.toLocaleString()}</span></div>
            <div><span className="text-slate-500">Peryot:</span> <span className="text-slate-100">{f.interval_min}dk</span></div>
            <div className="col-span-2 text-slate-500">
              Son senk: <span className="text-slate-400">{new Date(f.last_synced_at).toLocaleTimeString("tr-TR")}</span>
            </div>
            {f.status === "clean" && (
              <div className="col-span-2 text-[10px] text-cyan-400" title={statusStyle.help}>
                ℹ Sunucunda listelenen IP yok — feed aktif, sadece eşleşme bulamadı.
              </div>
            )}
            {f.last_error && (
              <div className="col-span-2 text-[10px] text-rose-400 truncate" title={f.last_error}>⚠ {f.last_error}</div>
            )}
          </div>
          <button data-testid={`feed-sync-${f.key}`} onClick={() => sync.mutate(f.key)} disabled={sync.isPending}
                  className="w-full text-xs py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
            <Zap className="w-3 h-3 inline mr-1"/>Şimdi Senkronize Et
          </button>
        </div>
        );
      })}
      </div>
    </div>
  );
}

function ComplianceTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ti-compliance"], queryFn: () => api.tiCompliance() });
  const toggle = useMutation({
    mutationFn: (payload) => api.tiComplianceToggle(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ti-compliance"] }),
  });
  const frameworks = q.data?.frameworks || [];
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="text-center py-6">
          <Award className="w-10 h-10 mx-auto text-fuchsia-400 mb-2"/>
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-1">Genel Uyumluluk Skoru</div>
          <div className={`text-5xl font-bold mono ${(q.data?.overall_pct ?? 0) >= 80 ? "text-emerald-300" : (q.data?.overall_pct ?? 0) >= 50 ? "text-amber-300" : "text-rose-300"}`}>
            %{q.data?.overall_pct ?? 0}
          </div>
          <div className="text-xs text-slate-500 mt-1">{frameworks.length} framework · KVKK · GDPR · HIPAA · SOC2</div>
          {q.data?.auto_detected_count > 0 && (
            <div className="mt-2 inline-flex items-center gap-1 text-[10px] mono px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <TrendingUp className="w-3 h-3"/> {q.data.auto_detected_count} item sistem tarafından otomatik doğrulandı
            </div>
          )}
        </CardBody>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {frameworks.map(fw => (
          <Card key={fw.key} data-testid={`fw-${fw.key}`}>
            <CardHeader
              title={<span className="flex items-center gap-2"><ShieldCheck className={`w-4 h-4 ${fw.pct >= 80 ? "text-emerald-400" : fw.pct >= 50 ? "text-amber-400" : "text-rose-400"}`}/>{fw.name}</span>}
              subtitle={fw.framework}
              right={
                <div className={`text-2xl mono font-bold ${fw.pct >= 80 ? "text-emerald-300" : fw.pct >= 50 ? "text-amber-300" : "text-rose-300"}`}>
                  %{fw.pct}
                </div>
              }
            />
            <CardBody>
              <div className="h-1.5 rounded bg-slate-800 overflow-hidden mb-3">
                <div className={`h-full ${fw.pct >= 80 ? "bg-emerald-500" : fw.pct >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
                     style={{ width: `${fw.pct}%` }}/>
              </div>
              <div className="space-y-1.5">
                {fw.items.map(it => (
                  <label key={it.key} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-800/40 rounded px-2 py-1">
                    <input type="checkbox" checked={it.checked}
                           data-testid={`comp-${fw.key}-${it.key}`}
                           onChange={(e) => toggle.mutate({ framework_key: fw.key, item_key: it.key, checked: e.target.checked })}
                           className="accent-emerald-500"/>
                    <span className={`flex-1 ${it.checked ? "text-slate-300" : "text-slate-500"}`}>{it.label}</span>
                    {it.auto_detected && (
                      <span className="text-[9px] mono px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" title="Sistem tarafından otomatik tespit edildi">AUTO</span>
                    )}
                    <span className="mono text-[10px] text-slate-600">+{it.weight}</span>
                  </label>
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatCounter({ label, value, tone }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-md p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mono text-2xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}


// v44.00.22 — USOM (TR) Zararlı Bağlantı Listesi
function UsomTab() {
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  // v44.00.27 — Master endpoint'leri license_key parametresi ister
  const lk = () => (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) || "";

  const list = useQuery({
    queryKey: ["usom-list", q],
    queryFn: async () => {
      const params = new URLSearchParams({ license_key: lk(), limit: "500" });
      if (q) params.set("q", q);
      return (await client.get(`/threat-intel/usom/list?${params}`)).data;
    },
  });
  // v44.00.29 — İstatistik dashboard
  const stats = useQuery({
    queryKey: ["usom-stats"],
    queryFn: async () =>
      (await client.get(`/threat-intel/usom/stats?license_key=${encodeURIComponent(lk())}`)).data,
    refetchInterval: 60000,
  });

  const fetchNow = useMutation({
    mutationFn: async () => (await client.post(`/threat-intel/usom/fetch?license_key=${encodeURIComponent(lk())}`)).data,
    onSuccess: (d) => {
      // v44.00.26 — Yeni response şeması: total_fetched + added_urls/domains/ips + added_to_blacklist
      const totalNew = (d.added_urls || 0) + (d.added_domains || 0) + (d.added_ips || 0);
      toast.success(`✓ USOM: ${d.total_fetched} IOC · ${totalNew} yeni · ${d.added_to_blacklist || 0} kara liste ekleme`);
      qc.invalidateQueries({ queryKey: ["usom-list"] });
      qc.invalidateQueries({ queryKey: ["usom-stats"] });
      qc.invalidateQueries({ queryKey: ["lists-manager-unified"] });
    },
    onError: (e) => toast.error("USOM fetch hatası: " + (e.response?.data?.detail || e.message)),
  });

  // v44.00.32 — Async fetch (2024+ tüm kayıtları çekene kadar arka planda) + progress polling
  const fetchAsync = useMutation({
    mutationFn: async ({ min_year }) =>
      (await client.post(`/threat-intel/usom/fetch-async?license_key=${encodeURIComponent(lk())}`,
        { min_year })).data,
    onSuccess: (d) => {
      if (d.ok) toast.success(`⏳ Async fetch başladı (yıl≥${d.min_year}) — Alt tarafta canlı ilerleme görebilirsin`);
      else toast.info(d.message || "Fetch zaten çalışıyor");
      qc.invalidateQueries({ queryKey: ["usom-fetch-progress"] });
    },
    onError: (e) => toast.error("Async fetch başlatılamadı: " + (e.response?.data?.detail || e.message)),
  });

  const progress = useQuery({
    queryKey: ["usom-fetch-progress"],
    queryFn: async () =>
      (await client.get(`/threat-intel/usom/fetch-progress?license_key=${encodeURIComponent(lk())}`)).data,
    refetchInterval: (q) => {
      const s = q.state?.data?.state;
      return (s === "running" || s === "ingesting") ? 1500 : false;
    },
  });
  // done state olduğunda listeyi yenile
  useEffect(() => {
    if (progress.data?.state === "done") {
      qc.invalidateQueries({ queryKey: ["usom-list"] });
      qc.invalidateQueries({ queryKey: ["usom-stats"] });
      qc.invalidateQueries({ queryKey: ["lists-manager-unified"] });
    }
  }, [progress.data?.state, qc]);

  // v44.00.29 — Manuel cron refresh (fetch + URL→domain extraction + karaliste sync)
  const cronRefresh = useMutation({
    mutationFn: async () =>
      (await client.post(`/threat-intel/usom/cron-refresh?license_key=${encodeURIComponent(lk())}`)).data,
    onSuccess: (d) => {
      toast.success(
        `⚡ Cron simüle edildi: ${d.total_fetched} IOC · ${d.added_to_blacklist} yeni karaliste · ${d.domain_extracted} URL'den domain çıkarıldı`,
        { duration: 6000 }
      );
      qc.invalidateQueries({ queryKey: ["usom-list"] });
      qc.invalidateQueries({ queryKey: ["usom-stats"] });
      qc.invalidateQueries({ queryKey: ["lists-manager-unified"] });
    },
    onError: (e) => toast.error("Cron refresh hatası: " + (e.response?.data?.detail || e.message)),
  });

  const cleanup = useMutation({
    mutationFn: async () => (await client.post(`/threat-intel/usom/cleanup?license_key=${encodeURIComponent(lk())}`)).data,
    onSuccess: (d) => {
      toast.success(`Temizlendi: ${d.removed_iocs} IOC + ${d.removed_from_lists} kara liste kaydı`);
      qc.invalidateQueries({ queryKey: ["usom-list"] });
      qc.invalidateQueries({ queryKey: ["usom-stats"] });
    },
    onError: (e) => toast.error("Temizleme hatası: " + (e.response?.data?.detail || e.message)),
  });

  const delRow = useMutation({
    mutationFn: async (value) =>
      (await client.post(`/threat-intel/usom/delete?license_key=${encodeURIComponent(lk())}`, { value })).data,
    onSuccess: (d, value) => {
      toast.success(`${value} silindi (${d.removed_iocs + d.removed_from_lists} kayıt)`);
      qc.invalidateQueries({ queryKey: ["usom-list"] });
      qc.invalidateQueries({ queryKey: ["usom-stats"] });
    },
    onError: (e) => toast.error("Silinemedi: " + (e.response?.data?.detail || e.message)),
  });

  // v44.00.32 — Toplu silme (id listesi veya "all")
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const bulkDelete = useMutation({
    mutationFn: async (body) =>
      (await client.post(`/threat-intel/usom/bulk-delete?license_key=${encodeURIComponent(lk())}`, body)).data,
    onSuccess: (d) => {
      toast.success(`✓ ${d.removed_iocs} IOC + ${d.removed_from_lists} kara liste kaydı silindi`);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["usom-list"] });
      qc.invalidateQueries({ queryKey: ["usom-stats"] });
      qc.invalidateQueries({ queryKey: ["lists-manager-unified"] });
    },
    onError: (e) => toast.error("Toplu silme hatası: " + (e.response?.data?.detail || e.message)),
  });

  const items = list.data?.items || [];
  const lastSync = list.data?.last_sync_at;

  return (
    <Card data-testid="usom-tab">
      <CardHeader
        title="USOM Zararlı Bağlantılar (siberguvenlik.gov.tr)"
        subtitle="Ulusal Siber Olaylara Müdahale Merkezi listesi — otomatik günlük fetch + manuel arama/silme"
      />
      <CardBody>
        {/* v44.00.29 — Stats Dashboard */}
        {stats.data && stats.data.total > 0 && (
          <div className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="bg-slate-900 border border-slate-800 rounded p-3">
              <div className="text-[10px] uppercase text-slate-500">Toplam IOC</div>
              <div className="mono text-2xl text-indigo-300">{(stats.data.total || 0).toLocaleString("tr-TR")}</div>
              <div className="text-[9px] text-slate-600 mt-0.5">
                {Object.entries(stats.data.types || {}).map(([k, v]) => `${k}:${v}`).join(" · ")}
              </div>
            </div>
            <div className="bg-rose-500/5 border border-rose-500/20 rounded p-3">
              <div className="text-[10px] uppercase text-slate-500">Kara Liste</div>
              <div className="mono text-2xl text-rose-300">{(stats.data.blacklist_count || 0).toLocaleString("tr-TR")}</div>
              <div className="text-[9px] text-slate-600 mt-0.5">otomatik ekleme</div>
            </div>
            {["phishing", "malware", "ransomware"].map(tagKey => (
              <div key={tagKey} className="bg-slate-900 border border-slate-800 rounded p-3">
                <div className="text-[10px] uppercase text-slate-500">
                  {tagKey === "phishing" && "🎣 Phishing"}
                  {tagKey === "malware" && "🦠 Malware"}
                  {tagKey === "ransomware" && "🔒 Ransomware"}
                </div>
                <div className="mono text-xl text-amber-300">{(stats.data.tags?.[tagKey] || 0).toLocaleString("tr-TR")}</div>
                <div className="text-[9px] text-slate-600 mt-0.5">
                  {stats.data.total > 0 ? `%${Math.round((stats.data.tags?.[tagKey] || 0) / stats.data.total * 100)}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Criticality histogramı */}
        {stats.data?.criticality && Object.values(stats.data.criticality).some(v => v > 0) && (
          <div className="mb-4 bg-slate-950/40 border border-slate-800 rounded p-2 flex items-center gap-2">
            <span className="text-[10px] uppercase text-slate-500 mono shrink-0">Kritiklik:</span>
            {[1,2,3,4,5].map(lvl => {
              const val = stats.data.criticality[lvl] || 0;
              const max = Math.max(...Object.values(stats.data.criticality));
              const w = max > 0 ? Math.max(4, (val / max) * 100) : 0;
              const c = lvl >= 4 ? "bg-rose-500" : lvl === 3 ? "bg-amber-500" : "bg-cyan-500";
              return (
                <div key={lvl} className="flex-1 flex flex-col items-center">
                  <div className="w-full bg-slate-800 rounded h-6 relative overflow-hidden">
                    <div className={`h-full ${c} transition-all`} style={{width: `${w}%`}}/>
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] mono text-white font-bold">
                      {val > 0 && val.toLocaleString("tr-TR")}
                    </span>
                  </div>
                  <div className="text-[9px] text-slate-600 mono mt-0.5">Sv.{lvl}</div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button onClick={() => fetchNow.mutate()} disabled={fetchNow.isPending}
            data-testid="usom-fetch-btn"
            className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
            <RefreshCw className={`w-4 h-4 ${fetchNow.isPending ? "animate-spin" : ""}`}/>
            {fetchNow.isPending ? "USOM verileri çekiliyor..." : "Hızlı Çek (500)"}
          </button>
          {/* v44.00.32 — Async big fetch (2024+ tüm kayıtlar) */}
          <button
            onClick={() => fetchAsync.mutate({ min_year: 2024 })}
            disabled={fetchAsync.isPending || ["running","ingesting"].includes(progress.data?.state)}
            data-testid="usom-fetch-async-btn"
            title="2024, 2025, 2026 yıllarına ait tüm USOM kayıtlarını çeker (dakikalar sürebilir, canlı ilerleme aşağıda)"
            className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
            <Zap className={`w-4 h-4 ${["running","ingesting"].includes(progress.data?.state) ? "animate-pulse" : ""}`}/>
            {["running","ingesting"].includes(progress.data?.state)
              ? "Çekiliyor…"
              : "🔥 Tam Çek (2024+)"}
          </button>
          {/* v44.00.29 — Manuel cron refresh */}
          <button onClick={() => cronRefresh.mutate()} disabled={cronRefresh.isPending}
            data-testid="usom-cron-refresh-btn"
            title="Fetch + URL'lerden domain çıkart + karalisteye ekle (günlük cron'un yaptığı işi tetikler)"
            className="px-3 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
            <Zap className={`w-3.5 h-3.5 ${cronRefresh.isPending ? "animate-pulse" : ""}`}/>
            {cronRefresh.isPending ? "Cron çalışıyor..." : "⚡ Cron'u Şimdi Çalıştır"}
          </button>
          <button onClick={() => window.confirm("HTML tag'i içeren bozuk USOM kayıtlarını sil?") && cleanup.mutate()}
            disabled={cleanup.isPending} data-testid="usom-cleanup-btn"
            className="px-3 py-2 rounded bg-rose-900/60 hover:bg-rose-900 text-rose-300 text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
            title="Önceki hatalı fetch'lerden kalan bozuk kayıtları temizle">
            <X className="w-3.5 h-3.5"/> Kirli Verileri Temizle
          </button>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="URL / domain'de ara..."
            data-testid="usom-search"
            className="flex-1 min-w-[200px] bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono"/>
          <div className="text-[11px] text-slate-500 mono whitespace-nowrap">
            {items.length} kayıt {lastSync && `· son sync: ${new Date(lastSync).toLocaleString("tr-TR")}`}
          </div>
        </div>

        {/* v44.00.32 — Live fetch progress bar */}
        {progress.data && progress.data.state && progress.data.state !== "idle" && (
          <UsomFetchProgress p={progress.data} />
        )}

        {/* v44.00.32 — Toplu silme toolbar */}
        {items.length > 0 && (
          <div data-testid="usom-bulk-toolbar" className="mb-2 flex items-center gap-2 flex-wrap text-xs">
            <button
              onClick={() => {
                if (selectedIds.size === items.length) setSelectedIds(new Set());
                else setSelectedIds(new Set(items.map(i => i.id)));
              }}
              data-testid="usom-select-all"
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 mono">
              {selectedIds.size === items.length ? "Seçimi Kaldır" : `Tümünü Seç (${items.length})`}
            </button>
            <button
              disabled={selectedIds.size === 0 || bulkDelete.isPending}
              onClick={() => {
                if (!window.confirm(`${selectedIds.size} kaydı silmek istiyor musun?`)) return;
                bulkDelete.mutate({ ids: [...selectedIds] });
              }}
              data-testid="usom-bulk-delete-selected"
              className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white mono font-semibold disabled:opacity-40">
              Seçilenleri Sil ({selectedIds.size})
            </button>
            <button
              disabled={bulkDelete.isPending}
              onClick={() => {
                const confirm1 = window.confirm(
                  `⚠ TÜM USOM KAYITLARINI (${items.length}+) silmek istiyor musun?\n\nBu işlem geri alınamaz. Kara liste kayıtları da silinir.`
                );
                if (!confirm1) return;
                const confirm2 = window.prompt('Onaylamak için "SIL" yazın:');
                if (confirm2 !== "SIL") { toast.info("İptal edildi"); return; }
                bulkDelete.mutate({ all: true });
              }}
              data-testid="usom-bulk-delete-all"
              className="px-3 py-1 rounded bg-rose-900/60 hover:bg-rose-900 text-rose-300 mono font-semibold disabled:opacity-40">
              ⚠ Tümünü Sil
            </button>
            {selectedIds.size > 0 && (
              <span className="text-slate-500 mono ml-auto">
                {selectedIds.size} / {items.length} seçili
              </span>
            )}
          </div>
        )}

        {items.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm border border-dashed border-slate-800 rounded">
            {q ? "Bu arama için sonuç yok." : 'Henüz USOM verisi çekilmedi. Üstteki "Şimdi Çek" butonuna basın.'}
          </div>
        ) : (
          <UsomPagedTable
            items={items}
            delRow={delRow}
            q={q}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
          />
        )}

        <div className="mt-4 p-3 rounded bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
          <b className="text-slate-200">Nasıl çalışır?</b> USOM (Ulusal Siber Olaylara Müdahale Merkezi) günlük güncellenen
          zararlı URL listesini <span className="mono">usom.gov.tr/url-list.txt</span> adresinden çekiyoruz. Her URL'nin
          host'unu da otomatik olarak Kara Liste'ye ekliyoruz — bu domainlerden gelen mail'lerin verdict'i otomatik
          "blocked" olur. Otomatik günlük fetch <b className="text-emerald-400">06:00 TR</b>'de çalışır.
        </div>
      </CardBody>
    </Card>
  );
}

// v44.00.32 — USOM canlı fetch progress bar
function UsomFetchProgress({ p }) {
  const state = p.state;
  const isRun = state === "running" || state === "ingesting";
  const totalCount = p.total_count || null;
  const fetched = p.fetched || 0;
  const page = p.page || 0;
  const pct = totalCount ? Math.min(100, Math.round(fetched / totalCount * 100)) : null;
  const started = p.started_at ? new Date(p.started_at) : null;
  const elapsedSec = started ? Math.floor((Date.now() - started.getTime()) / 1000) : 0;
  const mm = Math.floor(elapsedSec / 60);
  const ss = elapsedSec % 60;
  return (
    <div data-testid="usom-progress" className={`mb-4 p-3 rounded border ${
      state === "error" ? "border-rose-500/40 bg-rose-500/5"
        : state === "done" ? "border-emerald-500/40 bg-emerald-500/5"
        : "border-indigo-500/40 bg-indigo-500/5"
    }`}>
      <div className="flex items-center justify-between text-xs mb-2">
        <div className="flex items-center gap-2">
          {isRun && <RefreshCw className="w-4 h-4 text-indigo-300 animate-spin" />}
          {state === "done" && <span className="text-emerald-300">✓</span>}
          {state === "error" && <span className="text-rose-300">✕</span>}
          <b className={
            state === "error" ? "text-rose-200"
              : state === "done" ? "text-emerald-200"
              : "text-indigo-200"
          }>
            {state === "running" && "USOM verileri çekiliyor…"}
            {state === "ingesting" && "Veriler kayıt ediliyor…"}
            {state === "done" && "Tamamlandı"}
            {state === "error" && "Hata oluştu"}
          </b>
          {p.min_year && <span className="text-slate-400 mono">yıl≥{p.min_year}</span>}
        </div>
        <div className="text-slate-400 mono">
          {mm.toString().padStart(2,"0")}:{ss.toString().padStart(2,"0")} geçti
        </div>
      </div>
      <div className="w-full h-2 bg-slate-900 rounded overflow-hidden">
        <div
          className={`h-full transition-all ${
            state === "error" ? "bg-rose-500"
              : state === "done" ? "bg-emerald-500"
              : "bg-indigo-500 animate-pulse"
          }`}
          style={{ width: pct != null ? `${pct}%` : (isRun ? "45%" : "100%") }}
        />
      </div>
      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400 mono flex-wrap">
        <span>Sayfa: <b className="text-slate-200">{page}</b></span>
        <span>Çekilen: <b className="text-indigo-300">{fetched.toLocaleString("tr-TR")}</b></span>
        {totalCount && <span>API toplam: <b className="text-slate-300">{totalCount.toLocaleString("tr-TR")}</b></span>}
        {pct != null && <span>%{pct}</span>}
        {p.result && (
          <>
            <span className="text-emerald-300">+{p.result.added_domains || 0} domain</span>
            <span className="text-amber-300">+{p.result.added_urls || 0} URL</span>
            <span className="text-rose-300">+{p.result.added_ips || 0} IP</span>
            <span className="text-slate-300">→ {p.result.added_to_blacklist || 0} kara listeye eklendi</span>
          </>
        )}
        {p.error && <span className="text-rose-300">{p.error}</span>}
      </div>
    </div>
  );
}

// v44.00.29 — Sayfalanmış USOM tablosu (50 satır/sayfa, satır numarası, toplam)
function UsomPagedTable({ items, delRow, q, selectedIds, setSelectedIds }) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  useEffect(() => { setPage(0); }, [q, items.length]);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const start = page * pageSize;
  const end = Math.min(start + pageSize, items.length);
  const pageItems = items.slice(start, end);
  const goto = (p) => setPage(Math.max(0, Math.min(totalPages - 1, p)));

  const domainCount = items.filter(r => r.type === "domain").length;
  const urlCount = items.filter(r => r.type === "url").length;
  const ipCount = items.filter(r => r.type === "ip").length;

  return (
    <>
      {/* Sayaç header */}
      <div className="flex flex-wrap items-center gap-3 mb-2 px-1 text-xs">
        <span className="mono text-slate-300">
          <b className="text-indigo-300">{items.length.toLocaleString("tr-TR")}</b> toplam kayıt
        </span>
        {domainCount > 0 && <span className="mono text-cyan-400">🌐 {domainCount.toLocaleString("tr-TR")} domain</span>}
        {urlCount > 0 && <span className="mono text-rose-400">🔗 {urlCount.toLocaleString("tr-TR")} URL</span>}
        {ipCount > 0 && <span className="mono text-amber-400">📡 {ipCount.toLocaleString("tr-TR")} IP</span>}
        <span className="ml-auto text-slate-500 mono">
          Gösterilen: <b className="text-slate-200">{(start + 1).toLocaleString("tr-TR")}-{end.toLocaleString("tr-TR")}</b> · Sayfa {page + 1}/{totalPages}
        </span>
        <select value={pageSize} onChange={(e) => { setPageSize(parseInt(e.target.value)); setPage(0); }}
                data-testid="usom-page-size"
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 mono text-xs">
          <option value={25}>25 satır</option>
          <option value={50}>50 satır</option>
          <option value={100}>100 satır</option>
          <option value={250}>250 satır</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800 bg-slate-950/40">
              <th className="px-2 py-2 w-8 text-center">
                <input type="checkbox"
                  checked={pageItems.length > 0 && pageItems.every(r => selectedIds?.has(r.id))}
                  onChange={(e) => {
                    if (!setSelectedIds) return;
                    const next = new Set(selectedIds);
                    if (e.target.checked) pageItems.forEach(r => next.add(r.id));
                    else pageItems.forEach(r => next.delete(r.id));
                    setSelectedIds(next);
                  }}
                  data-testid="usom-page-select-all"
                  className="rounded" />
              </th>
              <th className="px-2 py-2 text-right w-12">#</th>
              <th className="px-3 py-2 text-left">Tip</th>
              <th className="px-3 py-2 text-left">Adres</th>
              <th className="px-3 py-2 text-left">Tarih</th>
              <th className="px-3 py-2 text-left">Açıklama</th>
              <th className="px-3 py-2 text-left">Kaynak</th>
              <th className="px-3 py-2 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((r, i) => (
              <tr key={`${r.type}-${r.value}`} className={`border-b border-slate-800/60 hover:bg-slate-900/40 ${
                selectedIds?.has(r.id) ? "bg-indigo-500/10" : ""
              }`}
                  data-testid={`usom-row-${r.value}`}>
                <td className="px-2 py-2 text-center">
                  <input type="checkbox"
                    checked={selectedIds?.has(r.id) || false}
                    onChange={(e) => {
                      if (!setSelectedIds) return;
                      const next = new Set(selectedIds);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      setSelectedIds(next);
                    }}
                    data-testid={`usom-row-select-${r.value}`}
                    className="rounded" />
                </td>
                <td className="px-2 py-2 text-right mono text-[10px] text-slate-500">{start + i + 1}</td>
                <td className="px-3 py-2">
                  <span className="text-[9px] mono uppercase px-1.5 py-0.5 rounded"
                        style={{ background: r.type === "url" ? "#f43f5522" : r.type === "ip" ? "#f59e0b22" : "#22d3ee22",
                                 color: r.type === "url" ? "#f43f5e" : r.type === "ip" ? "#f59e0b" : "#22d3ee" }}>
                    {r.type === "url" ? "URL" : r.type === "ip" ? "IP" : "Domain"}
                  </span>
                </td>
                <td className="px-3 py-2 mono text-slate-100 break-all max-w-[440px]">{r.value}</td>
                <td className="px-3 py-2 text-[10px] text-slate-500 mono whitespace-nowrap">
                  {r.created_at ? new Date(r.created_at).toLocaleString("tr-TR") : "-"}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400 max-w-[220px] truncate" title={r.note}>{r.note || "USOM"}</td>
                <td className="px-3 py-2 text-[10px] text-indigo-300 mono">{r.source}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => window.confirm(`${r.value} kaldırılsın mı?`) && delRow.mutate(r.value)}
                    disabled={delRow.isPending} data-testid={`usom-del-${r.value}`}
                    className="p-1 rounded hover:bg-rose-500/20 text-rose-400 disabled:opacity-40">
                    <X className="w-4 h-4"/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination bar */}
      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap text-xs">
        <div className="text-slate-500 mono">
          {items.length.toLocaleString("tr-TR")} kayıttan {(start + 1).toLocaleString("tr-TR")}-{end.toLocaleString("tr-TR")} arası
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => goto(0)} disabled={page === 0} data-testid="usom-first"
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 mono">« İlk</button>
          <button onClick={() => goto(page - 1)} disabled={page === 0} data-testid="usom-prev"
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 mono">‹ Önceki</button>
          {Array.from({ length: totalPages }, (_, i) => i)
            .filter(i => i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 2)
            .reduce((acc, i, idx, arr) => {
              if (idx > 0 && i - arr[idx - 1] > 1) acc.push(-1);
              acc.push(i);
              return acc;
            }, [])
            .map((p, idx) => {
              if (p === -1) {
                return <span key={"e" + idx} className="text-slate-600 mono px-1">…</span>;
              }
              return (
                <button key={p} onClick={() => goto(p)} data-testid={"usom-page-" + (p+1)}
                        className={"px-2.5 py-1 rounded mono min-w-[32px] " + (
                          p === page
                            ? "bg-indigo-500/30 text-indigo-100 border border-indigo-500/50 font-bold"
                            : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                        )}>{p + 1}</button>
              );
            })}
          <button onClick={() => goto(page + 1)} disabled={page >= totalPages - 1} data-testid="usom-next"
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 mono">Sonraki ›</button>
          <button onClick={() => goto(totalPages - 1)} disabled={page >= totalPages - 1} data-testid="usom-last"
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 mono">Son »</button>
        </div>
      </div>
    </>
  );
}

