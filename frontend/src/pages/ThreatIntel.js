import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import {
  Globe, Radar, ShieldCheck, FileCheck2, RefreshCw, Plus, X, Zap,
  AlertTriangle, TrendingUp, Award,
} from "lucide-react";
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
                URLhaus/PhishTank sadece URL, Spamhaus/Barracuda sadece IP döner. Bu 3 kategori için gerçek üretim feed'i (OpenPhish/MalwareBazaar/Blocklist.de) satın alınmadan aşağıdaki demo veriyi yükleyebilirsiniz.
              </div>
            </div>
            <button
              data-testid="ioc-seed-demo-btn"
              onClick={() => seedDemo.mutate()}
              disabled={seedDemo.isPending}
              className="shrink-0 text-xs px-3 py-1.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40"
            >
              {seedDemo.isPending ? "Yükleniyor…" : "🌱 Demo Verilerini Yükle"}
            </button>
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
            <div key={it.id} data-testid={`ioc-${it.id}`}
                 className="flex items-center gap-3 border border-slate-800 rounded p-2 text-xs bg-slate-950/30">
              <Badge tone={it.tag === "ransomware" || it.tag === "malware" ? "danger" : it.tag === "phishing" ? "warning" : "default"}>{it.tag}</Badge>
              <span className="mono text-slate-400 w-14 text-[10px]">{it.type}</span>
              <span className="mono text-slate-100 flex-1 truncate">{it.value}</span>
              <span className="mono text-slate-500 text-[10px]">güven: %{it.confidence}</span>
              <span className="mono text-slate-600 text-[10px]">{it.source}</span>
              <button onClick={() => del.mutate(it.id)} className="text-slate-500 hover:text-rose-400"><X className="w-3 h-3"/></button>
            </div>
          ))}
          {items.length === 0 && <div className="text-center py-8 text-slate-500 text-sm">Henüz IOC yok</div>}
        </div>
      </CardBody>
    </Card>
  );
}

function DmarcTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["dmarc-summary"], queryFn: () => api.tiDmarcSummary(30) });
  const seed = useMutation({
    mutationFn: () => api.tiDmarcSeedDemo(),
    onSuccess: (d) => { toast.success(`+${d.seeded} demo rapor eklendi (${d.domains} domain)`); qc.invalidateQueries({ queryKey: ["dmarc-summary"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const domains = q.data?.domains || [];
  return (
    <Card>
      <CardHeader
        title="DMARC Aggregate Raporlar"
        subtitle="Son 30 gün · Alıcı ISP'lerden gelen aggregate XML rapor özetleri"
        right={<Badge tone="info">{domains.length} domain</Badge>}
      />
      <CardBody>
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
                <tr key={d.domain} data-testid={`dmarc-row-${d.domain}`} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 mono text-slate-100">{d.domain}</td>
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
    </Card>
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
      {(q.data?.items || []).map(f => (
        <div key={f.key} data-testid={`feed-${f.key}`} className="border border-slate-800 bg-slate-900/40 rounded-lg p-4 hover:border-indigo-500/40 transition-colors">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-slate-100 font-semibold text-sm">{f.name}</div>
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-[10px] mono text-indigo-400 hover:underline">{f.url}</a>
            </div>
            <Badge tone={f.status === "ok" ? "success" : "danger"}>{f.status}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] mono mb-3">
            <div><span className="text-slate-500">IOC:</span> <span className="text-slate-100">{f.ioc_count.toLocaleString()}</span></div>
            <div><span className="text-slate-500">Peryot:</span> <span className="text-slate-100">{f.interval_min}dk</span></div>
            <div className="col-span-2 text-slate-500">
              Son senk: <span className="text-slate-400">{new Date(f.last_synced_at).toLocaleTimeString("tr-TR")}</span>
            </div>
          </div>
          <button data-testid={`feed-sync-${f.key}`} onClick={() => sync.mutate(f.key)} disabled={sync.isPending}
                  className="w-full text-xs py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
            <Zap className="w-3 h-3 inline mr-1"/>Şimdi Senkronize Et
          </button>
        </div>
      ))}
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
