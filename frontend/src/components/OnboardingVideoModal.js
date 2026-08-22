/**
 * OnboardingVideoModal — v44.00.03
 *
 * Yeni bir bayı Panele ilk giriş yaptığında ~60 saniyelik 8-adımlı
 * kurulum animasyonunu tam-ekran modal olarak oynatır.
 *
 * · Master'a gösterilmez (`isMaster === true` iken hiç mount olmaz)
 * · Bir kez oynatılır — localStorage `gws.onboarding_video_seen`
 * · Her adım ~7.5 saniye (8 × 7.5 ≈ 60sn); auto-advance
 * · Skip / Duraklat / İleri / Geri / Kapat kontrolleri
 * · ESC ile kapanır
 *
 * Kullanım: <OnboardingVideoModal /> App.js'de render edilir.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, ChevronLeft, ChevronRight, X, SkipForward, Rocket } from "lucide-react";
import InstallStepSimulator from "@/components/InstallSimulations";
import { useIsMaster } from "@/hooks/useIsMaster";

const SEEN_KEY = "gws.onboarding_video_seen";
const STEPS = [1, 2, 3, 4, 5, 6, 7, 8]; // matches InstallSimulations STEPS
const STEP_MS = 7500; // 8 × 7.5s = 60s
const STEP_LABELS = {
  1: "cPanel WHM sunucusunda root erişim",
  2: "install.sh betiğini indir",
  3: "chmod ile çalıştırma izni ver",
  4: "Kurulum betiğini başlat",
  5: "Bağımlılıklar (Perl, ClamAV, DCC, Razor)",
  6: "MailScanner + Exim entegrasyonu",
  7: "GökyüzüWebSpam servisleri başlar",
  8: "WHM iframe içinden panele giriş",
};

export default function OnboardingVideoModal() {
  const { isMaster } = useIsMaster();
  const [open, setOpen] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(null);
  const startRef = useRef(Date.now());

  // İlk mount + master değilse + henüz görmediyse → aç
  useEffect(() => {
    if (isMaster) return;
    try {
      if (localStorage.getItem(SEEN_KEY) === "1") return;
    } catch {}
    // Küçük gecikme ile aç (LicenseGate veya diğer modallarla çakışmasın)
    const t = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(t);
  }, [isMaster]);

  // Auto-advance
  useEffect(() => {
    if (!open || !playing) return;
    startRef.current = Date.now();
    const tick = () => {
      const e = Date.now() - startRef.current;
      const p = Math.min(100, (e / STEP_MS) * 100);
      setProgress(p);
      if (e >= STEP_MS) {
        if (stepIdx < STEPS.length - 1) {
          setStepIdx(i => i + 1);
        } else {
          markSeen(); setOpen(false); return;
        }
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [open, playing, stepIdx]);

  // ESC → kapat
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") { markSeen(); setOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const markSeen = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch {} };
  const skip = () => { markSeen(); setOpen(false); };
  const next = () => { if (stepIdx < STEPS.length - 1) { setStepIdx(i => i + 1); setProgress(0); startRef.current = Date.now(); } };
  const prev = () => { if (stepIdx > 0) { setStepIdx(i => i - 1); setProgress(0); startRef.current = Date.now(); } };

  const overall = useMemo(
    () => ((stepIdx + progress / 100) / STEPS.length) * 100,
    [stepIdx, progress]
  );

  if (isMaster || !open) return null;
  const currentStep = STEPS[stepIdx];

  return (
    <AnimatePresence>
      <motion.div
        key="onboarding-modal"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4"
        data-testid="onboarding-video-modal"
      >
        {/* Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:60px_60px] pointer-events-none" />

        {/* Content */}
        <div className="relative w-full max-w-5xl bg-slate-900/80 border border-slate-800 rounded-2xl shadow-2xl shadow-indigo-500/10 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-indigo-950/60 via-slate-900/60 to-fuchsia-950/40">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center">
                <Rocket className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-100">GökyüzüWebSpam · Hoş Geldin Turu</div>
                <div className="text-[11px] text-slate-500">~60 saniyede 8 adımda kurulum akışı — sonra hazırsın</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={skip}
                data-testid="onboarding-skip"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-700 bg-slate-900/60 hover:border-slate-600 text-slate-300 hover:text-white text-xs font-semibold transition"
                title="Turu atla"
              >
                <SkipForward className="w-3.5 h-3.5" />
                Atla
              </button>
              <button
                onClick={skip}
                data-testid="onboarding-close"
                className="p-1.5 rounded-md hover:bg-white/5 text-slate-500 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Simulator body */}
          <div className="relative min-h-[420px] max-h-[65vh] overflow-hidden bg-slate-950">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="p-6"
              >
                <div className="text-[10px] uppercase tracking-widest text-indigo-400 mono mb-1">
                  Adım {stepIdx + 1} / {STEPS.length}
                </div>
                <div className="text-lg font-bold text-slate-100 mb-4">{STEP_LABELS[currentStep]}</div>
                <InstallStepSimulator stepId={currentStep} />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Controls + progress */}
          <div className="border-t border-slate-800 bg-slate-950/70 px-6 py-3">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-rose-400 transition-[width] duration-100"
                  style={{ width: `${overall}%` }}
                />
              </div>
              <div className="text-[10px] mono text-slate-400 min-w-[52px] text-right">
                {Math.round(overall)}%
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                {STEPS.map((s, i) => (
                  <button
                    key={s}
                    onClick={() => { setStepIdx(i); setProgress(0); startRef.current = Date.now(); }}
                    data-testid={`onboarding-step-dot-${s}`}
                    className={`h-1.5 rounded-full transition-all ${
                      i === stepIdx ? "w-6 bg-indigo-400" : i < stepIdx ? "w-1.5 bg-emerald-400/60" : "w-1.5 bg-slate-700 hover:bg-slate-600"
                    }`}
                    title={`Adım ${s}`}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={prev}
                  disabled={stepIdx === 0}
                  data-testid="onboarding-prev"
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-300 transition"
                  title="Önceki"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPlaying(p => !p)}
                  data-testid="onboarding-play-pause"
                  className="w-10 h-10 rounded-full bg-indigo-500/30 hover:bg-indigo-500/50 ring-1 ring-indigo-400/50 flex items-center justify-center text-indigo-100 transition"
                  title={playing ? "Duraklat" : "Devam Et"}
                >
                  {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>
                <button
                  onClick={next}
                  disabled={stepIdx >= STEPS.length - 1}
                  data-testid="onboarding-next"
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-300 transition"
                  title="Sonraki"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <div className="text-[10px] mono text-slate-500 ml-2">
                  {stepIdx + 1} / {STEPS.length}
                </div>
              </div>
            </div>
            <div className="text-center text-[10px] text-slate-500 mt-2">
              💡 İstediğin adıma tıklayabilirsin · ESC ile kapat · Bir kez gösterilir
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
