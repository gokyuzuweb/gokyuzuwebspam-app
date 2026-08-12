import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Palette, Save, RotateCcw, ExternalLink, Sun, Moon, Sparkles } from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { toast } from "sonner";
import ModuleFooter from "@/components/ModuleFooter";

/**
 * v43.9 Landing CMS — Master paneli üzerinden landing sayfasının hem TEMA'sını
 * (koyu / açık warm cream) hem de anahtar METİN alanlarını düzenler. Boş bırakılan
 * alanlar dil dosyasındaki (LANG_STRINGS) varsayılana geri döner.
 */
const EMPTY_HERO = { badge: "", title_a: "", title_b: "", subtitle: "", cta_primary: "", cta_secondary: "" };
const EMPTY_STATE = {
  theme: "dark",
  hero: { ...EMPTY_HERO },
  features_title: "",
  features_sub: "",
  stats_headline: "",
  pricing_title: "",
  pricing_sub: "",
  cta_bottom_title: "",
  cta_bottom_sub: "",
  footer_copyright: "",
};

export default function LandingCMS() {
  const q = useQuery({ queryKey: ["landing-cms"], queryFn: () => api.landingGet(), staleTime: 15000 });
  const [form, setForm] = useState(EMPTY_STATE);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (q.data) {
      setForm({ ...EMPTY_STATE, ...q.data, hero: { ...EMPTY_HERO, ...(q.data.hero || {}) } });
      setDirty(false);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: (payload) => api.landingPut(payload),
    onSuccess: () => {
      toast.success("Landing içerikleri kaydedildi", { description: "Değişiklikler ziyaretçilerin bir sonraki isteğinde yayınlanır." });
      setDirty(false);
      q.refetch();
    },
    onError: (e) => toast.error("Kaydedilemedi", { description: e?.response?.data?.detail || String(e) }),
  });

  const setField = (path, val) => {
    setDirty(true);
    setForm((prev) => {
      const next = { ...prev };
      if (path.startsWith("hero.")) {
        const k = path.slice(5);
        next.hero = { ...next.hero, [k]: val };
      } else {
        next[path] = val;
      }
      return next;
    });
  };
  const reset = () => {
    if (!q.data) return;
    setForm({ ...EMPTY_STATE, ...q.data, hero: { ...EMPTY_HERO, ...(q.data.hero || {}) } });
    setDirty(false);
  };

  return (
    <div className="p-6 space-y-5" data-testid="landing-cms-page">
      {/* Header + save bar */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Palette className="w-6 h-6 text-fuchsia-300"/> Landing CMS
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Ana sayfanın (public landing) temasını ve anahtar metin bloklarını buradan yönetebilirsiniz.
            Boş bırakılan alanlar otomatik olarak dil dosyasındaki varsayılan metne düşer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/" target="_blank" rel="noreferrer" data-testid="landing-cms-preview"
             className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-700 bg-slate-900 text-slate-200 text-sm hover:border-slate-600">
            <ExternalLink className="w-3.5 h-3.5"/> Önizle
          </a>
          <button data-testid="landing-cms-reset"
                  onClick={reset}
                  disabled={!dirty}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-700 bg-slate-900 text-slate-300 text-sm disabled:opacity-40 hover:border-slate-600">
            <RotateCcw className="w-3.5 h-3.5"/> Geri Al
          </button>
          <button data-testid="landing-cms-save"
                  onClick={() => save.mutate(form)}
                  disabled={!dirty || save.isPending}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-600 text-white text-sm font-medium shadow-lg shadow-indigo-500/25 disabled:opacity-50">
            <Save className="w-3.5 h-3.5"/> {save.isPending ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </div>
      </div>

      {/* Theme selector */}
      <Card>
        <CardHeader
          title="Tema"
          subtitle="Koyu (varsayılan) — yıldızlı slate paleti · Açık — sıcak krem/soft-blue gradient"
        />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ThemeCard
              active={form.theme === "dark"}
              testid="theme-dark"
              onClick={() => setField("theme", "dark")}
              icon={Moon}
              tone="slate"
              title="Koyu (Dark)"
              desc="Yıldızlı slate-950 arka plan, indigo/fuchsia vurgular. Teknik / güvenlik odaklı."
            />
            <ThemeCard
              active={form.theme === "light"}
              testid="theme-light"
              onClick={() => setField("theme", "light")}
              icon={Sun}
              tone="amber"
              title="Açık (Light) — Warm Cream"
              desc="Krem/soft-blue gradient hero, davetkâr palet. Marketing / mass audience için."
            />
          </div>
        </CardBody>
      </Card>

      {/* Hero section CMS */}
      <Card>
        <CardHeader
          title="Hero (Ana Bölüm)"
          subtitle="Sayfayı açan ilk ekran — badge, başlık, alt metin ve CTA butonları"
          right={<Badge tone="info">TR dilinde geçerlidir · diğer dillerde LANG_STRINGS kullanılır</Badge>}
        />
        <CardBody className="space-y-4">
          <FieldRow label="Üst Rozet (badge)" hint="Örn: WHM / cPanel için ticari mail güvenliği"
                    value={form.hero.badge} onChange={(v) => setField("hero.badge", v)} testid="hero-badge"/>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="Başlık — 1. satır" hint="Örn: Sunucunuzdan"
                      value={form.hero.title_a} onChange={(v) => setField("hero.title_a", v)} testid="hero-title-a"/>
            <FieldRow label="Başlık — 2. satır (vurgu)" hint="Örn: spam ve tehdit sızmasın."
                      value={form.hero.title_b} onChange={(v) => setField("hero.title_b", v)} testid="hero-title-b"/>
          </div>
          <FieldRow label="Alt metin (subtitle)" hint="Kısa açıklama paragrafı" multiline
                    value={form.hero.subtitle} onChange={(v) => setField("hero.subtitle", v)} testid="hero-subtitle"/>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="CTA Ana (primary)" hint="Örn: Şimdi Satın Al"
                      value={form.hero.cta_primary} onChange={(v) => setField("hero.cta_primary", v)} testid="hero-cta-primary"/>
            <FieldRow label="CTA İkincil (secondary)" hint="Örn: Canlı Demo"
                      value={form.hero.cta_secondary} onChange={(v) => setField("hero.cta_secondary", v)} testid="hero-cta-secondary"/>
          </div>
        </CardBody>
      </Card>

      {/* Section titles */}
      <Card>
        <CardHeader
          title="Bölüm Başlıkları"
          subtitle="Özellikler / Fiyatlandırma / Alt CTA gibi bölümlerin başlık &amp; alt metinleri"
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="Özellikler — başlık" value={form.features_title}
                      onChange={(v) => setField("features_title", v)} testid="cms-features-title"/>
            <FieldRow label="Özellikler — alt metin" value={form.features_sub}
                      onChange={(v) => setField("features_sub", v)} testid="cms-features-sub" multiline/>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldRow label="Fiyatlandırma — başlık" value={form.pricing_title}
                      onChange={(v) => setField("pricing_title", v)} testid="cms-pricing-title"/>
            <FieldRow label="Fiyatlandırma — alt metin" value={form.pricing_sub}
                      onChange={(v) => setField("pricing_sub", v)} testid="cms-pricing-sub" multiline/>
          </div>
          <FieldRow label="Footer — telif" value={form.footer_copyright}
                    onChange={(v) => setField("footer_copyright", v)} testid="cms-footer"/>
        </CardBody>
      </Card>

      <ModuleFooter
        title="Landing CMS — Kısa özet"
        howItWorks="Landing sayfası her açıldığında /api/settings/landing çağrılır ve buradan gelen tema + metin blokları uygulanır. Boş bırakılan alanlar otomatik olarak i18n varsayılanına döner (dil bazlı fallback korunur)."
        technical={[
          "Backend: GET/PUT /api/settings/landing (PUT master-only)",
          "MongoDB: db.settings _key=landing_content",
          "Frontend: useLandingCms() hook, react-query cache 60sn",
          "Light theme: .gws-landing-light kapsayıcısı içinde CSS override — Tailwind class'ları yeniden yazılmaz",
        ]}
        recommendations={[
          "Değişiklikten sonra 'Önizle' butonu ile /landing sayfasını yeni sekmede açın",
          "Boş bıraktığınız alanlar dil dosyasındaki varsayılana geri döner — güvenli",
          "Light tema, marketing kampanyalarında dönüşüm oranını artırır (warm palette)",
        ]}
      />
    </div>
  );
}

function ThemeCard({ active, onClick, icon: Icon, tone, title, desc, testid }) {
  const toneMap = {
    slate:  active ? "border-indigo-500/60 bg-indigo-500/10" : "border-slate-800 bg-slate-900/40",
    amber:  active ? "border-amber-500/60 bg-amber-500/10"   : "border-slate-800 bg-slate-900/40",
  };
  return (
    <button data-testid={testid}
            onClick={onClick}
            className={`text-left rounded-xl border p-5 hover:border-slate-600 transition-colors relative ${toneMap[tone] || toneMap.slate}`}>
      {active && (
        <span className="absolute top-3 right-3 text-[10px] mono uppercase tracking-widest text-indigo-300">
          <Sparkles className="w-3 h-3 inline"/> AKTİF
        </span>
      )}
      <div className={`w-10 h-10 rounded-md flex items-center justify-center mb-3 border ${
        tone === "amber" ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "bg-slate-800 border-slate-700 text-slate-300"
      }`}>
        <Icon className="w-5 h-5"/>
      </div>
      <div className="text-slate-100 font-semibold">{title}</div>
      <div className="text-xs text-slate-400 mt-1 leading-relaxed">{desc}</div>
    </button>
  );
}

function FieldRow({ label, hint, value, onChange, multiline, testid }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs uppercase tracking-widest text-slate-500 mono">{label}</span>
        {hint && <span className="text-[10px] text-slate-600 italic ml-2">{hint}</span>}
      </div>
      {multiline ? (
        <textarea
          data-testid={testid}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder="Boş bırakırsanız i18n varsayılanı kullanılır"
          className="w-full bg-slate-950 border border-slate-800 rounded-md p-2.5 text-sm text-slate-100 focus:border-indigo-500/60 focus:outline-none"
        />
      ) : (
        <input
          data-testid={testid}
          type="text"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Boş bırakırsanız i18n varsayılanı kullanılır"
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-100 focus:border-indigo-500/60 focus:outline-none"
        />
      )}
    </label>
  );
}
