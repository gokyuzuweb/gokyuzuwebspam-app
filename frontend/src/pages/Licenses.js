import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Key, Plus, Trash2, ShieldAlert, Copy, Server, Calendar, Users2, AlertTriangle,
  CheckCircle2, XCircle, Package, PackagePlus, RefreshCw, Radio, Pencil, Wrench, Lock,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge, StatCard } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import MrrPanel from "@/components/MrrPanel";
import LicenseServerStatus from "@/components/LicenseServerStatus";
import EditLicenseModal from "@/components/EditLicenseModal";
import VersionPublishCard from "@/components/VersionPublishCard";
import ResellerAdminPanel from "@/components/ResellerAdminPanel";
import AdminOperationsCard from "@/components/AdminOperationsCard";
import { useIsMaster } from "@/hooks/useIsMaster";
import ErrorBoundary from "@/components/ErrorBoundary";

/**
 * MasterUnlockButton — one-time master session bootstrap.
 * When accessed via the WHM plugin (X-Forwarded-For carries master IP), clicking
 * this button gets a 30-day cookie so future requests don't need spoofing.
 */
function MasterUnlockButton() {
  const [key, setKey] = useState(
    typeof window !== "undefined"
      ? (localStorage.getItem("gws.event_license") || "")
      : ""
  );
  const unlock = useMutation({
    mutationFn: () => api.masterUnlock(key.trim()),
    onSuccess: (data) => {
      toast.success(`Master oturum açıldı · 30 gün geçerli (${new Date(data.valid_until).toLocaleDateString("tr-TR")}'e kadar)`);
      setTimeout(() => window.location.reload(), 800);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Oturum açılamadı"),
  });
  return (
    <div className="mt-6 p-4 rounded-lg border border-indigo-500/25 bg-indigo-500/5 text-left">
      <div className="text-[11px] uppercase tracking-widest text-indigo-400 font-bold mb-1">
        Ana Yönetici Girişi
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Master IP'den (WHM plugin üzerinden) erişiyorsanız aşağıya lisans anahtarınızı
        girin ve tek tıkla 30 günlük oturum başlatın. Sonrasında X-Forwarded-For
        gerekmez, çerez tanır.
      </p>
      <div className="flex gap-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value.trim())}
          placeholder="MS-XXXXXXXXXXXXXXXXXXX"
          className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs mono text-slate-100 focus:outline-none focus:border-indigo-500/60"
          data-testid="master-unlock-key"
        />
        <button
          onClick={() => unlock.mutate()}
          disabled={unlock.isPending || !key}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-gradient-to-br from-indigo-500 to-indigo-600 text-white text-sm font-semibold shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 disabled:opacity-50 transition"
          data-testid="master-unlock-btn"
        >
          {unlock.isPending ? "Doğrulanıyor…" : "Master Aç"}
        </button>
      </div>
    </div>
  );
}

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);
const isoDate = (iso) => iso ? new Date(iso).toLocaleDateString("tr-TR") : "—";
const isoDateTime = (iso) => iso ? new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function isExpired(iso) {
  try { return new Date(iso) < new Date(); } catch { return false; }
}

const PLAN_TONE = { starter: "info", pro: "brand", enterprise: "success" };
const REASON_LABEL = {
  ip_not_allowed: "IP izinli değil",
  key_not_found: "Anahtar bulunamadı",
  expired: "Süresi dolmuş",
  inactive: "Devre dışı",
  invalid_date: "Geçersiz tarih",
  domain_limit_exceeded: "Domain limiti aşıldı",
};

