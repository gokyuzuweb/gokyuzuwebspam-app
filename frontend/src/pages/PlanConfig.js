import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  SlidersHorizontal, Save, RotateCcw, Check, X, Info, ShieldCheck,
  Loader2, ChevronRight, Package,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const LICKEY = () =>
  (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) ||
  "";

// UI için özellik metaları — kilitli/açık toggle'ların net görünmesi için
const FEATURE_GROUPS = [
  {
    title: "Kapasite",
    icon: Package,
    features: [
      { key: "max_domains", label: "Maks. Domain Sayısı", type: "int", hint: "Kaç mail domain'i korunabilir" },
      { key: "max_mails_per_day", label: "Günlük Mail Limiti", type: "int", hint: "Aşınca ingest dururlar" },
    ],
  },
  {
    title: "İleri Güvenlik",
    icon: ShieldCheck,
    features: [
      { key: "exploit_editor", label: "Exploit / Webshell Tarayıcı", type: "bool", hint: "Custom regex imzaları + tarama" },
      { key: "custom_rules", label: "Özel Kural / Regex Editörü", type: "bool", hint: "Bayi kendi kurallarını yazabilir" },
      { key: "ai_explanations", label: "AI Destekli Açıklamalar", type: "bool", hint: "GPT/Claude ile spam açıklama" },
      { key: "attack_map", label: "Canlı Attack Map", type: "bool", hint: "Coğrafi saldırı görselleştirme" },
    ],
  },
  {
    title: "Ekosistem",
    icon: SlidersHorizontal,
    features: [
      { key: "bulk_actions", label: "Toplu İşlemler", type: "bool", hint: "Toplu sil / toplu whitelist" },
      { key: "reseller_mode", label: "Bayi Modu (Sub-Account)", type: "bool", hint: "Alt bayi hesapları oluşturma" },
      { key: "api_access", label: "REST API Dış Erişim", type: "bool", hint: "3rd party entegrasyon anahtarı" },
      { key: "priority_support", label: "Öncelikli Destek", type: "bool", hint: "SLA + WhatsApp önceliği" },
    ],
  },
];

const PLAN_TABS = [
  { code: "starter",    label: "Starter",    tone: "slate" },
  { code: "pro",        label: "Pro",        tone: "emerald" },
  { code: "enterprise", label: "Enterprise", tone: "fuchsia" },
];

