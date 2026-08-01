import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, Trash2, RefreshCw, Search, Info } from "lucide-react";
import { useState } from "react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import ModuleFooter from "@/components/ModuleFooter";

const CC_FLAG = (cc) => cc && cc.length === 2
  ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "🌐";

export default function WhitelistHistory() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const list = useQuery({
    queryKey: ["whitelist-list"],
    queryFn: api.whitelistList,
    refetchInterval: 30000,
  });

  const remove = useMutation({
    mutationFn: (ip) => api.whitelistRemove(ip),
    onSuccess: (_, ip) => {
      toast.success(`${ip} whitelist'ten çıkarıldı`);
      qc.invalidateQueries({ queryKey: ["whitelist-list"] });
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "İşlem başarısız"),
  });

  const items = (list.data?.items || []).filter((i) =>
    !filter || i.value.includes(filter) || (i.reason || "").toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400"/> Whitelist Yönetimi
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Beyaz listedeki IP'ler · Yanlış pozitif düzeltmeleri · Manuel eklemeler
          </p>
        </div>
        <button onClick={() => list.refetch()}
                data-testid="whitelist-refresh"
                className="text-sm px-3 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 inline-flex items-center gap-2">
          <RefreshCw className="w-4 h-4"/> Yenile
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Toplam Whitelist" value={list.data?.count || 0}
              icon={<ShieldCheck className="w-4 h-4 text-emerald-400"/>}/>
        <Stat label="Yanlış Pozitif Düzeltmesi"
              value={items.filter((i) => i.source === "false_positive_recovery").length}
              tone="text-emerald-300"/>
        <Stat label="Farklı Ülke"
              value={new Set(items.map((i) => i.country).filter(Boolean)).size}/>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"/>
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
               placeholder="IP veya sebep ile ara..."
               data-testid="whitelist-search"
               className="w-full pl-10 pr-3 py-2 bg-slate-950 border border-slate-800 rounded text-sm text-slate-100 focus:outline-none focus:border-emerald-500"/>
      </div>

      {/* Table */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="whitelist-table">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">Ülke</th>
                  <th className="px-3 py-2">Sebep</th>
                  <th className="px-3 py-2">Kaynak</th>
                  <th className="px-3 py-2 text-right">Mail Sayısı</th>
                  <th className="px-3 py-2">Eklendi</th>
                  <th className="px-3 py-2">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan="7" className="text-center text-slate-500 py-10">
                    {filter ? "Filtreye uygun kayıt yok" : "Whitelist boş"}
                  </td></tr>
                )}
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-slate-800/40 hover:bg-slate-800/30"
                      data-testid={`whitelist-row-${it.value}`}>
                    <td className="px-3 py-2 mono text-emerald-200">
                      <ShieldCheck className="w-3 h-3 inline mr-1"/>{it.value}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-base leading-none mr-1">{CC_FLAG(it.country)}</span>
                      <span className="text-slate-300 text-[11px]">{it.country || "-"}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-300 truncate max-w-[240px]">{it.reason || "-"}</td>
                    <td className="px-3 py-2">
                      {it.source === "false_positive_recovery" ? (
                        <Badge tone="warning">yanlış pozitif</Badge>
                      ) : it.source === "mail_detail_block" ? (
                        <Badge tone="info">manuel</Badge>
                      ) : (
                        <Badge>{it.source || "-"}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 mono text-right text-slate-300">{it.event_count || 0}</td>
                    <td className="px-3 py-2 mono text-slate-400 text-[11px]">
                      {(it.created_at || "").slice(0, 19).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => remove.mutate(it.value)}
                              disabled={remove.isPending}
                              data-testid={`whitelist-remove-${it.value}`}
                              title="Whitelist'ten çıkar"
                              className="text-[10px] px-2 py-1 rounded bg-rose-500/15 text-rose-200 border border-rose-500/30 hover:bg-rose-500/25 disabled:opacity-40 inline-flex items-center gap-1">
                        <Trash2 className="w-3 h-3"/> Çıkar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <ModuleFooter
        title="Whitelist Yönetimi — Nasıl Çalışır?"
        howItWorks="Whitelist'e eklenen IP'ler tüm engelleme motorlarının üzerindedir — MailScanner, RBL, exploit detector hepsi bu IP'yi geçirir. Kaynak alanı 'yanlış pozitif': Landing veya Panel'de bir bloklu IP'nin whitelist butonuyla eklenmiş demektir. 'Manuel': admin panelden doğrudan eklenmiş."
        technical={[
          "Endpoint: /maintenance/whitelist/list (30sn autorefresh)",
          "Whitelist ekleme: /maintenance/ip/whitelist (blacklist+ioc'den de siler)",
          "Whitelist çıkarma: /maintenance/whitelist/remove (lists koleksiyonundan silme)",
          "Öncelik: whitelist > blacklist > threat_iocs",
        ]}
        recommendations={[
          "Yanlış pozitif düzeltmelerini haftalık gözden geçirin",
          "Şüpheli IP'ler için whitelist'ten çıkarıp gözlemleyin",
          "Kritik iş ortaklarını doğrudan whitelist'e ekleyin",
        ]}
      />
    </div>
  );
}

function Stat({ label, value, tone = "text-slate-100", icon }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-bold mono ${tone}`}>{value}</div>
    </div>
  );
}
