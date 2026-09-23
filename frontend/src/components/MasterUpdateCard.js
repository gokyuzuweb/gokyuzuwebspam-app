// v44.00.54 — Master Panel Update Card
// Preview kod tabaninda daha yeni surum varsa gosterir + tek tikla Emergent
// Deploy sayfasina yonlendirir. Amac: bayilarin master panelin arkasindan
// deploy edilmesini beklemek yerine, master admin proaktif deploy edebilsin.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Rocket, RefreshCw, ExternalLink, Check } from "lucide-react";
import { toast } from "sonner";
import { client } from "@/lib/api";


function cmpVersions(a, b) {
  const pa = String(a || "0").replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0").replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}


export default function MasterUpdateCard() {
  const [deploying, setDeploying] = useState(false);

  // Canli panelin sundugu surum (deploy edilmis)
  const live = useQuery({
    queryKey: ["version-panel-live"],
    queryFn: async () => (await client.get("/version/panel")).data,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Kod tabaninda paketlenen surum (whm-plugin/VERSION icinden)
  const bundle = useQuery({
    queryKey: ["version-panel-bundle"],
    queryFn: async () => (await client.get("/version/bundle")).data,
    staleTime: 30000,
  });

  const liveV = live.data?.version;
  const bundleV = bundle.data?.version;

  if (live.isLoading || bundle.isLoading) return null;
  if (!liveV || !bundleV) return null;

  const cmp = cmpVersions(liveV, bundleV);

  // Guncel — yesil rozet
  if (cmp >= 0) {
    return (
      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 flex items-center justify-between"
           data-testid="master-update-card-current">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-emerald-300">
            <b>Master panel guncel</b> — canli: <span className="mono">{liveV}</span>
          </span>
        </div>
        <button onClick={() => { live.refetch(); bundle.refetch(); }}
                className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1"
                data-testid="master-update-refresh">
          <RefreshCw className="w-3 h-3" /> Kontrol et
        </button>
      </div>
    );
  }

  // Guncelleme var
  const handleDeploy = async () => {
    setDeploying(true);
    try {
      // Emergent Deploy trigger endpoint'i
      const r = await client.post("/version/deploy-trigger", {});
      if (r.data?.ok) {
        toast.success(
          `🚀 Deploy tetiklendi: ${liveV} → ${bundleV}. Panel 2-5 dk icinde guncel olacak.`,
          { duration: 8000 },
        );
      } else if (r.data?.emergent_url) {
        // Fallback: kullaniciyi Emergent Deploy sayfasina yonlendir
        window.open(r.data.emergent_url, "_blank");
        toast.info("Emergent Deploy sayfasi acildi — 'Deploy' butonuna tikla");
      } else {
        toast.warning(r.data?.message || "Deploy tetiklenemedi, elle: Emergent panel → Deploy");
      }
    } catch (e) {
      toast.error("Deploy tetikleyici erisilemedi: " + (e.response?.data?.detail || e.message));
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="rounded-md border-2 border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-orange-500/5 p-4"
         data-testid="master-update-card-available">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
            <Rocket className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-200">
              🚀 Yeni panel surumu hazir
            </div>
            <div className="text-[12px] text-slate-300 mt-1">
              Canli: <span className="mono text-slate-500">{liveV}</span>
              <span className="mx-2 text-slate-600">→</span>
              Hazir: <span className="mono text-amber-300 font-bold">{bundleV}</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Deploy sonrasi bayi sunucular <code>sudo gwsm-update</code> ile yeni surumu otomatik alir.
            </div>
          </div>
        </div>
        <button onClick={handleDeploy} disabled={deploying} data-testid="master-update-deploy-btn"
                className="shrink-0 px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
          {deploying ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /> Deploy…</>
          ) : (
            <><Rocket className="w-4 h-4" /> Panel'i Guncelle</>
          )}
        </button>
      </div>
    </div>
  );
}
