/**
 * v43.73 — Bayı Kendi Domain'i + Marka Ayarları
 *
 * Bayı kendi mail.bayihosting.com hostname'ini girer + brand name/logo/renk
 * tanımlar. Landing sayfası otomatik yayınlanır: /reseller/l?host=<domain>
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe, Save, ExternalLink, Copy, Loader2, Palette, Info } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { client } from "@/lib/api";

const brandApi = {
  get: () => client.get("/reseller-branding/me").then(r => r.data),
  set: (b) => client.post("/reseller-branding/me", b).then(r => r.data),
};

export default function ResellerBranding() {
  const q = useQuery({ queryKey: ["reseller-branding"], queryFn: brandApi.get, retry: false });
  const [s, setS] = useState({
    custom_domain: "", brand_name: "", brand_tagline: "", logo_url: "",
    primary_color: "#6366f1", support_email: "", support_whatsapp: "",
    pricing_note: "", active: false,
  });
  useEffect(() => { if (q.data) setS((x) => ({ ...x, ...q.data, custom_domain: q.data.custom_domain || "" })); }, [q.data]);

  const save = useMutation({
    mutationFn: () => brandApi.set(s),
    onSuccess: () => toast.success("Marka ayarları kaydedildi"),
    onError: (e) => toast.error("Kaydedilemedi: " + (e?.response?.data?.detail || e.message)),
  });

  const patch = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const landingUrl = s.custom_domain ? `https://${s.custom_domain}/` : "";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
          <Globe className="w-5 h-5 text-fuchsia-400" /> Bayı Kendi Domain'im
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Kendi hostname'inizi tanımlayın ve müşterileriniz için markalı bir landing sayfası
          alın. DNS'i yönlendirmek yeterli — otomatik oluşur.
        </p>
      </div>

      {/* Domain + Aktif */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Globe className="w-4 h-4 text-fuchsia-400"/> Alan Adı (Domain)</span>}
        />
        <CardBody className="space-y-3">
          <label className="text-[11px] uppercase tracking-widest text-slate-500">Custom Domain</label>
          <input
            data-testid="rb-domain"
            value={s.custom_domain}
            onChange={(e) => patch("custom_domain", e.target.value)}
            placeholder="mail.bayihosting.com"
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 mono text-sm text-slate-100"
          />
          <div className="flex items-center justify-between p-3 rounded-md bg-slate-900/60 border border-slate-800">
            <div>
              <div className="text-sm text-slate-200">Landing Sayfasını Yayınla</div>
              <div className="text-xs text-slate-500 mt-0.5">Kapalıyken müşteriler landing'e ulaşamaz</div>
            </div>
            <button
              data-testid="rb-active"
              onClick={() => patch("active", !s.active)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${s.active ? "bg-emerald-500/70" : "bg-slate-700"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${s.active ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          {s.custom_domain && (
            <div className="p-3 rounded-md border border-sky-500/25 bg-sky-500/5 text-xs text-sky-100 space-y-2">
              <div className="flex items-start gap-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-sky-300"/>
                <div>
                  <b>DNS Yönlendirme:</b> Domain sağlayıcınızda <span className="mono text-sky-200">{s.custom_domain}</span> için
                  A/CNAME kaydını <b>panel.gokyuzuhosting.com</b> IP'sine yönlendirin. Landing URL:
                </div>
              </div>
              <div className="mono text-[11px] flex items-center gap-2 bg-slate-950/60 px-2 py-1 rounded">
                <span className="flex-1 break-all">{landingUrl || "—"}</span>
                {landingUrl && (
                  <>
                    <button onClick={() => { navigator.clipboard.writeText(landingUrl); toast.success("Kopyalandı"); }} className="text-sky-300 hover:text-sky-200"><Copy className="w-3 h-3"/></button>
                    <a href={landingUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:text-sky-200"><ExternalLink className="w-3 h-3"/></a>
                  </>
                )}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Brand */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Palette className="w-4 h-4 text-violet-400"/> Marka</span>}
        />
        <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Marka Adı</label>
            <input data-testid="rb-brand-name" value={s.brand_name} onChange={(e) => patch("brand_name", e.target.value)} placeholder="Bayı Hosting"
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-100" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Tagline / Slogan</label>
            <input data-testid="rb-tagline" value={s.brand_tagline} onChange={(e) => patch("brand_tagline", e.target.value)} placeholder="Kurumsal Mail Güvenliği"
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-100" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Logo URL</label>
            <input data-testid="rb-logo" value={s.logo_url} onChange={(e) => patch("logo_url", e.target.value)} placeholder="https://.../logo.png"
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 mono text-sm text-slate-100" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Ana Renk</label>
            <div className="flex items-center gap-2">
              <input type="color" data-testid="rb-color-picker" value={s.primary_color} onChange={(e) => patch("primary_color", e.target.value)}
                className="w-12 h-10 bg-slate-950 border border-slate-800 rounded" />
              <input data-testid="rb-color-text" value={s.primary_color} onChange={(e) => patch("primary_color", e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 mono text-sm text-slate-100" />
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Destek E-postası</label>
            <input data-testid="rb-support-email" value={s.support_email} onChange={(e) => patch("support_email", e.target.value)} placeholder="destek@bayihosting.com"
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-100" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">WhatsApp (opsiyonel)</label>
            <input data-testid="rb-support-whatsapp" value={s.support_whatsapp} onChange={(e) => patch("support_whatsapp", e.target.value)} placeholder="+90 555 123 4567"
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 mono text-sm text-slate-100" />
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Fiyat Notu (opsiyonel)</label>
            <textarea data-testid="rb-pricing-note" value={s.pricing_note} onChange={(e) => patch("pricing_note", e.target.value)} rows={3}
              placeholder="Yıllık paket alanlar için %20 indirim..."
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-100" />
          </div>
        </CardBody>
      </Card>

      {/* Save */}
      <button
        data-testid="rb-save"
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white text-sm font-semibold shadow-lg hover:shadow-fuchsia-500/30 disabled:opacity-40"
      >
        {save.isPending ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
        Marka Ayarlarını Kaydet
      </button>

      {/* Preview */}
      <Card>
        <CardHeader title="Önizleme (mini)" />
        <CardBody>
          <div
            className="p-6 rounded-lg border text-slate-100"
            style={{ borderColor: s.primary_color + "55", background: `linear-gradient(135deg, ${s.primary_color}22 0%, rgba(15,23,42,0.6) 100%)` }}
          >
            {s.logo_url && <img src={s.logo_url} alt="logo" className="h-10 mb-3" onError={(e) => (e.currentTarget.style.display = "none")} />}
            <div className="text-xl font-bold" style={{ color: s.primary_color }}>{s.brand_name || "Bayı Hosting"}</div>
            <div className="text-sm text-slate-300 mt-1">{s.brand_tagline || "Kurumsal Mail Güvenliği"}</div>
            {s.pricing_note && <div className="text-xs text-slate-400 mt-3 whitespace-pre-line">{s.pricing_note}</div>}
            <div className="flex items-center gap-3 mt-4 text-[11px]">
              {s.support_email && <span className="text-slate-400">✉ {s.support_email}</span>}
              {s.support_whatsapp && <span className="text-slate-400">📱 {s.support_whatsapp}</span>}
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
