import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, X, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, CardHeader, Badge } from "@/components/ui-primitives";

const SEV_ICON = {
  error:   <AlertCircle className="w-4 h-4 text-rose-400"/>,
  warning: <AlertTriangle className="w-4 h-4 text-amber-400"/>,
  info:    <Info className="w-4 h-4 text-sky-400"/>,
};
const SEV_TONE = { error: "danger", warning: "warning", info: "info" };
const KIND_LABEL = {
  threat_intel_sync_failed: "Tehdit Zekası senkronizasyonu",
  plugin_daemon_offline: "Plugin daemon çevrimdışı",
  license_violation: "Lisans ihlali",
};

export default function MasterAlertCenter() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["master-alerts"],
    queryFn: () => api.masterAlerts({ limit: 8 }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const markRead = useMutation({
    mutationFn: (id) => api.masterAlerts, // placeholder — replaced below with real endpoint
  });

  const items = q.data?.items || [];
  const unread = q.data?.total_unread || 0;

  const doMarkRead = async (id) => {
    try {
      const url = `/api/master/alerts/${id}/read`;
      await fetch((process.env.REACT_APP_BACKEND_URL || "") + url, {
        method: "POST", credentials: "include",
      });
      qc.invalidateQueries({ queryKey: ["master-alerts"] });
    } catch (e) { toast.error("İşaretlenemedi"); }
  };
  const doMarkAllRead = async () => {
    try {
      await fetch((process.env.REACT_APP_BACKEND_URL || "") + "/api/master/alerts/read-all", {
        method: "POST", credentials: "include",
      });
      qc.invalidateQueries({ queryKey: ["master-alerts"] });
      toast.success("Tüm alertler okundu");
    } catch (e) { toast.error("Hata"); }
  };

  if (items.length === 0) return null;  // Dashboard'ı temiz tut

  return (
    <Card data-testid="master-alert-center">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Bell className="w-4 h-4 text-rose-400"/>
            Sistem Bildirimleri
            {unread > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500 text-white mono" data-testid="alert-center-unread-count">
                {unread}
              </span>
            )}
          </span>
        }
        subtitle="Threat Intel senkronizasyonu, plugin daemon durumu ve lisans olayları"
        right={
          unread > 0 && (
            <button
              onClick={doMarkAllRead}
              data-testid="alert-center-read-all"
              className="text-[11px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600"
            >Hepsini Okundu İşaretle</button>
          )
        }
      />
      <div className="divide-y divide-slate-800">
        {items.map((a) => (
          <div
            key={a.id}
            data-testid={`alert-item-${a.id}`}
            className={`px-4 py-2.5 flex items-start gap-3 hover:bg-slate-900/40 ${!a.read ? "bg-rose-500/[0.03]" : ""}`}
          >
            <div className="shrink-0 mt-0.5">{SEV_ICON[a.severity] || SEV_ICON.info}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-slate-200 font-medium">{a.title || KIND_LABEL[a.kind] || a.kind}</span>
                <Badge tone={SEV_TONE[a.severity] || "default"}>{a.severity}</Badge>
                {!a.read && <span className="text-[9px] px-1 py-0.5 rounded bg-rose-500/20 text-rose-300 mono uppercase">yeni</span>}
              </div>
              {a.detail && <div className="text-xs text-slate-400 mt-0.5 truncate">{a.detail}</div>}
              <div className="text-[10px] text-slate-600 mono mt-0.5">
                {a.created_at ? new Date(a.created_at).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                {a.added_iocs != null && <span className="ml-2">· +{a.added_iocs} IOC eklendi</span>}
              </div>
            </div>
            {!a.read && (
              <button
                onClick={() => doMarkRead(a.id)}
                data-testid={`alert-mark-read-${a.id}`}
                className="text-slate-500 hover:text-slate-200 p-1"
                title="Okundu işaretle"
              ><X className="w-3.5 h-3.5"/></button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
