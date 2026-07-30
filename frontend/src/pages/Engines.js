import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, Shield, Bug, Radar, Network, Sparkles, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const ICONS = {
  spamassassin: Shield,
  clamav: Bug,
  dcc: Radar,
  razor: Network,
  rspamd: Cpu,
  ai: Sparkles,
};

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

export default function Engines() {
  const qc = useQueryClient();
  const engines = useQuery({ queryKey: ["engines"], queryFn: api.engines, refetchInterval: 30000 });
  const toggle = useMutation({
    mutationFn: (name) => api.engineToggle(name),
    onSuccess: (data) => {
      toast.success(`${data.name} ${data.enabled ? "etkinleştirildi" : "durduruldu"}`);
      qc.invalidateQueries({ queryKey: ["engines"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["overview-header"] });
    },
  });

  return (
    <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {(engines.data || []).map((e) => {
        const Icon = ICONS[e.name] || Cpu;
        const catchRate = e.scanned_today ? Math.round((e.caught_today / e.scanned_today) * 100) : 0;
        return (
          <Card key={e.name} data-testid={`engine-card-${e.name}`}>
            <CardBody>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-md flex items-center justify-center ${
                    e.enabled ? "bg-indigo-500/10 border border-indigo-500/30 text-indigo-300"
                              : "bg-slate-800 border border-slate-700 text-slate-500"
                  }`}>
                    <Icon className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <div className="text-slate-100 font-medium tracking-tight">{e.label}</div>
                    <div className="mono text-[11px] text-slate-500">v{e.version}</div>
                  </div>
                </div>
                <Badge tone={e.enabled ? "success" : "default"}>{e.enabled ? "AÇIK" : "KAPALI"}</Badge>
              </div>
              <p className="text-xs text-slate-400 mb-4 min-h-[36px]">{e.description}</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Taranan</div>
                  <div className="mono text-lg text-slate-200">{nfmt(e.scanned_today)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Yakalanan</div>
                  <div className="mono text-lg text-amber-300">{nfmt(e.caught_today)}</div>
                </div>
              </div>
              <div className="h-1.5 rounded bg-slate-800 overflow-hidden mb-4">
                <div className={`h-full ${e.enabled ? "bg-gradient-to-r from-indigo-500 to-rose-500" : "bg-slate-700"}`}
                     style={{ width: `${Math.min(catchRate, 100)}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-slate-500 mono">yakalama % {catchRate}</div>
                <button
                  data-testid={`engine-toggle-${e.name}`}
                  onClick={() => toggle.mutate(e.name)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors ${
                    e.enabled
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                  }`}
                >
                  {e.enabled ? <><PowerOff className="w-3.5 h-3.5" /> Durdur</> : <><Power className="w-3.5 h-3.5" /> Başlat</>}
                </button>
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
