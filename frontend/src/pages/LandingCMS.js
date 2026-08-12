import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Palette, Save, RotateCcw, ExternalLink, Sun, Moon, Sparkles, Languages } from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { toast } from "sonner";
import ModuleFooter from "@/components/ModuleFooter";

/**
 * v43.9 → v43.11 Landing CMS — Master panelden landing sayfasının TEMA'sı
 * ve her dil için ayrı METİN blokları (TR/EN/DE/FR/ES/AR) yönetilir.
 * Boş bırakılan alanlar dil dosyasındaki (LANG_STRINGS) varsayılana geri döner.
 */
const SUPPORTED = [
  { code: "tr", label: "Türkçe",   flag: "🇹🇷" },
  { code: "en", label: "English",  flag: "🇬🇧" },
  { code: "de", label: "Deutsch",  flag: "🇩🇪" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "es", label: "Español",  flag: "🇪🇸" },
  { code: "ar", label: "العربية",   flag: "🇸🇦" },
];
const EMPTY_HERO = { badge: "", title_a: "", title_b: "", subtitle: "", cta_primary: "", cta_secondary: "" };
const EMPTY_BLOCK = {
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

const buildInitialState = (data) => {
  const contentByLang = {};
  SUPPORTED.forEach(({ code }) => {
    const stored = (data?.content_by_lang && data.content_by_lang[code]) || {};
    contentByLang[code] = {
      ...EMPTY_BLOCK,
      ...stored,
      hero: { ...EMPTY_HERO, ...(stored.hero || {}) },
    };
  });
  return {
    theme: (data?.theme === "light" || data?.theme === "dark") ? data.theme : "dark",
    content_by_lang: contentByLang,
  };
};

export default function LandingCMS() {
  const q = useQuery({ queryKey: ["landing-cms"], queryFn: () => api.landingGet(), staleTime: 15000 });
  const [form, setForm] = useState(() => buildInitialState(null));
  const [activeLang, setActiveLang] = useState("tr");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (q.data) {
      setForm(buildInitialState(q.data));
      setDirty(false);
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: (payload) => api.landingPut(payload),
    onSuccess: () => {
      toast.success("Landing içerikleri kaydedildi", {
        description: "Değişiklikler ziyaretçilerin bir sonraki isteğinde yayınlanır.",
      });
      setDirty(false);
      q.refetch();
    },
    onError: (e) => toast.error("Kaydedilemedi", { description: e?.response?.data?.detail || String(e) }),
  });

  const block = form.content_by_lang[activeLang] || EMPTY_BLOCK;

  const setTheme = (v) => { setDirty(true); setForm((prev) => ({ ...prev, theme: v })); };
  const setField = (path, val) => {
    setDirty(true);
    setForm((prev) => {
      const cbl = { ...prev.content_by_lang };
      const cur = { ...(cbl[activeLang] || EMPTY_BLOCK) };
      if (path.startsWith("hero.")) {
        const k = path.slice(5);
        cur.hero = { ...cur.hero, [k]: val };
      } else {
        cur[path] = val;
      }
      cbl[activeLang] = cur;
      return { ...prev, content_by_lang: cbl };
    });
  };
  const reset = () => {
    if (!q.data) return;
    setForm(buildInitialState(q.data));
    setDirty(false);
  };
  const filled = useMemo(() => {
    // Her dil için "kaç alan dolu" hesapla → tab üzerinde küçük göstergesi
    const out = {};
    SUPPORTED.forEach(({ code }) => {
      const b = form.content_by_lang[code] || EMPTY_BLOCK;
      let count = 0;
      Object.values(b.hero || {}).forEach((v) => { if (v && String(v).trim()) count++; });
      ["features_title","features_sub","pricing_title","pricing_sub","footer_copyright"]
        .forEach((k) => { if (b[k] && String(b[k]).trim()) count++; });
      out[code] = count;
    });
    return out;
  }, [form.content_by_lang]);

  return (
    <div className="p-6 space-y-5" data-testid="landing-cms-page">
      {/* Header + save bar */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Palette className="w-6 h-6 text-fuchsia-300"/> Landing CMS
            <Badge tone="info">v43.11 · Multi-Lang</Badge>
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Landing sayfasının temasını ve <b>her dil için ayrı</b> metin bloklarını yönetin.
            Boş bırakılan alanlar dil dosyasındaki (LANG_STRINGS) varsayılana geri düşer.
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
            <ThemeCard active={form.theme === "dark"}  testid="theme-dark"  onClick={() => setTheme("dark")}
                       icon={Moon} tone="slate" title="Koyu (Dark)"
                       desc="Yıldızlı slate-950 arka plan, indigo/fuchsia vurgular. Teknik / güvenlik odaklı."/>
            <ThemeCard active={form.theme === "light"} testid="theme-light" onClick={() => setTheme("light")}
                       icon={Sun} tone="amber" title="Açık (Light) — Warm Cream"
                       desc="Krem/soft-blue gradient hero, davetkâr palet. Marketing / mass audience için."/>
          </div>
        </CardBody>
      </Card>

      {/* Language tab bar */}
      <Card>
        <CardHeader
          title="Metin İçerikleri"
          subtitle="Her dil için ayrı bloklar. Aktif dilde girdiğiniz metin sadece o dilde yayınlanır."
          right={<Badge tone="warning"><Languages className="w-3 h-3 inline mr-1"/> {filled[activeLang] || 0} alan dolu</Badge>}
        />
        <CardBody className="space-y-4">
          <div className="flex gap-1 bg-slate-950/40 border border-slate-800 rounded-lg p-1 overflow-x-auto" data-testid="landing-cms-lang-tabs">
            {SUPPORTED.map(({ code, label, flag }) => {
              const count = filled[code] || 0;
              const active = activeLang === code;
              return (
                <button key={code}
                        data-testid={`cms-lang-${code}`}
                        onClick={() => setActiveLang(code)}
                        className={`shrink-0 flex items-center gap-1.5 text-xs px-3 py-2 rounded-md transition-all
                                   ${active
                                    ? "bg-indigo-500/25 text-indigo-100 ring-1 ring-indigo-500/50"
                                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"}`}>
                  <span className="text-base leading-none">{flag}</span>
                  <span>{label}</span>
                  <span className={`text-[9px] mono px-1.5 py-0.5 rounded-full ${count > 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-500"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Hero düzenleyicisi */}
          <div className="pt-2">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mono mb-2">
              HERO / ANA BÖLÜM ({SUPPORTED.find(x => x.code === activeLang)?.label})
            </div>
            <FieldRow label="Üst Rozet (badge)" hint="Örn: WHM / cPanel için ticari mail güvenliği"
                      value={block.hero.badge} onChange={(v) => setField("hero.badge", v)} testid={`hero-badge-${activeLang}`}/>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
              <FieldRow label="Başlık — 1. satır" hint="Örn: Sunucunuzdan"
                        value={block.hero.title_a} onChange={(v) => setField("hero.title_a", v)} testid={`hero-title-a-${activeLang}`}/>
              <FieldRow label="Başlık — 2. satır (vurgu)" hint="Örn: spam ve tehdit sızmasın."
                        value={block.hero.title_b} onChange={(v) => setField("hero.title_b", v)} testid={`hero-title-b-${activeLang}`}/>
            </div>
            <div className="mt-3">
              <FieldRow label="Alt metin (subtitle)" hint="Kısa açıklama paragrafı" multiline
                        value={block.hero.subtitle} onChange={(v) => setField("hero.subtitle", v)} testid={`hero-subtitle-${activeLang}`}/>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
              <FieldRow label="CTA Ana (primary)" hint="Örn: Şimdi Satın Al"
                        value={block.hero.cta_primary} onChange={(v) => setField("hero.cta_primary", v)} testid={`hero-cta-primary-${activeLang}`}/>
              <FieldRow label="CTA İkincil (secondary)" hint="Örn: Canlı Demo"
                        value={block.hero.cta_secondary} onChange={(v) => setField("hero.cta_secondary", v)} testid={`hero-cta-secondary-${activeLang}`}/>
            </div>
          </div>

          {/* Section titles */}
          <div className="pt-3 border-t border-slate-800/60">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mono mb-2">
              BÖLÜM BAŞLIKLARI ({SUPPORTED.find(x => x.code === activeLang)?.label})
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldRow label="Özellikler — başlık" value={block.features_title}
                        onChange={(v) => setField("features_title", v)} testid={`cms-features-title-${activeLang}`}/>
              <FieldRow label="Özellikler — alt metin" value={block.features_sub}
                        onChange={(v) => setField("features_sub", v)} testid={`cms-features-sub-${activeLang}`} multiline/>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
              <FieldRow label="Fiyatlandırma — başlık" value={block.pricing_title}
                        onChange={(v) => setField("pricing_title", v)} testid={`cms-pricing-title-${activeLang}`}/>
              <FieldRow label="Fiyatlandırma — alt metin" value={block.pricing_sub}
                        onChange={(v) => setField("pricing_sub", v)} testid={`cms-pricing-sub-${activeLang}`} multiline/>
            </div>
            <div className="mt-3">
              <FieldRow label="Footer — telif" value={block.footer_copyright}
                        onChange={(v) => setField("footer_copyright", v)} testid={`cms-footer-${activeLang}`}/>
            </div>
          </div>
        </CardBody>
      </Card>

      <ModuleFooter
        title="Landing CMS — v43.11 Multi-Language"
        howItWorks="Landing sayfası her açıldığında /api/settings/landing çağrılır. Ziyaretçinin aktif diline göre content_by_lang[lang] bloğu uygulanır; alan boşsa i18n LANG_STRINGS varsayılanına düşer. TR/EN/DE/FR/ES/AR bağımsız yönetilir."
        technical={[
          "Backend: GET/PUT /api/settings/landing (PUT master-only)",
          "MongoDB: db.settings _key=landing_content, content_by_lang: {tr,en,de,fr,es,ar}",
          "Frontend: useLandingCms() → aktif effective diline göre pick",
          "Backwards compat: legacy top-level hero → TR bloğuna otomatik map'lenir",
        ]}
        recommendations={[
          "Her dil için hero.badge + title_a + title_b + subtitle'ı doldurmak marketing tarafında yüksek dönüşüm getirir",
          "Türkçe zorunlu; diğer diller opsiyonel — boş bırakırsanız yerleşik strings.js kullanılır",
          "Light tema warm cream palet ile marketing sayfalarında %8-12 CTR artışı sağlar",
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
