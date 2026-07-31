import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Package, PackagePlus, RefreshCw, Sparkles, CheckCircle2, Copy, Globe,
  Server, Users, X, ExternalLink, Rocket,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const isoDate = (iso) => iso ? new Date(iso).toLocaleDateString("tr-TR") : "—";

/**
 * VersionPublishCard — master-only card that:
 *   1) Shows current installed version + last published version
 *   2) Auto-detects the master server's currently installed version
 *   3) One-click "Yeni Sürüm Yayınla" pipeline with animated success modal
 */
export default function VersionPublishCard() {
  const qc = useQueryClient();
  const { isMaster, masterHost, masterIp, keyMatch, ipMatch } = useIsMaster();
  const cur = useQuery({ queryKey: ["version-current"], queryFn: api.versionCurrent });
  const mf  = useQuery({ queryKey: ["version-manifest"], queryFn: api.versionManifest });

  const [editing, setEditing]     = useState(false);
  const [state, setState]         = useState({ latest_version: "", changelog: "" });
  const [publishResult, setResult] = useState(null); // set on success → shows modal
  const [confettiKey, setConfettiKey] = useState(0);

  const licenseKey = typeof window !== "undefined"
    ? (localStorage.getItem("gws.event_license") || localStorage.getItem("gws.master_license") || "")
    : "";

  const publish = useMutation({
    mutationFn: (p) => api.versionPublish(p),
    onSuccess: (data) => {
      setResult(data);
      setEditing(false);
      setConfettiKey((k) => k + 1);
      qc.invalidateQueries({ queryKey: ["version-manifest"] });
      qc.invalidateQueries({ queryKey: ["version-current"] });
      toast.success(`v${data.latest_version} yayınlandı → ${data.affected_clients} müşteri güncellenecek`, {
        duration: 8000,
      });
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || "Yayın hatası";
      toast.error(msg);
    },
  });

  useEffect(() => {
    if (mf.data && !state.latest_version && !editing) {
      setState({ latest_version: "", changelog: "" });
    }
  }, [mf.data]); // eslint-disable-line

  if (!isMaster) return null;

  const startAutoPublish = () => {
    // Explicit publish button — sends without a version to trigger backend auto-detect
    publish.mutate({
      license_key: licenseKey,
      changelog: `Otomatik yayın · ${new Date().toLocaleDateString("tr-TR")}`,
    });
  };

  const startEdit = () => {
    setState({
      latest_version: mf.data?.latest_version || "",
      changelog: "",
    });
    setEditing(true);
  };

  const submitEdit = () => {
    if (!state.latest_version.trim()) return toast.error("Sürüm numarası girin (örn 1.2.3)");
    publish.mutate({
      license_key: licenseKey,
      latest_version: state.latest_version.trim(),
      changelog: state.changelog,
    });
  };

  return (
    <>
      <Card data-testid="version-publish-card">
        <CardHeader
          title={<span className="flex items-center gap-2"><Package className="w-4 h-4 text-indigo-400" /> Sürüm Yönetimi</span>}
          subtitle={<span>Yayınladığınız sürümü tüm müşteri plugin'leri otomatik algılar · <span className="text-indigo-400 mono">{masterHost}</span></span>}
          right={
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
                ipMatch ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-500"
              }`}>
                <Server className="w-2.5 h-2.5" /> IP {ipMatch ? "✓" : "×"}
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
                keyMatch ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-500"
              }`}>
                <Sparkles className="w-2.5 h-2.5" /> KEY {keyMatch ? "✓" : "×"}
              </span>
            </div>
          }
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/40" data-testid="ver-installed-block">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Kurulu Sürüm</div>
              <div className="mono text-2xl text-slate-100 mt-1">{cur.data?.version || "—"}</div>
              <div className="text-xs text-slate-500 mt-1">bu sunucu · {masterIp}</div>
            </div>
            <div className="p-3 rounded-lg border border-indigo-500/25 bg-indigo-500/5" data-testid="ver-published-block">
              <div className="text-[10px] uppercase tracking-widest text-indigo-400 flex items-center gap-1">
                <Rocket className="w-3 h-3" /> Yayınlanan
              </div>
              <div className="mono text-2xl text-indigo-300 mt-1">{mf.data?.latest_version || "—"}</div>
              <div className="text-xs text-slate-500 mt-1">{isoDate(mf.data?.release_date)}</div>
            </div>
          </div>

          {editing ? (
            <div className="space-y-2">
              <input value={state.latest_version}
                onChange={(e) => setState({ ...state, latest_version: e.target.value })}
                placeholder="Sürüm — boş bırakılırsa kurulu sürüm alınır"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono focus:outline-none focus:border-indigo-500/60"
                data-testid="ver-edit-version" />
              <textarea rows={3} value={state.changelog}
                onChange={(e) => setState({ ...state, changelog: e.target.value })}
                placeholder="Yenilikler — bu metin müşterilere gönderilir"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:border-indigo-500/60"
                data-testid="ver-edit-changelog" />
              <div className="flex gap-2">
                <button data-testid="ver-publish-submit"
                        onClick={submitEdit}
                        disabled={publish.isPending}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-semibold shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 disabled:opacity-50 transition-shadow">
                  {publish.isPending ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Yayınlanıyor…</>
                  ) : (
                    <><Rocket className="w-4 h-4" /> Yayınla</>
                  )}
                </button>
                <button onClick={() => setEditing(false)} className="px-3 py-2 rounded-md text-sm border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                        data-testid="ver-edit-cancel">İptal</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-slate-400 space-y-1">
                {mf.data?.download_url && (
                  <div className="flex items-center gap-1.5 mono text-[10px] text-slate-500 truncate">
                    <Globe className="w-3 h-3 text-emerald-400" />{mf.data.download_url}
                  </div>
                )}
                {mf.data?.download_url_ip && (
                  <div className="flex items-center gap-1.5 mono text-[10px] text-slate-500 truncate">
                    <Server className="w-3 h-3 text-amber-400" />{mf.data.download_url_ip}
                  </div>
                )}
                {mf.data?.changelog && (
                  <div className="text-slate-400 whitespace-pre-wrap pt-2">{mf.data.changelog}</div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button data-testid="ver-auto-publish"
                        onClick={startAutoPublish}
                        disabled={publish.isPending}
                        className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-sm bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-semibold shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 disabled:opacity-50 transition-shadow">
                  {publish.isPending ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Yayınlanıyor…</>
                  ) : (
                    <><Sparkles className="w-4 h-4" /> Kurulu Sürümü Yayınla</>
                  )}
                </button>
                <button data-testid="ver-manual-publish"
                        onClick={startEdit}
                        className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20">
                  <PackagePlus className="w-4 h-4" /> Manuel Yayın
                </button>
              </div>
              <p className="text-[10px] text-slate-500 text-center pt-1">
                "Kurulu Sürümü Yayınla" bu sunucunun heartbeat sürümünü otomatik alır ve ikili URL (host + IP) ile paylaşır
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      {publishResult && (
        <PublishSuccessModal
          result={publishResult}
          onClose={() => setResult(null)}
          confettiKey={confettiKey}
        />
      )}
    </>
  );
}

/* ---------- Modern animated success modal ---------- */
function PublishSuccessModal({ result, onClose, confettiKey }) {
  const [copiedField, setCopied] = useState("");
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async (val, id) => {
    try { await navigator.clipboard.writeText(val); setCopied(id); toast.success("Kopyalandı"); }
    catch { toast.error("Kopyalanamadı"); }
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <>
      {/* Backdrop w/ fade */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 animate-in fade-in duration-200"
        data-testid="publish-success-backdrop"
      />
      {/* Confetti pieces */}
      <div key={confettiKey} className="fixed inset-0 pointer-events-none z-50 overflow-hidden" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="absolute top-0 left-1/2 confetti-piece"
            style={{
              left: `${5 + Math.random() * 90}%`,
              background: ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6"][i % 6],
              width: `${6 + Math.random() * 8}px`,
              height: `${10 + Math.random() * 8}px`,
              animationDelay: `${Math.random() * 0.3}s`,
              animationDuration: `${1.6 + Math.random() * 1.2}s`,
              transform: `rotate(${Math.random() * 360}deg)`,
            }}
          />
        ))}
      </div>

      {/* Modal */}
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-lg z-50 animate-in zoom-in-90 fade-in duration-300"
        data-testid="publish-success-modal"
        role="dialog"
        aria-modal="true"
      >
        <div className="rounded-2xl overflow-hidden shadow-2xl border border-emerald-500/30 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950">
          {/* Header */}
          <div className="relative px-6 pt-8 pb-6 bg-gradient-to-b from-emerald-500/15 via-emerald-500/5 to-transparent">
            <button onClick={onClose}
                    className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition"
                    data-testid="publish-success-close">
              <X className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-emerald-500/30 blur-xl animate-pulse" />
                <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/40 animate-in zoom-in-50 duration-500">
                  <CheckCircle2 className="w-9 h-9 text-white" strokeWidth={2.5} />
                </div>
              </div>
              <div className="mt-4 text-emerald-400 uppercase tracking-widest text-[11px] font-bold mono">
                Başarıyla Yayınlandı
              </div>
              <h2 className="mt-1 text-slate-100 text-2xl font-bold">
                Sürüm <span className="text-emerald-400 mono">v{result.latest_version}</span> aktif
              </h2>
              <p className="mt-2 text-sm text-slate-400 max-w-sm">
                <span className="text-indigo-400 mono font-semibold">{result.affected_clients}</span> müşteri plugin'i
                sonraki heartbeat'te bu sürümü algılayacak ve WHM içinde
                <span className="text-emerald-300"> "↻ Guncelle" </span> butonu görünür olacak.
              </p>
            </div>
          </div>

          {/* Body — URL list */}
          <div className="px-6 pb-6 space-y-2 text-xs">
            <UrlRow
              icon={<Globe className="w-3.5 h-3.5 text-emerald-400" />}
              label="Host URL (birincil)"
              value={result.download_url}
              copied={copiedField === "host"}
              onCopy={() => copy(result.download_url, "host")}
            />
            <UrlRow
              icon={<Server className="w-3.5 h-3.5 text-amber-400" />}
              label="IP Fallback"
              value={result.download_url_ip}
              copied={copiedField === "ip"}
              onCopy={() => copy(result.download_url_ip, "ip")}
            />
            {result.changelog && (
              <div className="pt-3 mt-3 border-t border-slate-800">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Değişiklik notu</div>
                <div className="text-xs text-slate-300 whitespace-pre-wrap">{result.changelog}</div>
              </div>
            )}
            <div className="pt-3 mt-3 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-500 mono">
              <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {result.affected_clients} etkilenen</span>
              <span>{new Date(result.release_date).toLocaleString("tr-TR", { hour12: false })}</span>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 pb-6 flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-sm font-semibold transition"
              data-testid="publish-success-done"
            >
              <CheckCircle2 className="w-4 h-4" /> Tamam
            </button>
            <a
              href={result.download_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-slate-100 hover:border-slate-600 text-sm transition"
              data-testid="publish-success-download"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Aç
            </a>
          </div>
        </div>
      </div>

      {/* Confetti CSS */}
      <style>{`
        @keyframes confettiFall {
          0%   { transform: translate(-50%, -20px) rotate(0deg);    opacity: 1; }
          100% { transform: translate(-50%, 120vh) rotate(720deg);  opacity: 0.3; }
        }
        .confetti-piece {
          position: absolute;
          border-radius: 2px;
          animation-name: confettiFall;
          animation-timing-function: ease-in;
          animation-iteration-count: 1;
          animation-fill-mode: forwards;
        }
        @keyframes zoom-in-90 { from { transform: translate(-50%,-50%) scale(.9); } to { transform: translate(-50%,-50%) scale(1); } }
        @keyframes zoom-in-50 { from { transform: scale(.5); } to { transform: scale(1); } }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        .animate-in { animation-fill-mode: both; }
        .fade-in { animation-name: fade-in; }
        .zoom-in-90 { animation-name: zoom-in-90; }
        .zoom-in-50 { animation-name: zoom-in-50; }
        .duration-200 { animation-duration: 200ms; }
        .duration-300 { animation-duration: 300ms; }
        .duration-500 { animation-duration: 500ms; }
      `}</style>
    </>
  );
}

function UrlRow({ icon, label, value, copied, onCopy }) {
  if (!value) return null;
  return (
    <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/50 flex items-center gap-2 group">
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
        <div className="mono text-[11px] text-slate-300 truncate">{value}</div>
      </div>
      <button
        onClick={onCopy}
        className={`shrink-0 p-1.5 rounded transition ${
          copied ? "text-emerald-300 bg-emerald-500/15" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
        }`}
      >
        {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
