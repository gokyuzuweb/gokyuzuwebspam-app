// v44.00.37 — Extracted from ThreatIntel.js
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, client } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { RefreshCw, Zap, X } from "lucide-react";

// v44.00.22 — USOM (TR) Zararlı Bağlantı Listesi
export function UsomTab() {
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