function AddLicenseForm({ onAdded }) {
  const [form, setForm] = useState({
    customer_name: "",
    customer_email: "",
    plan: "pro",
    ip_addresses: "",
    panel_domains: "",
    max_domains: 100,
    valid_until: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    notes: "",
  });
  const add = useMutation({
    mutationFn: (p) => api.licenseAdd(p),
    onSuccess: (data) => {
      toast.success(`Lisans oluşturuldu: ${data.license_key}`);
      setForm({ ...form, customer_name: "", customer_email: "", ip_addresses: "", panel_domains: "", notes: "" });
      onAdded?.();
    },
    onError: (e) => toast.error("Oluşturulamadı: " + (e?.response?.data?.detail || e.message)),
  });
  const submit = (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) return toast.error("Müşteri adı zorunlu");
    const ips = form.ip_addresses.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    const domains = form.panel_domains.split(/[\s,;]+/).map(s => s.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean);
    if (ips.length === 0 && domains.length === 0) return toast.error("En az bir IP veya cPanel domain girin");
    add.mutate({
      ...form,
      ip_addresses: ips,
      panel_domains: domains,
      max_domains: parseInt(form.max_domains) || 100,
      valid_until: new Date(form.valid_until + "T12:00:00Z").toISOString(),
    });
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-12 gap-3 items-end">
      <div className="col-span-12 md:col-span-3">
        <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Müşteri adı</label>
        <input data-testid="lic-customer" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
      </div>
      <div className="col-span-12 md:col-span-3">
        <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">E-posta</label>
        <input data-testid="lic-email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
          placeholder="admin@musteri.com"
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
      </div>
      <div className="col-span-4 md:col-span-2">
        <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Plan</label>
        <select data-testid="lic-plan" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-2 text-sm">
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>
      <div className="col-span-4 md:col-span-2">
        <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Max Domain</label>
        <input type="number" data-testid="lic-maxdom" value={form.max_domains} onChange={(e) => setForm({ ...form, max_domains: e.target.value })}
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right" />
      </div>
      <div className="col-span-4 md:col-span-2">
        <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Geçerli (bitiş)</label>
        <input type="date" data-testid="lic-until" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
      </div>
      <div className="col-span-12 md:col-span-9">
        <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">İzinli IP adresleri (virgül veya boşlukla ayırın)</label>
        <input data-testid="lic-ips" value={form.ip_addresses} onChange={(e) => setForm({ ...form, ip_addresses: e.target.value })}
          placeholder="203.0.113.10, 203.0.113.11"
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
      </div>
      <div className="col-span-12 md:col-span-3">
        <button data-testid="lic-add" type="submit"
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20">
          <Plus className="w-4 h-4" /> Lisans Oluştur
        </button>
      </div>
      <div className="col-span-12">
        <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Notlar</label>
        <input data-testid="lic-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="opsiyonel"
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
      </div>
    </form>
  );
}

