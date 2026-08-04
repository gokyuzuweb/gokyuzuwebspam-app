import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, Zap, Users2 } from "lucide-react";
import { api } from "@/lib/api";

/**
 * LiveTicker — Landing sayfasında sabit alt-orta konumda duran, 5sn'de bir
 * yenilenen canlı "son dakikada X saldırı engellendi" banner'ı. Ziyaretçilere
 * sistemin canlı çalıştığını gösterir (sosyal ispat + güven artışı).
 *
 * • Poll her 5sn — network yükü ~2KB/req
 * • Sayı yumuşak animasyon ile artar (odometer effect)
 * • Mobilde sticky-bottom, desktop'ta floating pill
 */
export default function LiveTicker() {
  const q = useQuery({
    queryKey: ["public-live-ticker"],
    queryFn: api.publicLiveTicker,
    refetchInterval: 5000,
    retry: false,
    staleTime: 4000,
  });

  const data = q.data || {};
  const m1 = data.blocked_last_minute ?? 0;
  const h1 = data.blocked_last_hour ?? 0;
  const bayi = data.active_resellers ?? 0;

  return (
    <div
      data-testid="landing-live-ticker"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(96%,720px)] pointer-events-none"
    >
      <div className="pointer-events-auto rounded-full border border-emerald-500/30 bg-slate-950/85 backdrop-blur-xl shadow-2xl shadow-emerald-500/10 px-3 py-2 flex items-center gap-3 flex-wrap md:flex-nowrap justify-center">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
        </span>
        <div className="text-[11px] md:text-xs text-emerald-100 font-medium flex items-center gap-1.5 min-w-0">
          <Shield className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
          <span className="hidden sm:inline text-slate-400">Son dakikada</span>
          <Odometer value={m1} testid="lt-m1" className="text-emerald-300 font-bold tabular-nums" />
          <span className="text-slate-300">saldırı engellendi</span>
        </div>
        <span className="hidden md:inline text-slate-700">·</span>
        <div className="text-[11px] md:text-xs text-slate-400 flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-amber-300" />
          <span className="hidden lg:inline">Son 1 saat:</span>
          <Odometer value={h1} testid="lt-h1" className="text-amber-200 font-semibold tabular-nums" />
        </div>
        <span className="hidden md:inline text-slate-700">·</span>
        <div className="text-[11px] md:text-xs text-slate-400 flex items-center gap-1.5">
          <Users2 className="w-3 h-3 text-sky-300" />
          <Odometer value={bayi} testid="lt-bayi" className="text-sky-200 font-semibold tabular-nums" />
          <span className="hidden lg:inline">aktif bayi</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Odometer — sayı değiştiğinde 400ms boyunca yumuşak count-up animasyonu.
 * Aynı değer geldiğinde re-render'ı skip eder (network polling'de sayı sabit
 * kalırsa animasyon flicker etmez).
 */
function Odometer({ value = 0, testid, className = "" }) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) return;
    const duration = 500;
    const start = performance.now();
    let raf;
    const step = (t) => {
      const elapsed = t - start;
      const p = Math.min(elapsed / duration, 1);
      // ease-out-quad
      const eased = 1 - (1 - p) * (1 - p);
      const next = Math.round(from + (to - from) * eased);
      setDisplay(next);
      if (p < 1) raf = requestAnimationFrame(step);
      else prevRef.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => raf && cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span data-testid={testid} className={className}>
      {Number(display).toLocaleString("tr-TR")}
    </span>
  );
}
