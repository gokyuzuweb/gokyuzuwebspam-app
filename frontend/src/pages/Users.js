import { useQuery } from "@tanstack/react-query";
import { User2, Mail, ShieldAlert, Archive } from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

export default function UsersPage() {
  const users = useQuery({ queryKey: ["users"], queryFn: api.users });

  return (
    <div className="p-6">
      <Card>
        <CardHeader
          title="cPanel Kullanıcıları"
          subtitle="Hesap bazlı e-posta trafiği ve spam metrikleri"
          right={<Badge tone="brand">{(users.data || []).length} hesap</Badge>}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                <th className="text-left px-4 py-3 font-semibold">Kullanıcı</th>
                <th className="text-left px-4 py-3 font-semibold">Alan Adı</th>
                <th className="text-right px-4 py-3 font-semibold">Bugün Gelen</th>
                <th className="text-right px-4 py-3 font-semibold">Bugün Spam</th>
                <th className="text-right px-4 py-3 font-semibold">Karantina</th>
                <th className="text-right px-4 py-3 font-semibold">Oran</th>
              </tr>
            </thead>
            <tbody>
              {(users.data || []).map((u) => {
                const ratio = u.email_count_today ? (u.spam_caught_today / u.email_count_today) * 100 : 0;
                const tone = ratio > 30 ? "danger" : ratio > 15 ? "warning" : "success";
                return (
                  <tr key={u.username} data-row data-testid={`user-row-${u.username}`} className="border-t border-slate-800">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400">
                          <User2 className="w-3.5 h-3.5" />
                        </div>
                        <span className="mono text-slate-200">{u.username}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 mono text-slate-400">{u.domain}</td>
                    <td className="px-4 py-2.5 text-right mono text-slate-200">{nfmt(u.email_count_today)}</td>
                    <td className="px-4 py-2.5 text-right mono text-amber-300">{nfmt(u.spam_caught_today)}</td>
                    <td className="px-4 py-2.5 text-right mono text-slate-300">{nfmt(u.quarantine_size)}</td>
                    <td className="px-4 py-2.5 text-right"><Badge tone={tone}>% {ratio.toFixed(1)}</Badge></td>
                  </tr>
                );
              })}
              {(users.data || []).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Kullanıcı bulunamadı</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
