/**
 * ModuleTourCTA — Landing page section that invites visitors to watch
 * the 4-minute animated module tour. v43.99.20
 */
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Play, Sparkles, Clock, Layers, Shield, Cpu, BarChart3, Lock,
  ChevronRight,
} from "lucide-react";

const PREVIEW_BUBBLES = [
  { icon: Cpu,       label: "Çekirdek Motorlar",  count: 5,  color: "from-cyan-500 to-blue-600" },
  { icon: Shield,    label: "Threat Defense",     count: 10, color: "from-fuchsia-500 to-rose-500" },
  { icon: BarChart3, label: "Raporlama",          count: 4,  color: "from-emerald-500 to-teal-500" },
  { icon: Lock,      label: "Sistem Güvenliği",   count: 5,  color: "from-amber-500 to-orange-500" },
];

export default function ModuleTourCTA() {
  return (
    <section
      id="module-tour"
      data-testid="landing-module-tour-cta"
      className="relative py-20 border-t border-slate-800/60 overflow-hidden"
    >
      {/* Animated backdrop */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/40 via-slate-950 to-fuchsia-950/40" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(168,85,247,0.15),transparent_60%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:60px_60px]" />

      <div className="relative max-w-6xl mx-auto px-6">
        {/* Heading */}
        <div className="text-center mb-12">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/30 text-fuchsia-200 text-[11px] uppercase tracking-widest font-bold mb-4"
          >
            <Sparkles className="w-3 h-3" /> Yeni · Etkileşimli Tur
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight"
          >
            24 Modül · 4 Dakika · <span className="bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-rose-400 bg-clip-text text-transparent">Tek Bir Turda</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="text-slate-400 mt-4 max-w-2xl mx-auto text-base leading-relaxed"
          >
            Sistemi kurmadan önce içinde ne var görün. Her modül canlı animasyonlu tanıtımla anlatılıyor — otomatik oynatılır, istediğinizde duraklatabilirsiniz.
          </motion.p>
        </div>

        {/* Preview + CTA card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="relative rounded-2xl border border-slate-800 overflow-hidden shadow-2xl bg-gradient-to-br from-slate-900 to-slate-950"
        >
          {/* Header bar (mimics browser) */}
          <div className="bg-slate-900/80 border-b border-slate-800 px-4 py-2.5 flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            </div>
            <div className="mx-auto text-[11px] text-slate-500 mono">gokyuzuwebspam.com/moduller-turu</div>
            <div className="w-8" />
          </div>

          {/* Body */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-0">
            {/* Left: Play area with pulsing button */}
            <Link
              to="/moduller-turu"
              data-testid="landing-mt-play"
              className="relative group aspect-video lg:aspect-auto min-h-[280px] flex items-center justify-center bg-gradient-to-br from-indigo-950 via-slate-900 to-fuchsia-950 hover:brightness-125 transition-all overflow-hidden"
            >
              {/* Animated backdrop */}
              <div className="absolute inset-0 opacity-40">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    animate={{
                      scale: [1, 1.6, 1],
                      opacity: [0.4, 0, 0.4],
                    }}
                    transition={{ duration: 3, delay: i * 1, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full bg-fuchsia-500/30 blur-xl"
                  />
                ))}
              </div>
              {/* Floating module icons */}
              {PREVIEW_BUBBLES.map((b, i) => {
                const Icon = b.icon;
                const positions = [
                  { top: "18%", left: "15%" },
                  { top: "22%", right: "18%" },
                  { bottom: "24%", left: "20%" },
                  { bottom: "18%", right: "16%" },
                ][i];
                return (
                  <motion.div
                    key={i}
                    animate={{ y: [0, -8, 0] }}
                    transition={{ duration: 3 + i * 0.3, repeat: Infinity, ease: "easeInOut", delay: i * 0.5 }}
                    style={positions}
                    className={`absolute w-14 h-14 rounded-xl bg-gradient-to-br ${b.color} flex items-center justify-center shadow-xl backdrop-blur-sm ring-2 ring-white/10`}
                  >
                    <Icon className="w-6 h-6 text-white" strokeWidth={2.5} />
                  </motion.div>
                );
              })}
              {/* Play button */}
              <div className="relative z-10 flex flex-col items-center gap-3">
                <motion.div
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="relative"
                >
                  <div className="absolute inset-0 rounded-full bg-fuchsia-500/40 blur-2xl scale-150" />
                  <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                    <Play className="w-10 h-10 text-white fill-white ml-1.5" strokeWidth={0} />
                  </div>
                </motion.div>
                <div className="text-white text-sm font-bold tracking-wider drop-shadow-lg">TURU BAŞLAT</div>
                <div className="text-slate-300 text-[11px] mono">~4 dk · Otomatik oynatma</div>
              </div>
            </Link>

            {/* Right: Section breakdown */}
            <div className="p-6 lg:p-8 flex flex-col justify-center">
              <div className="text-[10px] uppercase tracking-widest text-fuchsia-300 font-bold mb-4">
                Bu turda ne göreceksiniz?
              </div>
              <div className="space-y-3">
                {PREVIEW_BUBBLES.map((b, i) => {
                  const Icon = b.icon;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.2 + i * 0.1 }}
                      className="flex items-center gap-3 group"
                    >
                      <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${b.color} flex items-center justify-center shrink-0 shadow-md`}>
                        <Icon className="w-5 h-5 text-white" strokeWidth={2.5} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm font-bold">{b.label}</div>
                        <div className="text-slate-400 text-xs">
                          <span className="text-fuchsia-300 font-mono font-bold">{b.count}</span> modül tanıtımı
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-1 transition-all" />
                    </motion.div>
                  );
                })}
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800 flex items-center gap-4 text-[11px]">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Clock className="w-3.5 h-3.5" />
                  <span>~4 dakika</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Layers className="w-3.5 h-3.5" />
                  <span>24 modül</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400 ml-auto font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  ÜCRETSİZ
                </div>
              </div>

              <Link
                to="/moduller-turu"
                data-testid="landing-mt-cta"
                className="mt-5 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-500 hover:from-indigo-400 hover:to-fuchsia-400 text-white text-sm font-bold shadow-lg hover:shadow-xl hover:shadow-fuchsia-500/30 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                Modül Turunu Şimdi Başlat
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </motion.div>

        <div className="text-center mt-8">
          <p className="text-[11px] text-slate-500">
            💡 Kayıt gerekmez · Ürünü satın almadan tüm modülleri gerçek zamanlı görebilirsiniz
          </p>
        </div>
      </div>
    </section>
  );
}
