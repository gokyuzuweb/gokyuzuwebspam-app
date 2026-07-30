import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, MailWarning, Ban, ClipboardList } from "lucide-react";
import { Card, CardBody, CardHeader, Badge, StatCard } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

export default function Outbound() {
  const data = useQuery({ queryKey: ["outbound"], queryFn: api.outbound, refetchInterval: 20000 });
  const d = data.data || { top_senders: [] };

  return (
    <div className="p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Saatlik Limit / Kullanıcı" value={nfmt(d.limit_per_hour)} icon={ArrowUpRight} testid="ob-limit" />
        <StatCard label="Bugün Bayraklanan" tone="warning" icon={MailWarning}
                  value={nfmt(d.top_senders.reduce((s, r) => s + r.flagged, 0))} testid="ob-flagged" />
        <StatCard label="Kuyrukta Bekleyen" tone="info" icon={ClipboardList}
                  value={nfmt(d.queue_size)} testid="ob-queue" />
      </div>

      <Card>
        <CardHeader
          title="Giden Posta Kullanıcı Bazlı Durum"
          subtitle="Limitleri aşan kullanıcılar otomatik olarak sınırlanır"
          right={<Badge tone="brand">Milter aktif</Badge>}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                <th className="text-left px-4 py-3 font-semibold">Kullanıcı</th>
                <th className="text-left px-4 py-3 font-semibold">Alan Adı</th>
                <th className="text-right px-4 py-3 font-semibold">Bugün Giden</th>
                <th className="text-right px-4 py-3 font-semibold">Bayraklanan</th>
                <th className="text-right px-4 py-3 font-semibold">Bloklanan</th>
                <th className="text-right px-4 py-3 font-semibold">Durum</th>
              </tr>
            </thead>
            <tbody>
              {d.top_senders.map((r) => {
                const status = r.blocked > 0 ? { tone: "danger", label: "SINIRLANDI" }
                             : r.flagged > 100 ? { tone: "warning", label: "İZLENİYOR" }
                             : { tone: "success", label: "TEMİZ" };
                return (
                  <tr key={r.user} data-row data-testid={`ob-row-${r.user}`} className="border-t border-slate-800">
                    <td className="px-4 py-2.5 mono text-slate-200">{r.user}</td>
                    <td className="px-4 py-2.5 mono text-slate-400">{r.domain}</td>
                    <td className="px-4 py-2.5 text-right mono text-slate-200">{nfmt(r.sent_today)}</td>
                    <td className="px-4 py-2.5 text-right mono text-amber-300">{nfmt(r.flagged)}</td>
                    <td className="px-4 py-2.5 text-right mono text-rose-400">{nfmt(r.blocked)}</td>
                    <td className="px-4 py-2.5 text-right"><Badge tone={status.tone}>{status.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
