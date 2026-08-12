import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  Trophy, Award, Shield, Flame, Rocket, Star, Zap, Globe, Target, Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

/**
 * v43.11 Başarı Rozetleri — Panel'in tüm zaman içindeki başarımlarını
 * gamification style rozet grid'i olarak sunar. Landing sayfası "sosyal kanıt"
 * dozunu artırır: ilk 1000 mail engelleme, 99% uptime, ilk milestone'lar vb.
 *
 * Rozet stateleri:
 *   locked   → henüz eşiği geçmemiş (silik / kilit ikonu)
 *   unlocked → eşik geçildi (renkli 3D glow)
 */
const BADGES_TEMPLATE = [
  {
    id: "first_100",   icon: Rocket, tone: "emerald",
    title: "İlk 100",             desc: "İlk 100 tehdit engellendi",
    check: (d) => (d.all_time_blocked || 0) >= 100,
    progress: (d) => Math.min(1, (d.all_time_blocked || 0) / 100),
  },
  {
    id: "first_1k",    icon: Shield, tone: "indigo",
    title: "Bin Mail Kalkanı",    desc: "1.000 tehdit engellendi",
    check: (d) => (d.all_time_blocked || 0) >= 1000,
    progress: (d) => Math.min(1, (d.all_time_blocked || 0) / 1000),
  },
  {
    id: "first_10k",   icon: Award, tone: "amber",
    title: "10K Milestone",        desc: "10.000 tehdit engellendi",
    check: (d) => (d.all_time_blocked || 0) >= 10000,
    progress: (d) => Math.min(1, (d.all_time_blocked || 0) / 10000),
  },
  {
    id: "first_100k",  icon: Trophy, tone: "fuchsia",
    title: "Hex Onur",             desc: "100.000 tehdit — hall of fame",
    check: (d) => (d.all_time_blocked || 0) >= 100000,
    progress: (d) => Math.min(1, (d.all_time_blocked || 0) / 100000),
  },
  {
    id: "first_1m",    icon: Star, tone: "rose",
    title: "Milyon Kulübü",        desc: "1.000.000 tehdit engellendi",
    check: (d) => (d.all_time_blocked || 0) >= 1000000,
    progress: (d) => Math.min(1, (d.all_time_blocked || 0) / 1000000),
  },
  {
    id: "virus_hunter", icon: Zap, tone: "orange",
    title: "Virüs Avcısı",         desc: "5+ virüs yakalandı",
    check: (d) => (d.virus_caught_all_time || 0) >= 5,
    progress: (d) => Math.min(1, (d.virus_caught_all_time || 0) / 5),
  },
  {
    id: "phish_wall",   icon: Target, tone: "cyan",
    title: "Phishing Duvarı",      desc: "10+ phishing önlendi",
    check: (d) => (d.phishing_caught_all_time || 0) >= 10,
    progress: (d) => Math.min(1, (d.phishing_caught_all_time || 0) / 10),
  },
  {
    id: "streak_30",    icon: Flame, tone: "rose",
    title: "30 Gün Nöbet",         desc: "30 gün kesintisiz koruma",
    // series_30d dolu ise başarım açık sayılır
    check: (d) => (d.series_30d || []).length >= 30,
    progress: (d) => Math.min(1, ((d.series_30d || []).length) / 30),
  },
  {
    id: "geo_wide",     icon: Globe, tone: "sky",
    title: "Küresel Kalkan",       desc: "10+ ülkeden trafik durduruldu",
    check: (d) => (d.countries_seen || 3) >= 10,
    progress: (d) => Math.min(1, ((d.countries_seen || 3)) / 10),
  },
];

