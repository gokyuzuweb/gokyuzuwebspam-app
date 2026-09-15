// v44.00.37 — Extracted from ThreatIntel.js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { FileCheck2, TrendingUp, Award, ShieldCheck } from "lucide-react";

export function ComplianceTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ti-compliance"], queryFn: () => api.tiCompliance() });
  const toggle = useMutation({
    mutationFn: (payload) => api.tiComplianceToggle(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ti-compliance"] }),
  });
  const frameworks = q.data?.frameworks || [];
  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="text-center py-6">
          <Award className="w-10 h-10 mx-auto text-fuchsia-400 mb-2"/>
          <div className="text-xs uppercase tracking-widest text-slate-500 mb-1">Genel Uyumluluk Skoru</div>
          <div className={`text-5xl font-bold mono ${(q.data?.overall_pct ?? 0) >= 80 ? "text-emerald-300" : (q.data?.overall_pct ?? 0) >= 50 ? "text-amber-300" : "text-rose-300"}`}>
            %{q.data?.overall_pct ?? 0}
          </div>
          <div className="text-xs text-slate-500 mt-1">{frameworks.length} framework · KVKK · GDPR · HIPAA · SOC2</div>
          {q.data?.auto_detected_count > 0 && (
            <div className="mt-2 inline-flex items-center gap-1 text-[10px] mono px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <TrendingUp className="w-3 h-3"/> {q.data.auto_detected_count} item sistem tarafından otomatik doğrulandı
            </div>
          )}
        </CardBody>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {frameworks.map(fw => (
          <Card key={fw.key} data-testid={`fw-${fw.key}`}>
            <CardHeader
              title={<span className="flex items-center gap-2"><ShieldCheck className={`w-4 h-4 ${fw.pct >= 80 ? "text-emerald-400" : fw.pct >= 50 ? "text-amber-400" : "text-rose-400"}`}/>{fw.name}</span>}
              subtitle={fw.framework}
              right={
                <div className={`text-2xl mono font-bold ${fw.pct >= 80 ? "text-emerald-300" : fw.pct >= 50 ? "text-amber-300" : "text-rose-300"}`}>
                  %{fw.pct}
                </div>
              }
            />
            <CardBody>
              <div className="h-1.5 rounded bg-slate-800 overflow-hidden mb-3">
                <div className={`h-full ${fw.pct >= 80 ? "bg-emerald-500" : fw.pct >= 50 ? "bg-amber-500" : "bg-rose-500"}`}
                     style={{ width: `${fw.pct}%` }}/>
              </div>
              <div className="space-y-1.5">
                {fw.items.map(it => (
                  <label key={it.key} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-800/40 rounded px-2 py-1">
                    <input type="checkbox" checked={it.checked}
                           data-testid={`comp-${fw.key}-${it.key}`}
                           onChange={(e) => toggle.mutate({ framework_key: fw.key, item_key: it.key, checked: e.target.checked })}
                           className="accent-emerald-500"/>
                    <span className={`flex-1 ${it.checked ? "text-slate-300" : "text-slate-500"}`}>{it.label}</span>
                    {it.auto_detected && (
                      <span className="text-[9px] mono px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" title="Sistem tarafından otomatik tespit edildi">AUTO</span>
                    )}
                    <span className="mono text-[10px] text-slate-600">+{it.weight}</span>
                  </label>
                ))}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function StatCounter({ label, value, tone }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-md p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mono text-2xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}


