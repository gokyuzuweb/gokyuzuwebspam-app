import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Sparkles, Check, Zap, Calendar, Package, ShieldCheck, CreditCard,
  ArrowRight, Loader2, ExternalLink, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge, StatCard } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { trackPlanEvent } from "@/lib/track";

/**
 * /panel/subscription — Aboneliğim / Plan Yükseltme paneli.
 * Ziyaretçi & lisanslı bayi için son adım UI.
 *
 * Sunar:
 *  1) Mevcut plan HERO kartı (isim, kalan gün, kullanım)
 *  2) 3 planlık karşılaştırma tablosu (Starter/Pro/Enterprise) + monthly/yearly
 *  3) Tek-tık "Yükselt" — Stripe checkout başlatır (origin_url = window.location.origin)
 *  4) Deep-link: ?upgrade=pro&cycle=yearly → o kart öne çıkarılır ve otomatik scroll
 *  5) Ödeme geçmişi (payments listesi)
 */

const CUR_SYM = { USD: "$", EUR: "€", TRY: "₺", GBP: "£" };
const PLAN_ORDER = { starter: 0, pro: 1, enterprise: 2 };

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("tr-TR", { year: "numeric", month: "short", day: "numeric" });
}
function daysLeft(iso) {
  if (!iso) return null;
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return d;
}