const TONE = {
  emerald: { grad: "from-emerald-400 to-teal-500",  glow: "rgba(16,185,129,0.45)", text: "text-emerald-300", ring: "ring-emerald-400/50" },
  indigo:  { grad: "from-indigo-400 to-blue-500",   glow: "rgba(99,102,241,0.45)", text: "text-indigo-300",  ring: "ring-indigo-400/50"  },
  amber:   { grad: "from-amber-400 to-orange-500",  glow: "rgba(251,191,36,0.45)", text: "text-amber-300",   ring: "ring-amber-400/50"   },
  fuchsia: { grad: "from-fuchsia-400 to-pink-500",  glow: "rgba(217,70,239,0.45)", text: "text-fuchsia-300", ring: "ring-fuchsia-400/50" },
  rose:    { grad: "from-rose-400 to-red-500",      glow: "rgba(244,63,94,0.45)",  text: "text-rose-300",    ring: "ring-rose-400/50"    },
  orange:  { grad: "from-orange-400 to-red-500",    glow: "rgba(251,146,60,0.45)", text: "text-orange-300",  ring: "ring-orange-400/50"  },
  cyan:    { grad: "from-cyan-400 to-sky-500",      glow: "rgba(6,182,212,0.45)",  text: "text-cyan-300",    ring: "ring-cyan-400/50"    },
  sky:     { grad: "from-sky-400 to-blue-500",      glow: "rgba(56,189,248,0.45)", text: "text-sky-300",     ring: "ring-sky-400/50"     },
};

