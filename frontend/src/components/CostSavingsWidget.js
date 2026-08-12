import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PiggyBank, ShieldCheck, TrendingUp, Clock } from "lucide-react";
import { api } from "@/lib/api";

/**
 * v43.10 Kalkan Kazancı — Landing üzerinde "spam engelleme = para kazancı" hikayesi.
 * Her engellenen mail ortalama 0.12 USD kaybı önler (IBM Cost of Data Breach araştırmasına
 * dayalı sektörel ortalama). Sunucu bandwith + operasyon zamanı + phishing kaybı toplamı.
 */
const COST_PER_SPAM_BLOCKED = 0.12;       // USD — bandwith + IT time avg
const COST_PER_PHISHING_STOP = 4.35;      // USD — orta ölçek işletme ortalama phishing kaybı önlemi
const COST_PER_VIRUS_STOP = 8.20;         // USD — malware clean-up ortalama maliyet

export default function CostSavingsWidget() {
  const q = useQuery({
    queryKey: ["landing-cost-savings"],
    queryFn: () => api.publicBlockedStats("all"),
    refetchInterval: 60000,
  });
  const d = q.data || {};
  const spam    = d.all_time_blocked || 0;
  const phish   = d.phishing_caught_all_time || 0;
  const virus   = d.virus_caught_all_time || 0;
  const usd = spam * COST_PER_SPAM_BLOCKED
            + phish * COST_PER_PHISHING_STOP
            + virus * COST_PER_VIRUS_STOP;

  // Odometer-style rolling number (2sn ease-out)
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf; const start = performance.now(); const from = display; const to = usd;
    const dur = 1600;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * ease);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usd]);
  const fmtUsd = (n) => "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
  const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

  const breakdown = [
    { icon: ShieldCheck, tone: "emerald", label: "Spam Engelleme",     val: spam * COST_PER_SPAM_BLOCKED, cnt: spam,  unit: "mail" },
    { icon: TrendingUp,  tone: "fuchsia", label: "Phishing Önleme",    val: phish * COST_PER_PHISHING_STOP, cnt: phish, unit: "phishing" },
    { icon: Clock,       tone: "rose",    label: "Virüs / Kötü Amaçlı", val: virus * COST_PER_VIRUS_STOP, cnt: virus, unit: "virüs" },
  ];

  return (
    <section className="py-16 border-t border-slate-800/60 relative overflow-hidden" data-testid="landing-cost-savings">
      {/* Radial ambient */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-10 left-1/4 w-96 h-96 rounded-full bg-emerald-500/8 blur-3xl"/>
        <div className="absolute bottom-10 right-1/4 w-96 h-96 rounded-full bg-teal-500/8 blur-3xl"/>
      </div>

      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-stretch">
          {/* Ana 3D kart */}
          <div className="col-span-1 lg:col-span-3 relative rounded-3xl p-8 overflow-hidden
                          bg-gradient-to-br from-emerald-500/15 via-slate-900/60 to-teal-500/10
                          border border-emerald-500/40 gws-cost-hero
                          shadow-[0_20px_60px_-20px_rgba(16,185,129,0.4),inset_0_1px_0_0_rgba(255,255,255,0.06)]">
            {/* Depth orbs */}
            <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-emerald-500/25 blur-3xl"/>
            <div className="absolute -bottom-20 -left-16 w-72 h-72 rounded-full bg-cyan-500/15 blur-3xl"/>
            {/* Grid mesh */}
            <div className="absolute inset-0 opacity-20 pointer-events-none
                            [background-image:linear-gradient(rgba(16,185,129,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.2)_1px,transparent_1px)]
                            [background-size:32px_32px]
                            [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_40%,transparent_100%)]"/>

            {/* Floating piggy bank */}
            <div className="relative z-10 flex items-start gap-4 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500
                              flex items-center justify-center
                              shadow-[0_10px_20px_-4px_rgba(16,185,129,0.5),inset_0_1px_0_0_rgba(255,255,255,0.3)]
                              -rotate-6 hover:rotate-0 transition-transform duration-500">
                <PiggyBank className="w-8 h-8 text-white drop-shadow-md" strokeWidth={2.25}/>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.25em] mono text-emerald-300 font-bold">
                  Kalkan Kazancı · Cost Prevented
                </div>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-100 mt-1 leading-tight">
                  Kullanıcılarımıza kazandırdığımız <span className="text-emerald-300">gerçek para</span>
                </h2>
              </div>
            </div>

            {/* Big number */}
            <div className="relative z-10">
              <div className="flex items-baseline gap-3 gws-cost-num-wrap">
                <span data-testid="cost-savings-value"
                      className="text-6xl md:text-7xl font-black tabular-nums
                                 bg-gradient-to-br from-emerald-200 via-emerald-100 to-teal-300
                                 bg-clip-text text-transparent leading-none tracking-tight
                                 drop-shadow-[0_0_30px_rgba(16,185,129,0.35)] gws-cost-value">
                  {fmtUsd(display)}
                </span>
                <span className="text-sm text-emerald-300/80 mono uppercase tracking-widest gws-cost-unit">tasarruf</span>
              </div>
              <div className="text-xs text-slate-400 mono mt-3 max-w-md gws-cost-hint">
                Her engellenen tehdit; bandwith, IT operasyon zamanı ve olası phishing/virüs kaybını önler.
                Toplam <span className="text-emerald-300 font-bold">{nfmt(spam + phish + virus)}</span> tehdit tüm zamanlar.
              </div>
            </div>
          </div>

          {/* Kırılım kartları */}
          <div className="col-span-1 lg:col-span-2 grid grid-cols-1 gap-3">
            {breakdown.map((b, i) => {
              const TONE = {
                emerald: { bg: "from-emerald-500/12 to-emerald-500/5", border: "border-emerald-500/40", ic: "from-emerald-400 to-teal-500", text: "text-emerald-300" },
                fuchsia: { bg: "from-fuchsia-500/12 to-fuchsia-500/5", border: "border-fuchsia-500/40", ic: "from-fuchsia-400 to-pink-500", text: "text-fuchsia-300" },
                rose:    { bg: "from-rose-500/12 to-rose-500/5",       border: "border-rose-500/40",    ic: "from-rose-400 to-red-500",     text: "text-rose-300"    },
              }[b.tone];
              return (
                <div key={i}
                     data-testid={`cost-breakdown-${b.tone}`}
                     className={`relative overflow-hidden rounded-2xl border ${TONE.border} bg-gradient-to-br ${TONE.bg} p-4 flex items-center gap-4
                                 shadow-[0_8px_28px_-10px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.06)]
                                 hover:-translate-y-1 transition-transform duration-300 gws-cost-tile`}>
                  <div className={`w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br ${TONE.ic} flex items-center justify-center
                                  shadow-[0_6px_16px_-4px_rgba(0,0,0,0.35),inset_0_1px_0_0_rgba(255,255,255,0.35)]`}>
                    <b.icon className="w-5 h-5 text-white" strokeWidth={2.25}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[10px] uppercase tracking-widest mono font-bold ${TONE.text} gws-cost-tile-label`}>{b.label}</div>
                    <div className="text-xl font-black tabular-nums text-slate-100 leading-none mt-0.5 gws-cost-tile-val">{fmtUsd(b.val)}</div>
                    <div className="text-[10px] text-slate-500 mono mt-0.5 gws-cost-tile-sub">
                      {nfmt(b.cnt)} {b.unit} önlendi
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Light theme overrides */}
      <style>{`
        .gws-landing-light .gws-cost-hero {
          background: linear-gradient(135deg, #ffffff 0%, #ecfdf5 50%, #ccfbf1 100%) !important;
          border-color: #6ee7b7 !important;
          box-shadow: 0 20px 60px -20px rgba(5,150,105,0.35), inset 0 1px 0 0 rgba(255,255,255,0.85) !important;
        }
        .gws-landing-light .gws-cost-value {
          background-image: linear-gradient(135deg, #047857, #059669, #0d9488) !important;
          -webkit-background-clip: text; background-clip: text; color: transparent !important;
        }
        .gws-landing-light .gws-cost-unit { color: #059669 !important; }
        .gws-landing-light .gws-cost-hint { color: #475569 !important; }
        .gws-landing-light .gws-cost-hint .text-emerald-300 { color: #047857 !important; }
        .gws-landing-light .gws-cost-tile {
          background: rgba(255,255,255,0.9) !important;
          box-shadow: 0 8px 24px -10px rgba(0,0,0,0.1), inset 0 1px 0 0 rgba(255,255,255,0.95) !important;
        }
        .gws-landing-light .gws-cost-tile-val { color: #0f172a !important; }
        .gws-landing-light .gws-cost-tile-sub { color: #64748b !important; }
      `}</style>
    </section>
  );
}