function VersionCard() {
  const qc = useQueryClient();
  const cur = useQuery({ queryKey: ["version-current"], queryFn: api.versionCurrent });
  const mf = useQuery({ queryKey: ["version-manifest"], queryFn: api.versionManifest });
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: (p) => api.versionManifestPut(p),
    onSuccess: () => { toast.success("Manifest güncellendi"); setEditing(false);
      qc.invalidateQueries({ queryKey: ["version-manifest"] }); },
  });
  const startEdit = () => { setState(mf.data); setEditing(true); };
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Package className="w-4 h-4 text-indigo-400" /> Sürüm Yönetimi</span>}
        subtitle="Bir yenilik yayımladığınızda buradan manifest'i güncelleyin — plugin'ler otomatik algılar"
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded border border-slate-800 bg-slate-950/40">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Kurulu Sürüm</div>
            <div className="mono text-2xl text-slate-100 mt-1">{cur.data?.version || "—"}</div>
            <div className="text-xs text-slate-500 mt-1">bu server</div>
          </div>
          <div className="p-3 rounded border border-indigo-500/20 bg-indigo-500/5">
            <div className="text-[10px] uppercase tracking-widest text-indigo-400">Yayınlanan En Son</div>
            <div className="mono text-2xl text-indigo-300 mt-1">{mf.data?.latest_version || "—"}</div>
            <div className="text-xs text-slate-500 mt-1">{isoDate(mf.data?.release_date)}</div>
          </div>
        </div>
        {editing ? (
          <div className="space-y-2">
            <input value={state?.latest_version || ""} onChange={(e) => setState({ ...state, latest_version: e.target.value })}
              placeholder="Yeni sürüm (örn. 1.2.0)" className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
            <input value={state?.download_url || ""} onChange={(e) => setState({ ...state, download_url: e.target.value })}
              placeholder="https://.../gokyuzuwebspam-1.2.0.tar.gz"
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
            <textarea rows={3} value={state?.changelog || ""} onChange={(e) => setState({ ...state, changelog: e.target.value })}
              placeholder="Yenilikler..." className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button data-testid="ver-save" onClick={() => save.mutate({ ...state, release_date: new Date().toISOString() })}
                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20">
                <RefreshCw className="w-3.5 h-3.5" /> Yayınla
              </button>
              <button onClick={() => setEditing(false)} className="px-3 py-2 rounded-md text-sm border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
                İptal
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-xs text-slate-400">
              <div className="mono text-[11px] text-slate-500 truncate">{mf.data?.download_url}</div>
              <div className="mt-2 text-slate-400 whitespace-pre-wrap">{mf.data?.changelog}</div>
            </div>
            <button data-testid="ver-new" onClick={startEdit}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20">
              <PackagePlus className="w-3.5 h-3.5" /> Yeni Sürüm Yayınla
            </button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default function Licenses() {
  return (
    <ErrorBoundary label="Lisans Yönetimi">
      <LicensesInner />
    </ErrorBoundary>
  );
}

function LicensesInner() {
  const qc = useQueryClient();
  const { isMaster, isLoading: masterLoading, clientIp, masterIp } = useIsMaster();
  const licenses = useQuery({ queryKey: ["licenses"], queryFn: api.licenses, refetchInterval: 20000, enabled: isMaster });
  const violations = useQuery({ queryKey: ["violations"], queryFn: api.violations, refetchInterval: 15000, enabled: isMaster });
  // v44.00.00 — Master versiyonu ile karşılaştırıp güncelliği göster
  const masterVer = useQuery({ queryKey: ["version-current-lics"], queryFn: api.versionCurrent, staleTime: 60_000 });
  const masterVersion = (masterVer.data?.version || "").replace(/^v/i, "");
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState(new Set());

  const del = useMutation({
    mutationFn: (id) => api.licenseDelete(id),
    onSuccess: () => { toast.success("Lisans silindi"); qc.invalidateQueries({ queryKey: ["licenses"] }); },
  });
  const bulkAction = useMutation({
    mutationFn: ({ ids, action }) => api.licensesBulkAction(ids, action),
    onSuccess: (d) => {
      const labels = { delete: "silindi", suspend: "askıya alındı", activate: "aktifleştirildi" };
      toast.success(`${d.affected} lisans ${labels[d.action] || "güncellendi"}`);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["licenses"] });
    },
    onError: (e) => toast.error("Toplu aksiyon başarısız: " + (e?.response?.data?.detail || e.message)),
  });
  const fixIds = useMutation({
    mutationFn: () => api.licensesFixIds(),
    onSuccess: (d) => {
      if (d.fixed > 0) toast.success(`${d.fixed} eski kayda ID atandı — artık düzenlenebilir`);
      else toast.info("Zaten tüm kayıtlarda ID var");
      qc.invalidateQueries({ queryKey: ["licenses"] });
    },
  });
  const toggleActive = useMutation({
    mutationFn: ({ lic, active }) => api.licenseUpdate(lic.id, { ...lic, active }),
    onSuccess: () => { toast.success("Güncellendi"); qc.invalidateQueries({ queryKey: ["licenses"] }); },
  });
  const broadcast = useMutation({
    mutationFn: (id) => api.licenseBroadcastRefresh(id),
    onSuccess: (d) => {
      toast.success(`Zorla güncelleme iletildi (v${d.license_version})`, {
        description: "Hedef panel bir sonraki polling'de cache'i yenileyecek",
      });
      qc.invalidateQueries({ queryKey: ["licenses"] });
    },
    onError: (e) => toast.error("Zorla iletim başarısız: " + (e?.response?.data?.detail || e.message)),
  });
  const clearViol = useMutation({
    mutationFn: () => api.violationsClear(),
    onSuccess: (d) => { toast.success(`${d.deleted} kayıt temizlendi`); qc.invalidateQueries({ queryKey: ["violations"] }); },
  });
  const simulate = useMutation({
    mutationFn: () => api.violationSimulate({
      ip: "45.32.11.7", license_key: "MS-STOLEN99999",
      hostname: "test-rogue.example.com", reason: "ip_not_allowed",
    }),
    onSuccess: () => { toast.success("Simüle ihlal + bildirim tetiklendi (bkz. Bildirimler)");
      qc.invalidateQueries({ queryKey: ["violations"] }); },
  });

  const allRows = licenses.data || [];
  const rows = allRows.filter((r) => {
    if (planFilter !== "all" && r.plan !== planFilter) return false;
    if (statusFilter === "active"   && !r.active) return false;
    if (statusFilter === "inactive" &&  r.active) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${r.customer_name || ""} ${r.customer_email || ""} ${r.license_key || ""} ${(r.ip_addresses || []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const violRows = violations.data || [];
  const activeCount = rows.filter(r => r.active && !isExpired(r.valid_until)).length;
  const expiredCount = rows.filter(r => isExpired(r.valid_until) || !r.active).length;
  const totalIps = rows.reduce((s, r) => s + (r.ip_addresses?.length || 0), 0);

  const copyKey = async (k) => {
    try { await navigator.clipboard.writeText(k); toast.success("Anahtar kopyalandı"); }
    catch { toast.error("Kopyalanamadı"); }
  };

  if (masterLoading) {
    return <div className="p-10 text-slate-500 text-center">Yetki kontrolü yapılıyor…</div>;
  }
  if (!isMaster) {
    return (
      <div className="p-10 max-w-md mx-auto text-center" data-testid="lic-not-master">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
          <ShieldAlert className="w-7 h-7 text-slate-500" />
        </div>
        <div className="text-slate-200 font-semibold text-lg mb-1">Yetkisiz Erişim</div>
        <p className="text-sm text-slate-400 leading-relaxed mb-4">
          Bu sayfa yalnızca <span className="mono text-indigo-300">{masterIp || "ana yönetici sunucusu"}</span>{" "}
          IP'sinden ve master lisans anahtarıyla erişilebilir. Sizin IP'niz:{" "}
          <span className="mono text-slate-300">{clientIp || "bilinmiyor"}</span>
        </p>
        <MasterUnlockButton />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <MrrPanel />
      <LicenseServerStatus />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Aktif Lisans" tone="success" icon={CheckCircle2} testid="lic-stat-active"
                  value={nfmt(activeCount)} hint={`${rows.length} toplam`} />
        <StatCard label="İzinli IP" tone="info" icon={Server} testid="lic-stat-ips"
                  value={nfmt(totalIps)} hint="tüm müşteriler" />
        <StatCard label="Süresi Dolmuş" tone="warning" icon={XCircle} testid="lic-stat-expired"
                  value={nfmt(expiredCount)} hint="veya devre dışı" />
        <StatCard label="Son İhlaller" tone="danger" icon={AlertTriangle} testid="lic-stat-viol"
                  value={nfmt(violRows.length)} hint="son 100 kayıt" />
      </div>

      <LicenseTabs
        rows={rows} allRows={allRows}
        violRows={violRows}
        search={search} setSearch={setSearch}
        planFilter={planFilter} setPlanFilter={setPlanFilter}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        onEdit={setEditing}
        onCopy={copyKey}
        onToggle={toggleActive}
        onBroadcast={broadcast}
        onDelete={del}
        onSimulate={simulate}
        onClearViol={clearViol}
        onFixIds={fixIds}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        bulkAction={bulkAction}
        masterVersion={masterVersion}
        onAdded={() => qc.invalidateQueries({ queryKey: ["licenses"] })}
      />

      {editing && (
        <EditLicenseModal license={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ============================================================================
// LicenseTabs — 4 renkli tab: Lisanslar · Yeni · İhlaller · Yönetim
// ============================================================================
const LIC_TABS = [
  { key: "list",       label: "Lisanslar",     icon: Key,          tone: "indigo",  desc: "Tüm müşteri lisansları" },
  { key: "new",        label: "Yeni Lisans",   icon: CheckCircle2, tone: "emerald", desc: "Yeni müşteri ekle" },
  { key: "violations", label: "İhlaller",      icon: ShieldAlert,  tone: "rose",    desc: "Yetkisiz erişim kayıtları" },
  { key: "admin",      label: "Yönetim",       icon: Users2,       tone: "amber",   desc: "Sürüm · Bayiler · Yardım" },
];

const TAB_TONE_MAP = {
  indigo:  { active: "bg-indigo-500/15 border-indigo-500/60 text-indigo-100 shadow-indigo-500/30",
             dot: "bg-indigo-400", count: "bg-indigo-500/25 text-indigo-100" },
  emerald: { active: "bg-emerald-500/15 border-emerald-500/60 text-emerald-100 shadow-emerald-500/30",
             dot: "bg-emerald-400", count: "bg-emerald-500/25 text-emerald-100" },
  rose:    { active: "bg-rose-500/15 border-rose-500/60 text-rose-100 shadow-rose-500/30",
             dot: "bg-rose-400", count: "bg-rose-500/25 text-rose-100" },
  amber:   { active: "bg-amber-500/15 border-amber-500/60 text-amber-100 shadow-amber-500/30",
             dot: "bg-amber-400", count: "bg-amber-500/25 text-amber-100" },
};

function LicenseTabs({ rows, allRows, violRows, search, setSearch, planFilter, setPlanFilter,
                       statusFilter, setStatusFilter, onEdit, onCopy, onToggle, onBroadcast, onDelete,
                       onSimulate, onClearViol, onFixIds, selectedIds, setSelectedIds,
                       bulkAction, onAdded, masterVersion = "" }) {
  const [tab, setTab] = useState("list");
  const counts = { list: rows.length, new: null, violations: violRows.length, admin: null };

  return (
    <div className="space-y-4" data-testid="lic-tabs">
      {/* Renkli tab bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 p-1.5 rounded-xl bg-slate-900/50 border border-slate-800"
           data-testid="lic-tabbar">
        {LIC_TABS.map((t) => {
          const T = TAB_TONE_MAP[t.tone];
          const active = tab === t.key;
          const Icon = t.icon;
          return (
            <button key={t.key}
                    onClick={() => setTab(t.key)}
                    data-testid={`lictab-${t.key}`}
                    className={`relative flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                      active
                        ? `${T.active} shadow-lg font-semibold`
                        : "border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                    }`}>
              <div className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${
                active ? `bg-${t.tone}-500/20` : "bg-slate-800/60"
              }`}>
                <Icon className={`w-4 h-4 ${active ? "" : "text-slate-500"}`}/>
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-sm truncate flex items-center gap-1.5">
                  {t.label}
                  {counts[t.key] != null && counts[t.key] > 0 && (
                    <span className={`text-[9px] mono px-1.5 py-0.5 rounded-full ${T.count}`}>
                      {counts[t.key]}
                    </span>
                  )}
                </div>
                <div className={`text-[10px] truncate ${active ? "opacity-80" : "text-slate-600"}`}>
                  {t.desc}
                </div>
              </div>
              {active && (
                <span className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${T.dot} animate-pulse`}/>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab içerikleri */}
      {tab === "list" && (
        <LicensesListPanel rows={rows} allRows={allRows} search={search} setSearch={setSearch}
                           planFilter={planFilter} setPlanFilter={setPlanFilter}
                           statusFilter={statusFilter} setStatusFilter={setStatusFilter}
                           selectedIds={selectedIds} setSelectedIds={setSelectedIds}
                           bulkAction={bulkAction} onFixIds={onFixIds}
                           masterVersion={masterVersion}
                           onEdit={onEdit} onCopy={onCopy} onToggle={onToggle} onBroadcast={onBroadcast} onDelete={onDelete}/>
      )}
      {tab === "new" && (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Key className="w-4 h-4 text-emerald-400" /> Yeni Lisans Oluştur</span>}
            subtitle="Bir müşteri için lisans anahtarı oluşturun. Anahtar sadece belirtilen IP'lerden çalışır."/>
          <CardBody>
            <AddLicenseForm onAdded={onAdded}/>
          </CardBody>
        </Card>
      )}
      {tab === "violations" && (
        <ViolationsPanel violRows={violRows} onSimulate={onSimulate} onClearViol={onClearViol}/>
      )}
      {tab === "admin" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="lic-admin-panel">
          <VersionPublishCard />
          <ResellerAdminPanel />
          <AdminOperationsCard />
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Wrench className="w-4 h-4 text-amber-400" /> Veritabanı Bakımı</span>}
                        subtitle="Eski kayıtları düzelt / temizle" />
            <CardBody className="space-y-3">
              <div className="p-3 rounded border border-amber-500/20 bg-amber-500/5 text-xs text-amber-200">
                <div className="font-semibold mb-1">Eksik ID'leri Düzelt</div>
                <div className="text-amber-200/80 mb-2">
                  Eski seed kayıtlarında (MS-BAYI-001 gibi) <span className="mono">id</span> alanı olmayabilir.
                  Bu, "düzenle" ve "sil" işlemlerinin başarısız olmasına neden olur.
                </div>
                <button
                  data-testid="lic-fix-ids"
                  onClick={() => onFixIds.mutate()}
                  disabled={onFixIds.isPending}
                  className="text-xs px-3 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 border border-amber-500/40 disabled:opacity-50"
                >
                  {onFixIds.isPending ? "Düzeltiliyor…" : "Eksik ID'leri Bul & Ata"}
                </button>
              </div>
              <div className="text-[11px] text-slate-500 leading-relaxed">
                <b className="text-slate-300">İpucu:</b> Bu işlem yalnızca id'si olmayan kayıtlara yeni UUID atar,
                mevcut kayıtları etkilemez. Bir kere çalıştırmak yeterli.
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Users2 className="w-4 h-4 text-amber-400" /> Nasıl çalışır?</span>} />
            <CardBody className="text-xs text-slate-400 space-y-2">
              <div><span className="text-slate-200 font-medium">1. Lisans oluştur</span> — Müşteriye <span className="mono text-indigo-300">MS-XXXX…</span> anahtarını verin.</div>
              <div><span className="text-slate-200 font-medium">2. IP'leri gir</span> — Müşterinin cPanel sunucularının public IP'lerini ekleyin.</div>
              <div><span className="text-slate-200 font-medium">3. Plugin heartbeat</span> — Kurulan plugin her 15dk merkeze anahtar+IP gönderir.</div>
              <div><span className="text-slate-200 font-medium">4. İhlal olursa</span> — Slack/e-posta'ya anında bildirim gelir, plugin 403 döner.</div>
              <div className="mt-3 p-2 rounded border border-amber-500/20 bg-amber-500/5 text-amber-300 text-[11px]">
                <b>Not:</b> Bildirimler → "Lisans İhlali" toggle'ının açık olduğundan emin olun.
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function LicensesListPanel({ rows, allRows, search, setSearch, planFilter, setPlanFilter,
                              statusFilter, setStatusFilter, onEdit, onCopy, onToggle, onBroadcast, onDelete,
                              selectedIds = new Set(), setSelectedIds = () => {}, bulkAction, onFixIds,
                              masterVersion = "" }) {
  return (
    <Card>
      {/* Search + Filter bar */}
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/40 flex flex-wrap items-center gap-2" data-testid="lic-filters">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
               placeholder="Ara: ad / e-posta / anahtar / IP"
               className="flex-1 min-w-[220px] bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
               data-testid="lic-search-input"/>
        <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-slate-100"
                data-testid="lic-plan-filter">
          <option value="all">Tüm Planlar</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-slate-100"
                data-testid="lic-status-filter">
          <option value="all">Aktif + Pasif</option>
          <option value="active">Sadece Aktif</option>
          <option value="inactive">Sadece Pasif</option>
        </select>
        {(search || planFilter !== "all" || statusFilter !== "all") && (
          <button onClick={() => { setSearch(""); setPlanFilter("all"); setStatusFilter("all"); }}
                  className="text-xs px-2 py-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  data-testid="lic-filters-reset">Temizle</button>
        )}
        <span className="text-xs text-slate-500" data-testid="lic-filter-count">
          <span className="mono text-slate-300">{rows.length}</span> / {allRows.length}
        </span>
      </div>

      {/* Toplu aksiyon barı — bir/daha fazla seçildiğinde açılır */}
      {selectedIds.size > 0 && (
        <div data-testid="bulk-action-bar" className="mb-3 px-4 py-3 rounded-lg border-2 border-indigo-500/40 bg-indigo-500/10 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-indigo-100">
            <b className="mono">{selectedIds.size}</b> lisans seçildi
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              data-testid="bulk-activate"
              onClick={() => bulkAction.mutate({ ids: Array.from(selectedIds), action: "activate" })}
              disabled={bulkAction.isPending}
              className="text-xs px-3 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 disabled:opacity-50"
            >✓ Aktifleştir</button>
            <button
              data-testid="bulk-suspend"
              onClick={() => bulkAction.mutate({ ids: Array.from(selectedIds), action: "suspend" })}
              disabled={bulkAction.isPending}
              className="text-xs px-3 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 disabled:opacity-50"
            >⏸ Askıya Al</button>
            <button
              data-testid="bulk-delete"
              onClick={() => {
                if (!window.confirm(`${selectedIds.size} lisans SİLİNECEK. Emin misiniz?`)) return;
                bulkAction.mutate({ ids: Array.from(selectedIds), action: "delete" });
              }}
              disabled={bulkAction.isPending}
              className="text-xs px-3 py-1.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 disabled:opacity-50"
            >🗑 Sil</button>
            <button
              data-testid="bulk-clear"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs px-3 py-1.5 rounded bg-slate-700/40 hover:bg-slate-700 text-slate-300"
            >× Seçimi Temizle</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-widest text-slate-500">
              <th className="text-left px-3 py-3 font-semibold w-8" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  data-testid="lic-select-all"
                  checked={rows.filter(r => !(r.is_master || r.protected)).length > 0
                           && rows.filter(r => !(r.is_master || r.protected)).every(r => selectedIds.has(r.id || r.license_key))}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    // v43.85 — Master lisansları tümünü-seç'ten hariç tut
                    if (e.target.checked)
                      setSelectedIds(new Set(rows.filter(r => !(r.is_master || r.protected)).map(r => r.id || r.license_key)));
                    else setSelectedIds(new Set());
                  }}
                  style={{ minWidth: 18, minHeight: 18, cursor: "pointer", accentColor: "#6366f1" }}
                  className="w-[18px] h-[18px] cursor-pointer"
                />
              </th>
              <th className="text-left px-4 py-3 font-semibold">Müşteri</th>
              <th className="text-left px-4 py-3 font-semibold">Durum</th>
              <th className="text-left px-4 py-3 font-semibold">Anahtar</th>
              <th className="text-left px-4 py-3 font-semibold">Plan</th>
              <th className="text-left px-4 py-3 font-semibold">IP'ler</th>
              <th className="text-left px-4 py-3 font-semibold">Bitiş</th>
              <th className="text-left px-4 py-3 font-semibold">Kurulu Versiyon</th>
              <th className="text-left px-4 py-3 font-semibold">Son heartbeat</th>
              <th className="text-right px-4 py-3 font-semibold w-24"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const expired = isExpired(r.valid_until);
              const status = !r.active ? "inactive" : expired ? "expired" : "active";
              const rowKey = r.id || r.license_key;
              const isSelected = selectedIds.has(rowKey);
              const isMasterLic = Boolean(r.is_master || r.protected);   // v43.85 — master koruma
              return (
                <tr key={rowKey} data-row data-testid={`lic-row-${rowKey}`} className={`border-t border-slate-800 ${isSelected ? "bg-indigo-500/10" : ""} ${isMasterLic ? "bg-gradient-to-r from-amber-500/5 to-transparent" : ""}`}>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {isMasterLic ? (
                      <span
                        data-testid={`lic-select-${rowKey}`}
                        title="Master lisans korumalıdır — seçilemez ve silinemez"
                        className="w-[18px] h-[18px] inline-flex items-center justify-center text-amber-400"
                      >🔒</span>
                    ) : (
                      <input
                        type="checkbox"
                        data-testid={`lic-select-${rowKey}`}
                        checked={isSelected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(rowKey)) next.delete(rowKey);
                            else next.add(rowKey);
                            return next;
                          });
                        }}
                        style={{ minWidth: 18, minHeight: 18, cursor: "pointer", accentColor: "#6366f1" }}
                        className="w-[18px] h-[18px] cursor-pointer"
                      />
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-slate-200 flex items-center gap-1.5">
                      {r.customer_name}
                      {isMasterLic && (
                        <span data-testid={`lic-master-badge-${rowKey}`}
                              className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/40 font-bold">
                          MASTER
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mono">{r.customer_email || "—"}</div>
                  </td>
                  <td className="px-4 py-2.5" data-testid={`lic-status-${r.id}`}>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                      status === "active"   ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" :
                      status === "expired"  ? "bg-rose-500/15 text-rose-300 border border-rose-500/30" :
                                              "bg-slate-700/40 text-slate-400 border border-slate-700"
                    }`} data-testid={`lic-status-pill-${status}-${r.id}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        status === "active" ? "bg-emerald-400 animate-pulse" :
                        status === "expired" ? "bg-rose-400" : "bg-slate-500"
                      }`}></span>
                      {status === "active" ? "AKTİF" : status === "expired" ? "SÜRESİ DOLDU" : "PASİF"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => onCopy(r.license_key)} className="mono text-[11px] text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1">
                      {r.license_key.slice(0, 20)}… <Copy className="w-3 h-3" />
                    </button>
                  </td>
                  <td className="px-4 py-2.5"><Badge tone={PLAN_TONE[r.plan] || "info"}>{(r.plan || "unknown").toUpperCase()}</Badge></td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(r.ip_addresses || []).map(ip => (
                        <span key={ip} className="mono text-[10px] px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-300">{ip}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className={`mono text-xs ${expired ? "text-rose-400" : "text-slate-300"}`}>{isoDate(r.valid_until)}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {r.last_heartbeat_version ? (() => {
                      const cur = String(r.last_heartbeat_version || "").replace(/^v/i, "");
                      const isOutdated = masterVersion && cur && cur !== masterVersion;
                      const isNever = !r.last_heartbeat_at;
                      if (isNever) return <span className="text-slate-600 text-xs">—</span>;
                      return (
                        <div
                          data-testid={`lic-version-${r.id}`}
                          title={isOutdated ? `Bayı v${cur} · Master v${masterVersion} · GÜNCELLEME GEREKLİ` : `Bayı v${cur} — güncel`}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md mono text-[11px] font-bold border ${
                            isOutdated
                              ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
                              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isOutdated ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
                          v{cur}
                          {isOutdated && <span className="text-[9px] font-normal opacity-80">· ESKİ</span>}
                        </div>
                      );
                    })() : (r.last_heartbeat_at ? <span className="text-slate-500 text-xs mono">v?</span> : <span className="text-slate-600 text-xs">—</span>)}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.last_heartbeat_at ? (
                      <div>
                        <div className="mono text-[11px] text-slate-300">{isoDateTime(r.last_heartbeat_at)}</div>
                        <div className="mono text-[10px] text-slate-500">{r.last_heartbeat_ip}</div>
                      </div>
                    ) : <span className="text-slate-600 text-xs">hiç bağlanmadı</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => onEdit(r)} title="Düzenle"
                            data-testid={`lic-edit-${r.id}`}
                            className="mr-1.5 inline-flex items-center gap-1 px-2 py-1 rounded border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/25 hover:border-indigo-400 transition text-xs font-medium">
                      <Pencil className="w-3.5 h-3.5" />
                      <span className="hidden xl:inline">Düzenle</span>
                    </button>
                    <button onClick={() => { if (!isMasterLic) onToggle.mutate({ lic: r, active: !r.active }); }}
                            title={isMasterLic ? "Master lisans — pasif edilemez" : (r.active ? "Devre dışı bırak" : "Aktifleştir")}
                            disabled={isMasterLic}
                            data-testid={`lic-toggle-${r.id}`}
                            className={`mr-1.5 inline-flex items-center px-1.5 py-1 rounded border transition ${
                              isMasterLic
                                ? "border-slate-700 bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-50"
                                : r.active
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/25"
                                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/25"
                            }`}>
                      <Radio className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => onBroadcast?.mutate(r.id)}
                            title="Bu lisansı hedef panele zorla ilet — yerel cache anında yenilenir"
                            data-testid={`lic-broadcast-${r.id}`}
                            className="mr-1.5 inline-flex items-center px-1.5 py-1 rounded border border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/25 transition">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button data-testid={`lic-del-${r.id}`}
                            onClick={() => {
                              if (isMasterLic) {
                                toast.error("Master lisans korumalıdır — silinemez. Bu hesap sistem-kritik root'tur.");
                                return;
                              }
                              if (window.confirm(`${r.customer_name} lisansı silinsin mi?`)) onDelete.mutate(r.id);
                            }}
                            disabled={isMasterLic}
                            className={`inline-flex items-center px-1.5 py-1 rounded border transition ${
                              isMasterLic
                                ? "border-slate-700 bg-slate-800/40 text-slate-600 cursor-not-allowed opacity-50"
                                : "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/25"
                            }`}
                            title={isMasterLic ? "Master lisans — korumalı, silinemez" : "Sil"}>
                      {isMasterLic ? <Lock className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Henüz lisans yok</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ViolationsPanel({ violRows, onSimulate, onClearViol }) {
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-rose-400" /> Lisans İhlalleri</span>}
        subtitle="İzinsiz IP'lerden gelen istekler burada listelenir · Slack/E-posta'ya otomatik bildirim gider"
        right={
          <div className="flex items-center gap-2">
            <button data-testid="lic-simulate" onClick={() => onSimulate.mutate()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20">
              <AlertTriangle className="w-3 h-3" /> Simüle Et
            </button>
            <button data-testid="lic-clear-viol" onClick={() => onClearViol.mutate()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
              <Trash2 className="w-3 h-3" /> Temizle
            </button>
          </div>
        }/>
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900">
            <tr className="text-[11px] uppercase tracking-widest text-slate-500">
              <th className="text-left px-4 py-3 font-semibold">Zaman</th>
              <th className="text-left px-4 py-3 font-semibold">IP</th>
              <th className="text-left px-4 py-3 font-semibold">Sunucu</th>
              <th className="text-left px-4 py-3 font-semibold">Anahtar</th>
              <th className="text-left px-4 py-3 font-semibold">Sebep</th>
              <th className="text-left px-4 py-3 font-semibold">Sürüm</th>
            </tr>
          </thead>
          <tbody>
            {violRows.map((v) => (
              <tr key={v.id} data-row className="border-t border-slate-800">
                <td className="px-4 py-2.5 mono text-[11px] text-slate-400">{isoDateTime(v.at)}</td>
                <td className="px-4 py-2.5 mono text-slate-200">{v.ip}</td>
                <td className="px-4 py-2.5 mono text-slate-300 text-xs">{v.hostname || "—"}</td>
                <td className="px-4 py-2.5 mono text-[11px] text-slate-400">{v.license_key || "—"}</td>
                <td className="px-4 py-2.5"><Badge tone="danger">{REASON_LABEL[v.reason] || v.reason}</Badge></td>
                <td className="px-4 py-2.5 mono text-xs text-slate-400">v{v.version || "?"}</td>
              </tr>
            ))}
            {violRows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-emerald-400">🎉 İhlal yok</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
