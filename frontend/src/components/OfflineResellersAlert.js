/**
 * OfflineResellersAlert — v44.00.07
 *
 * Master Dashboard'a mount edilir. 45 dakikadan uzun süredir heartbeat
 * atmamış bayılerin listesini gösterir + kritik sayı için toast bildirim.
 *
 * · Sadece master için render olur (bayı hiç görmez)
 * · 60 saniyede bir refresh
 * · İlk açılışta ve sayı arttığında tek seferlik sonner toast
 * · Kaç bayı offline: badge tone
 *     0-2: yeşil, ok
 *     3-9: sarı, dikkat
 *     10+: kırmızı, kritik
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, WifiOff, Clock, User } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);
const fmtMinutes = (m) => {
  if (m == null) return "hiç";
  if (m < 60) return `${m} dk`;
  if (m < 1440) return `${Math.floor(m / 60)} sa ${m % 60} dk`;
  return `${Math.floor(m / 1440)} gün`;
};

export default function OfflineResellersAlert() {
  const { isMaster, ready } = useIsMaster();
  const seenCountRef = useRef(0);

  const q = useQuery({
    queryKey: ["offline-resellers"],
    queryFn: () => api.offlineResellers(45),
    refetchInterval: 60_000,
    enabled: !!isMaster && !!ready,
    retry: false,
  });

  // Sayı arttığında tek seferlik toast bildirimi
  useEffect(() => {
    if (!q.data) return;
    const cur = q.data.count || 0;
    if (cur > seenCountRef.current && cur >= 3) {
      const delta = cur - seenCountRef.current;
      const msg = seenCountRef.current === 0
        ? `${cur} bayı 45+ dk'dır heartbeat göndermiyor`
        : `+${delta} yeni offline bayı (toplam ${cur})`;
      toast.warning(msg, {
        description: "Master → Dashboard → Offline Bayılar bölümünden detayları görebilirsiniz",
        duration: 10_000,
        icon: "📡",
      });
    }
    seenCountRef.current = cur;
  }, [q.data?.count]);

  if (!isMaster || !ready) return null;
  if (q.isError) return null;
  const data = q.data;
  if (!data) return null;
  const count = data.count || 0;
  const items = data.offline || [];

  // 0 offline → sağlıklı badge göster, listeleme yok
  if (count === 0) {
    return (
      <Card data-testid="offline-resellers-widget">
        <CardBody className="flex items-center gap-3 py-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <User className="w-4 h-4 text-emerald-300" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-100">Tüm bayı bağlantıları sağlıklı</div>
            <div className="text-[11px] text-slate-500">
              Son 45 dakikada tüm bayılar heartbeat gönderdi.
            </div>
          </div>
          <Badge tone="success">0 offline</Badge>
        </CardBody>
      </Card>
    );
  }

  const tone = count >= 10 ? "danger" : count >= 3 ? "warning" : "info";
  const alertColor = count >= 10 ? "rose" : count >= 3 ? "amber" : "cyan";
  const colorClasses = {
    rose: "border-rose-500/40 bg-rose-500/5",
    amber: "border-amber-500/40 bg-amber-500/5",
    cyan: "border-cyan-500/40 bg-cyan-500/5",
  }[alertColor];

  return (
    <Card data-testid="offline-resellers-widget" className={colorClasses}>
      <CardHeader
        title={
          <div className="flex items-center gap-2">
            <WifiOff className={`w-4 h-4 text-${alertColor}-400`} />
            <span>Offline Bayılar</span>
          </div>
        }
        subtitle={`Son ${data.threshold_minutes} dakikada heartbeat atmamış aktif bayılar`}
        right={<Badge tone={tone}>{nfmt(count)} offline</Badge>}
      />
      <CardBody className="p-0">
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-800">
          {items.slice(0, 10).map((r) => (
            <div
              key={r.license_key}
              data-testid={`offline-row-${r.license_key.slice(0, 12)}`}
              className="px-4 py-2.5 hover:bg-slate-900/40 transition-colors flex items-center gap-3"
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${
                r.never_seen ? "bg-rose-400 animate-pulse" :
                (r.minutes_since_heartbeat > 1440) ? "bg-amber-400" : "bg-cyan-400"
              }`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-200 font-semibold truncate flex items-center gap-2">
                  {r.customer_name}
                  {r.plan && (
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      {r.plan}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 mono flex items-center gap-2">
                  <span>{r.license_key_short}</span>
                  {r.customer_email && <span className="truncate">· {r.customer_email}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                {r.never_seen ? (
                  <span className="text-[11px] font-bold text-rose-300">HİÇ BAĞLANMADI</span>
                ) : (
                  <>
                    <div className="text-[11px] mono text-slate-400 flex items-center gap-1 justify-end">
                      <Clock className="w-3 h-3" />
                      {fmtMinutes(r.minutes_since_heartbeat)} önce
                    </div>
                    {r.last_heartbeat_version && (
                      <div className="text-[9px] mono text-slate-600">v{r.last_heartbeat_version}</div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        {items.length > 10 && (
          <div className="px-4 py-2 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
            <span>{items.length - 10} bayı daha listede…</span>
            <Link
              to="/panel/licenses"
              data-testid="offline-view-all"
              className="text-cyan-400 hover:text-cyan-300 font-semibold"
            >
              Tümünü görüntüle →
            </Link>
          </div>
        )}
        {count >= 3 && (
          <div className={`px-4 py-2 border-t border-slate-800 text-[11px] text-${alertColor}-200 flex items-center gap-1.5`}>
            <AlertTriangle className="w-3.5 h-3.5" />
            {count >= 10
              ? "Kritik: 10+ bayı offline. Sunucu / master ağ sağlığını kontrol edin."
              : `Dikkat: ${count} bayı 45+ dk'dır bağlanmıyor.`}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
