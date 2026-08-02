import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { CreditCard, Check, Star, Loader2, CheckCircle2, XCircle, Copy, ArrowRight, ArrowLeft, Download, Terminal, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

/**
 * Public satın alma sayfası — /shop
 * Fiyatları /api/pricing'den çeker, plan kartlarında "Şimdi Satın Al" butonu ile
 * Stripe checkout başlatır. Ödeme sonrası /checkout/success sayfası açılır ve
 * müşteri lisans anahtarını e-posta ile alır.
 */
export default function Shop() {
  const pricing = useQuery({ queryKey: ["pricing"], queryFn: api.pricing });
  const [period, setPeriod] = useState("yearly");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [selecting, setSelecting] = useState(null);

  const start = useMutation({
    mutationFn: (plan_code) => api.checkoutCreate({
      plan_code,
      billing_period: period,
      customer_email: email.trim(),
      customer_name: name.trim(),
      origin_url: window.location.origin,
    }),
    onSuccess: (data) => {
      if (data.url) { window.location.href = data.url; }
      else toast.error("Checkout URL alınamadı");
    },
    onError: (e) => toast.error("Checkout başlatılamadı: " + (e?.response?.data?.detail || e.message)),
  });

  const p = pricing.data;
  const currency = p?.plans?.[0]?.currency || "USD";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 grid-backdrop">
      {/* Header — Ana sayfaya dön */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link
            to="/"
            data-testid="shop-home-link"
            className="flex items-center gap-2 text-slate-300 hover:text-slate-100 transition"
          >
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight">
              <div className="text-slate-100 font-bold tracking-tight text-[15px]">
                Gökyüzü<span className="text-indigo-400">WebSpam</span>
              </div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mono">
                Fiyatlandırma
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/install"
              data-testid="shop-install-link"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-amber-500/30 bg-amber-500/5 text-amber-200 hover:bg-amber-500/10 transition"
            >
              <Terminal className="w-3 h-3" /> Kurulum Kılavuzu
            </Link>
            <Link
              to="/"
              data-testid="shop-back-home"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-slate-600 transition"
            >
              <ArrowLeft className="w-3 h-3" /> Ana Sayfa
            </Link>
          </div>
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs uppercase tracking-widest font-semibold mb-4">
            <CreditCard className="w-3 h-3" /> Fiyatlandırma
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-slate-100 mb-4 tracking-tight">
            {p?.hero_headline || "GökyüzüWebSpam"}
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            {p?.hero_sub || "Modern, kapsamlı mail koruma paneli"}
          </p>
        </div>

        {/* Billing period toggle */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex bg-slate-900 border border-slate-800 rounded-lg p-1">
            {[
              { k: "monthly", l: "Aylık" },
              { k: "yearly", l: "Yıllık", save: "%17 indirim" },
            ].map((b) => (
              <button
                key={b.k}
                data-testid={`period-${b.k}`}
                onClick={() => setPeriod(b.k)}
                className={`px-6 py-2 rounded-md text-sm transition-colors relative ${
                  period === b.k ? "bg-indigo-500/20 text-indigo-200" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {b.l}
                {b.save && period === b.k && (
                  <span className="ml-2 text-[10px] text-emerald-400 mono">{b.save}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Contact form */}
        <div className="max-w-md mx-auto mb-8 grid grid-cols-2 gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ad Soyad"
            data-testid="buyer-name"
            className="bg-slate-900 border border-slate-800 rounded-md px-3 py-2.5 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-posta *" type="email"
            data-testid="buyer-email"
            className="bg-slate-900 border border-slate-800 rounded-md px-3 py-2.5 text-sm mono" />
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(p?.plans || []).filter(pl => pl.active !== false).map((pl) => {
            const price = period === "yearly" ? pl.yearly_price : pl.monthly_price;
            const perLabel = period === "yearly" ? "/yıl" : "/ay";
            const loading = start.isPending && selecting === pl.code;
            return (
              <Card key={pl.code} data-testid={`shop-plan-${pl.code}`}
                className={`relative ${pl.highlighted ? "ring-2 ring-indigo-500/60 shadow-2xl shadow-indigo-500/10" : ""}`}>
                {pl.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <div className="bg-gradient-to-r from-indigo-500 to-rose-500 text-white text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-full flex items-center gap-1">
                      <Star className="w-2.5 h-2.5" fill="currentColor" /> Popüler
                    </div>
                  </div>
                )}
                <CardBody className="p-8">
                  <div className="mb-6">
                    <Badge tone={pl.code === "enterprise" ? "success" : pl.code === "pro" ? "brand" : "info"}>
                      {pl.code.toUpperCase()}
                    </Badge>
                    <h3 className="text-2xl font-bold text-slate-100 mt-3">{pl.name}</h3>
                  </div>
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm text-slate-500 mono">{currency}</span>
                      <span className="text-4xl font-bold text-slate-100 mono">{price.toFixed(0)}</span>
                      <span className="text-slate-500 mono text-sm">{perLabel}</span>
                    </div>
                    <div className="mono text-[11px] text-slate-500 mt-1">
                      {pl.max_domains.toLocaleString("tr-TR")} domain · {pl.max_ips} IP
                    </div>
                  </div>
                  <button
                    data-testid={`buy-${pl.code}`}
                    onClick={() => {
                      if (!email.trim()) return toast.error("E-posta zorunlu");
                      setSelecting(pl.code);
                      start.mutate(pl.code);
                    }}
                    disabled={loading || price <= 0}
                    className={`w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-md text-sm font-medium mb-6 transition-colors ${
                      pl.highlighted
                        ? "bg-gradient-to-r from-indigo-500 to-rose-500 hover:from-indigo-600 hover:to-rose-600 text-white"
                        : "border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
                    } disabled:opacity-50`}
                  >
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Yönlendiriliyor…</>
                             : <><CreditCard className="w-4 h-4" /> Şimdi Satın Al <ArrowRight className="w-4 h-4" /></>}
                  </button>
                  <ul className="space-y-2">
                    {pl.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            );
          })}
        </div>

        <div className="mt-12 text-center text-xs text-slate-500">
          <div>Ödemeler Stripe ile güvenli işlenir · Ödeme sonrası lisans anahtarınız e-posta ile ulaşır</div>
          {p?.contact_email && <div className="mt-2">Sorularınız için: <a href={`mailto:${p.contact_email}`} className="text-indigo-400 hover:underline">{p.contact_email}</a></div>}
        </div>
      </div>
    </div>
  );
}


/** /checkout/success — Stripe redirect target */
export function CheckoutSuccess() {
  const [params] = useSearchParams();
  const sid = params.get("session_id");
  const [attempts, setAttempts] = useState(0);
  const q = useQuery({
    queryKey: ["checkout-status", sid],
    queryFn: () => api.checkoutStatus(sid),
    enabled: !!sid,
    refetchInterval: (data) => (data?.status === "paid" ? false : 2000),
  });
  useEffect(() => {
    if (q.data?.status === "paid") return;
    setAttempts(a => a + 1);
  }, [q.data]);

  const tx = q.data;
  const paid = tx?.status === "paid";

  // Fetch personalized install command with license key baked in
  const info = useQuery({
    queryKey: ["install-info", tx?.license_key],
    queryFn: () => api.pluginInstallInfo(tx?.license_key),
    enabled: !!tx?.license_key,
  });

  const copy = async (text, label) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast.success(`${label} kopyalandı`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 grid-backdrop flex items-center justify-center p-6">
      <Card className="max-w-2xl w-full">
        <CardBody className="p-8">
          {paid ? (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <h1 className="text-2xl font-bold text-slate-100 mb-2">Ödeme Başarılı 🎉</h1>
                <p className="text-slate-400">
                  Lisans anahtarınız oluşturuldu ve <b className="text-slate-200">{tx.customer_email}</b> adresine gönderildi.
                </p>
              </div>

              <div className="p-4 rounded border border-indigo-500/30 bg-indigo-500/5 mb-4">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Lisans anahtarı</div>
                <div className="mono text-indigo-300 text-sm break-all" data-testid="cs-license-key">{tx.license_key}</div>
                <button onClick={() => copy(tx.license_key, "Lisans anahtarı")}
                  data-testid="cs-copy-key"
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
                  <Copy className="w-3 h-3" /> Kopyala
                </button>
              </div>

              <div className="p-4 rounded border border-emerald-500/30 bg-emerald-500/5 mb-4">
                <div className="flex items-center gap-2 mb-2 text-emerald-300">
                  <Terminal className="w-4 h-4" />
                  <div className="text-sm font-semibold">Tek Komut Kurulum</div>
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  WHM sunucunuza root SSH ile bağlanın, aşağıdaki komutu yapıştırıp Enter'a basın:
                </p>
                {info.data?.wget_one_liner ? (
                  <>
                    <pre data-testid="cs-oneliner" className="mono text-[11px] bg-slate-950 border border-slate-800 rounded p-3 text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                      {info.data.wget_one_liner}
                    </pre>
                    <button onClick={() => copy(info.data.wget_one_liner, "Kurulum komutu")}
                      data-testid="cs-copy-oneliner"
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20">
                      <Copy className="w-3 h-3" /> Komutu Kopyala
                    </button>
                  </>
                ) : (
                  <div className="text-slate-500 text-xs">Kurulum komutu hazırlanıyor…</div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <a href={api.pluginDownloadUrl()} data-testid="cs-download-tar"
                   className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20">
                  <Download className="w-4 h-4" /> Paketi doğrudan indir (tar.gz)
                </a>
                <a href="/install" data-testid="cs-goto-install"
                   className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
                  <ArrowRight className="w-4 h-4" /> Adım adım kurulum
                </a>
              </div>
            </>
          ) : tx?.status === "failed" ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto mb-4">
                <XCircle className="w-8 h-8 text-rose-400" />
              </div>
              <h1 className="text-2xl font-bold text-slate-100 mb-2">Ödeme Başarısız</h1>
              <p className="text-slate-400">Lütfen yeniden deneyin ya da satıcı ile iletişime geçin.</p>
            </div>
          ) : (
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-indigo-400 animate-spin mx-auto mb-4" />
              <h1 className="text-xl font-bold text-slate-100 mb-2">Ödeme Doğrulanıyor</h1>
              <p className="text-slate-500 text-sm mono">
                {tx?.status || "pending"} · deneme #{attempts}
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
