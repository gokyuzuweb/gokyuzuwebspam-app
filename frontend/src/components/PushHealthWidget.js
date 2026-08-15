/**
 * v43.62 — Push Sağlık Widget
 *
 * Dashboard'a eklenen canlı push durumu göstergesi.
 * Her bayinin (veya master'ın kendi sunucusunun) son Exim push zamanını
 * renk kodlu gösterir:
 *   • Yeşil (<15sn): Sistem sağlıklı, real-time akış aktif
 *   • Sarı (15-60sn): Push yavaşlamış — timer çalışıyor mu?
 *   • Turuncu (1-5dk): Push gecikmiş — script kontrolü gerekli
 *   • Kırmızı (>5dk): Push yok — gws-simple-push timer kurulmalı
 *
 * `/api/outbound/stats.last_push_at` verisine dayanır. Master mod'da tek
 * kutu, seller mod'da bayilerin listesi (v43.63'te eklenecek).
 */
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Card } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const fmtSince = (isoStr) => {
  if (!isoStr) return "hiç";
  const s = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (s < 60) return `${s}sn önce`;
  if (s < 3600) return `${Math.floor(s / 60)}dk önce`;
  return `${Math.floor(s / 3600)}sa önce`;
};

const healthTier = (isoStr) => {
  if (!isoStr) return { tone: "rose", label: "Push YOK", icon: AlertCircle, help: "gws-simple-push timer kurulmamış" };
  const s = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (s < 15) return { tone: "emerald", label: "SAĞLIKLI", icon: CheckCircle2, help: "Real-time akış aktif · <15sn" };
  if (s < 60) return { tone: "yellow", label: "YAVAŞ", icon: Clock, help: "10sn timer'dan biraz uzun · normal olabilir" };
  if (s < 300) return { tone: "orange", label: "GECİKMİŞ", icon: Clock, help: "Timer çalışıyor mu? systemctl status gws-simple-push.timer" };
  return { tone: "rose", label: "PUSH DURDU", icon: AlertCircle, help: "Script/timer yeniden kurulmalı — fix-all.sh çalıştırın" };
};

const toneCls = (tone) => {
  switch (tone) {
    case "emerald": return { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-300", dot: "bg-emerald-400" };
    case "yellow":  return { bg: "bg-yellow-500/10",  border: "border-yellow-500/40",  text: "text-yellow-300",  dot: "bg-yellow-400" };
    case "orange":  return { bg: "bg-orange-500/10",  border: "border-orange-500/40",  text: "text-orange-300",  dot: "bg-orange-400" };
    case "rose":    return { bg: "bg-rose-500/10",    border: "border-rose-500/40",    text: "text-rose-300",    dot: "bg-rose-400" };
    default:        return { bg: "bg-slate-800",      border: "border-slate-700",      text: "text-slate-300",   dot: "bg-slate-400" };
  }
};

export default function PushHealthWidget() {
  const q = useQuery({
    queryKey: ["outbound-stats-widget"],
    queryFn: api.outboundStats,
    refetchInterval: 5000,          // 5sn'de bir güncelle
    staleTime: 0,
  });
  const lastPush = q.data?.last_push_at;
  const t = healthTier(lastPush);
  const cls = toneCls(t.tone);
  const Icon = t.icon;
  return (
    <Card data-testid="push-health-widget">
      <div className={`p-4 border-l-4 ${cls.border} ${cls.bg} rounded-r-lg flex items-center gap-4`}>
        <div className={`w-11 h-11 rounded-full ${cls.bg} border ${cls.border} flex items-center justify-center shrink-0`}>
          <Icon className={`w-5 h-5 ${cls.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Exim Push Sağlığı</span>
            <span className={`inline-flex items-center gap-1 text-[10px] mono px-1.5 py-0.5 rounded ${cls.bg} ${cls.text} border ${cls.border} font-bold`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cls.dot} animate-pulse`} />
              {t.label}
            </span>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className={`text-lg font-bold ${cls.text}`} data-testid="push-health-status">
              {lastPush ? `Son push: ${fmtSince(lastPush)}` : "Sunucudan push alınmadı"}
            </span>
            <span className="text-[11px] text-slate-500">{t.help}</span>
          </div>
        </div>
        {(t.tone === "orange" || t.tone === "rose") && (
          <a
            href="/panel/outbound"
            data-testid="push-health-fix-link"
            className="text-xs px-3 py-1.5 rounded border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 whitespace-nowrap"
          >
            → Onar
          </a>
        )}
      </div>
    </Card>
  );
}