export default function Subscription() {
  const [sp] = useSearchParams();
  const upgradeTarget = (sp.get("upgrade") || "").toLowerCase();
  const isRenewal = sp.get("renew") === "1";
  const initialCycle = (sp.get("cycle") || "yearly").toLowerCase();
  const [cycle, setCycle] = useState(initialCycle === "monthly" ? "monthly" : "yearly");
  const [gateway, setGateway] = useState("stripe"); // müşteri seçimi: 'stripe' | 'havale'
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [customerFocus, setCustomerFocus] = useState(false);

  const status = useQuery({ queryKey: ["plugin-status"], queryFn: api.pluginStatus });
  const pricing = useQuery({ queryKey: ["pricing"], queryFn: api.pricing });
  const payments = useQuery({ queryKey: ["my-payments"], queryFn: api.myPayments, retry: false });
  const renewalInfo = useQuery({ queryKey: ["renewal-info"], queryFn: api.pluginRenewalInfo, retry: false });

  const highlightRef = useRef(null);

  // Deep link: /panel/subscription?renew=1 → mevcut plana scroll + yıllık seçili
  useEffect(() => {
    if (isRenewal && status.data && highlightRef.current) {
      setTimeout(() => highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
    }
  }, [isRenewal, status.data]);

  useEffect(() => {
    if (upgradeTarget && highlightRef.current) {
      setTimeout(() => highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
    }
  }, [upgradeTarget, pricing.data]);

  const renew = useMutation({
    mutationFn: () => api.subscriptionRenew({ billing_period: cycle, gateway }),
    onSuccess: (d) => {
      trackPlanEvent("checkout_click", {
        current_plan: status.data?.license_plan,
        target_plan: d.plan_code || status.data?.license_plan,
        cycle, feature: "renewal_one_click",
      });
      if (d.url) window.location.href = d.url;
      else toast.error("Yenileme URL'i alınamadı");
    },
    onError: (e) => toast.error("Yenileme başlatılamadı: " + (e?.response?.data?.detail || e.message)),
  });

  const start = useMutation({
    mutationFn: (planCode) => {
      trackPlanEvent("checkout_click", {
        current_plan: status.data?.license_plan || "starter",
        target_plan: planCode, cycle, feature: "subscription_page",
      });
      return api.checkoutCreate({
        plan_code: planCode,
        billing_period: cycle,
        gateway,
        customer_email: email.trim() || status.data?.license_customer_name || "",
        customer_name: name.trim() || status.data?.license_customer_name || "",
        origin_url: window.location.origin,
      });
    },
    onSuccess: (d) => {
      if (d.url) window.location.href = d.url;
      else toast.error("Checkout URL alınamadı");
    },
    onError: (e) => {
      const msg = e?.response?.data?.detail || e.message;
      if (String(msg).toLowerCase().includes("email")) {
        setCustomerFocus(true);
        toast.error("E-posta zorunlu — lütfen faturalandırma bilgilerinizi doldurun");
      } else {
        toast.error("Checkout başlatılamadı: " + msg);
      }
    },
  });

  const s = status.data;
  const plans = pricing.data?.plans || [];
  const currency = plans[0]?.currency || "USD";
  const sym = CUR_SYM[currency] || currency;

  const currentPlan = s?.license_plan || "starter";
  const currentPlanRank = PLAN_ORDER[currentPlan] ?? 0;

  const priceOf = (p) => (cycle === "yearly" ? p.yearly_price : p.monthly_price) || 0;
  const savingsFor = (p) => Math.max(0, (p.monthly_price || 0) * 12 - (p.yearly_price || 0));

  return (
    <div className="p-6 space-y-6">
      {/* HERO — Mevcut Plan */}
      <Card>
        <CardBody className="p-5 md:p-6 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-gradient-to-br from-indigo-500/15 to-fuchsia-500/10 blur-3xl rounded-full pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Mevcut Aboneliğiniz</div>
              <div className="flex items-baseline gap-3 flex-wrap">
                <h1 data-testid="sub-current-plan" className="text-2xl md:text-3xl font-semibold text-slate-100 capitalize">
                  {plans.find((x) => x.code === currentPlan)?.name || currentPlan}
                </h1>
                <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                  s?.licensed
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                    : "bg-amber-500/10 text-amber-300 border-amber-500/30"
                }`}>
                  {s?.licensed ? "Aktif" : s?.is_demo ? `Demo · ${s?.demo_days_remaining ?? 0}g` : "Lisanssız"}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2 max-w-md">
                {s?.licensed ? (
                  <>
                    <b className="text-slate-200">{s.license_customer_name || "Kayıtlı"}</b> için aktif.
                    Süresi: <b className="mono text-slate-200">{fmtDate(s.license_expires)}</b>
                    {daysLeft(s.license_expires) !== null && (
                      <span className={`ml-1 ${daysLeft(s.license_expires) < 30 ? "text-amber-300" : "text-slate-500"}`}>
                        ({daysLeft(s.license_expires)} gün kaldı)
                      </span>
                    )}
                  </>
                ) : "Plan yükselterek tüm özelliklerin kilidini açın."}
              </p>

              {/* Tek Tık Yenile — 30 gün altında veya ?renew=1 iken göster */}
              {s?.licensed && (renewalInfo.data?.should_show_banner || isRenewal) && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <button
                    data-testid="sub-quick-renew"
                    onClick={() => renew.mutate()}
                    disabled={renew.isPending}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-all ${
                      renewalInfo.data?.severity === "critical"
                        ? "bg-rose-500 text-white hover:bg-rose-400 border border-rose-400 shadow-lg shadow-rose-500/25"
                        : "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:brightness-110 border border-indigo-400/40 shadow-lg shadow-indigo-500/20"
                    } disabled:opacity-50`}
                  >
                    {renew.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    Tek Tık {cycle === "yearly" ? "1 Yıl" : "1 Ay"} Uzat
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] text-slate-500">
                    · Mevcut {plans.find((x) => x.code === currentPlan)?.name || currentPlan} planı
                    {cycle === "yearly" && " ile 2 ay hediye"}
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 md:min-w-[280px]">
              <MiniStat label="Plan" value={currentPlan.toUpperCase()} icon={Package} />
              <MiniStat label="Mod" value={s?.mode === "seller" ? "Bayi" : "Müşteri"} icon={ShieldCheck} />
              <MiniStat label="Süre" value={s?.license_expires ? `${daysLeft(s.license_expires) ?? "—"}g` : "—"} icon={Calendar} />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Fatura Bilgileri (custom email/name — public checkout için) */}
      {!s?.licensed && (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><CreditCard className="w-4 h-4 text-indigo-400"/> Fatura Bilgileri</span>}
            subtitle="Ödemeyi tamamlarken lisans anahtarınız bu e-posta adresine gönderilecek"
          />
          <CardBody className="grid grid-cols-12 gap-3">
            <div className="col-span-12 md:col-span-6">
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">E-posta *</label>
              <input
                data-testid="sub-email"
                autoFocus={customerFocus}
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="siz@sirket.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono focus:border-indigo-500/60 outline-none"
              />
            </div>
            <div className="col-span-12 md:col-span-6">
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Ad Soyad / Şirket</label>
              <input
                data-testid="sub-name"
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Şirket Adı A.Ş."
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm focus:border-indigo-500/60 outline-none"
              />
            </div>
          </CardBody>
        </Card>
      )}

      {/* Cycle toggle */}
      <div className="flex items-center justify-center">
        <div className="inline-flex bg-slate-900/60 border border-slate-800 rounded-lg p-1 gap-0.5">
          <CycleBtn active={cycle === "monthly"} onClick={() => setCycle("monthly")} testid="sub-cycle-monthly">Aylık</CycleBtn>
          <CycleBtn active={cycle === "yearly"} onClick={() => setCycle("yearly")} testid="sub-cycle-yearly">
            Yıllık <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">2 ay hediye</span>
          </CycleBtn>
        </div>
      </div>

      {/* Payment gateway selector */}
      <div className="flex items-center justify-center">
        <div className="inline-flex items-center gap-2 flex-wrap justify-center">
          <span className="text-[11px] uppercase tracking-widest text-slate-500">Ödeme Yöntemi:</span>
          <div className="inline-flex bg-slate-900/60 border border-slate-800 rounded-lg p-1 gap-0.5">
            <button
              data-testid="sub-gw-stripe"
              onClick={() => setGateway("stripe")}
              className={`px-4 py-1.5 text-xs rounded-md transition-all inline-flex items-center gap-1.5 ${
                gateway === "stripe"
                  ? "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white shadow"
                  : "text-slate-400 hover:text-slate-100"
              }`}
            >
              💳 Kredi Kartı
              {gateway === "stripe" && <span className="text-[9px] px-1 py-0.5 rounded bg-white/20">Stripe</span>}
            </button>
            <button
              data-testid="sub-gw-havale"
              onClick={() => setGateway("havale")}
              className={`px-4 py-1.5 text-xs rounded-md transition-all inline-flex items-center gap-1.5 ${
                gateway === "havale"
                  ? "bg-gradient-to-r from-emerald-500 to-sky-500 text-white shadow"
                  : "text-slate-400 hover:text-slate-100"
              }`}
            >
              🏦 Havale / EFT
              {gateway === "havale" && <span className="text-[9px] px-1 py-0.5 rounded bg-white/20">Manuel</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((p) => {
          const isCurrent = p.code === currentPlan;
          const rank = PLAN_ORDER[p.code] ?? 0;
          const isDowngrade = rank < currentPlanRank;
          const isUpgrade = rank > currentPlanRank;
          const isFocus = upgradeTarget && upgradeTarget === p.code;
          const price = priceOf(p);
          const savings = cycle === "yearly" ? savingsFor(p) : 0;
          return (
            <div
              key={p.code}
              ref={isFocus ? highlightRef : null}
              data-testid={`sub-plan-${p.code}`}
              className={`relative rounded-xl border p-5 transition-all ${
                isFocus
                  ? "border-indigo-400/70 bg-gradient-to-b from-indigo-500/10 to-fuchsia-500/5 shadow-xl shadow-indigo-500/20 ring-2 ring-indigo-500/40"
                  : p.highlighted
                  ? "border-indigo-500/40 bg-indigo-500/[0.03]"
                  : "border-slate-800 bg-slate-900/40"
              } ${isCurrent ? "opacity-80" : ""}`}
            >
              {p.highlighted && !isFocus && (
                <span className="absolute -top-2 left-4 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30">
                  ⭐ Popüler
                </span>
              )}
              {isCurrent && (
                <span className="absolute -top-2 right-4 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/30">
                  ✓ Mevcut plan
                </span>
              )}

              <h3 className="text-lg font-semibold text-slate-100">{p.name}</h3>
              <p className="text-xs text-slate-500 mt-1 min-h-[32px]">{p.description || "—"}</p>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-semibold text-slate-100 tabular-nums">{sym}{price.toFixed(0)}</span>
                <span className="text-xs text-slate-500">/ {cycle === "yearly" ? "yıl" : "ay"}</span>
              </div>
              {savings > 0 && (
                <div className="text-[11px] text-emerald-300 mt-0.5">
                  {sym}{savings.toFixed(0)} yıllık tasarruf
                </div>
              )}

              <ul className="mt-4 space-y-1.5">
                {(p.features || []).map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
                    <Check className="w-3 h-3 mt-0.5 text-emerald-400 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                {isCurrent ? (
                  <button
                    disabled
                    data-testid={`sub-current-${p.code}`}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium border border-slate-700 bg-slate-800/50 text-slate-500 cursor-not-allowed"
                  >
                    <Check className="w-4 h-4" /> Mevcut Aboneliğiniz
                  </button>
                ) : isDowngrade ? (
                  <button
                    disabled
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium border border-slate-800 bg-slate-900 text-slate-500 cursor-not-allowed"
                  >
                    Alt plana geçiş için destek
                  </button>
                ) : (
                  <button
                    data-testid={`sub-upgrade-${p.code}`}
                    onClick={() => start.mutate(p.code)}
                    disabled={start.isPending}
                    className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${
                      isFocus || p.highlighted
                        ? "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:brightness-110 shadow-lg shadow-indigo-500/25 border border-indigo-400/40"
                        : "bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 border border-indigo-500/30"
                    } disabled:opacity-50`}
                  >
                    {start.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isUpgrade ? (
                      <>
                        <Sparkles className="w-4 h-4" /> {p.name}'a Yükselt <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    ) : (
                      <>{p.name} Satın Al <ArrowRight className="w-3.5 h-3.5" /></>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Ödeme geçmişi */}
      {payments.data?.items?.length > 0 && (
        <Card>
          <CardHeader title="Ödeme Geçmişi" subtitle="En son 20 fatura" />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/50 text-[10px] uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-2">Tarih</th>
                    <th className="text-left px-4 py-2">Plan</th>
                    <th className="text-left px-4 py-2">Tutar</th>
                    <th className="text-left px-4 py-2">Durum</th>
                    <th className="text-right px-4 py-2">Referans</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {payments.data.items.slice(0, 20).map((r) => (
                    <tr key={r.id || r.session_id} className="hover:bg-slate-900/40">
                      <td className="px-4 py-2.5 text-slate-300 mono text-xs">{fmtDate(r.created_at)}</td>
                      <td className="px-4 py-2.5 text-slate-200 capitalize">{r.plan_code || r.plan}</td>
                      <td className="px-4 py-2.5 mono text-slate-300">
                        {sym}{(r.amount || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded ${
                          r.status === "paid"    ? "bg-emerald-500/15 text-emerald-300" :
                          r.status === "pending" ? "bg-amber-500/15 text-amber-300" :
                                                    "bg-rose-500/15 text-rose-300"
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[10px] mono text-slate-500 truncate max-w-[200px]">
                        {r.session_id || r.id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function CycleBtn({ active, children, onClick, testid }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
        active ? "bg-indigo-500/25 text-indigo-100" : "text-slate-400 hover:text-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

function MiniStat({ label, value, icon: Icon }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/40 p-2.5 text-center">
      <div className="text-[9px] uppercase tracking-widest text-slate-500 flex items-center justify-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-slate-100 mono">{value}</div>
    </div>
  );
}
