import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, LogIn, Building2, CheckCircle2, XCircle, Clock, Search,
  Shield, RefreshCw, KeyRound, Power, Trash2, UserPlus, X, Copy, TrendingUp, Bell,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { api } from "@/lib/api";

const ago = (iso) => {
  if (!iso) return "-";
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} sn önce`;
  if (s < 3600) return `${Math.round(s / 60)} dk önce`;
  if (s < 86400) return `${Math.round(s / 3600)} sa önce`;
  return `${Math.round(s / 86400)} gün önce`;
};

/**
 * Master admin — shows all reseller accounts, recent login events (success + fail),
 * and aggregated sub-account list. Master-only via _require_master.
 */
export default function ResellerAdminPanel() {
  const licenseKey = typeof window !== "undefined"
    ? (localStorage.getItem("gws.event_license") || "")
    : "";
  const [tab, setTab] = useState("logins");  // logins | resellers | subaccounts
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [pwReset, setPwReset] = useState(null); // {id, email} | null
  const [activity, setActivity] = useState(null); // {id, email} | null
  const qc = useQueryClient();

  const logins = useQuery({
    queryKey: ["admin-logins"],
    queryFn: () => api.adminResellerLogins(licenseKey, 100),
    refetchInterval: 20000,
    retry: false,
    enabled: !!licenseKey,
  });
  const resellers = useQuery({
    queryKey: ["admin-resellers"],
    queryFn: () => api.adminResellers(licenseKey),
    refetchInterval: 30000,
    retry: false,
    enabled: !!licenseKey,
  });
  const subs = useQuery({
    queryKey: ["admin-subaccounts"],
    queryFn: () => api.adminSubaccounts(licenseKey),
    refetchInterval: 30000,
    retry: false,
    enabled: !!licenseKey,
  });

  const activeCount = resellers.data?.items?.filter((r) => r.active !== false).length || 0;
  const successToday = logins.data?.items?.filter(
    (r) => r.success && r.at && Date.now() - new Date(r.at).getTime() < 86400000
  ).length || 0;
  const failedToday = logins.data?.items?.filter(
    (r) => !r.success && r.at && Date.now() - new Date(r.at).getTime() < 86400000
  ).length || 0;

  const filterFn = (r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return JSON.stringify(r).toLowerCase().includes(q);
  };

  return (
    <Card data-testid="reseller-admin-card">
      <CardHeader
        title={<span className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-400" /> Bayi Portal Yönetimi
        </span>}
        subtitle={<span className="flex items-center gap-3 text-[11px]">
          <span className="text-emerald-400 mono">✓ {successToday} başarılı bugün</span>
          <span className="text-slate-600">·</span>
          <span className="text-rose-400 mono">✗ {failedToday} başarısız bugün</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400 mono">{activeCount} aktif bayi</span>
        </span>}
        right={
          <button
            onClick={() => { logins.refetch(); resellers.refetch(); subs.refetch(); }}
            className="text-slate-400 hover:text-indigo-300 p-1.5 rounded hover:bg-slate-800"
            title="Yenile"
            data-testid="admin-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${logins.isFetching ? "animate-spin" : ""}`} />
          </button>
        }
      />
      <CardBody className="space-y-3">
        {/* Master action bar for Resellers tab */}
        {tab === "resellers" && (
          <div className="flex justify-end -mt-1 -mb-1">
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 text-xs font-medium"
              data-testid="admin-new-reseller"
            >
              <UserPlus className="w-3.5 h-3.5" /> Yeni Bayi Oluştur
            </button>
          </div>
        )}
        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-800 -mt-2">
          {[
            { key: "logins",      label: "Girişler",     Icon: LogIn,      count: logins.data?.count || 0 },
            { key: "resellers",   label: "Bayiler",      Icon: Building2,  count: resellers.data?.count || 0 },
            { key: "subaccounts", label: "Alt Hesaplar", Icon: Users,      count: subs.data?.count || 0 },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition ${
                tab === t.key
                  ? "border-indigo-400 text-indigo-300"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
              data-testid={`admin-tab-${t.key}`}
            >
              <t.Icon className="w-3.5 h-3.5" />
              {t.label}
              <span className="text-[10px] mono px-1.5 rounded bg-slate-800 text-slate-400">{t.count}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "logins" ? "e-posta, IP, tarayıcı..." : tab === "resellers" ? "e-posta, firma, lisans..." : "kullanıcı adı, e-posta..."}
            className="w-full bg-slate-950 border border-slate-800 rounded pl-8 pr-3 py-1.5 text-xs text-slate-100 mono focus:outline-none focus:border-indigo-500/60"
            data-testid="admin-search"
          />
        </div>

        {/* Content */}
        {tab === "logins" && <LoginsTable items={(logins.data?.items || []).filter(filterFn)} loading={logins.isLoading} />}
        {tab === "resellers" && (
          <ResellersTable
            items={(resellers.data?.items || []).filter(filterFn)}
            loading={resellers.isLoading}
            licenseKey={licenseKey}
            onResetPassword={(r) => setPwReset({ id: r.id, email: r.email })}
            onShowActivity={(r) => setActivity({ id: r.id, email: r.email, company: r.company })}
          />
        )}
        {tab === "subaccounts" && <SubaccountsTable items={(subs.data?.items || []).filter(filterFn)} loading={subs.isLoading} />}
      </CardBody>

      {showCreate && (
        <CreateResellerModal
          licenseKey={licenseKey}
          onClose={() => setShowCreate(false)}
          onCreated={() => { qc.invalidateQueries({ queryKey: ["admin-resellers"] }); setShowCreate(false); }}
        />
      )}
      {pwReset && (
        <PasswordResetModal
          licenseKey={licenseKey}
          reseller={pwReset}
          onClose={() => setPwReset(null)}
        />
      )}
      {activity && (
        <ActivityChartModal
          licenseKey={licenseKey}
          reseller={activity}
          onClose={() => setActivity(null)}
        />
      )}
    </Card>
  );
}

