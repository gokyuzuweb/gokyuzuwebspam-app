import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign, Save, Plus, Trash2, Star, Check, ExternalLink, Tag, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api, API } from "@/lib/api";

const CURRENCIES = ["USD", "EUR", "TRY", "GBP"];
const PLAN_CODES = ["starter", "pro", "enterprise"];

export default function Pricing() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pricing"], queryFn: api.pricing });
  const [state, setState] = useState(null);

  useEffect(() => { if (q.data && !state) setState(q.data); }, [q.data]); // eslint-disable-line

  const save = useMutation({
    mutationFn: (p) => api.pricingPut(p),
    onSuccess: () => { toast.success("Fiyatlandırma kaydedildi · bayilerin gördüğü fiyat sayfası anında güncellendi");
                       qc.invalidateQueries({ queryKey: ["pricing"] }); },
    onError: (e) => toast.error("Kaydedilemedi: " + (e?.response?.data?.detail || e.message)),
  });

  if (!state) return <div className="p-6 text-slate-500">Yükleniyor…</div>;

  const updatePlan = (idx, k, v) => {
    setState((s) => ({
      ...s,
      plans: s.plans.map((p, i) => i === idx ? { ...p, [k]: v } : p),
    }));
  };

  const updateFeature = (idx, fidx, val) => {
    setState((s) => ({
      ...s,
      plans: s.plans.map((p, i) => i === idx ? {
        ...p, features: p.features.map((f, fi) => fi === fidx ? val : f),
      } : p),
    }));
  };
  const addFeature = (idx) => {
    setState((s) => ({
      ...s,
      plans: s.plans.map((p, i) => i === idx ? { ...p, features: [...p.features, "Yeni özellik"] } : p),
    }));
  };
  const removeFeature = (idx, fidx) => {
    setState((s) => ({
      ...s,
      plans: s.plans.map((p, i) => i === idx ? {
        ...p, features: p.features.filter((_, fi) => fi !== fidx),
      } : p),
    }));
  };

  const publicUrl = `${API}/pricing`;

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Tag className="w-4 h-4 text-indigo-400" /> Genel Ayarlar</span>}
          subtitle="Satış sayfası başlığı ve iletişim bilgileri · bayiler bu değerleri görür"
          right={
            <a href={publicUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
              <ExternalLink className="w-3 h-3" /> Genel API'yi Aç
            </a>
          }
        />
        <CardBody className="grid grid-cols-12 gap-3">
          <div className="col-span-12 md:col-span-6">
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Başlık</label>
            <input value={state.hero_headline} onChange={(e) => setState({ ...state, hero_headline: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
          </div>
          <div className="col-span-12 md:col-span-6">
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Alt Başlık</label>
            <input value={state.hero_sub} onChange={(e) => setState({ ...state, hero_sub: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
          </div>
          <div className="col-span-12 md:col-span-6">
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Satış E-postası</label>
            <input value={state.contact_email} onChange={(e) => setState({ ...state, contact_email: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
          </div>
          <div className="col-span-12 md:col-span-6">
            <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Telefon (opsiyonel)</label>
            <input value={state.contact_phone} onChange={(e) => setState({ ...state, contact_phone: e.target.value })}
              placeholder="+90 ..."
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {state.plans.map((p, idx) => (
          <Card key={p.code} data-testid={`plan-${p.code}`}>
            <CardBody>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge tone={p.code === "enterprise" ? "success" : p.code === "pro" ? "brand" : "info"}>
                    {p.code.toUpperCase()}
                  </Badge>
                  {p.highlighted && <Star className="w-4 h-4 text-amber-400" fill="currentColor" />}
                </div>
                <label className="text-[11px] flex items-center gap-1 text-slate-500 cursor-pointer">
                  <input type="checkbox" checked={p.highlighted} onChange={(e) => updatePlan(idx, "highlighted", e.target.checked)}
                    className="accent-amber-400" />
                  Öne çıkar
                </label>
              </div>
              <input value={p.name} onChange={(e) => updatePlan(idx, "name", e.target.value)}
                data-testid={`plan-${p.code}-name`}
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-lg font-semibold text-slate-100 mb-4" />

              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="col-span-1">
                  <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Para birimi</label>
                  <select value={p.currency} onChange={(e) => updatePlan(idx, "currency", e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-sm mono">
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="col-span-1">
                  <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Aylık</label>
                  <input type="number" step="0.01" value={p.monthly_price}
                    data-testid={`plan-${p.code}-monthly`}
                    onChange={(e) => updatePlan(idx, "monthly_price", parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-sm mono text-right" />
                </div>
                <div className="col-span-1">
                  <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Yıllık</label>
                  <input type="number" step="0.01" value={p.yearly_price}
                    data-testid={`plan-${p.code}-yearly`}
                    onChange={(e) => updatePlan(idx, "yearly_price", parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-sm mono text-right" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-4">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Max domain</label>
                  <input type="number" value={p.max_domains}
                    onChange={(e) => updatePlan(idx, "max_domains", parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-sm mono text-right" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Max IP</label>
                  <input type="number" value={p.max_ips}
                    onChange={(e) => updatePlan(idx, "max_ips", parseInt(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-sm mono text-right" />
                </div>
              </div>

              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-widest text-slate-500">Özellikler</label>
                  <button onClick={() => addFeature(idx)} className="text-[11px] text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-0.5">
                    <Plus className="w-3 h-3" /> ekle
                  </button>
                </div>
                <div className="space-y-1">
                  {p.features.map((f, fi) => (
                    <div key={fi} className="flex items-center gap-1">
                      <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                      <input value={f} onChange={(e) => updateFeature(idx, fi, e.target.value)}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs" />
                      <button onClick={() => removeFeature(idx, fi)} className="text-slate-600 hover:text-rose-400">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 space-y-2">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Stripe eşleşmesi</div>
                <input value={p.stripe_lookup_monthly || ""} onChange={(e) => updatePlan(idx, "stripe_lookup_monthly", e.target.value)}
                  placeholder="stripe lookup key (aylık)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs mono" />
                <input value={p.stripe_lookup_yearly || ""} onChange={(e) => updatePlan(idx, "stripe_lookup_yearly", e.target.value)}
                  placeholder="stripe lookup key (yıllık)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-xs mono" />
              </div>

              <div className="pt-3 flex items-center justify-between text-xs">
                <label className="flex items-center gap-1 text-slate-400 cursor-pointer">
                  <input type="checkbox" checked={p.active} onChange={(e) => updatePlan(idx, "active", e.target.checked)}
                    className="accent-emerald-500" /> Aktif
                </label>
                <div className="mono text-[11px] text-slate-500">{p.currency} {p.monthly_price}/ay · {p.currency} {p.yearly_price}/yıl</div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button data-testid="pricing-save" onClick={() => save.mutate(state)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20">
          <Save className="w-4 h-4" /> Fiyatlandırmayı Kaydet
        </button>
        <a href={publicUrl} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-sm border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
          <ExternalLink className="w-4 h-4" /> Bayilerin Gördüğü JSON'u Aç
        </a>
        <div className="text-xs text-slate-500">
          Bu sayfa <b>yalnızca satıcı</b> yönetim panelinde görünür. Bayilerin panelinde bu menü yoktur.
        </div>
      </div>
    </div>
  );
}
