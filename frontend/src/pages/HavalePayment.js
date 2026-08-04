import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Landmark, Copy, CheckCircle2, Clock, AlertCircle, ArrowLeft, Loader2,
  ShieldCheck, Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

/**
 * /panel/payment/havale?ref=XXX
 * Bayi Stripe kullanmadan havale/EFT ile plan yükseltmesi yaparken bu sayfayı
 * görür. Banka IBAN, hesap sahibi ve zorunlu açıklama kodu ekranda dururken
 * ödeme durumu her 15sn'de polling edilir → onaylanınca banner değişir.
 */
export default function HavalePayment() {
  const [sp] = useSearchParams();
  const ref = sp.get("ref") || "";

  const q = useQuery({
    queryKey: ["payment-havale", ref],
    queryFn: () => api.paymentHavaleStatus(ref),
    refetchInterval: 15000,
    enabled: !!ref,
    retry: false,
  });

  const info = q.data;
  const status = info?.status || "awaiting_transfer";
  const paid = status === "paid";
  const failed = status === "failed";

  const copy = (v, label) => {
    navigator.clipboard?.writeText(v);
    toast.success(`${label} kopyalandı`);
  };

  if (!ref) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4 text-rose-100 text-sm">
          Geçersiz ödeme referansı. Lütfen aboneliğim sayfasına dönün.
        </div>
        <Link to="/panel/subscription" className="mt-3 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100">
          <ArrowLeft className="w-3 h-3" /> Aboneliğime dön
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <Link
          to="/panel/subscription"
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-200"
          data-testid="hp-back"
        >
          <ArrowLeft className="w-3 h-3" /> Aboneliğim
        </Link>
        <h1 className="mt-1 text-slate-100 text-lg font-semibold flex items-center gap-2">
          <Landmark className="w-5 h-5 text-emerald-400" />
          Havale / EFT ile Ödeme
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Aşağıdaki bilgilerle bankanızdan havale gönderin. Ödemeniz doğrulandığında lisansınız otomatik uzatılır — Stripe hesabı gerekmez.
        </p>
      </div>

      {/* Durum bandı */}
      <StatusBanner paid={paid} failed={failed} loading={q.isLoading} createdAt={info?.created_at} />

      {q.isLoading ? (
        <div className="p-8 text-center text-slate-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Ödeme referansı yükleniyor…
        </div>
      ) : !info ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4 text-rose-100 text-sm" data-testid="hp-notfound">
          Bu referans ({ref}) sistemde bulunamadı. Ödeme oluşturma sırasında bir hata olmuş olabilir.
        </div>
      ) : (
        <>
          {/* Banka Bilgileri */}
          <section className="rounded-lg border border-slate-800 bg-slate-950/40 divide-y divide-slate-800/60" data-testid="hp-bank-info">
            <Header title="1. Banka Bilgileri" subtitle="Aşağıdaki hesaba transfer yapın" />
            <FieldRow label="Banka" value={info.bank} onCopy={() => copy(info.bank, "Banka adı")} />
            <FieldRow label="Hesap Sahibi" value={info.beneficiary} onCopy={() => copy(info.beneficiary, "Hesap sahibi")} />
            <FieldRow label="IBAN" value={info.iban} mono onCopy={() => copy(info.iban, "IBAN")} highlight />
            <FieldRow
              label="Tutar"
              value={`${Number(info.amount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${info.currency}`}
              onCopy={() => copy(String(info.amount), "Tutar")}
              highlight
            />
          </section>

          {/* Açıklama (kritik) */}
          <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-2" data-testid="hp-reference">
            <div className="text-[11px] uppercase tracking-widest text-amber-300 font-semibold flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> 2. AÇIKLAMA / Referans Kodu (Zorunlu)
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-slate-950/70 px-3 py-2.5">
              <span className="mono text-emerald-300 text-base font-semibold break-all">{info.reference}</span>
              <button
                onClick={() => copy(info.reference, "Referans")}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-emerald-500/15 border border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/25"
                data-testid="hp-copy-ref"
              >
                <Copy className="w-3 h-3" /> Kopyala
              </button>
            </div>
            <p className="text-[11px] text-amber-100/80 leading-relaxed">
              <b>Havale/EFT açıklamasına mutlaka bu kodu yazın.</b> Kod eksik olursa ödemeniz otomatik eşleşemez, doğrulama günler alabilir.
            </p>
          </section>

          {/* Plan özeti */}
          <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4" data-testid="hp-plan">
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1">3. Sipariş Özeti</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-100 font-semibold">{info.plan}</div>
                <div className="text-[11px] text-slate-500">
                  Fatura dönemi: <b className="text-slate-300">{info.billing_period === "yearly" ? "Yıllık" : "Aylık"}</b>
                  {info.is_renewal ? " · Yenileme" : " · Yeni satın alım"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-emerald-300 tabular-nums">
                  {Number(info.amount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} {info.currency}
                </div>
                <div className="text-[10px] text-slate-500">Referans: <span className="mono">{info.reference}</span></div>
              </div>
            </div>
          </section>

          {/* Sonraki adımlar */}
          <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-300 space-y-2 leading-relaxed" data-testid="hp-next-steps">
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1">4. Şimdi ne olacak?</div>
            <ol className="list-decimal list-inside space-y-1 marker:text-slate-500">
              <li>Bankanızdan yukarıdaki IBAN'a <b>{info.amount} {info.currency}</b> gönderin.</li>
              <li>AÇIKLAMA alanına <span className="mono text-emerald-300">{info.reference}</span> kodunu yazmayı unutmayın.</li>
              <li>Ödemeniz genellikle <b>15 dakika – 24 saat</b> içinde doğrulanır (banka saatine bağlı).</li>
              <li>Doğrulama tamamlandığında bu sayfa otomatik "ÖDEME ONAYLANDI" olur ve lisansınız uzatılır.</li>
              <li>Sorun olursa <b>{info.reference}</b> kodu ile master'a ulaşın.</li>
            </ol>
          </section>
        </>
      )}
    </div>
  );
}