function LoginsTable({ items, loading }) {
  if (loading) return <div className="text-center py-8 text-slate-500 text-xs">Yükleniyor…</div>;
  if (items.length === 0) return <div className="text-center py-8 text-slate-500 text-xs">Kayıt yok</div>;
  return (
    <div className="max-h-[420px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-widest text-slate-500">
          <tr>
            <th className="px-2 py-1.5 text-left">Zaman</th>
            <th className="px-2 py-1.5 text-left">Durum</th>
            <th className="px-2 py-1.5 text-left">E-posta</th>
            <th className="px-2 py-1.5 text-left">Firma</th>
            <th className="px-2 py-1.5 text-left">IP</th>
            <th className="px-2 py-1.5 text-left">Tarayıcı</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-t border-slate-800 hover:bg-slate-800/40" data-testid={`admin-login-row-${r.id}`}>
              <td className="px-2 py-1.5 mono text-slate-400 whitespace-nowrap">
                <Clock className="w-2.5 h-2.5 inline mr-1 text-slate-600" />
                {ago(r.at)}
              </td>
              <td className="px-2 py-1.5">
                {r.success ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="w-3 h-3" /> OK</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-rose-400"><XCircle className="w-3 h-3" /> RED</span>
                )}
              </td>
              <td className="px-2 py-1.5 mono text-slate-200">{r.email}</td>
              <td className="px-2 py-1.5 text-slate-400 truncate max-w-[140px]">{r.company || "-"}</td>
              <td className="px-2 py-1.5 mono text-slate-400 truncate max-w-[110px]">{r.ip || "-"}</td>
              <td className="px-2 py-1.5 text-slate-500 truncate max-w-[180px]" title={r.user_agent}>
                {(r.user_agent || "").split(" ")[0]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResellersTable({ items, loading, licenseKey, onResetPassword, onShowActivity }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (rid) => api.adminResellerToggle(licenseKey, rid),
    onSuccess: (d) => { toast.success(d.active ? "Bayi aktifleştirildi" : "Bayi askıya alındı");
      qc.invalidateQueries({ queryKey: ["admin-resellers"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });
  const del = useMutation({
    mutationFn: (rid) => api.adminResellerDelete(licenseKey, rid),
    onSuccess: (d) => { toast.success(`Bayi silindi (${d.subaccounts_deleted} alt hesap da silindi)`);
      qc.invalidateQueries({ queryKey: ["admin-resellers"] });
      qc.invalidateQueries({ queryKey: ["admin-subaccounts"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });
  const remind = useMutation({
    mutationFn: (rid) => api.adminSendReminder(licenseKey, rid),
    onSuccess: (d) => toast.success(`✓ Hatırlatma gönderildi → ${d.email}`, { duration: 6000 }),
    onError: (e) => toast.error(e?.response?.data?.detail || "Hatırlatma gönderilemedi"),
  });
  if (loading) return <div className="text-center py-8 text-slate-500 text-xs">Yükleniyor…</div>;
  if (items.length === 0) return <div className="text-center py-8 text-slate-500 text-xs">Bayi kaydı yok</div>;
  return (
    <div className="max-h-[420px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-widest text-slate-500">
          <tr>
            <th className="px-2 py-1.5 text-left">E-posta</th>
            <th className="px-2 py-1.5 text-left">Firma</th>
            <th className="px-2 py-1.5 text-left">Plan</th>
            <th className="px-2 py-1.5 text-left">Lisans</th>
            <th className="px-2 py-1.5 text-right">Alt</th>
            <th className="px-2 py-1.5 text-left">Son Giriş</th>
            <th className="px-2 py-1.5 text-left">Durum</th>
            <th className="px-2 py-1.5 text-right">Aksiyon</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-t border-slate-800 hover:bg-slate-800/40" data-testid={`admin-reseller-row-${r.id}`}>
              <td className="px-2 py-1.5 mono text-slate-200">{r.email}</td>
              <td className="px-2 py-1.5 text-slate-400 truncate max-w-[120px]">{r.company || "-"}</td>
              <td className="px-2 py-1.5">
                <Badge tone={r.plan === "enterprise" ? "success" : r.plan === "pro" ? "info" : "neutral"}>
                  {r.plan || "starter"}
                </Badge>
              </td>
              <td className="px-2 py-1.5 mono text-indigo-300 truncate max-w-[110px]" title={r.license_key}>
                {r.license_key?.slice(0, 10)}…
              </td>
              <td className="px-2 py-1.5 mono text-right text-slate-300">{r.subaccount_count}</td>
              <td className="px-2 py-1.5 mono text-slate-400 whitespace-nowrap">{ago(r.last_login_at)}</td>
              <td className="px-2 py-1.5">
                {r.active === false ? (
                  <span className="text-rose-400 text-[10px]">askıda</span>
                ) : r.idle ? (
                  <span className="inline-flex items-center gap-1 text-amber-400 text-[10px]" title={`${r.inactivity_days} gün girişsiz`}>
                    😴 uyku ({r.inactivity_days}g)
                  </span>
                ) : (
                  <span className="text-emerald-400 text-[10px]">aktif</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                {r.idle && r.active !== false && (
                  <button
                    onClick={() => remind.mutate(r.id)}
                    title="Hatırlatma maili gönder"
                    data-testid={`admin-reseller-remind-${r.id}`}
                    className="mr-1 inline-flex items-center p-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                  >
                    <Bell className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => onShowActivity(r)}
                  title="30 günlük aktivite grafiği"
                  data-testid={`admin-reseller-activity-${r.id}`}
                  className="mr-1 inline-flex items-center p-1 rounded border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
                >
                  <TrendingUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => onResetPassword(r)}
                  title="Şifre sıfırla"
                  data-testid={`admin-reseller-pw-${r.id}`}
                  className="mr-1 inline-flex items-center p-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                >
                  <KeyRound className="w-3 h-3" />
                </button>
                <button
                  onClick={() => toggle.mutate(r.id)}
                  title={r.active === false ? "Aktifleştir" : "Askıya al"}
                  data-testid={`admin-reseller-toggle-${r.id}`}
                  className="mr-1 inline-flex items-center p-1 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  <Power className="w-3 h-3" />
                </button>
                <button
                  onClick={() => { if (confirm(`${r.email} ve alt hesapları KALICI olarak silinsin mi?`)) del.mutate(r.id); }}
                  title="Kalıcı olarak sil"
                  data-testid={`admin-reseller-del-${r.id}`}
                  className="inline-flex items-center p-1 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PasswordResetModal({ licenseKey, reseller, onClose }) {
  const [pw, setPw] = useState("");
  const [visible, setVisible] = useState(false);
  const gen = () => {
    const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setPw(s);
    setVisible(true);
  };
  const save = useMutation({
    mutationFn: () => api.adminResellerReset(licenseKey, reseller.id, pw),
    onSuccess: () => {
      toast.success(`✓ Şifre sıfırlandı: ${reseller.email}`, { duration: 6000 });
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Sıfırlanamadı"),
  });
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/70 z-40" data-testid="pwreset-backdrop" />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md z-50 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-2xl"
           data-testid="pwreset-modal">
        <div className="p-5 border-b border-slate-800 flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Şifre Sıfırla</div>
            <div className="text-slate-100 font-semibold text-base mt-0.5">{reseller.email}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 p-1 rounded" data-testid="pwreset-close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Yeni Şifre</label>
            <div className="flex gap-2">
              <input
                type={visible ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="En az 6 karakter"
                className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono text-slate-100"
                data-testid="pwreset-input"
              />
              <button onClick={() => setVisible(v => !v)}
                      className="px-3 rounded bg-slate-800 text-slate-400 hover:text-slate-200 text-xs">
                {visible ? "gizle" : "göster"}
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={gen}
                    className="flex-1 text-xs px-3 py-1.5 rounded border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
                    data-testid="pwreset-generate">
              🎲 Rastgele Oluştur
            </button>
            {pw && (
              <button onClick={() => { navigator.clipboard.writeText(pw); toast.success("Kopyalandı"); }}
                      className="text-xs px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 inline-flex items-center gap-1">
                <Copy className="w-3 h-3" /> kopyala
              </button>
            )}
          </div>
          {pw && (
            <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
              ⚠️ Şifreyi kaydetmeden önce güvenli bir yere not edin. Kaydettikten sonra tekrar göremezsiniz.
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-800 flex justify-end gap-2">
          <button onClick={onClose}
                  className="px-3 py-1.5 rounded text-xs border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                  data-testid="pwreset-cancel">İptal</button>
          <button onClick={() => save.mutate()}
                  disabled={save.isPending || pw.length < 6}
                  className="px-4 py-1.5 rounded text-xs bg-gradient-to-br from-amber-500 to-amber-600 text-white font-semibold shadow disabled:opacity-50"
                  data-testid="pwreset-save">
            {save.isPending ? "Kaydediliyor…" : "Şifreyi Sıfırla"}
          </button>
        </div>
      </div>
    </>
  );
}

function CreateResellerModal({ licenseKey, onClose, onCreated }) {
  const [form, setForm] = useState({ email: "", password: "", company: "", license_key: "", plan: "pro" });
  const gen = () => {
    const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setForm((f) => ({ ...f, password: s }));
  };
  const create = useMutation({
    mutationFn: () => api.adminResellerCreate(licenseKey, form),
    onSuccess: () => { toast.success("Bayi oluşturuldu"); onCreated?.(); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Oluşturulamadı"),
  });
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/70 z-40" data-testid="createreseller-backdrop" />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md z-50 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-2xl"
           data-testid="createreseller-modal">
        <div className="p-5 border-b border-slate-800 flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-bold">Yeni Bayi</div>
            <div className="text-slate-100 font-semibold text-base mt-0.5">Bayi Portalına Hesap Ekle</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 p-1 rounded" data-testid="createreseller-close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <F label="E-posta">
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.toLowerCase() })}
                   placeholder="bayi@ornek.com" className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono"
                   data-testid="createreseller-email" />
          </F>
          <F label="Firma">
            <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}
                   placeholder="ABC Ltd. Şti." className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm"
                   data-testid="createreseller-company" />
          </F>
          <F label="Lisans Anahtarı">
            <input value={form.license_key} onChange={(e) => setForm({ ...form, license_key: e.target.value.trim() })}
                   placeholder="MS-XXXXXXXXXXXXXXXXX" className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono"
                   data-testid="createreseller-license" />
          </F>
          <div className="grid grid-cols-3 gap-2">
            <F label="Plan" className="col-span-1">
              <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-2 text-sm"
                      data-testid="createreseller-plan">
                <option value="starter">starter (5)</option>
                <option value="pro">pro (50)</option>
                <option value="enterprise">enterprise (999)</option>
              </select>
            </F>
            <F label="Şifre" className="col-span-2">
              <div className="flex gap-1">
                <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                       placeholder="En az 6 karakter"
                       className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono"
                       data-testid="createreseller-pw" />
                <button onClick={gen} className="text-xs px-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                        title="Rastgele">🎲</button>
              </div>
            </F>
          </div>
        </div>
        <div className="p-4 border-t border-slate-800 flex justify-end gap-2">
          <button onClick={onClose}
                  className="px-3 py-1.5 rounded text-xs border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                  data-testid="createreseller-cancel">İptal</button>
          <button onClick={() => create.mutate()}
                  disabled={create.isPending || !form.email || form.password.length < 6 || !form.license_key}
                  className="px-4 py-1.5 rounded text-xs bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-semibold shadow disabled:opacity-50"
                  data-testid="createreseller-save">
            {create.isPending ? "Oluşturuluyor…" : "Oluştur"}
          </button>
        </div>
      </div>
    </>
  );
}

function F({ label, children, className = "" }) {
  return (
    <div className={className}>
      <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">{label}</label>
      {children}
    </div>
  );
}

/* --------------------------- Activity chart modal ------------------------- */
function ActivityChartModal({ licenseKey, reseller, onClose }) {
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["reseller-activity", reseller.id, days],
    queryFn: () => api.adminResellerActivity(licenseKey, reseller.id, days),
    retry: false,
  });
  const rows = (q.data?.items || []).map((d) => ({
    ...d,
    day_short: d.day.slice(5), // MM-DD
  }));
  const totalSuccess = rows.reduce((s, r) => s + (r.success || 0), 0);
  const totalFail    = rows.reduce((s, r) => s + (r.fail    || 0), 0);
  const totalDays    = rows.filter(r => r.total > 0).length;

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/70 z-40" data-testid="activity-backdrop" />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[94vw] max-w-2xl z-50 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-2xl"
           data-testid="activity-modal">
        <div className="p-5 border-b border-slate-800 flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-bold">Login Aktivitesi</div>
            <div className="text-slate-100 font-semibold text-base mt-0.5">{reseller.email}</div>
            <div className="text-xs text-slate-400 mt-0.5">{reseller.company || "-"}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 p-1 rounded" data-testid="activity-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-4 flex items-center gap-2 text-xs">
          <span className="text-slate-500">Dönem:</span>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
                    data-testid={`activity-days-${d}`}
                    className={`px-2.5 py-0.5 rounded text-[11px] ${
                      days === d
                        ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/40"
                        : "border border-slate-700 bg-slate-800/40 text-slate-400 hover:text-slate-200"
                    }`}>
              {d} gün
            </button>
          ))}
        </div>

        <div className="px-5 py-3 grid grid-cols-3 gap-3 text-center">
          <MetricPill label="Başarılı" value={totalSuccess} color="#10b981" />
          <MetricPill label="Başarısız" value={totalFail} color="#ef4444" />
          <MetricPill label="Aktif Gün" value={`${totalDays}/${days}`} color="#6366f1" />
        </div>

        <div className="px-5 pb-5">
          <div className="h-56 w-full">
            {q.isLoading ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">Yükleniyor…</div>
            ) : (
              <ResponsiveContainer>
                <LineChart data={rows} margin={{ top: 8, right: 10, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="day_short" stroke="#64748b" fontSize={10} tick={{ fill: "#94a3b8" }} />
                  <YAxis stroke="#64748b" fontSize={10} allowDecimals={false} tick={{ fill: "#94a3b8" }} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="success" name="Başarılı" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="fail" name="Başarısız" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2 }} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          {rows.every(r => r.total === 0) && !q.isLoading && (
            <div className="text-center text-xs text-slate-500 mt-2">
              Son {days} günde login kaydı yok
            </div>
          )}
        </div>

        <div className="p-3 border-t border-slate-800 text-[10px] text-slate-500 text-center mono">
          Master → /api/admin/resellers/{reseller.id.slice(0, 8)}…/activity
        </div>
      </div>
    </>
  );
}

function MetricPill({ label, value, color }) {
  return (
    <div className="rounded-lg py-2 border" style={{ background: `${color}12`, borderColor: `${color}30` }}>
      <div className="mono font-bold text-slate-100 text-lg">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-slate-400">{label}</div>
    </div>
  );
}

function SubaccountsTable({ items, loading }) {
  if (loading) return <div className="text-center py-8 text-slate-500 text-xs">Yükleniyor…</div>;
  if (items.length === 0) return <div className="text-center py-8 text-slate-500 text-xs">Alt hesap yok</div>;
  return (
    <div className="max-h-[420px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-900 text-[10px] uppercase tracking-widest text-slate-500">
          <tr>
            <th className="px-2 py-1.5 text-left">Kullanıcı</th>
            <th className="px-2 py-1.5 text-left">E-posta</th>
            <th className="px-2 py-1.5 text-left">Ait Olduğu Bayi</th>
            <th className="px-2 py-1.5 text-left">Domain</th>
            <th className="px-2 py-1.5 text-right">Kota Kullanım</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="border-t border-slate-800 hover:bg-slate-800/40" data-testid={`admin-sub-row-${s.id}`}>
              <td className="px-2 py-1.5 mono text-slate-200">{s.username}</td>
              <td className="px-2 py-1.5 text-slate-400 truncate max-w-[160px]">{s.email || "-"}</td>
              <td className="px-2 py-1.5 text-slate-300 truncate max-w-[180px]">
                {s.reseller_company || s.reseller_email || "-"}
              </td>
              <td className="px-2 py-1.5 mono text-slate-400 truncate max-w-[140px]">{s.domain || "-"}</td>
              <td className="px-2 py-1.5 mono text-slate-400 text-right">{s.mail_count ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
