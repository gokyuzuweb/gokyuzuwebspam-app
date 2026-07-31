import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { CheckCircle2, Circle, X, ArrowRight, Key, Server, Palette, CreditCard, Sparkles, Rocket } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

/**
 * Onboarding banner + wizard. Master sees a persistent progress card until
 * all 4 setup steps are done. Auto-dismissed once the master hits "Bitti".
 * Backend `/api/admin/onboarding-status` returns per-step done flags.
 */
export default function OnboardingWizard() {
  const { isMaster } = useIsMaster();
  const licenseKey = typeof window !== "undefined"
    ? (localStorage.getItem("gws.event_license") || "") : "";
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(
    typeof window !== "undefined" && localStorage.getItem("gws.onboarding_dismissed") === "1"
  );
  const q = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => api.adminOnboardingStatus(licenseKey),
    enabled: isMaster && !dismissed,
    retry: false,
    staleTime: 30000,
  });
  const complete = useMutation({
    mutationFn: () => api.adminOnboardingComplete(licenseKey),
    onSuccess: () => {
      toast.success("Kurulum tamamlandı 🎉");
      localStorage.setItem("gws.onboarding_dismissed", "1");
      setDismissed(true);
      qc.invalidateQueries({ queryKey: ["onboarding-status"] });
    },
  });

  if (!isMaster || dismissed || !q.data) return null;
  if (q.data.completed) return null;

  const stepMeta = {
    license:  { Icon: Key,       route: "/panel/licenses",     hint: "Master için aktif Enterprise lisans" },
    smtp:     { Icon: Server,    route: "/panel/notifications", hint: "Mail bildirimleri için SMTP relay" },
    branding: { Icon: Palette,   route: "/reseller",            hint: "Logo + marka rengi (bayi paneli görünümü)" },
    stripe:   { Icon: CreditCard,route: "/panel/pricing",       hint: "Ödeme kabul etmek için Stripe key" },
  };
  const pct = Math.round((q.data.done_count / q.data.total) * 100);

  return (
    <div className="rounded-lg border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-slate-900/50 to-rose-500/10 p-4 shadow-lg"
         data-testid="onboarding-wizard">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-slate-100 font-bold text-base">Kurulum Sihirbazı</div>
              <span className="text-[10px] mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold">
                {q.data.done_count}/{q.data.total}
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Panel'i tam çalışır hale getirmek için 4 küçük adım</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {q.data.done_count === q.data.total ? (
            <button
              onClick={() => complete.mutate()}
              disabled={complete.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-xs font-bold shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 disabled:opacity-50"
              data-testid="onboarding-finish"
            >
              <Rocket className="w-3.5 h-3.5" /> Kurulum Tamam
            </button>
          ) : (
            <button
              onClick={() => {
                localStorage.setItem("gws.onboarding_dismissed", "1");
                setDismissed(true);
              }}
              className="text-slate-400 hover:text-slate-100 p-1 rounded hover:bg-slate-800"
              title="Şimdilik kapat"
              data-testid="onboarding-dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-3 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500 transition-all duration-500"
             style={{ width: `${pct}%` }} />
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {q.data.steps.map((s, i) => {
          const meta = stepMeta[s.key] || {};
          const Icon = meta.Icon || Circle;
          return (
            <NavLink
              key={s.key}
              to={meta.route || "/"}
              data-testid={`onboarding-step-${s.key}`}
              className={`flex items-center gap-2.5 p-2.5 rounded-md border transition group ${
                s.done
                  ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
                  : "border-slate-700 bg-slate-900/40 hover:bg-slate-800/60 hover:border-indigo-500/40"
              }`}
            >
              <div className={`w-7 h-7 rounded flex items-center justify-center shrink-0 ${
                s.done ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-500 group-hover:text-indigo-300"
              }`}>
                {s.done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1">
                  <span>Adım {i + 1}</span>
                  {s.done && <span className="text-emerald-400">✓</span>}
                </div>
                <div className={`text-xs font-medium truncate ${s.done ? "text-emerald-300" : "text-slate-200"}`}>
                  {s.label}
                </div>
                <div className="text-[10px] text-slate-500 truncate">{meta.hint || ""}</div>
              </div>
              {!s.done && <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-indigo-300 shrink-0" />}
            </NavLink>
          );
        })}
      </div>

      {q.data.done_count === q.data.total && (
        <div className="mt-3 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 text-center">
          🎉 Harika! Tüm adımlar tamam · "Kurulum Tamam" butonuna basıp sihirbazı kapatabilirsiniz
        </div>
      )}
    </div>
  );
}
