import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Users, RefreshCw, Rocket, CheckCircle2, XCircle, AlertTriangle, Zap,
  Package, Radio, TrendingUp, Server, ChevronRight,
} from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import ModuleFooter from "@/components/ModuleFooter";

export default function ResellersAdmin() {
  const qc = useQueryClient();
  const [publishOpen, setPublishOpen] = useState(false);
  const heartbeats = useQuery({
    queryKey: ["reseller-heartbeats"],
    queryFn: () => api.masterHeartbeats(100),
    refetchInterval: 10000,
  });
  const master = useQuery({ queryKey: ["master-status"], queryFn: api.masterStatus });
  const releases = useQuery({ queryKey: ["master-releases"], queryFn: api.masterReleases });

  const d = heartbeats.data || {};
  const items = d.items || [];
  const online = d.online_count || 0;
  const outdated = d.outdated_count || 0;
  const currentVersion = releases.data?.current || master.data?.version || "?";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400"/> Bayi Panosu
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Canlı heartbeat · Master versiyon yönetimi · Yayın geçmişi
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPublishOpen(true)}
                  data-testid="publish-version-btn"
                  className="text-sm px-4 py-2 rounded bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 inline-flex items-center gap-2">
            <Rocket className="w-4 h-4"/> Yeni Versiyon Yayınla
          </button>
          <button onClick={() => heartbeats.refetch()}
                  data-testid="refresh-heartbeats"
                  className="text-sm px-3 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 inline-flex items-center gap-2">
            <RefreshCw className="w-4 h-4"/> Yenile
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Toplam Bayi" value={d.total || 0} icon={<Users className="w-4 h-4 text-slate-400"/>}/>
        <Stat label="Şu An Online" value={online} tone="text-emerald-300"
              icon={<Radio className="w-4 h-4 text-emerald-400"/>} hint="son 10 dk"/>
        <Stat label="Güncel Sürüm" value={items.length - outdated} tone="text-indigo-300"
              icon={<CheckCircle2 className="w-4 h-4 text-indigo-400"/>} hint={`v${currentVersion}`}/>
        <Stat label="Yükseltme Bekleyen" value={outdated} tone={outdated ? "text-amber-300" : "text-slate-300"}
              icon={<AlertTriangle className="w-4 h-4 text-amber-400"/>}/>
        <Stat label="Bitişe Yakın (14g)" value={d.expiring_soon || 0}
              tone={(d.expiring_soon || 0) ? "text-rose-300" : "text-slate-300"}
              icon={<AlertTriangle className="w-4 h-4 text-rose-400"/>}
              hint={d.expired ? `${d.expired} süresi bitti` : ""}/>
      </div>

      {/* Heartbeat table */}
      <Card>
        <CardHeader
          title="Bayi Heartbeat'leri"
          subtitle="10sn otomatik yenileme · son 10 dk aktif olanlar online kabul edilir"
        />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="reseller-heartbeat-table">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="px-3 py-2">Durum</th>
                  <th className="px-3 py-2">Bayi</th>
                  <th className="px-3 py-2">Lisans</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Sürüm</th>
                  <th className="px-3 py-2">Bitiş</th>
                  <th className="px-3 py-2">Son Görülme</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan="7" className="text-center text-slate-500 py-10">
                      Henüz heartbeat gönderilmedi
                    </td>
                  </tr>
                )}
                {items.map((r) => (
                  <tr key={r.license_key} className="border-b border-slate-800/40 hover:bg-slate-800/30"
                      data-testid={`heartbeat-row-${r.license_key}`}>
                    <td className="px-3 py-2">
                      {r.online ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-300 text-xs">
                          <span className="relative flex w-2 h-2">
                            <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-70 animate-ping"/>
                            <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500"/>
                          </span>
                          online
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-slate-500 text-xs">
                          <span className="w-2 h-2 rounded-full bg-slate-600 inline-block"/>
                          offline
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-slate-200 truncate max-w-[200px]">{r.reseller_name || r.license_key.slice(0, 12)}</div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[200px]">{r.email}</div>
                    </td>
                    <td className="px-3 py-2 mono text-[10px] text-slate-400 truncate">{r.license_key}</td>
                    <td className="px-3 py-2">
                      <Badge tone={r.plan === "enterprise" ? "info" : r.plan === "pro" ? "success" : "default"}>
                        {r.plan}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 mono text-slate-300">
                      {r.plugin_version || "-"}
                      {r.plugin_version && r.plugin_version !== currentVersion && (
                        <Badge tone="warning" className="ml-1">güncel değil</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.expires_at ? (
                        <div>
                          <div className={`text-[11px] mono ${
                            r.expired ? "text-rose-400 font-semibold"
                            : r.expiring_soon ? "text-amber-300 font-semibold"
                            : "text-slate-300"
                          }`}>
                            {r.expires_at.slice(0, 10)}
                          </div>
                          <div className={`text-[10px] ${
                            r.expired ? "text-rose-400"
                            : r.expiring_soon ? "text-amber-400"
                            : "text-slate-500"
                          }`}>
                            {r.expired ? `${Math.abs(r.days_left)}g önce bitti`
                            : r.days_left != null ? `${r.days_left} gün kaldı`
                            : "-"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-[11px]">süresiz</span>
                      )}
                    </td>
                    <td className="px-3 py-2 mono text-slate-400 text-[11px]">
                      {r.age_seconds < 0 ? "-" :
                       r.age_seconds < 60 ? `${r.age_seconds}sn önce` :
                       r.age_seconds < 3600 ? `${Math.floor(r.age_seconds / 60)}dk önce` :
                       r.age_seconds < 86400 ? `${Math.floor(r.age_seconds / 3600)}sa önce` :
                       `${Math.floor(r.age_seconds / 86400)}g önce`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Release history */}
      <Card>
        <CardHeader
          title="Yayın Geçmişi"
          subtitle={`Aktif sürüm: v${currentVersion}`}
        />
        <CardBody>
          {(releases.data?.items || []).length === 0 ? (
            <div className="text-center text-xs text-slate-500 py-6">
              <Package className="w-10 h-10 text-slate-700 mx-auto mb-2"/>
              Henüz yayın yapılmadı — "Yeni Versiyon Yayınla" ile başlayın
            </div>
          ) : (
            <div className="space-y-2">
              {(releases.data.items || []).map((rel, idx) => (
                <div key={rel.id + rel.version}
                     className={`p-3 rounded border ${
                       idx === 0
                         ? "bg-emerald-500/10 border-emerald-500/40"
                         : "bg-slate-900/40 border-slate-800"
                     }`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="mono text-slate-100 font-semibold">v{rel.version}</span>
                      {idx === 0 && <Badge tone="success">aktif</Badge>}
                    </div>
                    <span className="text-[10px] mono text-slate-500">
                      {(rel.published_at || "").slice(0, 19).replace("T", " ")}
                    </span>
                  </div>
                  {rel.changelog && (
                    <div className="text-xs text-slate-400 whitespace-pre-line">{rel.changelog}</div>
                  )}
                  {rel.download_url && (
                    <div className="text-[10px] text-indigo-400 mono truncate mt-1">
                      📦 {rel.download_url}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <ModuleFooter
        title="Bayi Panosu — Nasıl Çalışır?"
        howItWorks="Bayiler WHM plugin'lerinden veya web panellerinden /master/relay/heartbeat çağırır (10 dk period). Master server (buradaki panel) heartbeat zamanını + plugin sürümünü kaydeder. Bir bayi 10 dk boyunca heartbeat göndermezse offline sayılır. 'Yeni Versiyon Yayınla' butonu global cache'i temizler, yeni sürümü settings'e yazar; bir sonraki heartbeat'te bayilere outdated=true dönülür."
        technical={[
          "Endpoint: /master/relay/heartbeats (10sn otomatik yenileme)",
          "Publish: /master/publish-version — cache temizler + release_history kaydeder",
          "Online tanımı: age_seconds < 600 (10 dakika)",
          "Heartbeat verisi: reseller_heartbeats koleksiyonu",
        ]}
        recommendations={[
          "Yeni sürüm yayınlamadan önce release notes hazırlayın",
          "Outdated sayısı yüksekse bayilere e-posta bildirimi yollayın",
          "Offline bayilere ulaşmayı deneyin — sunucu sorunu olabilir",
        ]}
      />

      {publishOpen && (
        <PublishVersionModal
          currentVersion={currentVersion}
          onClose={() => setPublishOpen(false)}
          onSuccess={() => {
            setPublishOpen(false);
            qc.invalidateQueries({ queryKey: ["master-releases"] });
            qc.invalidateQueries({ queryKey: ["master-status"] });
            qc.invalidateQueries({ queryKey: ["reseller-heartbeats"] });
          }}
        />
      )}
    </div>
  );
}

function PublishVersionModal({ currentVersion, onClose, onSuccess }) {
  const [version, setVersion] = useState("");
  const [changelog, setChangelog] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  // Otomatik +1 minor version önerisi
  const suggestNext = () => {
    const parts = currentVersion.split(".");
    if (parts.length === 3) {
      parts[1] = String(Number(parts[1]) + 1);
      parts[2] = "0";
      setVersion(parts.join("."));
    }
  };

  const publish = useMutation({
    mutationFn: () => api.masterPublishVersion({
      version, changelog, download_url: downloadUrl,
    }),
    onSuccess: (d) => {
      toast.success(`✓ v${d.version} yayınlandı · ${d.resellers_outdated} bayi güncelleme alacak`, { duration: 8000 });
      onSuccess?.(d);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Yayınlama başarısız"),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
         onClick={onClose} data-testid="publish-modal">
      <div className="bg-slate-900 border border-emerald-500/40 rounded-lg max-w-lg w-full p-6 space-y-4"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-emerald-300">
          <Rocket className="w-6 h-6"/>
          <h2 className="text-lg font-bold">Yeni Versiyon Yayınla</h2>
        </div>
        <div className="text-xs text-slate-400">
          Mevcut sürüm: <span className="mono text-slate-200">v{currentVersion}</span> ·
          Bu işlem tüm bayilerin update cache'ini temizler.
        </div>
        <div className="space-y-3">
          <label className="text-xs block">
            <div className="text-slate-400 mb-1 flex items-center justify-between">
              <span>Sürüm numarası</span>
              <button onClick={suggestNext} className="text-[10px] text-indigo-400 hover:text-indigo-300">
                → sonraki minor öner
              </button>
            </div>
            <input value={version} onChange={(e) => setVersion(e.target.value)}
                   placeholder="ör: 2.6.0"
                   data-testid="publish-version-input"
                   className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-sm text-slate-100 mono focus:outline-none focus:border-emerald-500"/>
          </label>
          <label className="text-xs block">
            <div className="text-slate-400 mb-1">Değişiklikler (changelog)</div>
            <textarea value={changelog} onChange={(e) => setChangelog(e.target.value)}
                      placeholder="- Yeni özellik: ..."
                      rows="4"
                      data-testid="publish-changelog"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-xs text-slate-100 focus:outline-none focus:border-emerald-500"/>
          </label>
          <label className="text-xs block">
            <div className="text-slate-400 mb-1">İndirme URL (opsiyonel)</div>
            <input value={downloadUrl} onChange={(e) => setDownloadUrl(e.target.value)}
                   placeholder="otomatik oluşturulur"
                   className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-xs text-slate-100 mono focus:outline-none focus:border-emerald-500"/>
          </label>
        </div>
        <div className="flex gap-2 pt-2 border-t border-slate-800">
          <button onClick={onClose}
                  className="flex-1 px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm">
            İptal
          </button>
          <button onClick={() => publish.mutate()}
                  disabled={!version || publish.isPending}
                  data-testid="publish-confirm"
                  className="flex-1 px-4 py-2 rounded bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow disabled:opacity-40 inline-flex items-center justify-center gap-2">
            <Zap className="w-4 h-4"/>
            {publish.isPending ? "Yayınlanıyor..." : "Yayınla"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint, tone = "text-slate-100", icon }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-bold mono ${tone}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}
