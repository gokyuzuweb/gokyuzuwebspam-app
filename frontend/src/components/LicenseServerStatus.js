import { useQuery } from "@tanstack/react-query";
import { Radio, CheckCircle2, XCircle, ExternalLink, Server, Zap, Globe2 } from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

export default function LicenseServerStatus() {
  const health = useQuery({
    queryKey: ["license-server-health"],
    queryFn: api.licenseServerHealth,
    refetchInterval: 20000,
  });
  const d = health.data;
  const healthy = d?.healthy_count ?? 0;
  const total = d?.total_regions ?? 0;
  const tone = healthy === total && total > 0 ? "success" : healthy > 0 ? "warning" : "danger";
  const label =
    healthy === total && total > 0 ? "Sağlıklı" :
    healthy > 0 ? "Kısmi" : "Erişilemiyor";

  return (
    <Card data-testid="license-server-status">
      <CardHeader
        title={<span className="flex items-center gap-2"><Radio className="w-4 h-4 text-indigo-400" /> Uzak Lisans Sunucu Cluster'ı</span>}
        subtitle="Coğrafi olarak dağıtık replica'lar · Otomatik failover · Cache-hızlandırılmış doğrulama"
        right={
          <Badge tone={tone}>
            {tone === "success" ? <CheckCircle2 className="w-3 h-3 inline mr-1" /> : <XCircle className="w-3 h-3 inline mr-1" />}
            {label} {total > 0 ? `(${healthy}/${total})` : ""}
          </Badge>
        }
      />
      <CardBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          {(d?.regions || []).map((rep, idx) => (
            <div key={rep.region + idx} data-testid={`region-${(rep.region || 'r').toLowerCase().replace(/\s+/g,'-')}`}
                 className={`rounded-md border p-3 ${
                   rep.reachable
                     ? "border-emerald-500/30 bg-emerald-500/5"
                     : "border-rose-500/30 bg-rose-500/5"
                 }`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 text-slate-100 font-medium text-sm">
                  <Globe2 className={`w-4 h-4 ${rep.reachable ? "text-emerald-400" : "text-rose-400"}`} />
                  {rep.region}
                </div>
                <span className={`text-[10px] mono uppercase tracking-widest ${rep.reachable ? "text-emerald-400" : "text-rose-400"}`}>
                  {rep.reachable ? "ÇEVRİMİÇİ" : "ERİŞİLEMİYOR"}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-400">
                <span>v{rep.version || "?"}</span>
                <span className="flex items-center gap-1">
                  <Zap className={`w-2.5 h-2.5 ${rep.redis_connected ? "text-emerald-400" : "text-slate-600"}`} />
                  Cache {rep.redis_connected ? "aktif" : "offline"}
                </span>
                {rep.last_seen && <span className="text-slate-600">{new Date(rep.last_seen).toLocaleTimeString()}</span>}
              </div>
              {rep.error && <div className="mt-1 mono text-[10px] text-rose-400 truncate">Hata: bağlantı kurulamadı</div>}
            </div>
          ))}
        </div>

        {d?.cluster_size !== null && d?.cluster_size !== undefined && (
          <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3 mb-3 flex items-center justify-between">
            <div className="text-xs text-slate-400">
              <b className="text-slate-200">{d.cluster_size}</b> replica cluster üyesi keşfedildi
              <span className="ml-2 text-slate-500">· Redis üzerinden koordinasyon</span>
            </div>
            <Badge tone="brand">Distributed</Badge>
          </div>
        )}

        <div className="text-[11px] text-slate-500 flex items-start gap-2">
          <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            WHM plugin heartbeat'leri ingress arkasında bu cluster'a POST atar. Verify cache (60s TTL) ve dağıtık rate limiting (120/min per license) uygulanır.
            Bir bölge erişilemez olursa ana backend otomatik olarak diğer bölgeye geçer — plugin'iniz bunu fark etmez.
          </span>
        </div>
      </CardBody>
    </Card>
  );
}
