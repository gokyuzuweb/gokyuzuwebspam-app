import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User2, Mail, ShieldAlert, Archive, Info, Trash2, Server, X, Upload, HardDrive, Clock, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

export default function UsersPage() {
  const users = useQuery({ queryKey: ["users"], queryFn: api.users });
  const { isMaster } = useIsMaster();
  const qc = useQueryClient();
  const [detailUsername, setDetailUsername] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");

  const purgeDemo = useMutation({
    mutationFn: () => api.quarantinePurgeDemo(),
    onSuccess: (d) => {
      toast.success(`Demo temizlendi: ${d.users_deleted || 0} kullanıcı + ${d.quarantine_deleted} karantina + ${d.events_deleted} event silindi`);
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["quarantine"] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });

  // v43.29 — cPanel kullanıcılarını çağır (yerel WHM varsa gerçek listaccts,
  // yoksa örnek 8 hesap seed edilir + bayi plugin daemon'a sinyal yazılır)
  const refreshFromCpanel = useMutation({
    mutationFn: () => api.usersRefreshFromCpanel(),
    onSuccess: (d) => {
      const msg = d.source === "whmapi1_local"
        ? `✓ ${d.synced} gerçek cPanel hesabı senkronize edildi`
        : `+${d.sample_added} örnek hesap yüklendi (${d.current_count} toplam) · ${d.signaled_licenses} bayiye sinyal`;
      toast.success(msg, { duration: 6000, description: d.note });
      // Cache'i hemen invalidate et — tabloyu tazele
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message || "İstek başarısız"),
  });

  const rows = users.data || [];
  const demoCount = rows.filter((u) => ["example","sirket","tekno","deneme","kobi"].includes(u.username)).length;
  const realCount = rows.length - demoCount;
  const hasDemo = demoCount > 0;

  return (
    <div className="p-6 space-y-4">
      {/* Info banner explaining data source */}
      <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded bg-indigo-500/15 flex items-center justify-center shrink-0">
          <Info className="w-4 h-4 text-indigo-400" />
        </div>
        <div className="text-xs text-slate-300 leading-relaxed flex-1">
          <div className="font-semibold text-slate-100 mb-0.5">Kullanıcılar nereden geliyor?</div>
          Bu liste iki kaynaktan beslenir: <b className="text-emerald-400">Gerçek</b> (WHM sunucunuzdaki cPanel hesapları — plugin daemon <code className="mono bg-slate-900 px-1 rounded">POST /api/users/sync</code> ile push eder) ve <b className="text-amber-400">Demo</b> (kurulum seed'i · fake alan adları).
          <div className="mt-1 text-[11px] text-slate-400">
            <span className="text-emerald-400 mono">GERÇEK: {realCount}</span> · <span className="text-amber-400 mono">DEMO: {demoCount}</span>
            {hasDemo && isMaster && (
              <button
                onClick={() => purgeDemo.mutate()}
                disabled={purgeDemo.isPending}
                className="ml-3 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
                data-testid="users-purge-demo"
              >
                <Trash2 className="w-2.5 h-2.5" />
                {purgeDemo.isPending ? "Temizleniyor…" : "Demo Verilerini Temizle"}
              </button>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader
          title="cPanel Kullanıcıları"
          subtitle="Hesap bazlı e-posta trafiği ve spam metrikleri"
          right={
            <div className="flex items-center gap-2">
              {isMaster && (
                <>
                  <button
                    onClick={() => setImportOpen(true)}
                    data-testid="users-bulk-import-btn"
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
                    title="CSV dosyasından toplu kullanıcı ekle"
                  >
                    <Upload className="w-3 h-3" />
                    Toplu İçe Aktar
                  </button>
                  <button
                    onClick={() => refreshFromCpanel.mutate()}
                    disabled={refreshFromCpanel.isPending}
                    data-testid="users-cpanel-refresh"
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
                    title="Bayi WHM plugin daemon'ına 'whmapi1 listaccts çalıştır' sinyali gönderir"
                  >
                    <Server className="w-3 h-3" />
                    {refreshFromCpanel.isPending ? "Çağırılıyor…" : "🔄 cPanel Kullanıcıları Çağır"}
                  </button>
                </>
              )}
              <Badge tone="brand">{rows.length} hesap</Badge>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                <th className="text-left px-4 py-3 font-semibold">Kullanıcı</th>
                <th className="text-left px-4 py-3 font-semibold">Alan Adı</th>
                <th className="text-left px-4 py-3 font-semibold">Kaynak</th>
                <th className="text-right px-4 py-3 font-semibold">Bugün Gelen</th>
                <th className="text-right px-4 py-3 font-semibold">Bugün Spam</th>
                <th className="text-right px-4 py-3 font-semibold">Karantina</th>
                <th className="text-right px-4 py-3 font-semibold">Oran</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const ratio = u.email_count_today ? (u.spam_caught_today / u.email_count_today) * 100 : 0;
                const tone = ratio > 30 ? "danger" : ratio > 15 ? "warning" : "success";
                const isDemo = ["example","sirket","tekno","deneme","kobi"].includes(u.username);
                return (
                  <tr key={u.username + u.domain}
                      data-testid={`user-row-${u.username}`}
                      onClick={() => setDetailUsername(u.username)}
                      className="border-t border-slate-800 hover:bg-indigo-500/5 cursor-pointer transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${
                          isDemo ? "bg-amber-500/10 border border-amber-500/30 text-amber-400" : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                        }`}>
                          <User2 className="w-3.5 h-3.5" />
                        </div>
                        <span className="mono text-slate-200 hover:text-indigo-300">{u.username}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 mono text-slate-400">{u.domain}</td>
                    <td className="px-4 py-2.5">
                      {isDemo ? (
                        <Badge tone="warning">DEMO</Badge>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 mono">
                          <Server className="w-2.5 h-2.5" /> WHM
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right mono text-slate-200">{nfmt(u.email_count_today)}</td>
                    <td className="px-4 py-2.5 text-right mono text-amber-300">{nfmt(u.spam_caught_today)}</td>
                    <td className="px-4 py-2.5 text-right mono text-slate-300">{nfmt(u.quarantine_size)}</td>
                    <td className="px-4 py-2.5 text-right"><Badge tone={tone}>% {ratio.toFixed(1)}</Badge></td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Kullanıcı bulunamadı</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* v43.30 — User Detay Modal */}
      {detailUsername && (
        <UserDetailModal username={detailUsername} onClose={() => setDetailUsername(null)} />
      )}

      {/* v43.30 — Bulk Import Modal */}
      {importOpen && (
        <BulkImportModal
          csvText={csvText}
          setCsvText={setCsvText}
          onClose={() => { setImportOpen(false); setCsvText(""); }}
          onImported={() => { qc.invalidateQueries({ queryKey: ["users"] }); setImportOpen(false); setCsvText(""); }}
        />
      )}
    </div>
  );
}

function UserDetailModal({ username, onClose }) {
  const q = useQuery({ queryKey: ["user-detail", username], queryFn: () => api.userDetail(username), enabled: !!username });
  const d = q.data;
  return (
    <div className="fixed inset-0 bg-black/75 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose} data-testid="user-detail-backdrop">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full my-8 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="user-detail-modal">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-emerald-500 flex items-center justify-center text-white font-bold">
              {username.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="text-slate-100 font-semibold">{username}</div>
              <div className="text-xs text-slate-500 mono">{d?.domain || "…"}</div>
            </div>
          </div>
          <button onClick={onClose} data-testid="user-detail-close" className="text-slate-400 hover:text-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        {q.isLoading && <div className="p-12 text-center text-slate-500">Yükleniyor…</div>}
        {q.isError && <div className="p-12 text-center text-rose-400">{q.error?.response?.data?.detail || "Yüklenemedi"}</div>}
        {d && (
          <div className="p-5 space-y-4">
            {/* Kaynak + son senkron */}
            <div className="flex items-center gap-3 text-xs">
              <Badge tone={d.source === "whmapi1" ? "success" : d.source === "sample_cpanel" ? "warning" : "info"}>
                {d.source === "whmapi1" ? "WHM API" : d.source === "sample_cpanel" ? "ÖRNEK" : d.source?.toUpperCase()}
              </Badge>
              <span className="text-slate-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Son senkron: <span className="text-slate-300 mono">{d.last_synced_at ? new Date(d.last_synced_at).toLocaleString("tr-TR") : "yok"}</span>
              </span>
            </div>
            {/* Profil metrikleri */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricBlock icon={<Mail className="w-4 h-4"/>} label="Bugün Gelen" value={d.profile.email_count_today} tone="text-indigo-300"/>
              <MetricBlock icon={<ShieldAlert className="w-4 h-4"/>} label="Bugün Spam" value={d.profile.spam_caught_today} tone="text-amber-300"/>
              <MetricBlock icon={<Archive className="w-4 h-4"/>} label="Karantina" value={d.quarantine_total} tone="text-rose-300"/>
              <MetricBlock icon={<HardDrive className="w-4 h-4"/>} label="Disk (MB)" value={d.disk_used_mb ?? "—"} tone="text-slate-300"
                sub={d.disk_quota_mb ? `/ ${d.disk_quota_mb}` : null}/>
            </div>
            {/* 24 saat verdict dağılımı */}
            {d.traffic_24h?.total > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1.5">Son 24 saat verdict dağılımı ({d.traffic_24h.total} mail)</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(d.traffic_24h.verdicts).map(([v, c]) => {
                    const pct = ((c / d.traffic_24h.total) * 100).toFixed(0);
                    const tone = v === "clean" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                      : v === "spam" || v === "high_spam" ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      : v === "virus" || v === "phishing" ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                      : "bg-slate-700/40 text-slate-300 border-slate-600";
                    return (
                      <span key={v} className={`px-2 py-1 rounded border text-xs ${tone}`}>
                        <span className="uppercase">{v}</span> · <b>{c}</b> · %{pct}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Son mailler */}
            <div>
              <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1.5 flex items-center gap-1"><MessageSquare className="w-3 h-3"/> Son 10 Mail</div>
              {d.recent_mails.length === 0 ? (
                <div className="text-xs text-slate-500 italic px-2 py-6 text-center bg-slate-950/50 rounded">Son 24 saatte kayıt yok</div>
              ) : (
                <div className="border border-slate-800 rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody>
                      {d.recent_mails.map((m, i) => (
                        <tr key={i} className="border-t border-slate-800 first:border-t-0">
                          <td className="px-2 py-1.5 mono text-slate-500">{m.ts ? new Date(m.ts).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</td>
                          <td className="px-2 py-1.5">
                            <span className={`inline-block w-2 h-2 rounded-full ${m.direction === "out" ? "bg-cyan-400" : "bg-emerald-400"}`} title={m.direction}></span>
                          </td>
                          <td className="px-2 py-1.5 mono text-slate-400 truncate max-w-[140px]">{m.direction === "out" ? m.to : m.from}</td>
                          <td className="px-2 py-1.5 text-slate-300 truncate max-w-[280px]">{m.subject || "—"}</td>
                          <td className="px-2 py-1.5 mono text-slate-400 text-right">{m.score != null ? Number(m.score).toFixed(1) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricBlock({ icon, label, value, tone, sub }) {
  return (
    <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1">{icon}{label}</div>
      <div className={`text-xl font-bold mono mt-1 ${tone}`}>{typeof value === "number" ? new Intl.NumberFormat("tr-TR").format(value) : value}
        {sub && <span className="text-xs text-slate-500 ml-1">{sub}</span>}
      </div>
    </div>
  );
}

function BulkImportModal({ csvText, setCsvText, onClose, onImported }) {
  const importer = useMutation({
    mutationFn: () => api.usersBulkImport({ csv_content: csvText, delimiter: "," }),
    onSuccess: (d) => {
      toast.success(`${d.added} yeni + ${d.updated} güncellendi (toplam ${d.total_processed}, ${d.error_count} hata)`);
      onImported();
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  return (
    <div className="fixed inset-0 bg-black/75 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose} data-testid="bulk-import-backdrop">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full my-8" onClick={(e) => e.stopPropagation()} data-testid="bulk-import-modal">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2 text-slate-100 font-semibold">
            <Upload className="w-4 h-4 text-indigo-400" />
            Toplu Kullanıcı İçe Aktar (CSV)
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="text-xs text-slate-400 leading-relaxed">
            CSV formatı: <code className="mono bg-slate-950 px-1 py-0.5 rounded text-slate-200">username,domain,bugun_gelen,bugun_spam</code> (header opsiyonel). Aynı isimli kullanıcı upsert edilir (üzerine yazılır).
          </div>
          {/* Örnek satır */}
          <div className="text-[11px] text-slate-500 mono">
            Örnek: <span className="text-emerald-400">ahmet,ornek.com,150,12</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 cursor-pointer text-slate-300">
              <Upload className="w-3 h-3"/> Dosya Seç
              <input
                type="file"
                accept=".csv,.txt"
                className="hidden"
                data-testid="bulk-import-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => setCsvText(String(ev.target.result || ""));
                  reader.readAsText(f);
                }}
              />
            </label>
            <button
              onClick={() => setCsvText("username,domain,bugun_gelen,bugun_spam\nmertkaya,mertkaya.com,120,5\nayses,ayseshop.net,340,18\nkerimyilmaz,yilmazgroup.com.tr,200,10")}
              className="text-xs px-2.5 py-1.5 rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-400"
            >
              Örnek Doldur
            </button>
          </div>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            data-testid="bulk-import-textarea"
            placeholder="username,domain,bugun_gelen,bugun_spam"
            className="w-full h-56 bg-slate-950 border border-slate-800 rounded p-3 text-xs mono text-slate-200 focus:border-indigo-500/40 focus:outline-none"
          />
          <div className="flex justify-between items-center pt-2">
            <div className="text-xs text-slate-500">{csvText ? `${csvText.split("\n").filter(l => l.trim()).length} satır hazır` : "Boş"}</div>
            <button
              onClick={() => importer.mutate()}
              disabled={importer.isPending || !csvText.trim()}
              data-testid="bulk-import-submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-40"
            >
              <Upload className="w-3.5 h-3.5"/>
              {importer.isPending ? "İçe aktarılıyor…" : "İçe Aktar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