export default function PlanConfig() {
  const qc = useQueryClient();
  const [matrix, setMatrix] = useState(null);
  const [dirty, setDirty] = useState(false);

  const q = useQuery({
    queryKey: ["plan-matrix"],
    queryFn: () => api.adminPlanMatrix(LICKEY()),
    retry: false,
  });

  useEffect(() => {
    if (q.data?.matrix && !matrix) setMatrix(q.data.matrix);
  }, [q.data, matrix]);

  const save = useMutation({
    mutationFn: (m) => api.adminPlanMatrixSave(m, LICKEY()),
    onSuccess: (d) => {
      toast.success("Plan matrisi kaydedildi", {
        description: "Tüm bayilerin panelleri en fazla 30sn içinde yeni matriste çalışır",
      });
      setMatrix(d.matrix);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["plan-features"] });
      qc.invalidateQueries({ queryKey: ["plan-matrix"] });
    },
    onError: (e) => toast.error("Kayıt başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  const reset = useMutation({
    mutationFn: () => api.adminPlanMatrixReset(LICKEY()),
    onSuccess: (d) => {
      toast.success("Plan matrisi varsayılana döndürüldü");
      setMatrix(d.matrix);
      setDirty(false);
    },
    onError: (e) => toast.error("Sıfırlama başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  const setFeature = (plan, key, value) => {
    setMatrix((prev) => ({
      ...prev,
      [plan]: { ...(prev?.[plan] || {}), [key]: value },
    }));
    setDirty(true);
  };

  if (q.isLoading || !matrix) {
    return <div className="p-8 text-center text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-2"/> Yükleniyor…</div>;
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-indigo-400" />
            Plan Modül Yapılandırma
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Her plan için modülleri tek tek aç/kapat. Değişiklik anında tüm bayilerin panelinde uygulanır.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="pc-reset"
            onClick={() => { if (window.confirm("Matris varsayılana dönsün mü?")) reset.mutate(); }}
            disabled={reset.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Varsayılana Dön
          </button>
          <button
            data-testid="pc-save"
            onClick={() => save.mutate(matrix)}
            disabled={!dirty || save.isPending}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium border transition-all ${
              dirty
                ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30 shadow-lg shadow-emerald-500/10"
                : "border-slate-800 bg-slate-900/40 text-slate-500 cursor-not-allowed"
            }`}
          >
            {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Save className="w-3.5 h-3.5"/>}
            {dirty ? "Değişiklikleri Kaydet" : "Kaydedildi"}
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="p-3 rounded-md border border-sky-500/25 bg-sky-500/5 text-xs text-sky-100 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 mt-0.5 text-sky-300 shrink-0" />
        <div>
          <b>Nasıl çalışır?</b> Bir modülü kapatınca o plandaki bayiler UI'de o özelliği ya <span className="mono">"Üst versiyonda geçerli"</span> banner'ı olarak görür ya da hiç görmez. Backend de o özelliğe yazma isteklerini reddeder.
          Değişiklikler <b>anlık</b> uygulanır — bayi panelleri sadece browser cache tazelendiğinde (~30sn içinde) yeni matrisi görür.
        </div>
      </div>

      {/* Feature groups */}
      {FEATURE_GROUPS.map((grp) => (
        <Card key={grp.title}>
          <CardHeader
            title={<span className="flex items-center gap-2"><grp.icon className="w-4 h-4 text-indigo-400"/> {grp.title}</span>}
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/50 text-[10px] uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-2 w-1/3">Modül</th>
                    {PLAN_TABS.map((p) => (
                      <th key={p.code} className="text-center px-4 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full border ${
                          p.tone === "emerald" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" :
                          p.tone === "fuchsia" ? "bg-fuchsia-500/10 text-fuchsia-200 border-fuchsia-500/30" :
                                                  "bg-slate-800 text-slate-300 border-slate-700"
                        }`}>
                          {p.label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {grp.features.map((f) => (
                    <tr key={f.key} data-testid={`pc-row-${f.key}`} className="hover:bg-slate-900/40">
                      <td className="px-4 py-2.5">
                        <div className="text-slate-100">{f.label}</div>
                        <div className="text-[11px] text-slate-500 mono mt-0.5">{f.key} · {f.hint}</div>
                      </td>
                      {PLAN_TABS.map((p) => {
                        const val = matrix[p.code]?.[f.key];
                        return (
                          <td key={p.code} className="text-center px-4 py-2.5">
                            {f.type === "int" ? (
                              <input
                                type="number"
                                data-testid={`pc-cell-${p.code}-${f.key}`}
                                value={val ?? 0}
                                min={0}
                                onChange={(e) => setFeature(p.code, f.key, Number(e.target.value || 0))}
                                className="w-24 bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-sm mono text-center focus:border-indigo-500/60 outline-none"
                              />
                            ) : (
                              <button
                                data-testid={`pc-cell-${p.code}-${f.key}`}
                                onClick={() => setFeature(p.code, f.key, !val)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                  val ? "bg-emerald-500/70" : "bg-slate-700"
                                }`}
                                title={val ? "Açık" : "Kilitli"}
                              >
                                <span
                                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    val ? "translate-x-6" : "translate-x-1"
                                  }`}
                                />
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ))}

      {/* Sticky save bar for mobile */}
      {dirty && (
        <div className="fixed bottom-4 right-4 md:hidden">
          <button
            onClick={() => save.mutate(matrix)}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white shadow-2xl shadow-indigo-500/40"
          >
            <Save className="w-4 h-4" /> Kaydet
          </button>
        </div>
      )}
    </div>
  );
}
