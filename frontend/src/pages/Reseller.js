import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert, Users2, Key, LogOut, Plus, Trash2, Mail, Server,
  Inbox, ListChecks, LogIn, UserPlus, ArrowRight, CheckCircle2, XCircle,
  Receipt, Download, FileText, Palette,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge, StatCard } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import BrandingSettings from "@/components/BrandingSettings";

const TOKEN_KEY = "gws_reseller_token";

function useResellerToken() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const set = (t) => {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
    setToken(t || "");
  };
  return [token, set];
}

/* ----------------------------- Auth screen -------------------------------- */
function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", license_key: "", company: "" });

  const register = useMutation({
    mutationFn: (p) => api.resellerRegister(p),
    onSuccess: (d) => { onLogin(d.token); toast.success("Bayi hesabı oluşturuldu"); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kayıt başarısız"),
  });
  const login = useMutation({
    mutationFn: (p) => api.resellerLogin(p),
    onSuccess: (d) => { onLogin(d.token); toast.success(`Hoş geldiniz${d.company ? ' — ' + d.company : ''}`); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Giriş başarısız"),
  });

  const submit = () => {
    if (mode === "login") login.mutate({ email: form.email, password: form.password });
    else register.mutate(form);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 grid-backdrop flex items-center justify-center p-6" data-testid="reseller-auth">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="relative w-10 h-10 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <ShieldAlert className="w-5 h-5 text-white" />
          </div>
          <div className="text-slate-100 font-bold tracking-tight text-lg">Gökyüzü<span className="text-indigo-400">WebSpam</span></div>
        </Link>

        <Card>
          <CardHeader
            title={mode === "login" ? "Bayi Portalına Giriş" : "Yeni Bayi Hesabı"}
            subtitle={mode === "login"
              ? "Lisans sahibi bayiler kendi alt hesaplarını buradan yönetir"
              : "Zaten aldığınız lisans anahtarı ile hesap oluşturun"}
          />
          <CardBody className="space-y-3">
            {mode === "register" && (
              <>
                <div>
                  <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Lisans Anahtarı</label>
                  <input
                    data-testid="reseller-license"
                    value={form.license_key}
                    onChange={(e) => setForm({ ...form, license_key: e.target.value.trim() })}
                    placeholder="MS-XXXXXXXXXXXXXXXXXXX"
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono focus:outline-none focus:border-indigo-500/60"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Firma (opsiyonel)</label>
                  <input
                    data-testid="reseller-company"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    placeholder="Örnek Hosting Ltd."
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm"
                  />
                </div>
              </>
            )}
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">E-posta</label>
              <input
                data-testid="reseller-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="bayi@ornek.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono focus:outline-none focus:border-indigo-500/60"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Şifre</label>
              <input
                data-testid="reseller-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="En az 8 karakter"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono focus:outline-none focus:border-indigo-500/60"
              />
            </div>
            <button
              data-testid="reseller-submit"
              onClick={submit}
              disabled={login.isPending || register.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-medium shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-shadow disabled:opacity-50"
            >
              {mode === "login" ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
              {mode === "login" ? "Giriş Yap" : "Hesap Oluştur"}
            </button>
            <button
              data-testid="reseller-mode-toggle"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="w-full text-center text-xs text-slate-500 hover:text-indigo-300 transition-colors"
            >
              {mode === "login" ? "Hesabınız yok mu? Kayıt ol →" : "Zaten hesabınız var mı? Giriş yap →"}
            </button>
          </CardBody>
        </Card>

        <div className="mt-4 text-center text-xs text-slate-500">
          Henüz lisans almadınız mı?
          <Link to="/shop" className="text-indigo-400 hover:underline ml-1">/shop</Link> üzerinden edinebilirsiniz.
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Branding hook -------------------------------- */
function useBranding() {
  const [b, setB] = useState(() => {
    try {
      const raw = localStorage.getItem("gws.branding");
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  });
  useEffect(() => {
    const onChange = () => {
      try {
        const raw = localStorage.getItem("gws.branding");
        setB(raw ? JSON.parse(raw) : null);
      } catch (_) {}
    };
    window.addEventListener("gws.branding.changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("gws.branding.changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return b;
}

/* --------------------------- Reseller dashboard --------------------------- */
function ResellerDashboard({ token, onLogout }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["reseller-me"], queryFn: () => api.resellerMe(token), retry: false });
  const [subForm, setSubForm] = useState({ username: "", email: "", domain: "" });

  const addSub = useMutation({
    mutationFn: (p) => api.resellerAddSub(token, p),
    onSuccess: () => {
      toast.success("Alt hesap eklendi");
      setSubForm({ username: "", email: "", domain: "" });
      qc.invalidateQueries({ queryKey: ["reseller-me"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Ekleme başarısız"),
  });
  const delSub = useMutation({
    mutationFn: (id) => api.resellerDelSub(token, id),
    onSuccess: () => { toast.success("Silindi"); qc.invalidateQueries({ queryKey: ["reseller-me"] }); },
  });

  const scopedQ = useQuery({ queryKey: ["reseller-quarantine"], queryFn: () => api.resellerQuarantine(token) });
  const invoices = useQuery({ queryKey: ["reseller-invoices"], queryFn: () => api.resellerInvoices(token) });
  const [invLang, setInvLang] = useState(() => localStorage.getItem("gws_invoice_lang") || "tr");
  useEffect(() => { localStorage.setItem("gws_invoice_lang", invLang); }, [invLang]);

  const downloadPdf = async (tx_id, inv_no) => {
    try {
      const blob = await api.resellerInvoicePdfBlob(token, tx_id, invLang);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${inv_no}-${invLang}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`${inv_no}-${invLang}.pdf indirildi`);
    } catch (e) {
      toast.error("PDF indirilemedi");
    }
  };

  useEffect(() => {
    if (me.error) onLogout();
  }, [me.error]); // eslint-disable-line

  const branding = useBranding();

  if (me.isLoading) return <div className="p-10 text-slate-500 text-center">Yükleniyor…</div>;
  if (!me.data) return null;
  const { reseller, subaccounts, quota } = me.data;
  const quotaFull = quota.current >= quota.max_subaccounts;
  const brandName = branding?.brand_name || "GökyüzüWebSpam";
  const primary  = branding?.primary_color || "#6366f1";
  const accent   = branding?.accent_color  || "#ef4444";
  const logoUrl  = branding?.logo_url || "";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800/60 bg-slate-950/60 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="relative w-9 h-9 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <div className="text-slate-100 font-bold text-[15px]">Gökyüzü<span className="text-indigo-400">WebSpam</span></div>
              <div className="text-[10px] uppercase tracking-widest text-indigo-400 mono">BAYİ PORTALI</div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <div className="text-slate-300" data-testid="reseller-header-email">{reseller.email}</div>
              <div className="mono text-slate-500">{reseller.company} · {reseller.plan.toUpperCase()}</div>
            </div>
            <button data-testid="reseller-logout" onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 text-xs">
              <LogOut className="w-3.5 h-3.5" /> Çıkış
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard label="Lisans" tone="brand" icon={Key} testid="stat-license"
            value={reseller.license_key.slice(0, 12) + "…"}
            hint={reseller.valid_until ? "Bitiş: " + reseller.valid_until.slice(0, 10) : ""} />
          <StatCard label="Alt Hesaplar" tone="info" icon={Users2} testid="stat-subs"
            value={`${quota.current} / ${quota.max_subaccounts}`}
            hint={quotaFull ? "Kota dolu" : `${quota.max_subaccounts - quota.current} slot boş`} />
          <StatCard label="Karantina" tone="warning" icon={Inbox} testid="stat-quarantine"
            value={scopedQ.data?.length || 0}
            hint="Yalnızca alt hesaplarınız için" />
          <StatCard label="Plan" tone="success" icon={CheckCircle2} testid="stat-plan"
            value={reseller.plan.toUpperCase()}
            hint="Yükseltme için /shop" />
        </div>

        {/* Sub-accounts */}
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Users2 className="w-4 h-4 text-indigo-400" /> Alt Hesaplar</span>}
            subtitle="Yalnızca bu kullanıcıların e-postaları için karantina/liste yönetimi görebilirsiniz"
          />
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
              <input
                data-testid="sub-username"
                value={subForm.username}
                onChange={(e) => setSubForm({ ...subForm, username: e.target.value })}
                placeholder="cpanel-username"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono"
              />
              <input
                data-testid="sub-email"
                type="email"
                value={subForm.email}
                onChange={(e) => setSubForm({ ...subForm, email: e.target.value })}
                placeholder="user@domain.com"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono"
              />
              <input
                data-testid="sub-domain"
                value={subForm.domain}
                onChange={(e) => setSubForm({ ...subForm, domain: e.target.value })}
                placeholder="domain.com (opsiyonel)"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono"
              />
              <button
                data-testid="sub-add"
                onClick={() => addSub.mutate(subForm)}
                disabled={quotaFull || !subForm.username || !subForm.email}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" /> Ekle
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                    <th className="text-left px-3 py-2 font-semibold">Kullanıcı</th>
                    <th className="text-left px-3 py-2 font-semibold">E-posta</th>
                    <th className="text-left px-3 py-2 font-semibold">Domain</th>
                    <th className="text-right px-3 py-2 font-semibold">Kota/gün</th>
                    <th className="text-right px-3 py-2 font-semibold w-16"></th>
                  </tr>
                </thead>
                <tbody data-testid="subs-tbody">
                  {subaccounts.map((s) => (
                    <tr key={s.id} className="border-t border-slate-800">
                      <td className="px-3 py-2.5 mono text-slate-200">{s.username}</td>
                      <td className="px-3 py-2.5 mono text-slate-300">{s.email}</td>
                      <td className="px-3 py-2.5 mono text-slate-500">{s.domain || "—"}</td>
                      <td className="px-3 py-2.5 mono text-slate-400 text-right">{s.quota_daily}</td>
                      <td className="px-3 py-2.5 text-right">
                        <button onClick={() => delSub.mutate(s.id)}
                          data-testid={`sub-del-${s.username}`}
                          className="text-slate-500 hover:text-rose-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {subaccounts.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">Henüz alt hesap yok</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        {/* Scoped quarantine */}
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Inbox className="w-4 h-4 text-amber-400" /> Karantina (yalnızca alt hesaplarınız)</span>}
            subtitle={`${scopedQ.data?.length || 0} kayıt bulunuyor`}
          />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                    <th className="text-left px-3 py-2 font-semibold">Zaman</th>
                    <th className="text-left px-3 py-2 font-semibold">Gönderici</th>
                    <th className="text-left px-3 py-2 font-semibold">Alıcı</th>
                    <th className="text-left px-3 py-2 font-semibold">Konu</th>
                    <th className="text-right px-3 py-2 font-semibold">Skor</th>
                  </tr>
                </thead>
                <tbody data-testid="reseller-q-tbody">
                  {(scopedQ.data || []).map((r) => (
                    <tr key={r.id} className="border-t border-slate-800">
                      <td className="px-3 py-2.5 mono text-xs text-slate-400">{new Date(r.received_at).toLocaleString("tr-TR")}</td>
                      <td className="px-3 py-2.5 text-slate-300 truncate max-w-[220px]">{r.sender}</td>
                      <td className="px-3 py-2.5 text-slate-300 truncate max-w-[180px]">{r.recipient}</td>
                      <td className="px-3 py-2.5 text-slate-200 truncate max-w-[300px]">{r.subject}</td>
                      <td className="px-3 py-2.5 mono text-amber-300 text-right">{r.score.toFixed(2)}</td>
                    </tr>
                  ))}
                  {(scopedQ.data || []).length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                      Alt hesaplarınıza ait karantina kaydı yok — henüz spam yakalanmadı.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        {/* Invoice history */}
        <BrandingSettings licenseKey={reseller.license_key} />

        <Card data-testid="invoices-card">
          <CardHeader
            title={<span className="flex items-center gap-2"><Receipt className="w-4 h-4 text-emerald-400" /> Fatura Geçmişi</span>}
            subtitle={
              invoices.data
                ? `${invoices.data.count} fatura · Toplam ödeme: ${new Intl.NumberFormat("tr-TR", { style: "currency", currency: invoices.data.currency, maximumFractionDigits: 2 }).format(invoices.data.total_paid)}`
                : "Yükleniyor…"
            }
            right={
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase tracking-widest text-slate-500">PDF Dili</label>
                <select
                  data-testid="invoice-lang"
                  value={invLang}
                  onChange={(e) => setInvLang(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs mono text-slate-300 focus:outline-none focus:border-indigo-500/40"
                >
                  <option value="tr">Türkçe</option>
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                  <option value="fr">Français</option>
                  <option value="es">Español</option>
                </select>
              </div>
            }
          />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                    <th className="text-left px-3 py-2 font-semibold">Fatura No</th>
                    <th className="text-left px-3 py-2 font-semibold">Tarih</th>
                    <th className="text-left px-3 py-2 font-semibold">Plan</th>
                    <th className="text-right px-3 py-2 font-semibold">Tutar</th>
                    <th className="text-right px-3 py-2 font-semibold w-32">İşlem</th>
                  </tr>
                </thead>
                <tbody data-testid="invoices-tbody">
                  {(invoices.data?.invoices || []).map((inv) => (
                    <tr key={inv.id} className="border-t border-slate-800">
                      <td className="px-3 py-2.5 mono text-emerald-300">{inv.invoice_number}</td>
                      <td className="px-3 py-2.5 mono text-xs text-slate-400">
                        {inv.issued_at ? new Date(inv.issued_at).toLocaleDateString("tr-TR") : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone="brand">{(inv.plan_code || "").toUpperCase()}</Badge>
                        <span className="ml-2 text-xs text-slate-500 mono">{inv.billing_period}</span>
                      </td>
                      <td className="px-3 py-2.5 mono text-slate-100 text-right font-medium">
                        {new Intl.NumberFormat("tr-TR", { style: "currency", currency: inv.currency }).format(inv.amount)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          data-testid={`inv-pdf-${inv.id}`}
                          onClick={() => downloadPdf(inv.id, inv.invoice_number)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs"
                        >
                          <Download className="w-3 h-3" /> PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!invoices.data?.invoices || invoices.data.invoices.length === 0) && (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                      Henüz fatura yok. /shop üzerinden ilk aboneliğinizi başlatın.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center gap-2">
              <FileText className="w-3 h-3" />
              Faturalar Türkiye muhasebe standardına uygun formattadır — ödenmiş işaretli, ödeme referansı içerir. Muhasebe için ayrı entegrasyon gerektirmez.
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------ Route entry ------------------------------- */
export default function Reseller() {
  const [token, setToken] = useResellerToken();
  if (!token) return <AuthScreen onLogin={setToken} />;
  return <ResellerDashboard token={token} onLogout={() => setToken("")} />;
}
