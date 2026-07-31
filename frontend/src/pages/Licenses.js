import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Key, Plus, Trash2, ShieldAlert, Copy, Server, Calendar, Users2, AlertTriangle,
  CheckCircle2, XCircle, Package, PackagePlus, RefreshCw, Radio, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge, StatCard } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import MrrPanel from "@/components/MrrPanel";
import LicenseServerStatus from "@/components/LicenseServerStatus";
import EditLicenseModal from "@/components/EditLicenseModal";

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
    max_domains: 100,
    valid_until: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    notes: "",
  });
  const add = useMutation({
    mutationFn: (p) => api.licenseAdd(p),
    onSuccess: (data) => {
      toast.success(`Lisans oluşturuldu: ${data.license_key}`);
      setForm({ ...form, customer_name: "", customer_email: "", ip_addresses: "", notes: "" });
      onAdded?.();
    },
    onError: (e) => toast.error("Oluşturulamadı: " + (e?.response?.data?.detail || e.message)),
  });
  const submit = (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) return toast.error("Müşteri adı zorunlu");
    const ips = form.ip_addresses.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (ips.length === 0) return toast.error("En az bir IP adresi girin");
    add.mutate({
      ...form,
      ip_addresses: ips,
      max_domains: parseInt(form.max_domains) || 100,
      valid_until: new Date(form.valid_until + "T23:59:59Z").toISOString(),
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
  const qc = useQueryClient();
  const licenses = useQuery({ queryKey: ["licenses"], queryFn: api.licenses, refetchInterval: 20000 });
  const violations = useQuery({ queryKey: ["violations"], queryFn: api.violations, refetchInterval: 15000 });
  const [editing, setEditing] = useState(null);

  const del = useMutation({
    mutationFn: (id) => api.licenseDelete(id),
    onSuccess: () => { toast.success("Lisans silindi"); qc.invalidateQueries({ queryKey: ["licenses"] }); },
  });
  const toggleActive = useMutation({
    mutationFn: ({ lic, active }) => api.licenseUpdate(lic.id, { ...lic, active }),
    onSuccess: () => { toast.success("Güncellendi"); qc.invalidateQueries({ queryKey: ["licenses"] }); },
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

  const rows = licenses.data || [];
  const violRows = violations.data || [];
  const activeCount = rows.filter(r => r.active && !isExpired(r.valid_until)).length;
  const expiredCount = rows.filter(r => isExpired(r.valid_until) || !r.active).length;
  const totalIps = rows.reduce((s, r) => s + (r.ip_addresses?.length || 0), 0);

  const copyKey = async (k) => {
    try { await navigator.clipboard.writeText(k); toast.success("Anahtar kopyalandı"); }
    catch { toast.error("Kopyalanamadı"); }
  };

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

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><Key className="w-4 h-4 text-indigo-400" /> Yeni Lisans</span>}
              subtitle="Bir müşteri için lisans anahtarı oluşturun. Anahtar sadece belirtilen IP'lerden çalışır."
            />
            <CardBody className="border-b border-slate-800 bg-slate-950/40">
              <AddLicenseForm onAdded={() => qc.invalidateQueries({ queryKey: ["licenses"] })} />
            </CardBody>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                    <th className="text-left px-4 py-3 font-semibold">Müşteri</th>
                    <th className="text-left px-4 py-3 font-semibold">Anahtar</th>
                    <th className="text-left px-4 py-3 font-semibold">Plan</th>
                    <th className="text-left px-4 py-3 font-semibold">IP'ler</th>
                    <th className="text-left px-4 py-3 font-semibold">Bitiş</th>
                    <th className="text-left px-4 py-3 font-semibold">Son heartbeat</th>
                    <th className="text-right px-4 py-3 font-semibold w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const expired = isExpired(r.valid_until);
                    const status = !r.active ? "inactive" : expired ? "expired" : "active";
                    return (
                      <tr key={r.id} data-row data-testid={`lic-row-${r.id}`} className="border-t border-slate-800">
                        <td className="px-4 py-2.5">
                          <div className="text-slate-200">{r.customer_name}</div>
                          <div className="text-[11px] text-slate-500 mono">{r.customer_email || "—"}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => copyKey(r.license_key)} className="mono text-[11px] text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1">
                            {r.license_key.slice(0, 20)}… <Copy className="w-3 h-3" />
                          </button>
                        </td>
                        <td className="px-4 py-2.5"><Badge tone={PLAN_TONE[r.plan]}>{r.plan.toUpperCase()}</Badge></td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {r.ip_addresses.map(ip => (
                              <span key={ip} className="mono text-[10px] px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-300">{ip}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className={`mono text-xs ${expired ? "text-rose-400" : "text-slate-300"}`}>{isoDate(r.valid_until)}</div>
                          <div className="text-[10px]"><Badge tone={status === "active" ? "success" : status === "expired" ? "danger" : "warning"}>
                            {status === "active" ? "AKTİF" : status === "expired" ? "SÜRESİ DOLDU" : "PASİF"}
                          </Badge></div>
                        </td>
                        <td className="px-4 py-2.5">
                          {r.last_heartbeat_at ? (
                            <div>
                              <div className="mono text-[11px] text-slate-300">{isoDateTime(r.last_heartbeat_at)}</div>
                              <div className="mono text-[10px] text-slate-500">{r.last_heartbeat_ip} · v{r.last_heartbeat_version}</div>
                            </div>
                          ) : <span className="text-slate-600 text-xs">hiç bağlanmadı</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button onClick={() => setEditing(r)} title="Düzenle"
                            data-testid={`lic-edit-${r.id}`}
                            className="mr-2 text-slate-400 hover:text-indigo-400">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => toggleActive.mutate({ lic: r, active: !r.active })} title={r.active ? "Devre dışı bırak" : "Aktifleştir"}
                            className={`mr-2 ${r.active ? "text-slate-400 hover:text-amber-400" : "text-slate-400 hover:text-emerald-400"}`}>
                            <Radio className="w-4 h-4" />
                          </button>
                          <button data-testid={`lic-del-${r.id}`} onClick={() => { if (confirm(`${r.customer_name} lisansı silinsin mi?`)) del.mutate(r.id); }}
                            className="text-slate-500 hover:text-rose-400" title="Sil">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Henüz lisans yok</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-rose-400" /> Lisans İhlalleri</span>}
              subtitle="İzinsiz IP'lerden gelen istekler burada listelenir · Slack/Telegram'a otomatik bildirim gider"
              right={
                <div className="flex items-center gap-2">
                  <button data-testid="lic-simulate" onClick={() => simulate.mutate()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20">
                    <AlertTriangle className="w-3 h-3" /> Simüle Et
                  </button>
                  <button data-testid="lic-clear-viol" onClick={() => clearViol.mutate()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700">
                    <Trash2 className="w-3 h-3" /> Temizle
                  </button>
                </div>
              }
            />
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
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
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <VersionCard />

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Users2 className="w-4 h-4 text-indigo-400" /> Nasıl çalışır?</span>} />
            <CardBody className="text-xs text-slate-400 space-y-2">
              <div>
                <span className="text-slate-200 font-medium">1. Lisans oluştur</span> — Müşteriye
                <span className="mono text-indigo-300"> MS-XXXX…</span> anahtarını verin.
              </div>
              <div>
                <span className="text-slate-200 font-medium">2. IP'leri gir</span> — Müşterinin
                cPanel sunucularının public IP'lerini ekleyin.
              </div>
              <div>
                <span className="text-slate-200 font-medium">3. Plugin heartbeat</span> — Kurulan
                plugin her 15dk merkeze anahtar+IP gönderir.
              </div>
              <div>
                <span className="text-slate-200 font-medium">4. İhlal olursa</span> — Slack/Telegram'a
                anında bildirim gelir, plugin çalışmayı durdurur (403).
              </div>
              <div className="mt-3 p-2 rounded border border-amber-500/20 bg-amber-500/5 text-amber-300 text-[11px]">
                <b>Not:</b> Bildirimler → "Lisans İhlali" toggle'ının açık olduğundan emin olun.
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
      {editing && (
        <EditLicenseModal license={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
