import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package, Upload, Radio, CheckCircle2, RefreshCw, Loader2, Download, FileCode2, GitCommit,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const LICKEY = () =>
  (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) ||
  "";

const fmtBytes = (n) => {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

/**
 * /panel/version-publish — Master için sürüm dağıtım paneli.
 * • /api/plugin/versions endpoint'inden yüklü tar.gz paketlerini listeler
 * • Seçilen sürüm için tek tıkla /api/version/publish çağırır
 * • Publish sonrası tüm bayilerin heartbeat'i ile duyuru otomatik yayılır
 */
export default function VersionPublish() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const [changelog, setChangelog] = useState("");

  const versions = useQuery({
    queryKey: ["plugin-versions"],
    queryFn: api.pluginVersions,
    refetchInterval: 30000,
  });

  const manifest = useQuery({
    queryKey: ["version-manifest"],
    queryFn: api.versionManifest,
    refetchInterval: 30000,
  });

  const publish = useMutation({
    mutationFn: (v) => api.versionPublish({ latest_version: v, changelog }, LICKEY()),
    onSuccess: (d) => {
      toast.success(`Yayınlandı: v${d.latest_version}`, {
        description: `${d.affected || 0} bayi otomatik güncelleme alacak`,
      });
      setChangelog("");
      qc.invalidateQueries({ queryKey: ["plugin-versions"] });
      qc.invalidateQueries({ queryKey: ["version-manifest"] });
    },
    onError: (e) => toast.error("Yayın başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  const items = versions.data?.versions || [];
  const current = versions.data?.current || manifest.data?.latest_version || "—";
  const activeSel = selected || current;

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
          <Package className="w-5 h-5 text-emerald-400" />
          Sürüm Yayın Merkezi
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Yeni plugin paketini seç, tek tıkla yayınla — heartbeat üzerinden tüm bayi kurulumlarına otomatik dağılır.
        </p>
      </div>

      {/* Aktif sürüm */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><GitCommit className="w-4 h-4 text-sky-400"/> Aktif Sürüm</span>}
          subtitle="Şu an bayilere sunulan paket"
        />
        <CardBody className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-2xl font-bold text-emerald-300 tabular-nums" data-testid="vp-current">v{current}</div>
            {manifest.data?.release_date && (
              <div className="text-[11px] text-slate-500 mt-0.5">
                Yayın tarihi: {new Date(manifest.data.release_date).toLocaleString("tr-TR")}
              </div>
            )}
            {manifest.data?.changelog && (
              <div className="text-xs text-slate-300 mt-2 max-w-2xl">{manifest.data.changelog}</div>
            )}
          </div>
          <a
            href={`${(process.env.REACT_APP_BACKEND_URL || window.location.origin)}/api/plugin/download`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700"
            data-testid="vp-download-latest"
          >
            <Download className="w-3.5 h-3.5" /> Latest paketi indir
          </a>
        </CardBody>
      </Card>

      {/* Sürüm listesi */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><FileCode2 className="w-4 h-4 text-fuchsia-400"/> Mevcut Paketler</span>}
          subtitle={`${items.length} tar.gz paketi tespit edildi (${(process.env.REACT_APP_BACKEND_URL || "").replace(/^https?:\/\//,"")}/api/plugin/download/{v})`}
          right={
            <button
              onClick={() => versions.refetch()}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
              title="Listeyi yenile"
              data-testid="vp-refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${versions.isFetching ? "animate-spin" : ""}`} />
            </button>
          }
        />
        <CardBody className="p-0">
          {versions.isLoading ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Yükleniyor…
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              Henüz paket yüklenmemiş. <span className="mono text-slate-400">/app/backend/dist/</span> altına
              <span className="mono text-slate-400"> gokyuzuwebspam-X.Y.Z.tar.gz</span> koyun.
            </div>
          ) : (
            <ul className="divide-y divide-slate-800/60" data-testid="vp-versions-list">
              {items.map((v) => {
                const isCurrent = v.version === current;
                const isSelected = activeSel === v.version;
                return (
                  <li
                    key={v.version}
                    className={`p-3 flex items-center gap-3 cursor-pointer transition-colors ${
                      isSelected ? "bg-emerald-500/10 border-l-2 border-emerald-500" : "hover:bg-slate-900/50 border-l-2 border-transparent"
                    }`}
                    onClick={() => setSelected(v.version)}
                    data-testid={`vp-version-${v.version}`}
                  >
                    <input
                      type="radio"
                      checked={isSelected}
                      onChange={() => setSelected(v.version)}
                      className="accent-emerald-500 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-100">v{v.version}</span>
                        {isCurrent && (
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            AKTİF
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mono mt-0.5">
                        {v.filename} · {fmtBytes(v.size_bytes)}
                      </div>
                    </div>
                    <a
                      href={`${(process.env.REACT_APP_BACKEND_URL || window.location.origin)}${v.download_url}`}
                      onClick={(e) => e.stopPropagation()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-slate-100 p-1.5 rounded hover:bg-slate-800"
                      title="İndir"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Yayın formu */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Radio className="w-4 h-4 text-emerald-400 animate-pulse"/> Yayınla</span>}
          subtitle="Seçilen sürümü tüm bayilere aktif olarak duyurur (heartbeat ile yayılır)"
        />
        <CardBody className="space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Yayınlanacak Sürüm</label>
            <div className="text-lg font-bold text-emerald-300 tabular-nums" data-testid="vp-target">v{activeSel}</div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Changelog (opsiyonel)</label>
            <textarea
              data-testid="vp-changelog"
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="Neler değişti? · Bug fixleri, yeni özellikler, breaking changes…"
              rows={3}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm focus:border-emerald-500/60 outline-none resize-none"
            />
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <div className="text-[11px] text-slate-500">
              💡 Yayın sonrası tüm aktif bayilerin <b className="text-slate-300">bir sonraki heartbeat</b>'inde otomatik güncellenir.
            </div>
            <button
              data-testid="vp-publish"
              onClick={() => publish.mutate(activeSel)}
              disabled={publish.isPending || !activeSel || activeSel === "—"}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-gradient-to-r from-emerald-500 to-sky-500 text-white shadow-lg shadow-emerald-500/20 border border-emerald-400/40 hover:brightness-110 disabled:opacity-50"
            >
              {publish.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
              🚀 Yayınla
            </button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
