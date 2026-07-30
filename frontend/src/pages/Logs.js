import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Terminal, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { Card, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const ICON = {
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
};

const TONE = { info: "info", warn: "warning", error: "danger" };

export default function LogsPage() {
  const [level, setLevel] = useState("all");
  const logs = useQuery({
    queryKey: ["logs", level],
    queryFn: () => api.logs({ level, limit: 300 }),
    refetchInterval: 10000,
  });

  return (
    <div className="p-6">
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Terminal className="w-4 h-4 text-indigo-400" /> Etkinlik Kayıtları</span>}
          subtitle="Milter, karantina, motor durumu ve politika olayları"
          right={
            <select data-testid="logs-level" value={level} onChange={(e) => setLevel(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm">
              <option value="all">Tümü</option>
              <option value="info">Bilgi</option>
              <option value="warn">Uyarı</option>
              <option value="error">Hata</option>
            </select>
          }
        />
        <div className="bg-slate-950/60 max-h-[70vh] overflow-y-auto">
          {(logs.data || []).map((l) => {
            const I = ICON[l.level] || Info;
            return (
              <div key={l.id} data-testid={`log-${l.id}`}
                   className="flex items-start gap-3 px-5 py-2.5 border-b border-slate-800/70 hover:bg-slate-900/60">
                <div className="mono text-[11px] text-slate-500 shrink-0 pt-0.5">
                  {new Date(l.at).toLocaleTimeString("tr-TR")}
                </div>
                <Badge tone={TONE[l.level]}>{l.level.toUpperCase()}</Badge>
                <div className="mono text-[11px] text-slate-500 uppercase shrink-0 pt-0.5">{l.source}</div>
                <div className="text-sm text-slate-200 mono">{l.message}</div>
              </div>
            );
          })}
          {(logs.data || []).length === 0 && (
            <div className="p-10 text-center text-slate-500">Kayıt bulunamadı</div>
          )}
        </div>
      </Card>
    </div>
  );
}
