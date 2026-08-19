/**
 * v43.99.4 — Demo Mode Banner
 *
 * Lisans girilmemişse üstte "Demo modu" bandı görünür. Tüm özellikler açık ama
 * kullanıcıya sürekli "Satın Al" CTA göstererek dönüşümü artırır.
 * Lisans girildiğinde bu banner otomatik gizlenir.
 */
import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { Sparkles, ShoppingCart, X, TrendingUp } from "lucide-react";

const DISMISS_KEY = "gws.demo_banner_dismissed_at";
const RE_SHOW_MS = 6 * 60 * 60 * 1000; // 6 saatte bir tekrar göster

export default function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [hasLicense, setHasLicense] = useState(false);

  useEffect(() => {
    const check = () => {
      try {
        const lk = localStorage.getItem("gws.master_license")
          || localStorage.getItem("gws.event_license") || "";
        setHasLicense(!!lk);
        const at = parseInt(localStorage.getItem(DISMISS_KEY) || "0", 10);
        setDismissed(at > 0 && (Date.now() - at) < RE_SHOW_MS);
      } catch (_) {}
    };
    check();
    // localStorage değişince (lisans girilince) banner gizlensin
    const t = setInterval(check, 3000);
    window.addEventListener("storage", check);
    return () => { clearInterval(t); window.removeEventListener("storage", check); };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (_) {}
    setDismissed(true);
  };

  if (hasLicense || dismissed) return null;

  return (
    <div
      data-testid="demo-banner"
      className="relative z-10 border-b border-amber-500/30 bg-gradient-to-r from-amber-950/40 via-orange-950/30 to-rose-950/40 backdrop-blur-sm"
    >
      <div className="max-w-full px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" strokeWidth={2.5} />
            <div className="absolute inset-0 blur-md bg-amber-400/40 rounded-full" />
          </div>
          <span className="text-[11px] font-black uppercase tracking-widest text-amber-300 mono">
            Demo Modu
          </span>
        </div>

        <div className="flex-1 min-w-0 text-[13px] text-amber-100/90 leading-tight">
          <span className="font-semibold text-amber-200">Tüm özellikler açık — inceleyin.</span>
          <span className="hidden sm:inline text-amber-100/60 ml-2">
            · Canlı üretimde kullanmak için lisans satın alın.
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <NavLink
            to="/panel/pricing"
            data-testid="demo-banner-buy-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-gradient-to-br from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-bold text-[12px] shadow-lg shadow-amber-500/30 transition-all hover:scale-105"
          >
            <ShoppingCart className="w-3.5 h-3.5" strokeWidth={2.5} />
            <span>Satın Al</span>
            <TrendingUp className="w-3 h-3 opacity-70" strokeWidth={2.5} />
          </NavLink>
          <button
            onClick={dismiss}
            data-testid="demo-banner-dismiss"
            className="p-1.5 rounded-md hover:bg-amber-900/40 text-amber-300/70 hover:text-amber-200 transition-colors"
            title="6 saat gizle"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
