// v44.00.37 — Extracted from ThreatIntel.js
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, client } from "@/lib/api";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { Plus, X, ChevronDown, ChevronRight, Mail } from "lucide-react";
import { StatCounter } from "./ComplianceTab";

export function IocTab() {
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


export function IocRow({ it, onDelete }) {
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
