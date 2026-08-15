import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User2, Mail, ShieldAlert, Archive, Info, Trash2, Server } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

export default function UsersPage() {
  const users = useQuery({ queryKey: ["users"], queryFn: api.users });
  const { isMaster } = useIsMaster();
  const qc = useQueryClient();

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

  // v43.28 — cPanel kullanıcılarını çağır
  const refreshFromCpanel = useMutation({
    mutationFn: () => api.usersRefreshFromCpanel(),
    onSuccess: (d) => {
      toast.success(d.note, { duration: 6000 });
      // 3sn sonra tekrar sorgula (plugin daemon sync yaparsa görsün)
      setTimeout(() => qc.invalidateQueries({ queryKey: ["users"] }), 3000);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
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
                  <tr key={u.username + u.domain} data-testid={`user-row-${u.username}`} className="border-t border-slate-800">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${
                          isDemo ? "bg-amber-500/10 border border-amber-500/30 text-amber-400" : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                        }`}>
                          <User2 className="w-3.5 h-3.5" />
                        </div>
                        <span className="mono text-slate-200">{u.username}</span>
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
    </div>
  );
}
