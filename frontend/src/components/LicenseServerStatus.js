import { useQuery } from "@tanstack/react-query";
import { Radio, CheckCircle2, XCircle, ExternalLink, Server, Zap } from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

export default function LicenseServerStatus() {
  const health = useQuery({
    queryKey: ["license-server-health"],
    queryFn: api.licenseServerHealth,
    refetchInterval: 20000,
  });
  const d = health.data;
  const ok = d?.reachable;
  const healthy = d?.healthy_count ?? 0;
  const total = d?.total_replicas ?? 0;
  const cluster = d?.cluster;

  const tone = healthy === total && total > 0 ? "success" : healthy > 0 ? "warning" : "danger";
  const label = healthy === total && total > 0 ? "Sağlıklı Cluster" : healthy > 0 ? "Kısmi" : "Erişilemiyor";

  return (
    <Card data-testid="license-server-status">
      <CardHeader
        title={<span className="flex items-center gap-2"><Radio className="w-4 h-4 text-indigo-400" /> Uzak Lisans Sunucusu Cluster'ı</span>}
        subtitle="Redis-backed multi-replica FastAPI cluster · Round-robin proxy · Otomatik failover"
        right={
          <Badge tone={tone}>
            {tone === "success" ? <CheckCircle2 className="w-3 h-3 inline mr-1" /> : <XCircle className="w-3 h-3 inline mr-1" />}
            {label} {total > 0 ? `(${healthy}/${total})` : ""}
          </Badge>
        }
      />
      <CardBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          {(d?.replicas || []).map((rep) => (
            <div key={rep.url} data-testid={`replica-${rep.replica_id || rep.url}`}
                 className={`rounded-md border p-3 ${
                   rep.reachable
                     ? "border-emerald-500/30 bg-emerald-500/5"
                     : "border-rose-500/30 bg-rose-500/5"
                 }`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 text-slate-100 font-medium text-sm">
                  <Server className={`w-4 h-4 ${rep.reachable ? "text-emerald-400" : "text-rose-400"}`} />
                  {rep.replica_id || "unknown"}
                </div>
                <span className={`text-[10px] mono uppercase tracking-widest ${rep.reachable ? "text-emerald-400" : "text-rose-400"}`}>
                  {rep.reachable ? "UP" : "DOWN"}
                </span>
              </div>
              <div className="text-[11px] mono text-slate-500 truncate">{rep.url}</div>
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-400">
                <span>v{rep.version || "?"}</span>
                <span className="flex items-center gap-1">
                  <Zap className={`w-2.5 h-2.5 ${rep.redis?.connected ? "text-emerald-400" : "text-slate-600"}`} />
                  Redis {rep.redis?.connected ? "✓" : "×"}
                </span>
                {rep.time && <span className="text-slate-600">{new Date(rep.time).toLocaleTimeString()}</span>}
              </div>
              {rep.error && <div className="mt-1 mono text-[10px] text-rose-400 truncate">{rep.error}</div>}
            </div>
          ))}
        </div>

        {cluster && (
          <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3 mb-3">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">
              Redis-Backed Cluster View (self: <span className="mono text-slate-300">{cluster.self}</span>)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(cluster.replicas || []).map((r) => (
                <span key={r.replica_id} className="mono text-[10px] px-2 py-0.5 rounded border border-indigo-500/30 bg-indigo-500/10 text-indigo-300">
                  {r.replica_id}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="text-[11px] text-slate-500 flex items-center gap-2">
          <ExternalLink className="w-3 h-3" />
          WHM plugin heartbeat'leri ingress arkasında bu cluster'a POST atar. Redis üzerinden verify cache (60s TTL) ve dağıtık rate limiting (120/min per license). Bir replica düşerse ana backend otomatik olarak diğerine geçer.
        </div>
      </CardBody>
    </Card>
  );
}
