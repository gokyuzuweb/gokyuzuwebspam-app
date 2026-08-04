import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Save, RotateCcw, Palette, Info, Loader2, Eye } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const LICKEY = () =>
  (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) ||
  "";

const TEMPLATE_LABELS = {
  havale_confirmed:    { title: "Havale Ödeme Onayı", tone: "emerald", when: "Havale ödemesi master tarafından onaylandığında müşteriye" },
  session_deactivated: { title: "Lisans Pasifleştirildi", tone: "rose", when: "Master bir lisansı deaktive ettiğinde bayiye" },
  plan_changed:        { title: "Plan Değişikliği", tone: "sky", when: "Master bir bayi'nin planını yükseltip düşürdüğünde" },
  bulk_ping_bayi:      { title: "Toplu Canlan Ping (Bayi)", tone: "amber", when: "30dk+ heartbeat gelmeyen bayilere yollanır" },
};

const TONE_CLASS = {
  emerald: "border-emerald-500/40 bg-emerald-500/5",
  rose:    "border-rose-500/40 bg-rose-500/5",
  sky:     "border-sky-500/40 bg-sky-500/5",
  amber:   "border-amber-500/40 bg-amber-500/5",
};

/**
 * /panel/email-templates — Master için otomatik sistem maillerinin editörü.
 * Marka rengi + logo + gönderici ayarları üstte, altında her template için
 * subject + body düzenleme + reset butonu.
 */
