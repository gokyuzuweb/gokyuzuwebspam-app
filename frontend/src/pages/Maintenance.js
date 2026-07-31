import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Database, Trash2, AlertTriangle, ShieldCheck, HardDrive, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import ModuleFooter from "@/components/ModuleFooter";

function humanBytes(n) {
  if (!n && n !== 0) return "-";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

export default function Maintenance() {
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [olderThan, setOlderThan] = useState("");   // "" = tümü
  const [confirmText, setConfirmText] = useState("");

  const usage = useQuery({
    queryKey: ["db-usage"],
    queryFn: api.dbUsage,
    refetchInterval: 30000,
  });
  const logs = useQuery({ queryKey: ["cleanup-log"], queryFn: api.cleanupLog });

  const cleanup = useMutation({
    mutationFn: () => api.dbCleanup({
      confirm: "DELETE_DATA",
      older_than_days: olderThan ? Number(olderThan) : null,
    }),
    onSuccess: (data) => {
      toast.success(`${data.total_deleted} kayıt silindi. Ayarlar korundu.`, { duration: 8000 });
      setConfirmOpen(false);
      setConfirmText("");
      qc.invalidateQueries({ queryKey: ["db-usage"] });
      qc.invalidateQueries({ queryKey: ["cleanup-log"] });
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Temizleme başarısız"),
  });

  const d = usage.data;
  const totals = d?.totals || {};

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-emerald-400"/> Veritabanı Bakımı
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Depolama alanı raporu · Geçmiş veri temizleme (ayarlarınız korunur)
          </p>
        </div>
        <button
          onClick={() => usage.refetch()}
          className="text-xs px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 inline-flex items-center gap-1.5"
          data-testid="db-refresh"
        >
          <RefreshCw className="w-3 h-3"/> Yenile
        </button>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Toplam Depolama" value={humanBytes(d?.storage_kb * 1024)} icon={<Database className="w-4 h-4 text-indigo-400"/>}/>
        <Stat label="Veri (Silinebilir)" value={humanBytes(totals.data_bytes)}
              hint={`${totals.data_docs || 0} kayıt`} tone="text-rose-300"
              icon={<Trash2 className="w-4 h-4 text-rose-400"/>}/>
        <Stat label="Ayarlar (Korunur)" value={humanBytes(totals.settings_bytes)}
              hint={`${totals.settings_docs || 0} kayıt`} tone="text-emerald-300"
              icon={<ShieldCheck className="w-4 h-4 text-emerald-400"/>}/>
        <Stat label="İndeks" value={humanBytes(d?.index_kb * 1024)}
              icon={<Database className="w-4 h-4 text-amber-400"/>}/>
      </div>

      {/* Cleanup CTA */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Trash2 className="w-4 h-4 text-rose-400"/> Cache / Geçmiş Veri Temizleme</span>}
          subtitle="Mail geçmişi, karantina, log ve tarama sonuçlarını siler. Lisans, ayar ve yapılandırma DOKUNULMAZ."
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 block mb-1">Sadece şu tarihten eskiler</label>
              <select
                value={olderThan}
                onChange={(e) => setOlderThan(e.target.value)}
                data-testid="cleanup-older-than"
                className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200"
              >
                <option value="">Tüm veriler</option>
                <option value="7">7 günden eski</option>
                <option value="30">30 günden eski</option>
                <option value="60">60 günden eski</option>
                <option value="90">90 günden eski</option>
                <option value="180">180 günden eski</option>
              </select>
            </div>
            <button
              onClick={() => setConfirmOpen(true)}
              className="text-sm px-4 py-2 rounded bg-rose-500/20 text-rose-200 border border-rose-500/40 hover:bg-rose-500/30 inline-flex items-center gap-2"
              data-testid="cleanup-open"
            >
              <Trash2 className="w-4 h-4"/> Temizlemeyi Başlat
            </button>
          </div>
          <div className="text-[11px] text-amber-300 flex items-start gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded p-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0"/>
            <div>
              <div className="font-semibold">Dikkat</div>
              <div className="text-amber-200">Silinen veriler geri alınamaz. Ayarlarınız, lisanslarınız, kullanıcı hesaplarınız ve tüm konfigürasyon <b>korunacaktır</b>. Sadece mail geçmişi ve log verileri silinir.</div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Collections table */}
      <Card>
        <CardHeader
          title="Koleksiyonlar"
          subtitle={`${d?.collections || 0} koleksiyon · sıralama: en büyük ilk`}
        />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="collections-table">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="px-3 py-2">Koleksiyon</th>
                  <th className="px-3 py-2 text-right">Kayıt</th>
                  <th className="px-3 py-2 text-right">Boyut</th>
                  <th className="px-3 py-2">Tür</th>
                </tr>
              </thead>
              <tbody>
                {(d?.items || []).map((c) => (
                  <tr key={c.name} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                    <td className="px-3 py-2 mono text-slate-200">{c.name}</td>
                    <td className="px-3 py-2 mono text-right text-slate-300">{c.count.toLocaleString("tr-TR")}</td>
                    <td className="px-3 py-2 mono text-right text-slate-300">{humanBytes(c.size_bytes)}</td>
                    <td className="px-3 py-2">
                      {c.kind === "data" && <Badge tone="danger">geçmiş</Badge>}
                      {c.kind === "settings" && <Badge tone="success">ayar</Badge>}
                      {c.kind === "other" && <Badge tone="default">diğer</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Cleanup log */}
      {(logs.data?.items || []).length > 0 && (
        <Card>
          <CardHeader title="Temizleme Geçmişi"/>
          <CardBody>
            <div className="space-y-1.5">
              {logs.data.items.map((l) => (
                <div key={l.id} className="flex items-center justify-between text-xs px-3 py-2 bg-slate-900/40 rounded border border-slate-800">
                  <div>
                    <span className="mono text-slate-400">{(l.created_at || "").slice(0, 19).replace("T", " ")}</span>
                    <span className="text-slate-500"> · </span>
                    <span className="text-slate-200">{l.deleted} kayıt silindi</span>
                    {l.older_than_days != null && <span className="text-slate-500"> · {l.older_than_days} günden eski</span>}
                  </div>
                  <span className="text-slate-500">{(l.collections || []).length} koleksiyon</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <ModuleFooter
        title="Veri Temizleme — Nasıl Çalışır?"
        howItWorks="Mongo koleksiyonları iki gruba ayrılır: (1) 'data' = mail_events, quarantine, logs, exploit_findings vb. geçmiş verileri, (2) 'settings' = licenses, users, engines, rules, mailscanner_config vb. yapılandırmayı. Temizleme sadece 1. gruba dokunur; 2. grup asla silinmez."
        technical={[
          "Endpoint: POST /api/maintenance/cleanup (confirm=DELETE_DATA zorunlu)",
          "Filtre: older_than_days ile created_at/ingested_at/ts alanları",
          "İşlem: delete_many() ile hızlı toplu silme",
          "Log: her temizlik maintenance_log'a kaydedilir",
        ]}
        recommendations={[
          "90 günden eski verileri her ay temizleyin — disk şişmesin",
          "Kritik audit log'lar için önce PDF/CSV export alın",
          "Karantina TTL ile birleştirin (mailscanner config)",
          "Cron ile aylık otomatik temizlik ayarlanabilir",
        ]}
      />

      {/* Confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/40 rounded-lg max-w-md w-full p-6 space-y-4"
               data-testid="cleanup-confirm-modal">
            <div className="flex items-center gap-2 text-rose-300">
              <AlertTriangle className="w-6 h-6"/>
              <h2 className="text-lg font-bold">Dikkat! Veri Silinecek</h2>
            </div>
            <div className="text-sm text-slate-300 space-y-2">
              <p>Bu işlem geri alınamaz. Aşağıdaki veriler <b className="text-rose-300">silinecek</b>:</p>
              <ul className="text-xs text-slate-400 bg-slate-950 p-3 rounded border border-slate-800 space-y-0.5">
                {(d?.will_delete || []).map(c => <li key={c} className="mono">· {c}</li>)}
              </ul>
              <p>Ancak aşağıdakiler <b className="text-emerald-300">korunacak</b>:</p>
              <ul className="text-xs text-emerald-200/70 bg-emerald-500/5 p-3 rounded border border-emerald-500/20 space-y-0.5">
                <li className="mono">· Tüm ayarlar (settings, mailscanner_config)</li>
                <li className="mono">· Lisanslar (licenses)</li>
                <li className="mono">· Kullanıcı hesapları (users, resellers)</li>
                <li className="mono">· Motor konfigürasyonları (engines, rules)</li>
                <li className="mono">· Kara/beyaz listeler (lists, country_rules)</li>
                <li className="mono">· Alert kuralları (alert_rules)</li>
                <li className="mono">· Fiyatlandırma (pricing)</li>
              </ul>
              <p className="pt-2">Devam etmek için aşağıya <span className="mono text-rose-300 font-bold">SIL</span> yazın:</p>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="SIL"
                data-testid="cleanup-confirm-input"
                className="w-full px-3 py-2 bg-slate-950 border border-rose-500/40 rounded text-sm mono text-rose-200 focus:outline-none focus:border-rose-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmOpen(false); setConfirmText(""); }}
                className="flex-1 px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm"
                data-testid="cleanup-cancel"
              >İptal</button>
              <button
                onClick={() => cleanup.mutate()}
                disabled={confirmText !== "SIL" || cleanup.isPending}
                className="flex-1 px-4 py-2 rounded bg-rose-500 text-white hover:bg-rose-600 text-sm disabled:opacity-40 inline-flex items-center justify-center gap-2"
                data-testid="cleanup-confirm"
              >
                <Trash2 className="w-4 h-4"/>
                {cleanup.isPending ? "Siliniyor..." : "EVET, SİL"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone = "text-slate-100", icon }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-bold mono ${tone}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}
