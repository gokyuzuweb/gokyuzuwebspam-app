import { useQuery } from "@tanstack/react-query";
import {
  History, RefreshCw, Zap, CheckCircle2, AlertCircle, Loader2, Users2,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const LICKEY = () =>
  (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) ||
  "";

const fmtDT = (iso) =>
  iso ? new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * /panel/wake-history — Master için toplu canlan ping geçmişi.
 * Her batch için: tarih, ping edilen sayı, sonuç (kaçı yeşile döndü),
 * lisans detay listesi.
 */
export default function WakeHistory() {
  const q = useQuery({
    queryKey: ["wake-history"],
    queryFn: () => api.adminWakeHistory(LICKEY()),
    refetchInterval: 15000,
    retry: false,
  });
  const items = q.data?.items || [];
  const totals = items.reduce(
    (acc, it) => {
      acc.pings += 1;
      acc.pinged += it.count || 0;
      acc.green += it.turned_green || 0;
      acc.red += it.still_red || 0;
      return acc;
    },
    { pings: 0, pinged: 0, green: 0, red: 0 }
  );
  const overallSuccess = totals.pinged > 0 ? Math.round((totals.green / totals.pinged) * 100) : 0;

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-400" />
            Wake Ping Geçmişi
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Toplu canlan ping'lerinin başarı istatistiği · 15sn otomatik yenileme
          </p>
        </div>
        <button
          onClick={() => q.refetch()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          data-testid="wh-refresh"
        >
          <RefreshCw className={`w-3 h-3 ${q.isFetching ? "animate-spin" : ""}`} /> Yenile
        </button>
      </div>

      {/* Özet istatistik */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Toplam Ping" value={totals.pings} color="text-slate-100" bg="bg-slate-900/60"/>
        <StatBox label="Toplam Bayi" value={totals.pinged} color="text-sky-300" bg="bg-sky-500/10 border-sky-500/30"/>
        <StatBox label="Yeşile Dönen" value={totals.green} color="text-emerald-300" bg="bg-emerald-500/10 border-emerald-500/30"/>
        <StatBox label="Başarı %" value={`${overallSuccess}%`} color="text-emerald-300" bg="bg-emerald-500/10 border-emerald-500/30" hint={`${totals.red} hâlâ kırmızı`}/>
      </div>

      {q.isLoading ? (
        <div className="p-8 text-center text-slate-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Yükleniyor…
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center">
            <Zap className="w-10 h-10 text-slate-700 mx-auto mb-2"/>
            <div className="text-sm text-slate-400 mb-1">Henüz toplu ping gönderilmedi</div>
            <div className="text-[11px] text-slate-500">
              Canlı Bayi Trafiği sayfasında "🔔 Kırmızıyı Pingle" butonuna basınca burada geçmişi göreceksiniz.
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Users2 className="w-4 h-4 text-fuchsia-400"/> Ping Batch Geçmişi</span>}
            subtitle={`${items.length} kayıt gösteriliyor`}
          />
          <CardBody className="p-0">
            <div className="divide-y divide-slate-800/60" data-testid="wh-list">
              {items.map((h) => (
                <BatchRow key={h.id} batch={h} />
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function StatBox({ label, value, color = "text-slate-100", bg = "bg-slate-900/60", hint }) {
  return (
    <div className={`rounded-lg border border-slate-800 p-3 ${bg}`}>
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`text-2xl font-bold tabular-nums mt-0.5 ${color}`}>{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function BatchRow({ batch }) {
  const pct = batch.success_pct || 0;
  const pctColor = pct >= 70 ? "text-emerald-300" : pct >= 40 ? "text-amber-300" : "text-rose-300";
  return (
    <div className="p-3 hover:bg-slate-900/30" data-testid={`wh-row-${batch.id}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Zap className="w-3.5 h-3.5 text-rose-400"/>
            <span className="text-sm font-semibold text-slate-100">{batch.count} bayi pingle edildi</span>
            <span className="text-[11px] text-slate-500 mono">· {fmtDT(batch.at)}</span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <CheckCircle2 className="w-3 h-3"/> {batch.turned_green} yeşile döndü
            </span>
            <span className="inline-flex items-center gap-1 text-rose-300">
              <AlertCircle className="w-3 h-3"/> {batch.still_red} hâlâ kırmızı
            </span>
            <span className={`font-semibold ${pctColor}`}>Başarı %{pct}</span>
          </div>
        </div>
        <div className="w-32 shrink-0">
          <div className="text-[10px] text-slate-500 text-right mb-0.5">Başarı</div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full ${
              pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500"
            }`} style={{ width: `${Math.max(2, pct)}%` }}/>
          </div>
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-200">
          Bayi listesi ({batch.licenses?.length || 0}) ▾
        </summary>
        <ul className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1 text-[11px]">
          {(batch.licenses || []).map((l) => (
            <li key={l.license_key} className="flex items-center gap-2 py-1 px-2 rounded bg-slate-950/60 border border-slate-800/50">
              <span className="text-slate-300 truncate flex-1">{l.customer_name}</span>
              <span className="text-slate-600 mono text-[10px] truncate">{(l.license_key || "").slice(0, 16)}...</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