export default function EmailTemplates() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["email-templates"],
    queryFn: () => api.adminEmailTemplates(LICKEY()),
  });
  const [branding, setBranding] = useState({});
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    if (q.data?.branding) setBranding(q.data.branding);
    if (q.data?.templates) {
      const d = {};
      Object.values(q.data.templates).forEach((t) => {
        d[t.key] = { subject: t.subject, body: t.body, enabled: t.enabled };
      });
      setDrafts(d);
    }
  }, [q.data]);

  const saveTpl = useMutation({
    mutationFn: (payload) => api.adminEmailTemplateSave(payload, LICKEY()),
    onSuccess: (_, p) => {
      toast.success(`✓ "${TEMPLATE_LABELS[p.key]?.title}" şablonu kaydedildi`);
      qc.invalidateQueries({ queryKey: ["email-templates"] });
    },
    onError: (e) => toast.error("Kaydetme başarısız: " + (e?.response?.data?.detail || e.message)),
  });
  const resetTpl = useMutation({
    mutationFn: (key) => api.adminEmailTemplateReset(key, LICKEY()),
    onSuccess: (_, key) => {
      toast.success(`Şablon "${TEMPLATE_LABELS[key]?.title}" varsayılana döndürüldü`);
      qc.invalidateQueries({ queryKey: ["email-templates"] });
    },
  });
  const saveBrand = useMutation({
    mutationFn: () => api.adminEmailBrandingSave(branding, LICKEY()),
    onSuccess: () => toast.success("✓ Marka ayarları kaydedildi"),
    onError: (e) => toast.error("Kaydetme başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
          <Mail className="w-5 h-5 text-emerald-400" />
          E-posta Şablonları
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Otomatik sistem maillerinin metnini + marka rengi + logoyu buradan yönet.
          <span className="text-emerald-300"> {"{{customer_name}}"}, {"{{plan}}"}, {"{{amount}}"}</span> gibi değişkenler kullanılabilir.
        </p>
      </div>

      {/* Marka ayarları */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Palette className="w-4 h-4 text-fuchsia-400"/> Marka Ayarları</span>}
          subtitle="Tüm mail HTML'lerinde header rengi + logo + imzada kullanılır"
        />
        <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Şirket Adı" value={branding.company_name || ""}
                 onChange={(v) => setBranding({ ...branding, company_name: v })} testid="brand-company"/>
          <Field label="Marka Rengi (HEX)" value={branding.color || ""} isColor
                 onChange={(v) => setBranding({ ...branding, color: v })} testid="brand-color"/>
          <Field label="Logo URL" value={branding.logo_url || ""}
                 onChange={(v) => setBranding({ ...branding, logo_url: v })} testid="brand-logo"
                 hint="Boş bırakırsanız sadece metin gösterilir"/>
          <Field label="Gönderici Adı" value={branding.from_name || ""}
                 onChange={(v) => setBranding({ ...branding, from_name: v })} testid="brand-from-name"/>
          <Field label="Gönderici E-postası" value={branding.from_email || ""}
                 onChange={(v) => setBranding({ ...branding, from_email: v })} testid="brand-from-email"/>
          <Field label="Alt Bilgi (Footer)" value={branding.footer_text || ""}
                 onChange={(v) => setBranding({ ...branding, footer_text: v })} testid="brand-footer"/>
          <div className="md:col-span-2 flex items-center justify-between pt-2 border-t border-slate-800">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Önizleme rengi:</span>
              <div className="w-16 h-6 rounded border border-slate-700" style={{ background: branding.color || "#10b981" }}/>
            </div>
            <button
              onClick={() => saveBrand.mutate()}
              disabled={saveBrand.isPending}
              data-testid="brand-save"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-white disabled:opacity-60"
            >
              {saveBrand.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Save className="w-3.5 h-3.5"/>}
              Markayı Kaydet
            </button>
          </div>
        </CardBody>
      </Card>

      {q.isLoading ? (
        <div className="p-8 text-center text-slate-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Yükleniyor...
        </div>
      ) : (
        Object.entries(q.data?.templates || {}).map(([key, tpl]) => {
          const meta = TEMPLATE_LABELS[key] || { title: key, tone: "sky", when: "" };
          const draft = drafts[key] || { subject: tpl.subject, body: tpl.body, enabled: tpl.enabled };
          const dirty = draft.subject !== tpl.subject || draft.body !== tpl.body || draft.enabled !== tpl.enabled;
          return (
            <Card key={key} className={TONE_CLASS[meta.tone]} data-testid={`tpl-card-${key}`}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {meta.title}
                    {tpl.customized && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">DÜZENLENDİ</span>}
                    {dirty && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">KAYDEDİLMEDİ</span>}
                  </span>
                }
                subtitle={<span className="flex items-center gap-1"><Info className="w-3 h-3"/> {meta.when}</span>}
                right={
                  <label className="text-[11px] flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={draft.enabled}
                           onChange={(e) => setDrafts({ ...drafts, [key]: { ...draft, enabled: e.target.checked } })}
                           className="accent-emerald-500"/>
                    Aktif
                  </label>
                }
              />
              <CardBody className="space-y-3">
                <Field label="Konu (Subject)" value={draft.subject}
                       onChange={(v) => setDrafts({ ...drafts, [key]: { ...draft, subject: v } })}
                       testid={`tpl-${key}-subject`}/>
                <div>
                  <label className="text-[11px] uppercase tracking-widest text-slate-500 block mb-1">Metin (Body)</label>
                  <textarea
                    data-testid={`tpl-${key}-body`}
                    value={draft.body}
                    onChange={(e) => setDrafts({ ...drafts, [key]: { ...draft, body: e.target.value } })}
                    rows={10}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs mono focus:border-emerald-500/60 outline-none resize-y leading-relaxed"
                  />
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <button
                    onClick={() => resetTpl.mutate(key)}
                    disabled={resetTpl.isPending || !tpl.customized}
                    data-testid={`tpl-${key}-reset`}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-100 disabled:opacity-40"
                  >
                    <RotateCcw className="w-3 h-3"/> Varsayılana dön
                  </button>
                  <button
                    onClick={() => saveTpl.mutate({ key, ...draft })}
                    disabled={saveTpl.isPending || !dirty}
                    data-testid={`tpl-${key}-save`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-white disabled:opacity-40"
                  >
                    {saveTpl.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Save className="w-3.5 h-3.5"/>}
                    Şablonu Kaydet
                  </button>
                </div>
              </CardBody>
            </Card>
          );
        })
      )}
    </div>
  );
}

function Field({ label, value, onChange, testid, hint, isColor }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-widest text-slate-500 block mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          data-testid={testid}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm focus:border-emerald-500/60 outline-none"
        />
        {isColor && <div className="w-8 h-8 rounded border border-slate-700 shrink-0" style={{ background: value }}/>}
      </div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}
