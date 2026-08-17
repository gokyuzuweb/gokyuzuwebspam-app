import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  SlidersHorizontal, Save, RotateCcw, Check, X, Info, ShieldCheck,
  Loader2, ChevronRight, Package, History, User2,
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
    title: "Temel Modüller (Sayfa/Route)",
    icon: Check,
    features: [
      { key: "dashboard", label: "Dashboard (Ana Sayfa)", type: "bool", hint: "Ana panel görünümü" },
      { key: "live_traffic", label: "Canlı Mail Trafiği", type: "bool", hint: "Real-time trafik akışı" },
      { key: "attack_map", label: "3D Saldırı Haritası", type: "bool", hint: "Coğrafi saldırı görselleştirme" },
      { key: "logs_view", label: "Sistem Logları", type: "bool", hint: "Log görüntüleme" },
      { key: "mailscanner", label: "MailScanner", type: "bool", hint: "MailScanner konfig sayfası" },
      { key: "mail_health", label: "Mail Sağlık", type: "bool", hint: "Mail sağlık kontrolleri" },
      { key: "live_diagnostic", label: "Canlı Sunucu Tanı", type: "bool", hint: "Kurulum tanı sihirbazı" },
      { key: "my_server", label: "Sunucumu Bağla", type: "bool", hint: "Bayi kendi WHM sunucusunu bağlar" },
      { key: "docs_view", label: "Dokümantasyon", type: "bool", hint: "Yardım dokümanları" },
    ],
  },
  {
    title: "Liste Yönetimi",
    icon: ShieldCheck,
    features: [
      { key: "blacklist_check", label: "Blacklist / RBL Sorgu", type: "bool", hint: "15+ RBL sağlayıcı sorgusu" },
      { key: "blacklist_manage", label: "Kara Liste Ekle/Sil", type: "bool", hint: "IP/domain blackliste ekleme" },
      { key: "whitelist_manage", label: "Beyaz Liste Ekle/Sil", type: "bool", hint: "IP/domain whiteliste ekleme" },
      { key: "whitelist_history", label: "Whitelist Geçmişi", type: "bool", hint: "Whitelist audit sayfası" },
      { key: "quarantine_view", label: "Karantina Görüntüleme", type: "bool", hint: "Karantinaya düşen mailler" },
      { key: "quarantine_release", label: "Karantinadan Serbest Bırak", type: "bool", hint: "Karantinadan mail çıkarma" },
      { key: "quarantine_delete", label: "Karantinadan Silme", type: "bool", hint: "Toplu karantina silme yetkisi" },
    ],
  },
  {
    title: "Güvenlik & Motorlar",
    icon: ShieldCheck,
    features: [
      { key: "security_view", label: "Güvenlik Sayfası Görüntüleme", type: "bool", hint: "Country rules, engine listesi görme" },
      { key: "security_config", label: "Güvenlik Ayarı Değiştirme", type: "bool", hint: "Country blok, ratelimit, greylist ayarları" },
      { key: "engine_toggle", label: "Motor Aç / Kapa", type: "bool", hint: "SpamAssassin/ClamAV motorlarını yönetme" },
    ],
  },
  {
    title: "Giden Mail",
    icon: SlidersHorizontal,
    features: [
      { key: "outbound_view", label: "Giden Mail Görüntüleme", type: "bool", hint: "Sunucudan giden mailleri izleme" },
      { key: "outbound_control", label: "Giden Mail Kontrolü", type: "bool", hint: "Giden mail askıya alma / silme" },
    ],
  },
  {
    title: "İleri Güvenlik",
    icon: ShieldCheck,
    features: [
      { key: "custom_rules", label: "Kural Editörü (Rules)", type: "bool", hint: "Custom regex spam kuralları" },
      { key: "exploit_editor", label: "Exploit / Webshell Tarayıcı", type: "bool", hint: "Sunucuda kötü niyetli dosya tarama" },
      { key: "ai_explanations", label: "AI Destekli Açıklama", type: "bool", hint: "GPT/Claude ile spam açıklama" },
      { key: "threat_intel", label: "Tehdit Zekası (Threat Intel)", type: "bool", hint: "Global threat feed erişimi" },
      { key: "bec_detection", label: "BEC / Business Email Compromise", type: "bool", hint: "Yönetici sahtekarlık tespiti" },
      { key: "sandbox", label: "Ek/URL Sandbox", type: "bool", hint: "Şüpheli ek+URL sandbox analizi" },
      { key: "attachment_scan", label: "Ek Tarama", type: "bool", hint: "Virüs / imza taraması" },
      { key: "url_scan", label: "URL Taraması", type: "bool", hint: "Phishing URL tespit" },
    ],
  },
  {
    title: "Ekosistem",
    icon: Package,
    features: [
      { key: "marketplace", label: "İmza Marketplace", type: "bool", hint: "Kural paylaşımı & topluluk marketi" },
      { key: "bounce_digest", label: "Bounce Digest", type: "bool", hint: "Günlük bounce özet raporu" },
    ],
  },
  {
    title: "Bildirim & Raporlama",
    icon: Info,
    features: [
      { key: "notifications_view", label: "Bildirim Kutusu", type: "bool", hint: "Panel içi bildirim merkezi" },
      { key: "alerts_rules", label: "Custom Alert Kuralları", type: "bool", hint: "Özel uyarı tetikleyicileri" },
      { key: "reports_view", label: "Rapor Sayfası Görüntüleme", type: "bool", hint: "Rapor tablarına erişim" },
      { key: "reports_weekly", label: "Haftalık AI Raporu", type: "bool", hint: "Otomatik weekly summary" },
      { key: "reports_export", label: "Rapor Export (CSV/PDF)", type: "bool", hint: "Rapor dışa aktarma" },
      { key: "email_notifications", label: "E-posta Bildirimleri", type: "bool", hint: "Kritik olay maili" },
      { key: "smtp_settings", label: "SMTP Relay Ayarları", type: "bool", hint: "Kendi SMTP yapılandırması" },
    ],
  },
  {
    title: "Yönetim & Ekosistem",
    icon: SlidersHorizontal,
    features: [
      { key: "users_view", label: "Kullanıcı Görüntüleme", type: "bool", hint: "WHM kullanıcı listesi" },
      { key: "bulk_actions", label: "Toplu İşlemler", type: "bool", hint: "Toplu sil / whitelist / import" },
      { key: "sub_users", label: "Alt Kullanıcı Yönetimi", type: "bool", hint: "Panel içi sub-account" },
      { key: "reseller_mode", label: "Bayi Modu (Alt Bayi)", type: "bool", hint: "Kendi altına bayi açabilme" },
      { key: "api_access", label: "REST API Dış Erişim", type: "bool", hint: "API anahtarı ile 3rd party" },
      { key: "webhooks", label: "Webhook Entegrasyonu", type: "bool", hint: "Olay bazlı 3rd party bildirim" },
      { key: "two_factor_auth", label: "İki Faktörlü Doğrulama (2FA)", type: "bool", hint: "TOTP/SMS ile giriş" },
      { key: "priority_support", label: "Öncelikli Destek (SLA)", type: "bool", hint: "WhatsApp / öncelik" },
      { key: "custom_branding", label: "Beyaz Etiket (Custom Logo/Domain)", type: "bool", hint: "Kendi marka görünümü" },
      { key: "settings_customize", label: "Genel Ayar Değiştirme", type: "bool", hint: "Sistem ayarlarını değiştirme yetkisi" },
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
  const [tab, setTab] = useState("edit"); // 'edit' | 'history'

  const q = useQuery({
    queryKey: ["plan-matrix"],
    queryFn: () => api.adminPlanMatrix(LICKEY()),
    retry: false,
  });

  const history = useQuery({
    queryKey: ["plan-matrix-history"],
    queryFn: () => api.adminPlanMatrixHistory(LICKEY(), 100),
    enabled: tab === "history",
    retry: false,
  });

  useEffect(() => {
    if (q.data?.matrix && !matrix) setMatrix(q.data.matrix);
  }, [q.data, matrix]);

  const save = useMutation({
    mutationFn: (m) => api.adminPlanMatrixSave(m, LICKEY()),
    onSuccess: (d) => {
      toast.success("Plan matrisi kaydedildi", {
        description: `${d.changes ?? 0} alan değişti · bayi panelleri ~30sn içinde yeni matriste çalışır`,
      });
      setMatrix(d.matrix);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["plan-features"] });
      qc.invalidateQueries({ queryKey: ["plan-matrix"] });
      qc.invalidateQueries({ queryKey: ["plan-matrix-history"] });
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

      {/* Tab switcher */}
      <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-md p-1 w-fit">
        <button
          data-testid="pc-tab-edit"
          onClick={() => setTab("edit")}
          className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition ${
            tab === "edit" ? "bg-indigo-500/25 text-indigo-100" : "text-slate-400 hover:text-slate-100"
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" /> Düzenle
        </button>
        <button
          data-testid="pc-tab-history"
          onClick={() => setTab("history")}
          className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition ${
            tab === "history" ? "bg-indigo-500/25 text-indigo-100" : "text-slate-400 hover:text-slate-100"
          }`}
        >
          <History className="w-3.5 h-3.5" /> Değişiklik Geçmişi
        </button>
      </div>

      {tab === "history" ? (
        <Card>
          <CardHeader title="Plan Matris Değişiklik Geçmişi" subtitle="Kim ne zaman hangi modülü açtı/kapattı" />
          <CardBody className="p-0">
            {history.isLoading ? (
              <div className="text-center py-8 text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-2"/> Yükleniyor…</div>
            ) : !history.data?.items?.length ? (
              <div className="text-center py-12 text-slate-500 text-xs">Henüz değişiklik kaydı yok</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/50 text-[10px] uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="text-left px-4 py-2">Tarih</th>
                      <th className="text-left px-4 py-2">İşlem</th>
                      <th className="text-left px-4 py-2">IP</th>
                      <th className="text-left px-4 py-2">Değişiklikler</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {history.data.items.map((h) => (
                      <tr key={h.id} data-testid={`pc-history-row-${h.id}`} className="hover:bg-slate-900/40">
                        <td className="px-4 py-2.5 text-slate-300 mono text-xs whitespace-nowrap">
                          {new Date(h.at).toLocaleString("tr-TR")}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded ${
                            h.action === "reset" ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"
                          }`}>
                            {h.action === "reset" ? "sıfırla" : "güncelle"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 mono text-[11px]">{h.actor_ip || "—"}</td>
                        <td className="px-4 py-2.5">
                          {h.action === "reset" ? (
                            <span className="text-slate-500 text-xs">Tümü varsayılana döndü</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {(h.changes || []).slice(0, 5).map((c, i) => (
                                <span key={i} className="text-[11px] mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                                  <b className="text-slate-400">{c.plan}</b>.{c.feature}:{" "}
                                  <span className="text-rose-300">{String(c.from)}</span>→<span className="text-emerald-300">{String(c.to)}</span>
                                </span>
                              ))}
                              {(h.changes || []).length > 5 && (
                                <span className="text-[11px] text-slate-500">+{h.changes.length - 5} daha</span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : (<>

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
      </>)}
    </div>
  );
}