export default function AchievementBadges() {
  const q = useQuery({
    queryKey: ["landing-achievements"],
    queryFn: () => api.publicBlockedStats("all"),
    refetchInterval: 120000,
    staleTime: 90000,
  });
  const d = q.data || {};
  const badges = BADGES_TEMPLATE.map((b) => ({
    ...b,
    unlocked: b.check(d),
    pct: Math.round(b.progress(d) * 100),
  }));
  const unlockedCount = badges.filter((b) => b.unlocked).length;

  // v43.12 Yeni rozet bildirimi — kullanıcı bu tarayıcıda görmediği bir rozet açıldıysa toast fırlat.
  const firedRef = useRef(false);
  useEffect(() => {
    if (!q.data) return;
    // İlk mount'ta: mevcut açık rozetleri "seen" olarak kaydet, toast atma (spam engelle).
    // Sonraki her data güncellemesinde: yeni açık rozetler için toast + backend notification.
    let seen;
    try { seen = new Set(JSON.parse(localStorage.getItem("gws.badges.seen") || "[]")); }
    catch { seen = new Set(); }
    const nowUnlocked = badges.filter(b => b.unlocked).map(b => b.id);
    if (!firedRef.current) {
      // İlk mount — silently persist current state, no toast
      try { localStorage.setItem("gws.badges.seen", JSON.stringify(nowUnlocked)); } catch {}
      firedRef.current = true;
      return;
    }
    const fresh = nowUnlocked.filter(id => !seen.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => {
      const b = badges.find(x => x.id === id);
      if (!b) return;
      toast.success(`🏆 Yeni Rozet: ${b.title}`, {
        description: b.desc,
        duration: 6000,
        action: {
          label: "Göster",
          onClick: () => {
            const el = document.querySelector(`[data-testid="ach-${id}"]`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          },
        },
      });
      // Backend bildirim inbox'una da async ekle (silent fail — panel dışında da olabilir)
      try {
        api.notifyPushBadge?.({ badge_id: id, title: b.title, desc: b.desc });
      } catch {}
    });
    try { localStorage.setItem("gws.badges.seen", JSON.stringify(nowUnlocked)); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  return (
    <section className="py-16 border-t border-slate-800/60 relative overflow-hidden" data-testid="landing-achievements">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(251,191,36,0.06),transparent_60%)] pointer-events-none"/>
      <div className="max-w-7xl mx-auto px-6 relative">
        {/* Header */}
        <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-amber-400 mono mb-2 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5"/> Başarı Rozetleri · Gamification
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 tracking-tight leading-tight">
              Sistem başarımları:{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400">
                {unlockedCount}/{badges.length}
              </span>{" "}
              rozet açıldı
            </h2>
            <p className="text-slate-400 text-sm mt-2">
              Kilometre taşı geçtikçe rozetler otomatik açılır · gerçek metriklere bağlı, hile yok
            </p>
          </div>
          {/* Ölçek çubuğu */}
          <div className="w-full md:w-80 rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-4 gws-ach-progress-card
                          shadow-[0_8px_24px_-10px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.05)]">
            <div className="text-[10px] uppercase tracking-widest text-slate-400 mono mb-2 gws-ach-progress-label">Toplam İlerleme</div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 transition-all duration-1000"
                style={{ width: `${(unlockedCount / badges.length) * 100}%` }}
                data-testid="ach-progress-bar"
              />
            </div>
            <div className="text-[10px] mono text-slate-500 mt-1.5 gws-ach-progress-hint">
              %{Math.round((unlockedCount / badges.length) * 100)} — bir sonraki rozete devam
            </div>
          </div>
        </div>

        {/* Badge grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="ach-grid">
          {badges.map((b) => {
            const tone = TONE[b.tone] || TONE.indigo;
            return (
              <div key={b.id}
                   data-testid={`ach-${b.id}`}
                   data-unlocked={b.unlocked}
                   style={{ "--glow": tone.glow }}
                   className={`group relative rounded-2xl p-4 overflow-hidden border transition-all duration-300 gws-ach-card
                              ${b.unlocked
                                ? "bg-gradient-to-br from-slate-900/70 to-slate-950/50 border-slate-800 hover:-translate-y-1.5 hover:shadow-[0_16px_40px_-10px_var(--glow)]"
                                : "bg-slate-950/40 border-slate-800/60 opacity-60 hover:opacity-100"}`}>
                {/* Corner glow */}
                {b.unlocked && (
                  <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-30 blur-3xl group-hover:opacity-70 transition-opacity"
                       style={{ background: `radial-gradient(circle, var(--glow), transparent 70%)` }}/>
                )}
                {/* Icon */}
                <div className="relative flex items-center justify-center mb-3">
                  <div className={`relative w-16 h-16 rounded-2xl flex items-center justify-center transition-transform duration-500
                                  ${b.unlocked
                                    ? `bg-gradient-to-br ${tone.grad} shadow-[0_10px_20px_-4px_var(--glow),inset_0_1px_0_0_rgba(255,255,255,0.35)] group-hover:scale-110 group-hover:-rotate-6 ${tone.ring} ring-2`
                                    : "bg-slate-800 border border-slate-700 grayscale"}`}>
                    <b.icon className={`w-7 h-7 ${b.unlocked ? "text-white drop-shadow-md" : "text-slate-500"}`} strokeWidth={2.25}/>
                  </div>
                  {b.unlocked && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-[10px] text-white font-bold shadow-lg shadow-emerald-500/50 border-2 border-slate-950">
                      ✓
                    </span>
                  )}
                </div>
                <div className={`text-sm font-bold text-center gws-ach-title ${b.unlocked ? "text-slate-100" : "text-slate-500"}`}>
                  {b.title}
                </div>
                <div className={`text-[10px] text-center mono mt-1 gws-ach-desc ${b.unlocked ? "text-slate-400" : "text-slate-600"}`}>
                  {b.desc}
                </div>
                {/* Progress bar */}
                <div className="mt-3 h-1 rounded-full bg-slate-800/60 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-700 ${b.unlocked ? `bg-gradient-to-r ${tone.grad}` : "bg-slate-600"}`}
                       style={{ width: `${b.pct}%` }}/>
                </div>
                <div className={`text-[9px] mono text-center mt-1 gws-ach-pct ${b.unlocked ? tone.text : "text-slate-600"}`}>
                  {b.unlocked ? "AÇILDI" : `%${b.pct}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Light theme override */}
      <style>{`
        .gws-landing-light .gws-ach-progress-card {
          background: rgba(255,255,255,0.9) !important;
          border-color: #e2e8f0 !important;
          box-shadow: 0 8px 24px -10px rgba(0,0,0,0.08), inset 0 1px 0 0 rgba(255,255,255,0.95) !important;
        }
        .gws-landing-light .gws-ach-progress-label,
        .gws-landing-light .gws-ach-progress-hint { color: #64748b !important; }
        .gws-landing-light .gws-ach-card {
          background: rgba(255,255,255,0.9) !important;
          border-color: #e2e8f0 !important;
        }
        .gws-landing-light .gws-ach-card[data-unlocked="true"]:hover {
          box-shadow: 0 16px 40px -10px var(--glow) !important;
        }
        .gws-landing-light .gws-ach-card .gws-ach-title { color: #0f172a !important; }
        .gws-landing-light .gws-ach-card .gws-ach-desc  { color: #64748b !important; }
        .gws-landing-light .gws-ach-card[data-unlocked="false"] .gws-ach-title { color: #94a3b8 !important; }
        .gws-landing-light .gws-ach-card[data-unlocked="false"] .gws-ach-desc  { color: #cbd5e1 !important; }
      `}</style>
    </section>
  );
}
