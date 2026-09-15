// v44.00.37 — Extracted from ThreatIntel.js
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, client } from "@/lib/api";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { Radar, ShieldCheck, RefreshCw, X, Zap, Plus } from "lucide-react";

export function FeedsTab() {
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

