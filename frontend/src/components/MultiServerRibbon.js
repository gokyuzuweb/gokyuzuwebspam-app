import { useQuery } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { Server } from "lucide-react";

function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}dk`;
  if (s < 86400) return `${Math.floor(s / 3600)}sa`;
  return `${Math.floor(s / 86400)}g`;
}

export default function MultiServerRibbon({ licenseKey }) {
  const q = useQuery({
    queryKey: ["events-by-server", licenseKey],
    queryFn: () => api.eventsByServer(licenseKey),
    refetchInterval: 20000,
    enabled: !!licenseKey && licenseKey.length >= 8,
    retry: false,
  });
  const items = q.data?.items || [];
  if (!items.length) return null;

  return (
    <Card data-testid="multi-server-ribbon">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Server className="w-4 h-4 text-indigo-400" />
            Sunucular ({items.length})
          </span>
        }
        subtitle="Bu lisans anahtarını kullanan tüm mail sunucuları"
      />
      <CardBody>
        <div className="flex flex-wrap gap-2">
          {items.map((s) => {
            const spamPct = s.count ? Math.round((s.spam_count / s.count) * 100) : 0;
            const tone = spamPct > 15 ? "danger" : spamPct > 5 ? "warning" : "success";
            const bg = tone === "danger" ? "bg-rose-500/10 border-rose-500/30"
                    : tone === "warning" ? "bg-amber-500/10 border-amber-500/30"
                    : "bg-emerald-500/10 border-emerald-500/30";
            const dot = tone === "danger" ? "bg-rose-400" : tone === "warning" ? "bg-amber-400" : "bg-emerald-400";
            return (
              <div
                key={s.hostname}
                className={`px-3 py-2 rounded border ${bg} min-w-[180px]`}
                data-testid={`server-badge-${s.hostname}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${dot} animate-pulse`}></span>
                  <span className="text-sm text-slate-200 mono truncate max-w-[220px]" title={s.hostname}>
                    {s.hostname}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-400">Toplam: <span className="mono text-slate-200">{s.count}</span></span>
                  <span className="text-slate-400">Spam: <span className="mono text-rose-400">{s.spam_count}</span></span>
                  <span className="text-slate-500">Son: <span className="mono text-slate-400">{timeAgo(s.last_seen)} önce</span></span>
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
