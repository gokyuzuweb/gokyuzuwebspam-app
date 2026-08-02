import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert, Clock, KeyRound, Mail, ExternalLink, RotateCw, Sparkles,
  CheckCircle2, Server, ArrowUpCircle, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

/**
 * Bileşen setleri:
 * - <PluginStatusStripe />   üst şerit: demo günü kalanı VEYA lisans bilgisi
 * - <LicenseGate />          demo bittiyse ve lisans yoksa full-screen kilit
 * Her ikisi de yalnızca customer modunda görünür. Seller modda pas geçer.
 */

export function PluginStatusStripe() {
  const q = useQuery({ queryKey: ["plugin-status"], queryFn: api.pluginStatus, refetchInterval: 30000 });
  const upd = useQuery({ queryKey: ["version-check"], queryFn: api.versionCheckUpdate, refetchInterval: 3600000 });
  const { isMaster } = useIsMaster();
  const qc = useQueryClient();
  const [upgrading, setUpgrading] = useState(false);

  const upgrade = useMutation({
    mutationFn: () => api.pluginUpgrade(),
    onMutate: () => setUpgrading(true),
    onSettled: () => setUpgrading(false),
    onSuccess: (data) => {
      if (data.ok) toast.success(data.message);
      else toast.error(data.message);
      qc.invalidateQueries({ queryKey: ["version-check"] });
      qc.invalidateQueries({ queryKey: ["version-current"] });
    },
    onError: (e) => toast.error("Güncelleme başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  if (!q.data) return null;
  const s = q.data;

  return (
    <>
      {/* Update available banner (both modes) */}
      {upd.data?.update_available && (
        <div data-testid="update-banner" className="bg-indigo-500/10 border-b border-indigo-500/20 text-indigo-200 text-xs px-6 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowUpCircle className="w-3.5 h-3.5" />
            <span>
              <b>Yeni sürüm mevcut:</b> <span className="mono">{upd.data.current}</span> → <span className="mono text-indigo-100">{upd.data.latest}</span>
              {upd.data.changelog && <span className="text-slate-400 ml-2">· {upd.data.changelog.slice(0, 80)}</span>}
            </span>
          </div>
          <button
            data-testid="upgrade-btn"
            onClick={() => upgrade.mutate()}
            disabled={upgrading}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold border border-indigo-500/40 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30 disabled:opacity-50"
          >
            {upgrading ? <RotateCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            {upgrading ? "Güncelleniyor…" : "Tek Tıkla Güncelle"}
          </button>
        </div>
      )}
      {/* Demo / license status
       * Master anahtarı olan kullanıcılar için hiçbir şey gösterme (tam erişim).
       * Master anahtarı olmayan tüm ziyaretçilere DEMO bandını göster (server
       * mode ne olursa olsun).
       */}
      {!isMaster && !s.gated && (
        <div data-testid="plugin-status-demo" className="relative bg-gradient-to-r from-amber-500/20 via-amber-400/15 to-rose-500/15 border-b-2 border-amber-500/50 text-amber-100 text-xs px-6 py-2.5 flex items-center justify-between shadow-inner shadow-amber-500/20">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/25 border border-rose-400/50 text-rose-100 text-[10px] font-black uppercase tracking-widest animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-300"/>
              Salt Okunur
            </span>
            <Clock className="w-3.5 h-3.5 text-amber-300" />
            <span>
              <b className="text-amber-50">DEMO MODU</b> · <span className="mono text-amber-200">{s.demo_days_remaining ?? 7}</span> gün · Örnek verilerle inceleme · Yazma kilitli
            </span>
          </div>
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); try { window.dispatchEvent(new CustomEvent("gws:open-license-modal")); } catch (_) {} }}
            data-testid="demo-unlock-link"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border border-amber-400/60 bg-amber-400/20 text-amber-50 hover:bg-amber-400/30 hover:border-amber-300 transition"
          >
            <KeyRound className="w-3 h-3" />
            Lisansla Kilidi Aç
          </a>
        </div>
      )}
    </>
  );
}


export function LicenseGate() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["plugin-status"], queryFn: api.pluginStatus, refetchInterval: 30000 });
  const [licenseKey, setLicenseKey] = useState("");
  const [detectedIP, setDetectedIP] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    const handler = () => setManualOpen(true);
    window.addEventListener("gws:open-license-modal", handler);
    return () => window.removeEventListener("gws:open-license-modal", handler);
  }, []);

  const verify = useMutation({
    mutationFn: (payload) => api.pluginVerifyLicense(payload),
    onSuccess: (data) => {
      toast.success(`Lisans etkinleştirildi: ${data.customer} · ${data.plan}`);
      setManualOpen(false);
      qc.invalidateQueries({ queryKey: ["plugin-status"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Doğrulama başarısız"),
  });

  const runVerify = async () => {
    let ip = detectedIP;
    if (!ip) {
      try {
        const r = await fetch("https://api.ipify.org?format=json");
        const d = await r.json();
        ip = d.ip;
        setDetectedIP(ip);
      } catch { ip = ""; }
    }
    // Panelin çalıştığı domain'i otomatik gönder (shared hosting için kritik)
    let hostname = "";
    try { hostname = window.location.hostname.toLowerCase().replace(/^www\./, ""); } catch (_) {}
    verify.mutate({ license_key: licenseKey || null, ip: ip || null, hostname: hostname || null });
  };

  if (!q.data) return null;
  if (q.data.mode === "seller") return null;
  // Kapı açık değilse ve manuel açma da yoksa görünmez
  if (!q.data.gated && !manualOpen) return null;

  return (
    <div data-testid="license-gate" className="fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-6 grid-backdrop">
      <div className="max-w-2xl w-full bg-slate-900 border border-rose-500/30 rounded-lg shadow-2xl overflow-hidden relative">
        {manualOpen && !q.data.gated && (
          <button
            data-testid="gate-close-btn"
            onClick={() => setManualOpen(false)}
            aria-label="Kapat"
            className="absolute top-3 right-3 z-10 w-8 h-8 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 text-2xl leading-none flex items-center justify-center"
          >×</button>
        )}
        <div className="p-6 bg-gradient-to-br from-rose-500/10 to-amber-500/5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-md bg-rose-500/20 border border-rose-500/40 flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-rose-300" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-rose-300 font-semibold">Lisans Gerekli</div>
              <h2 className="text-2xl font-bold text-slate-100">
                {q.data.gated ? "GökyüzüWebSpam Deneme Süresi Doldu" : "Lisans Etkinleştirme"}
              </h2>
            </div>
          </div>
          <p className="mt-4 text-slate-300 text-sm">
            {q.data.gated
              ? <>7 günlük ücretsiz deneme süreniz sona erdi. Panelde işlem yapmaya devam etmek için <b>lisansınızı doğrulayın</b>. Sistemde IP'niz kayıtlıysa lisansınız otomatik etkinleşir; yoksa satıcınızla iletişime geçin.</>
              : <>Demo modunda yalnızca inceleme yapabilirsiniz. Aç/kapa, başlat/durdur gibi işlemler için lisansınızı etkinleştirin. IP'niz kayıtlıysa lisansınız otomatik etkinleşir.</>
            }
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div className="p-4 rounded border border-slate-800 bg-slate-950/40">
            <div className="flex items-center gap-2 text-sm text-slate-200 font-medium mb-2">
              <Sparkles className="w-4 h-4 text-indigo-400" /> Otomatik Sorgulama
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Sunucunuzun public IP'si otomatik algılanır ve lisans veritabanında aranır.
              Kayıtlıysa lisansınız hemen etkinleşir.
            </p>
            <button
              data-testid="gate-auto-verify"
              onClick={runVerify}
              disabled={verify.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50"
            >
              <RotateCw className={`w-4 h-4 ${verify.isPending ? "animate-spin" : ""}`} />
              {verify.isPending ? "Sorgulanıyor…" : "Lisansımı Sorgula (IP ile)"}
            </button>
            {detectedIP && (
              <div className="mt-2 mono text-[11px] text-slate-500 flex items-center gap-1">
                <Server className="w-3 h-3" /> Tespit edilen IP: <span className="text-slate-300">{detectedIP}</span>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowManual(!showManual)}
            className="text-xs text-slate-400 hover:text-slate-200 underline"
          >
            {showManual ? "Elle giriş kısımını gizle" : "Lisans anahtarım var, elle gireceğim"}
          </button>

          {showManual && (
            <div className="p-4 rounded border border-slate-800 bg-slate-950/40 space-y-3">
              <div className="flex items-center gap-2 text-sm text-slate-200 font-medium">
                <KeyRound className="w-4 h-4 text-amber-400" /> Elle Lisans Anahtarı
              </div>
              <input
                data-testid="gate-license-key"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value.trim())}
                placeholder="MS-XXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono placeholder:text-slate-600"
              />
              <button
                data-testid="gate-manual-verify"
                onClick={runVerify}
                disabled={verify.isPending || !licenseKey}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                Anahtarla Etkinleştir
              </button>
            </div>
          )}

          <div className="pt-3 border-t border-slate-800">
            <div className="text-xs text-slate-400 mb-2 font-medium">Lisans Alma</div>
            <div className="grid grid-cols-2 gap-2">
              <a
                href="mailto:satis@gokyuzuwebspam.com?subject=Lisans%20Talebi"
                data-testid="gate-mail-seller"
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
              >
                <Mail className="w-3.5 h-3.5" /> Satıcıya E-posta
              </a>
              <a
                href="/shop"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Fiyat Planları
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
