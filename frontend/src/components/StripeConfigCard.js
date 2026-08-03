import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Save, Loader2, ShieldCheck, ExternalLink, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const LICKEY = () =>
  (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) ||
  "";

const MODE_META = {
  live:            { label: "CANLI (Live)",        tone: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" },
  test:            { label: "Test Modu",           tone: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
  emergent_sandbox:{ label: "Emergent Sandbox",    tone: "text-sky-300 border-sky-500/30 bg-sky-500/10" },
  custom:          { label: "Özel",                tone: "text-slate-300 border-slate-700 bg-slate-800/40" },
  none:            { label: "Yapılandırılmamış",   tone: "text-rose-300 border-rose-500/30 bg-rose-500/10" },
};

/**
 * StripeConfigCard — Master için Stripe API Key yönetim kartı.
 * Emergent shared sandbox'tan gerçek Stripe hesabına geçiş rehberi + input.
 * Sadece master için render edilir.
 */
export default function StripeConfigCard() {
  const { isMaster } = useIsMaster();
  const qc = useQueryClient();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);

  const cfg = useQuery({
    queryKey: ["stripe-config"],
    queryFn: () => api.adminStripeConfig(LICKEY()),
    enabled: !!isMaster,
    retry: false,
  });

  const save = useMutation({
    mutationFn: (k) => api.adminStripeConfigSave(k, LICKEY()),
    onSuccess: (d) => {
      toast.success("Stripe API key kaydedildi", { description: `Mod: ${d.mode?.toUpperCase()}` });
      setKey("");
      qc.invalidateQueries({ queryKey: ["stripe-config"] });
    },
    onError: (e) => toast.error("Kayıt başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  if (!isMaster) return null;

  const meta = MODE_META[cfg.data?.mode] || MODE_META.none;
  const isEmergent = cfg.data?.mode === "emergent_sandbox";

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><CreditCard className="w-4 h-4 text-emerald-400"/> Stripe Ödeme Yapılandırması</span>}
        subtitle="Emergent sandbox → gerçek Stripe hesabına geçiş"
      />
      <CardBody className="space-y-4">
        {/* Mevcut durum */}
        <div className="flex items-center justify-between flex-wrap gap-3 p-3 rounded-md border border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <ShieldCheck className="w-4 h-4 text-slate-500" />
            Mevcut Anahtar:
            <span
              data-testid="stripe-current-mode"
              className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${meta.tone}`}
            >
              {meta.label}
            </span>
            {cfg.data?.key_tail && (
              <span className="text-[11px] text-slate-500 mono">···{cfg.data.key_tail}</span>
            )}
          </div>
          <span className="text-[10px] text-slate-500 mono">
            kaynak: {cfg.data?.source === "db" ? "Panel (DB)" : "Env"}
          </span>
        </div>

        {/* Emergent → Prod geçiş rehberi */}
        {isEmergent && (
          <div className="p-3 rounded-md border border-sky-500/30 bg-sky-500/5 text-xs text-sky-100 space-y-2">
            <div className="flex items-center gap-2 font-medium">
              <ExternalLink className="w-3.5 h-3.5" /> Gerçek Stripe Hesabına Geçiş — 4 Adım
            </div>
            <ol className="list-decimal list-inside space-y-1 text-sky-200/90 leading-relaxed">
              <li><a href="https://dashboard.stripe.com/register" target="_blank" rel="noreferrer" className="underline">stripe.com/register</a>'a git, hesap oluştur (ücretsiz, Türkiye desteklenir).</li>
              <li>Dashboard → <b>Developers → API keys</b>'te <span className="mono">sk_test_</span> veya <span className="mono">sk_live_</span> ile başlayan Secret Key'i kopyala.</li>
              <li>Aşağıdaki alana yapıştır → <b>Kaydet</b>. Bu anahtar sadece bu master panel DB'sinde saklanır.</li>
              <li>Test kartı: <span className="mono">4242 4242 4242 4242 · 12/34 · CVC 123</span> ile denemeyi tamamla.</li>
            </ol>
          </div>
        )}

        {/* Yeni key input */}
        <div>
          <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">
            Yeni Stripe Secret Key
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                data-testid="stripe-key-input"
                type={show ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk_test_… veya sk_live_…"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 pr-9 text-sm mono focus:border-indigo-500/60 outline-none"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
                title={show ? "Gizle" : "Göster"}
              >
                {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button
              data-testid="stripe-key-save"
              onClick={() => save.mutate(key)}
              disabled={!key.trim() || save.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 border border-emerald-400/40 hover:brightness-110 disabled:opacity-50 whitespace-nowrap"
            >
              {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Save className="w-3.5 h-3.5"/>}
              Kaydet
            </button>
          </div>
          <div className="text-[10px] text-slate-500 mt-1.5">
            ⚠️ Anahtarınız yalnızca bu master panelde şifrelenmemiş olarak saklanır — sunucunuza fiziksel erişimi kontrol edin.
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
