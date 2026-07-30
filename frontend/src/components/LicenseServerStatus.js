import { useQuery } from "@tanstack/react-query";
import { Radio, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

export default function LicenseServerStatus() {
  const health = useQuery({
    queryKey: ["license-server-health"],
    queryFn: api.licenseServerHealth,
    refetchInterval: 30000,
  });
  const d = health.data;
  const ok = d?.reachable;

  return (
    <Card data-testid="license-server-status">
      <CardHeader
        title={<span className="flex items-center gap-2"><Radio className="w-4 h-4 text-indigo-400" /> Uzak Lisans Sunucusu</span>}
        subtitle="WHM plugin'lerinden gelen heartbeat isteklerini karşılayan bağımsız servis"
        right={
          ok ? (
            <Badge tone="success"><CheckCircle2 className="w-3 h-3 inline mr-1" />Erişilebilir</Badge>
          ) : (
            <Badge tone="danger"><XCircle className="w-3 h-3 inline mr-1" />Erişilemiyor</Badge>
          )
        }
      />
      <CardBody>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-slate-500 uppercase tracking-widest mb-1">URL</div>
            <div className="mono text-slate-300 break-all">{d?.url || "—"}</div>
          </div>
          <div>
            <div className="text-slate-500 uppercase tracking-widest mb-1">Servis</div>
            <div className="mono text-slate-300">{d?.service || "—"}</div>
            <div className="mono text-slate-500">{d?.version || ""}</div>
          </div>
          <div>
            <div className="text-slate-500 uppercase tracking-widest mb-1">Son yanıt</div>
            <div className="mono text-slate-300">{d?.time ? new Date(d.time).toLocaleTimeString() : "—"}</div>
            {!ok && d?.error && <div className="mono text-rose-400 mt-1 truncate">{d.error}</div>}
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center gap-2">
          <ExternalLink className="w-3 h-3" />
          Bu servis 8002 portunda ayrı bir FastAPI process'i olarak çalışır. WHM heartbeat'leri
          bu URL'e /v1/heartbeat POST atar. Prod'da genelde https://license.gokyuzuwebspam.com
          şeklinde satıcının kendi domain'inde host edilir.
        </div>
      </CardBody>
    </Card>
  );
}
