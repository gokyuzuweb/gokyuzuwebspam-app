import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import ModuleFooter from "@/components/ModuleFooter";
import { Activity, MailCheck } from "lucide-react";

export default function MailHealth() {
  const [domain, setDomain] = useState("");
  const check = useMutation({
    mutationFn: () => api.mailHealth(domain),
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const r = check.data;
  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
          <MailCheck className="w-5 h-5 text-emerald-400"/> Mail Sağlık Kontrolü
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">MX · SPF · DKIM · DMARC · PTR DNS tabanlı toplu kontrol</p>
      </div>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex gap-2">
            <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="ornek.com"
                   data-testid="mh-domain"
                   className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
            <button data-testid="mh-check" onClick={() => check.mutate()} disabled={!domain || check.isPending}
                    className="text-sm px-4 py-2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40">
              {check.isPending ? "Kontrol ediliyor..." : "Sağlık Kontrolü Yap"}
            </button>
          </div>
          {r && (
            <>
              <div className="p-4 bg-slate-950 border border-slate-800 rounded flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Sağlık Skoru</div>
                  <div className="text-4xl font-bold mono text-emerald-300">%{Math.round(r.score / r.max_score * 100)}</div>
                </div>
                <Activity className={`w-10 h-10 ${r.score >= 80 ? "text-emerald-400" : r.score >= 50 ? "text-amber-400" : "text-rose-400"}`}/>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {Object.entries(r.checks).map(([k, v]) => (
                  <div key={k} className={`border rounded p-3 ${v.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5"}`}>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-100 font-semibold uppercase">{k}</span>
                      <Badge tone={v.ok ? "success" : "danger"}>{v.ok ? "✓ OK" : "✗ FAIL"}</Badge>
                    </div>
                    {v.record && <div className="mono text-[10px] text-slate-400 mt-1 break-all">{v.record}</div>}
                    {v.records && <div className="mono text-[10px] text-slate-400 mt-1">{v.records.join(", ")}</div>}
                    {v.policy && <div className="text-[10px] text-slate-500 mt-1">policy: <span className="mono text-slate-300">{v.policy}</span></div>}
                    {v.ptr && <div className="text-[10px] text-slate-500 mt-1">PTR: <span className="mono">{v.ptr}</span></div>}
                    {v.error && <div className="text-[10px] text-rose-400 mt-1">{v.error}</div>}
                    {v.note && <div className="text-[10px] text-amber-400 mt-1">ℹ️ {v.note}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardBody>
      </Card>
      <ModuleFooter title="Mail Sağlık Kontrolü — DNS Tabanlı"
        howItWorks="Domain için MX, SPF (TXT v=spf1), DKIM (default._domainkey), DMARC (_dmarc), PTR (reverse DNS) kayıtları kontrol edilir. Her başarılı kayıt skora katkı sağlar; toplam 100 üzerinden değerlendirilir."
        technical={["dnspython ile senkron sorgu (2sn timeout)", "SPF -all → hard fail bonus", "DMARC p=reject → +10 bonus",
                   "PTR MX ile eşleşme kontrolü", "DKIM 'default' selector — özel selectör manuel"]}
        recommendations={["SPF: v=spf1 mx a -all", "DKIM: 2048-bit key + rotasyon yılda 1 kez",
                   "DMARC: p=quarantine → p=reject (aşamalı)", "PTR: hostname.domain.com formatı, MX ile eşleşmeli",
                   "Aylık toplu domain taraması cron ile"]}/>
    </div>
  );
}
