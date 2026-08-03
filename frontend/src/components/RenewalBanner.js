import { useMemo, useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { X, Clock, AlertTriangle, Sparkles, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";

const DISMISS_KEY_BASE = "gws.renewal_banner_dismissed";
const DISMISS_HOURS = 24;

/**
 * RenewalBanner — Panel üstünde görünen abonelik yenileme hatırlatma banner'ı.
 *
 * Kurallar:
 *  • Sadece licensed=true olan panellerde çalışır.
 *  • Kalan gün ≤ 30 iken görünür (info @30d / warning @14d / critical @3d).
 *  • Kullanıcı 24 saatliğine kapatabilir (sessionStorage tabanlı).
 *  • KRITIK (3 gün) olduğunda kapatılamaz.
 *  • /panel/subscription sayfasındayken görünmez (kullanıcı zaten oradaysa gürültü olmasın).
 */
export default function RenewalBanner() {
  const loc = useLocation();
  const [now, setNow] = useState(Date.now());
  const [dismissTick, setDismissTick] = useState(0);

  // Refresh dismiss check every minute to auto-reappear after 24h
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const q = useQuery({
    queryKey: ["renewal-info"],
    queryFn: api.pluginRenewalInfo,
    refetchInterval: 300000, // 5 dakika
    retry: false,
    staleTime: 60000,
  });

  const info = q.data;
  // Dismiss key'i lisans bazlı — bir bayi bir başkasının panelinde açtığında
  // eski dismissed state taşınmasın.
  const dismissKey = info?.license_key
    ? `${DISMISS_KEY_BASE}:${info.license_key}`
    : DISMISS_KEY_BASE;
  const dismissedUntil = useMemo(() => {
    try {
      const raw = sessionStorage.getItem(dismissKey);
      return raw ? Number(raw) : 0;
    } catch (_) { return 0; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissTick, info?.expires_at, dismissKey]);

  // Kritik uyarı kapatılamaz — dismiss ignore
  const isCritical = info?.severity === "critical";
  const isDismissed = !isCritical && dismissedUntil > now;

  const onDismiss = () => {
    try {
      sessionStorage.setItem(dismissKey, String(Date.now() + DISMISS_HOURS * 3600 * 1000));
      setDismissTick((t) => t + 1);
    } catch (_) {}
  };

  if (!info?.should_show_banner) return null;
  if (loc.pathname.startsWith("/panel/subscription")) return null;
  if (isDismissed) return null;

  const tone = {
    info: {
      bg: "bg-amber-500/10 border-amber-500/30",
      text: "text-amber-100",
      accent: "text-amber-300",
      icon: Clock,
      label: "HATIRLATMA",
    },
    warning: {
      bg: "bg-orange-500/10 border-orange-500/40",
      text: "text-orange-100",
      accent: "text-orange-300",
      icon: AlertTriangle,
      label: "UYARI",
    },
    critical: {
      bg: "bg-rose-500/15 border-rose-500/50",
      text: "text-rose-50",
      accent: "text-rose-200",
      icon: AlertTriangle,
      label: "KRİTİK",
    },
  }[info.severity] || {
    bg: "bg-amber-500/10 border-amber-500/30",
    text: "text-amber-100", accent: "text-amber-300", icon: Clock, label: "HATIRLATMA",
  };

  const Icon = tone.icon;
  const dayLabel = info.days_left === 0 ? "bugün" : info.days_left === 1 ? "1 gün" : `${info.days_left} gün`;

  return (
    <div
      data-testid="renewal-banner"
      data-severity={info.severity}
      className={`border-b ${tone.bg} ${tone.text} px-6 py-2.5 flex items-center justify-between gap-3 flex-wrap ${isCritical ? "animate-pulse-slow" : ""}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded ${tone.accent} border border-current/30 shrink-0`}>
          <Icon className="w-3 h-3" />
          {tone.label}
        </span>
        <div className="text-xs min-w-0">
          <b className={tone.accent}>
            {info.days_left <= 0 ? "Lisansınız sona erdi!" :
             `Lisansınız ${dayLabel} sonra sona eriyor`}
          </b>
          <span className="ml-2 text-slate-300/80 hidden md:inline">
            · {info.plan?.toUpperCase()} planı ·{" "}
            <span className="mono">{new Date(info.expires_at).toLocaleDateString("tr-TR")}</span>
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Link
          to="/panel/subscription?renew=1"
          data-testid="renewal-banner-cta"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-all ${
            isCritical
              ? "bg-rose-500 text-white hover:bg-rose-400 border-rose-400 shadow-lg shadow-rose-500/20"
              : "bg-indigo-500/25 text-indigo-100 hover:bg-indigo-500/40 border-indigo-400/40"
          }`}
        >
          <Sparkles className="w-3 h-3" />
          Şimdi Yenile
          <ArrowRight className="w-3 h-3" />
        </Link>
        {!isCritical && (
          <button
            data-testid="renewal-banner-dismiss"
            onClick={onDismiss}
            title="24 saatliğine gizle"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