function StatusBanner({ paid, failed, loading, createdAt }) {
  if (loading) return null;
  if (paid) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 flex items-center gap-3" data-testid="hp-status-paid">
        <CheckCircle2 className="w-6 h-6 text-emerald-300" />
        <div>
          <div className="text-emerald-200 font-semibold text-sm">Ödeme Onaylandı</div>
          <div className="text-[11px] text-emerald-100/80">Lisansınız uzatıldı. Panele erişimi hemen kullanmaya başlayabilirsiniz.</div>
        </div>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 flex items-center gap-3" data-testid="hp-status-failed">
        <AlertCircle className="w-6 h-6 text-rose-300" />
        <div>
          <div className="text-rose-200 font-semibold text-sm">Ödeme Reddedildi / İptal</div>
          <div className="text-[11px] text-rose-100/80">Master onayı iptal etmiş olabilir. Yeni bir yükseltme başlatın veya bize ulaşın.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 flex items-center gap-3" data-testid="hp-status-awaiting">
      <Clock className="w-6 h-6 text-amber-300 animate-pulse" />
      <div className="flex-1">
        <div className="text-amber-200 font-semibold text-sm">Havale Bekleniyor</div>
        <div className="text-[11px] text-amber-100/80">
          Ödeme oluşturuldu {createdAt ? `· ${new Date(createdAt).toLocaleString("tr-TR")}` : ""}. Onaylandığında bu ekran otomatik güncellenir (15sn'de bir kontrol edilir).
        </div>
      </div>
      <ShieldCheck className="w-5 h-5 text-amber-300/60" />
    </div>
  );
}

function Header({ title, subtitle }) {
  return (
    <div className="p-3 border-b border-slate-800/70">
      <div className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
        <Receipt className="w-3.5 h-3.5 text-sky-400" />
        {title}
      </div>
      {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
    </div>
  );
}

function FieldRow({ label, value, onCopy, mono, highlight }) {
  return (
    <div className="px-3 py-2.5 flex items-center justify-between gap-3">
      <div className="text-[11px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-sm truncate ${mono ? "mono" : ""} ${highlight ? "text-emerald-300 font-semibold" : "text-slate-100"}`}>
          {value || "—"}
        </span>
        {value && (
          <button
            onClick={onCopy}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
            title="Kopyala"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
