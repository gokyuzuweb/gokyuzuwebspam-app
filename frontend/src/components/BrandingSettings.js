import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Palette, Save, Image as ImageIcon, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const DEFAULTS = {
  brand_name: "GökyüzüWebSpam",
  logo_url: "",
  primary_color: "#6366f1",
  accent_color: "#10b981",
};

/**
 * Reseller white-label branding form. Bayi kendi lisansı için marka bilgilerini
 * kaydeder — panel header/sidebar bu değerleri otomatik uygular (localStorage cache).
 */
export default function BrandingSettings({ licenseKey }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["branding", licenseKey],
    queryFn: () => api.brandingGet(licenseKey),
    enabled: !!licenseKey,
    retry: false,
  });
  const [form, setForm] = useState(DEFAULTS);
  useEffect(() => {
    if (q.data) {
      const next = {
        brand_name:    q.data.brand_name || DEFAULTS.brand_name,
        logo_url:      q.data.logo_url || "",
        primary_color: q.data.primary_color || DEFAULTS.primary_color,
        accent_color:  q.data.accent_color || DEFAULTS.accent_color,
      };
      setForm(next);
      // Cache for header/sidebar to pick up without an extra API call
      try {
        localStorage.setItem("gws.branding", JSON.stringify({ ...next, license_key: licenseKey }));
        window.dispatchEvent(new CustomEvent("gws.branding.changed"));
      } catch (_) {}
    }
  }, [q.data, licenseKey]);

  const save = useMutation({
    mutationFn: (payload) => api.brandingPut(licenseKey, payload),
    onSuccess: () => {
      toast.success("Marka bilgileri kaydedildi");
      qc.invalidateQueries({ queryKey: ["branding", licenseKey] });
      try {
        localStorage.setItem("gws.branding", JSON.stringify({ ...form, license_key: licenseKey }));
        window.dispatchEvent(new CustomEvent("gws.branding.changed"));
      } catch (_) {}
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kaydedilemedi"),
  });

  const reset = () => setForm(DEFAULTS);

  return (
    <Card data-testid="branding-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><Palette className="w-4 h-4 text-indigo-400" /> White-label Marka</span>}
        subtitle="Kendi müşterileriniz için panel logosu ve rengi — bayi paneli anında güncellenir"
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: fields */}
          <div className="space-y-3">
            <Field label="Marka Adı">
              <input
                data-testid="branding-name"
                value={form.brand_name}
                onChange={(e) => setForm({ ...form, brand_name: e.target.value })}
                maxLength={40}
                placeholder="Firmanızın adı"
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/60"
              />
            </Field>
            <Field label="Logo URL (opsiyonel)">
              <div className="flex gap-2">
                <input
                  data-testid="branding-logo"
                  value={form.logo_url}
                  onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
                  placeholder="https://cdn.firmam.com/logo.svg"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100 mono focus:outline-none focus:border-indigo-500/60"
                />
                {form.logo_url && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, logo_url: "" })}
                    className="px-2 rounded bg-slate-800 text-slate-400 hover:text-rose-400 text-xs"
                    title="Logo URL'i temizle"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                Kare (1:1) veya yatay SVG/PNG önerilir · maks 128×128px görünür
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Birincil Renk">
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    data-testid="branding-primary"
                    value={form.primary_color}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                    className="w-11 h-9 rounded cursor-pointer border border-slate-800 bg-slate-950"
                  />
                  <input
                    value={form.primary_color}
                    onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-100 mono"
                  />
                </div>
              </Field>
              <Field label="Vurgu Rengi">
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    data-testid="branding-accent"
                    value={form.accent_color}
                    onChange={(e) => setForm({ ...form, accent_color: e.target.value })}
                    className="w-11 h-9 rounded cursor-pointer border border-slate-800 bg-slate-950"
                  />
                  <input
                    value={form.accent_color}
                    onChange={(e) => setForm({ ...form, accent_color: e.target.value })}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-100 mono"
                  />
                </div>
              </Field>
            </div>
          </div>

          {/* Right: live preview */}
          <div className="p-4 rounded border border-slate-800 bg-slate-950/60">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Canlı Önizleme</div>
            <div
              className="rounded-lg p-4 border shadow-inner"
              style={{
                background: `linear-gradient(135deg, ${form.primary_color}15, ${form.accent_color}12)`,
                borderColor: `${form.primary_color}55`,
              }}
              data-testid="branding-preview"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <div
                  className="w-10 h-10 rounded-md flex items-center justify-center overflow-hidden"
                  style={{ background: `linear-gradient(135deg, ${form.primary_color}, ${form.accent_color})` }}
                >
                  {form.logo_url ? (
                    <img
                      src={form.logo_url}
                      alt=""
                      className="w-full h-full object-contain"
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-white/90" />
                  )}
                </div>
                <div>
                  <div className="text-slate-100 font-bold text-sm" style={{ color: form.primary_color }}>
                    {form.brand_name}
                  </div>
                  <div className="text-[9px] uppercase tracking-widest mono" style={{ color: form.accent_color }}>
                    Bayi Paneli
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <button
                  className="w-full px-3 py-1.5 rounded text-xs font-medium text-white shadow"
                  style={{ background: form.primary_color }}
                >
                  Örnek Buton
                </button>
                <div
                  className="text-[10px] px-2 py-1 rounded inline-block"
                  style={{ background: `${form.accent_color}20`, color: form.accent_color }}
                >
                  ✓ Örnek başarı rozeti
                </div>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 mt-2 flex items-center justify-between">
              <span>Değişiklik anlık — kaydettiğinizde tüm bayilerinizde uygulanır</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
          <button
            onClick={() => save.mutate(form)}
            disabled={save.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-50 text-sm font-medium"
            data-testid="branding-save"
          >
            <Save className="w-4 h-4" />
            {save.isPending ? "Kaydediliyor…" : "Marka Bilgilerini Kaydet"}
          </button>
          <button
            onClick={reset}
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-xs border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
            data-testid="branding-reset"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Varsayılana Dön
          </button>
          <span className="text-[10px] text-slate-500 ml-auto">
            {q.data?.updated_at ? "Son güncelleme: " + new Date(q.data.updated_at).toLocaleString("tr-TR") : ""}
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">{label}</label>
      {children}
    </div>
  );
}
