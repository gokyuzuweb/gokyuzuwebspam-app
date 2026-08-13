import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Shield, Zap, Bug, Radar, ShieldCheck, Server, Globe, TrendingUp, Activity, Lock, Database,
} from "lucide-react";
import { api } from "@/lib/api";

/**
 * v43.15 HeroLivePreview — Landing hero'nun sağ sütununda gösterilen
 * canlı animasyonlu yönetim paneli önizlemesi. Referans görsellerdeki
 * "hareketli kalkan + canlı istatistikler + saldırı çizgileri" layout'unu
 * sağlar. Panel arkaplanında Framer-benzeri yumuşak float animasyonları,
 * gerçek zamanlı veri (10sn refetch), hover'da tile highlight'ı bulunur.
 */
export default function HeroLivePreview() {
  const q = useQuery({
    queryKey: ["landing-hero-preview"],
    queryFn: () => api.publicBlockedStats("all"),
    refetchInterval: 10000,
    staleTime: 5000,
  });
  const d = q.data || {};
  const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

  // Rolling odometer for the giant "Bugün Engellenen" number
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const to = d.today_blocked || 0;
    let raf; const start = performance.now(); const from = display; const dur = 1400;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.today_blocked]);

  return (
    <div className="relative w-full max-w-[560px] mx-auto" data-testid="hero-live-preview">
      {/* Radial ambient glow */}
      <div className="absolute inset-0 pointer-events-none -z-10">
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full bg-indigo-500/15 blur-3xl gws-hero-orb1"/>
        <div className="absolute bottom-0 right-10 w-72 h-72 rounded-full bg-fuchsia-500/12 blur-3xl gws-hero-orb2"/>
      </div>

      {/* Ana container — 3D perspective */}
      <div className="relative rounded-2xl border border-slate-700/50 overflow-hidden
                      bg-gradient-to-br from-slate-900/90 via-slate-950/80 to-slate-900/90
                      shadow-[0_30px_70px_-20px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.06)]
                      backdrop-blur-lg gws-hero-panel">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800/60 bg-slate-950/60">
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-70 animate-ping"/>
            <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500"/>
          </span>
          <span className="mono text-[10px] uppercase tracking-widest text-emerald-300 font-bold">Canlı Sistem</span>
          <div className="ml-auto flex items-center gap-1.5 text-[9px] mono text-slate-500">
            <Activity className="w-3 h-3 text-indigo-400 gws-hero-actv"/> gerçek zamanlı · 10sn
          </div>
        </div>

        {/* Body */}
        <div className="relative p-4 min-h-[380px]">
          {/* Grid mesh */}
          <div className="absolute inset-0 opacity-25 pointer-events-none
                          [background-image:linear-gradient(rgba(99,102,241,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.15)_1px,transparent_1px)]
                          [background-size:24px_24px]
                          [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_40%,transparent_100%)]"/>

          {/* Animated shield in the center — "git gel" back-and-forth */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative gws-hero-shield-wrap">
              {/* Aura pulse rings */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-40 h-40 rounded-full border border-indigo-400/30 gws-hero-ring1"/>
                <div className="absolute w-32 h-32 rounded-full border border-fuchsia-400/40 gws-hero-ring2"/>
                <div className="absolute w-24 h-24 rounded-full border border-cyan-400/30 gws-hero-ring3"/>
              </div>
              {/* Shield */}
              <div className="relative w-24 h-28 flex items-center justify-center">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-purple-600
                                rounded-[42%_42%_44%_44%_/_58%_58%_42%_42%] rotate-0
                                shadow-[0_10px_40px_-6px_rgba(99,102,241,0.7),inset_0_2px_0_0_rgba(255,255,255,0.35),inset_0_-20px_40px_0_rgba(147,51,234,0.5)]"/>
                <Shield className="relative w-12 h-12 text-white drop-shadow-[0_4px_10px_rgba(0,0,0,0.4)]" strokeWidth={2.25}/>
              </div>
              {/* Attack lines (SVG) — 4 lines converging */}
              <svg className="absolute -inset-16 w-[calc(100%+8rem)] h-[calc(100%+8rem)] pointer-events-none" viewBox="0 0 220 220" fill="none">
                <defs>
                  <linearGradient id="atk1" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity="0"/>
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.7"/>
                  </linearGradient>
                  <linearGradient id="atk2" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#f97316" stopOpacity="0"/>
                    <stop offset="100%" stopColor="#f97316" stopOpacity="0.7"/>
                  </linearGradient>
                </defs>
                {/* Top-left attack */}
                <line x1="10" y1="20" x2="110" y2="110" stroke="url(#atk1)" strokeWidth="1.5" strokeDasharray="4 6" className="gws-hero-atk-line" style={{ animationDelay: "0s" }}/>
                <line x1="210" y1="30" x2="110" y2="110" stroke="url(#atk2)" strokeWidth="1.5" strokeDasharray="4 6" className="gws-hero-atk-line" style={{ animationDelay: "0.5s" }}/>
                <line x1="200" y1="200" x2="110" y2="110" stroke="url(#atk1)" strokeWidth="1.5" strokeDasharray="4 6" className="gws-hero-atk-line" style={{ animationDelay: "1s" }}/>
                <line x1="20" y1="190" x2="110" y2="110" stroke="url(#atk2)" strokeWidth="1.5" strokeDasharray="4 6" className="gws-hero-atk-line" style={{ animationDelay: "1.5s" }}/>
              </svg>
            </div>
          </div>

          {/* Top-left tile: Canlı Sistem + Bugün Engellenen */}
          <div className="relative w-fit rounded-lg border border-indigo-500/40 bg-indigo-500/10 backdrop-blur
                          px-3 py-2 mb-3 z-10 hover:scale-[1.03] hover:border-indigo-400/70 transition-all cursor-pointer"
               data-testid="hero-preview-today">
            <div className="text-[9px] uppercase tracking-widest text-indigo-300 mono font-bold">Bugün Engellenen</div>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-2xl mono font-black text-indigo-100 tabular-nums leading-none">{nfmt(display)}</span>
              <span className="text-[9px] text-indigo-300 opacity-70">mail</span>
            </div>
          </div>

          {/* Bottom-left tile: Yakalanan Virüs + Bloklu IP */}
          <div className="absolute left-4 bottom-16 flex flex-col gap-2 z-10">
            <MiniTile
              testid="hero-preview-virus"
              icon={Bug} tone="rose"
              label="Yakalanan Virüs"
              value={nfmt(d.virus_caught_all_time)}
              unit="adet"
            />
            <MiniTile
              testid="hero-preview-ip"
              icon={Lock} tone="cyan"
              label="Bloklu IP"
              value={nfmt(d.ips_blocked)}
              unit="IP"
            />
          </div>

          {/* Right-side tiles */}
          <div className="absolute right-4 top-16 flex flex-col gap-2 z-10">
            <MiniTile
              testid="hero-preview-phishing"
              icon={Radar} tone="fuchsia"
              label="Yakalanan Phishing"
              value={nfmt(d.phishing_caught_all_time)}
              unit="adet"
            />
            <MiniTile
              testid="hero-preview-ioc"
              icon={Globe} tone="emerald"
              label="Tehdit İstihbaratı"
              value={nfmt(d.iocs_tracked)}
              unit="IOC"
            />
          </div>

          {/* Server rack ikon (dekoratif) */}
          <div className="absolute right-6 bottom-4 flex flex-col gap-1 opacity-40 z-10 gws-hero-server">
            <Server className="w-8 h-8 text-indigo-400"/>
            <Database className="w-8 h-8 text-fuchsia-400"/>
          </div>

          {/* Bottom animated sparkline */}
          <div className="absolute bottom-4 left-4 right-32 z-10">
            <HeroSpark values={(d.series_30d || []).slice(-24).map(x => x.count)}/>
          </div>
        </div>

        {/* Footer strip — trust + micro CTA */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-800/60 bg-slate-950/60">
          <span className="text-[9px] mono text-slate-500 uppercase tracking-widest">Trusted by</span>
          <span className="text-[10px] mono text-emerald-300 font-bold">500+ WHM sunucusu</span>
          <span className="mx-2 w-1 h-1 rounded-full bg-slate-700"/>
          <span className="text-[10px] mono text-slate-400">
            {nfmt(d.all_time_blocked)} tehdit engellendi · tüm zamanlar
          </span>
        </div>
      </div>

      {/* Recent purchase floating card (sağ üst köşe) */}
      <div className="absolute -top-3 -right-3 rounded-lg border border-emerald-500/50
                      bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 backdrop-blur
                      px-2.5 py-1.5 shadow-[0_8px_20px_-6px_rgba(16,185,129,0.5)] gws-hero-purchase-card
                      hidden md:block max-w-[180px] z-20 hover:scale-[1.03] transition-transform">
        <div className="flex items-center gap-1.5 text-[9px] mono uppercase tracking-widest text-emerald-300 font-bold">
          <span className="relative flex w-1.5 h-1.5">
            <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-70 animate-ping"/>
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-500"/>
          </span>
          Yeni Satın Alan
        </div>
        <div className="text-[10px] text-slate-100 font-semibold mt-0.5 truncate">Marmara Tech Ltd.</div>
        <div className="text-[9px] text-slate-400 mono truncate">🇹🇷 Bursa · Organik'te</div>
      </div>

      {/* Animation styles */}
      <style>{`
        .gws-hero-panel { animation: gws-hero-float 6s ease-in-out infinite; }
        .gws-hero-shield-wrap { animation: gws-hero-shield-motion 3.6s ease-in-out infinite; }
        .gws-hero-ring1 { animation: gws-hero-ring 3s ease-in-out infinite; }
        .gws-hero-ring2 { animation: gws-hero-ring 3s ease-in-out infinite 0.5s; }
        .gws-hero-ring3 { animation: gws-hero-ring 3s ease-in-out infinite 1s; }
        .gws-hero-orb1 { animation: gws-hero-orb 8s ease-in-out infinite; }
        .gws-hero-orb2 { animation: gws-hero-orb 8s ease-in-out infinite 2s; }
        .gws-hero-actv { animation: gws-hero-pulse 1.6s ease-in-out infinite; }
        .gws-hero-server { animation: gws-hero-float-slow 5s ease-in-out infinite; }
        .gws-hero-purchase-card { animation: gws-hero-float-slow 4s ease-in-out infinite 1s; }
        .gws-hero-atk-line {
          stroke-dasharray: 4 6;
          animation: gws-hero-atk-dash 1.6s linear infinite;
        }
        @keyframes gws-hero-shield-motion {
          0%, 100% { transform: translateX(-8px) rotate(-1deg); }
          50%      { transform: translateX(8px) rotate(1deg); }
        }
        @keyframes gws-hero-float {
          0%, 100% { transform: translateY(0px); }
          50%      { transform: translateY(-6px); }
        }
        @keyframes gws-hero-float-slow {
          0%, 100% { transform: translateY(0px); }
          50%      { transform: translateY(-4px); }
        }
        @keyframes gws-hero-ring {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50%      { transform: scale(1.15); opacity: 0.2; }
        }
        @keyframes gws-hero-orb {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(15px, -10px) scale(1.1); }
        }
        @keyframes gws-hero-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }
        @keyframes gws-hero-atk-dash {
          to { stroke-dashoffset: -20; }
        }
        /* Light theme */
        .gws-landing-light .gws-hero-panel {
          background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(240,249,255,0.9)) !important;
          border-color: #dbeafe !important;
          box-shadow: 0 30px 70px -20px rgba(30,58,138,0.25), inset 0 1px 0 0 rgba(255,255,255,0.95) !important;
        }
        .gws-landing-light .gws-hero-panel .text-indigo-100 { color: #1e3a8a !important; }
      `}</style>
    </div>
  );
}

/** Mini tile — 3D glass icon + label + big number */
function MiniTile({ icon: Icon, tone, label, value, unit, testid }) {
  const TONE = {
    rose:    { grad: "from-rose-400 to-red-500",       border: "border-rose-500/40",    bg: "bg-rose-500/10",    text: "text-rose-100"    },
    cyan:    { grad: "from-cyan-400 to-sky-500",       border: "border-cyan-500/40",    bg: "bg-cyan-500/10",    text: "text-cyan-100"    },
    fuchsia: { grad: "from-fuchsia-400 to-pink-500",   border: "border-fuchsia-500/40", bg: "bg-fuchsia-500/10", text: "text-fuchsia-100" },
    emerald: { grad: "from-emerald-400 to-teal-500",   border: "border-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-100" },
  }[tone] || {};
  return (
    <div data-testid={testid}
         className={`rounded-lg border ${TONE.border} ${TONE.bg} backdrop-blur px-2.5 py-1.5
                    hover:scale-[1.06] hover:brightness-125 transition-all cursor-pointer
                    shadow-[0_4px_12px_-4px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.06)]`}>
      <div className="flex items-center gap-1.5">
        <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${TONE.grad} flex items-center justify-center
                        shadow-[0_3px_8px_-2px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.35)]`}>
          <Icon className="w-3 h-3 text-white"/>
        </div>
        <div className="text-[8px] uppercase tracking-widest text-slate-400 mono leading-tight">{label}</div>
      </div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={`text-base mono font-black tabular-nums leading-none ${TONE.text}`}>{value}</span>
        <span className="text-[8px] text-slate-500 mono">{unit}</span>
      </div>
    </div>
  );
}

/** Bottom animated sparkline — SVG-only */
function HeroSpark({ values }) {
  const arr = (values && values.length > 0) ? values : [3, 5, 4, 7, 6, 9, 8, 12, 10, 14, 13, 16, 14, 18, 20, 17, 22, 19, 24, 21, 26, 23, 28, 25];
  const w = 260, h = 40;
  const max = Math.max(...arr, 1);
  const step = w / (arr.length - 1 || 1);
  const pts = arr.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <div className="rounded-md border border-slate-800/60 bg-slate-950/60 backdrop-blur p-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] uppercase tracking-widest mono text-emerald-300 font-bold">Son 24 Saat · Trend</span>
        <span className="text-[9px] mono text-slate-500 flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5 text-emerald-400"/> canlı</span>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="hero-spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.5"/>
            <stop offset="100%" stopColor="#10b981" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <polygon fill="url(#hero-spark-fill)" points={`0,${h} ${pts} ${w},${h}`}/>
        <polyline fill="none" stroke="#34d399" strokeWidth="1.5" points={pts}
                  className="gws-hero-spark-line"/>
      </svg>
      <style>{`
        .gws-hero-spark-line { stroke-dasharray: 900; animation: gws-hero-spark-draw 3s ease-out forwards; }
        @keyframes gws-hero-spark-draw {
          from { stroke-dashoffset: 900; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}
