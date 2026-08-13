import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Palette, Save, RotateCcw, ExternalLink, Sun, Moon, Sparkles, Languages, Copy, FlaskConical, BarChart3 } from "lucide-react";
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
  const variantBByLang = {};
  SUPPORTED.forEach(({ code }) => {
    const stored = (data?.content_by_lang && data.content_by_lang[code]) || {};
    contentByLang[code] = {
      ...EMPTY_BLOCK,
      ...stored,
      hero: { ...EMPTY_HERO, ...(stored.hero || {}) },
    };
    const vb = (data?.variant_b_hero_by_lang && data.variant_b_hero_by_lang[code]) || {};
    variantBByLang[code] = { ...EMPTY_HERO, ...vb };
  });
  return {
    theme: (data?.theme === "light" || data?.theme === "dark") ? data.theme : "dark",
    content_by_lang: contentByLang,
    // v43.12 A/B
    ab_test_enabled: !!data?.ab_test_enabled,
    // v43.13 Geo scope
    ab_geo_scope: data?.ab_geo_scope || "global",
    // v43.16 Hero live preview toggle
    hero_preview_enabled: data?.hero_preview_enabled !== false,
    hero_preview_style: data?.hero_preview_style || "animated",
    variant_b_hero_by_lang: variantBByLang,
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
  // v43.12 — Bir dilden aktif dile içerik kopyala (deep clone hero + section titles)
  const copyFrom = (srcLang) => {
    if (srcLang === activeLang) return;
    const src = form.content_by_lang[srcLang];
    if (!src) return;
    setDirty(true);
    setForm((prev) => {
      const cbl = { ...prev.content_by_lang };
      cbl[activeLang] = {
        ...src,
        hero: { ...(src.hero || EMPTY_HERO) },
      };
      return { ...prev, content_by_lang: cbl };
    });
    toast.success(
      `${SUPPORTED.find(x => x.code === srcLang)?.label} dilinden ` +
      `${SUPPORTED.find(x => x.code === activeLang)?.label} diline kopyalandı`,
      { description: "Şimdi çevirebilir veya doğrudan kaydedebilirsiniz." }
    );
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

          {/* v43.12 Copy-From-Lang bar — kaynak dilden aktif dile hızlı klonlama */}
          <div className="flex items-center gap-2 flex-wrap" data-testid="cms-copy-from-bar">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 mono flex items-center gap-1.5">
              <Copy className="w-3 h-3"/> Bu dile içerik kopyala:
            </span>
            {SUPPORTED.filter(x => x.code !== activeLang).map(({ code, label, flag }) => {
              const src = form.content_by_lang[code];
              const hasContent = (filled[code] || 0) > 0;
              return (
                <button key={code}
                        data-testid={`cms-copy-from-${code}`}
                        onClick={() => copyFrom(code)}
                        disabled={!hasContent}
                        className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border transition-all
                                   ${hasContent
                                    ? "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20 hover:border-fuchsia-500/60"
                                    : "border-slate-800 bg-slate-900/40 text-slate-600 cursor-not-allowed"}`}>
                  <span>{flag}</span>
                  <span>{label}</span>
                  {hasContent && <span className="text-[9px] mono opacity-70">→ kopyala</span>}
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

      {/* v43.16 Hero Live Preview toggle */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-indigo-300"/> Hero Canlı Önizleme</span>}
          subtitle="Landing hero'nun sağ tarafında animasyonlu yönetim paneli önizlemesi (git-gel kalkan + canlı tile grid)."
          right={
            <button
              data-testid="hero-preview-toggle"
              onClick={() => { setDirty(true); setForm(prev => ({...prev, hero_preview_enabled: !prev.hero_preview_enabled})); }}
              className={`text-xs px-3 py-1.5 rounded-md border font-medium transition-colors
                         ${form.hero_preview_enabled
                           ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                           : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"}`}>
              {form.hero_preview_enabled ? "AÇIK · Kapat" : "KAPALI · Aç"}
            </button>
          }
        />
      </Card>

      {/* v43.12 A/B Testing Card */}
      <AbTestingCard form={form} setForm={setForm} setDirty={setDirty} activeLang={activeLang}/>

      <ModuleFooter
        title="Landing CMS — v43.12 Multi-Lang + A/B"
        howItWorks="Landing sayfası her açıldığında /api/settings/landing çağrılır. Ziyaretçinin aktif diline göre content_by_lang[lang] bloğu uygulanır; A/B testi açıksa hero için %50/%50 zar atılır ve variant_b_hero_by_lang'dan alternatif hero seçilir. Alan boşsa i18n LANG_STRINGS varsayılanına düşer."
        technical={[
          "Backend: GET/PUT /api/settings/landing (PUT master-only) · GET /api/landing/ab-stats",
          "MongoDB: db.settings _key=landing_content, _key=landing_ab_stats",
          "Frontend: useLandingCms() + useAbVariant() → localStorage 'gws.ab_variant'",
          "A/B analitik: POST /api/landing/ab-impression (silent, IP-scope'suz global sayaç)",
        ]}
        recommendations={[
          "A/B test başlatmadan önce Variant B hero'ya CTA odaklı farklı bir başlık yazın",
          "Impression sayısı 500-1000'e ulaştığında istatistiklere bakın; anlamlı fark için binlerce ziyaret gerekir",
          "Copy-From-Lang butonu ile Türkçe içeriği İngilizceye kopyalayıp sadece çeviri değişikliği yapın",
        ]}
      />
    </div>
  );
}

/**
 * v43.12 A/B Testing Card — Landing hero için ikinci varyant tanımlama +
 * canlı impression istatistiklerini gösterir.
 */
function AbTestingCard({ form, setForm, setDirty, activeLang }) {
  const setEnabled = (v) => { setDirty(true); setForm((prev) => ({ ...prev, ab_test_enabled: !!v })); };
  const setGeoScope = (v) => { setDirty(true); setForm((prev) => ({ ...prev, ab_geo_scope: v })); };
  const setVbField = (k, val) => {
    setDirty(true);
    setForm((prev) => {
      const next = { ...prev };
      const vb = { ...next.variant_b_hero_by_lang };
      const cur = { ...(vb[activeLang] || EMPTY_HERO) };
      cur[k] = val;
      vb[activeLang] = cur;
      next.variant_b_hero_by_lang = vb;
      return next;
    });
  };
  const vb = form.variant_b_hero_by_lang[activeLang] || EMPTY_HERO;
  const langLabel = SUPPORTED.find(x => x.code === activeLang)?.label || activeLang.toUpperCase();

  const stats = useQuery({
    queryKey: ["landing-ab-stats"],
    queryFn: () => api.abStats(),
    enabled: !!form.ab_test_enabled,
    refetchInterval: 15000,
  });
  const s = stats.data || { A_impressions: 0, B_impressions: 0, total: 0, A_pct: 0, B_pct: 0 };

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><FlaskConical className="w-5 h-5 text-purple-300"/> A/B Testi (Hero)</span>}
        subtitle="İki farklı hero varyantı arasında %50/%50 trafik böl. Ziyaretçi ilk gelişte rastgele A veya B atanır ve sonraki ziyaretlerde aynı kalır."
        right={
          <div className="flex items-center gap-2">
            <Badge tone={form.ab_test_enabled ? "success" : "warning"}>
              {form.ab_test_enabled ? "AKTİF · %50/%50" : "KAPALI"}
            </Badge>
            <button
              data-testid="ab-test-toggle"
              onClick={() => setEnabled(!form.ab_test_enabled)}
              className={`text-xs px-3 py-1.5 rounded-md border font-medium transition-colors
                         ${form.ab_test_enabled
                           ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                           : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"}`}>
              {form.ab_test_enabled ? "Kapat" : "Aç"}
            </button>
          </div>
        }
      />
      <CardBody className="space-y-4">
        {form.ab_test_enabled && (
          <>
            {/* v43.13 Geo Segmentasyonu */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 gws-ab-geo" data-testid="ab-geo-scope">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mono mb-2 flex items-center gap-1.5">
                🌍 Coğrafi Kapsam
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {[
                  { v: "global",     label: "Herkes",     desc: "Tüm ziyaretçiler A/B",   flag: "🌍" },
                  { v: "TR_only",    label: "Sadece TR",  desc: "Yalnız Türkiye A/B",     flag: "🇹🇷" },
                  { v: "TR_exclude", label: "TR Hariç",   desc: "Türkiye dışı A/B",       flag: "🌐" },
                ].map(({ v, label, desc, flag }) => {
                  const active = form.ab_geo_scope === v;
                  return (
                    <button key={v}
                            data-testid={`ab-geo-${v}`}
                            onClick={() => setGeoScope(v)}
                            className={`text-left rounded-lg border p-2.5 transition-all
                                       ${active
                                         ? "border-purple-500/60 bg-purple-500/15 ring-1 ring-purple-500/40"
                                         : "border-slate-800 bg-slate-900/40 hover:border-slate-600"}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-xl leading-none">{flag}</span>
                        <div className="flex-1">
                          <div className={`text-xs font-semibold ${active ? "text-purple-100" : "text-slate-100"}`}>{label}</div>
                          <div className="text-[9px] mono text-slate-500 mt-0.5">{desc}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="text-[9px] mono text-slate-500 mt-2 italic">
                Kapsam dışı ziyaretçiler her zaman Variant A görür — ziyaretçi ülkesi ipapi.co ile ilk açılışta tespit edilir ve tarayıcıda cache'lenir.
              </div>
            </div>

            {/* v43.13 Confidence Score + Winner Badge */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 gws-ab-confidence" data-testid="ab-confidence">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-slate-500 mono">İstatistiksel Anlamlılık</span>
                  {s.is_significant ? (
                    <Badge tone="success">
                      🏆 Kazanan: Variant {s.winner} · Güven %{s.confidence}
                    </Badge>
                  ) : s.ready_for_significance ? (
                    <Badge tone="warning">
                      Henüz anlamlı değil · Güven %{s.confidence ?? 0}
                    </Badge>
                  ) : (
                    <Badge tone="info">
                      Yetersiz veri · {500 - s.total} gösterim daha gerekli
                    </Badge>
                  )}
                </div>
                <div className="text-[10px] mono text-slate-500 flex items-center gap-3">
                  {s.p_value !== null && s.p_value !== undefined && (
                    <span>p-value: <b className={s.p_value < 0.05 ? "text-emerald-300" : "text-slate-300"}>{s.p_value}</b></span>
                  )}
                  {s.z_score !== null && s.z_score !== undefined && (
                    <span>z: <b className="text-slate-300">{s.z_score}</b></span>
                  )}
                </div>
              </div>
              {/* Progress bar toward 500 */}
              {!s.ready_for_significance && (
                <div className="mt-2">
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                         style={{ width: `${Math.min(100, (s.total / 500) * 100)}%` }}/>
                  </div>
                  <div className="text-[9px] mono text-slate-500 mt-1">
                    {s.total} / 500 gösterim — anlamlı test için minimum 500 gerekli
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-4 gap-3" data-testid="ab-stats-grid">
              <StatBox label="Variant A" value={s.A_impressions} pct={s.A_pct} tone="indigo"
                       sub={`CR %${s.A_cr} · ${s.A_conversions} conv`}/>
              <StatBox label="Variant B" value={s.B_impressions} pct={s.B_pct} tone="purple"
                       sub={`CR %${s.B_cr} · ${s.B_conversions} conv`}/>
              <StatBox label="Toplam Gösterim" value={s.total} icon={BarChart3} tone="emerald"/>
              <StatBox label="Toplam Conversion" value={s.A_conversions + s.B_conversions} tone="amber"
                       sub={s.total > 0 ? `CR ortalama %${((s.A_conversions + s.B_conversions) / s.total * 100).toFixed(2)}` : ""}/>
            </div>
          </>
        )}
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mono">
          Variant B — Hero ({langLabel})
        </div>
        <FieldRow label="Alternatif Rozet" hint="Örn: WHM için %60 daha hızlı mail güvenliği"
                  value={vb.badge} onChange={(v) => setVbField("badge", v)} testid={`vb-badge-${activeLang}`}/>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FieldRow label="Alternatif Başlık — 1. satır" value={vb.title_a}
                    onChange={(v) => setVbField("title_a", v)} testid={`vb-title-a-${activeLang}`}/>
          <FieldRow label="Alternatif Başlık — 2. satır" value={vb.title_b}
                    onChange={(v) => setVbField("title_b", v)} testid={`vb-title-b-${activeLang}`}/>
        </div>
        <FieldRow label="Alternatif Alt Metin" multiline value={vb.subtitle}
                  onChange={(v) => setVbField("subtitle", v)} testid={`vb-subtitle-${activeLang}`}/>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FieldRow label="Alternatif CTA (primary)" value={vb.cta_primary}
                    onChange={(v) => setVbField("cta_primary", v)} testid={`vb-cta-primary-${activeLang}`}/>
          <FieldRow label="Alternatif CTA (secondary)" value={vb.cta_secondary}
                    onChange={(v) => setVbField("cta_secondary", v)} testid={`vb-cta-secondary-${activeLang}`}/>
        </div>
        <p className="text-[10px] mono text-slate-500 italic">
          İpucu: Variant B'de boş bıraktığınız alanlar Variant A değerine düşer — partial override.
        </p>
      </CardBody>
    </Card>
  );
}

function StatBox({ label, value, pct, sub, tone = "indigo", icon: Icon }) {
  const TONE = {
    indigo:  "border-indigo-500/40 bg-indigo-500/10 text-indigo-200",
    purple:  "border-purple-500/40 bg-purple-500/10 text-purple-200",
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    amber:   "border-amber-500/40 bg-amber-500/10 text-amber-200",
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${TONE}`}>
      <div className="text-[9px] uppercase tracking-widest mono opacity-80 flex items-center gap-1.5">
        {Icon && <Icon className="w-3 h-3"/>} {label}
      </div>
      <div className="text-2xl font-black tabular-nums mt-1 text-slate-100">{value}</div>
      {pct !== undefined && (
        <div className="text-[10px] mono opacity-70 mt-0.5">%{pct}</div>
      )}
      {sub && (
        <div className="text-[9px] mono opacity-70 mt-0.5 truncate">{sub}</div>
      )}
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
