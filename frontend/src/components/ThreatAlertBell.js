import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, X, Check, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const LICKEY = () =>
  (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) ||
  "";

const fmtRel = (iso) => {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}sn önce`;
  if (diff < 3600) return `${Math.floor(diff / 60)}dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}sa önce`;
  return `${Math.floor(diff / 86400)}g önce`;
};

/**
 * ThreatAlertBell — Master-only bildirim zili. 20sn'de bir polling yapar;
 * yeni unseen alert geldiğinde toast atar ve badge sayacını günceller.
 */
export default function ThreatAlertBell() {
  const { isMaster } = useIsMaster();
  const [open, setOpen] = useState(false);
  const prevUnseenRef = useRef(0);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["threat-alerts"],
    queryFn: () => api.adminThreatAlerts(LICKEY(), { limit: 30 }),
    enabled: !!isMaster,
    refetchInterval: 20000,
    retry: false,
  });

  const ack = useMutation({
    mutationFn: (id) => api.adminThreatAlertAck(id, LICKEY()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["threat-alerts"] }),
  });

  const ackAll = useMutation({
    mutationFn: () => api.adminThreatAlertsAckAll(LICKEY()),
    onSuccess: (d) => {
      toast.success(`${d.acked} uyarı okundu işaretlendi`);
      qc.invalidateQueries({ queryKey: ["threat-alerts"] });
    },
  });

  const items = q.data?.items || [];
  const unseen = q.data?.unseen_count || 0;

  // Yeni unseen geldiğinde toast
  useEffect(() => {
    if (unseen > prevUnseenRef.current && prevUnseenRef.current !== 0) {
      const newest = items.find((a) => !a.seen);
      if (newest) {
        toast.warning("⚠️ Yeni Tehdit Uyarısı", {
          description: newest.message,
          action: {
            label: "Görüntüle",
            onClick: () => setOpen(true),
          },
          duration: 10000,
        });
      }
    }
    prevUnseenRef.current = unseen;
  }, [unseen, items]);

  // Dışarı tık ile kapat
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!isMaster) return null;

  return (
    <div className="relative">
      <button
        data-testid="threat-bell"
        onClick={() => setOpen((v) => !v)}
        className="relative text-slate-400 hover:text-slate-100 transition-colors p-1"
        title="Tehdit Uyarıları"
      >
        <Bell className="w-4 h-4" />
        {unseen > 0 && (
          <span
            data-testid="threat-bell-badge"
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center animate-pulse"
          >
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            data-testid="threat-bell-panel"
            className="absolute right-0 top-full mt-2 w-96 max-h-[500px] rounded-lg border border-slate-800 bg-slate-950 shadow-2xl shadow-rose-500/10 z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-slate-100 text-sm font-medium">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                Tehdit Uyarıları
                {unseen > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 mono">
                    {unseen} okunmadı
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unseen > 0 && (
                  <button
                    data-testid="threat-ack-all"
                    onClick={() => ackAll.mutate()}
                    disabled={ackAll.isPending}
                    className="text-[10px] px-2 py-1 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                  >
                    Hepsini oku
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 text-slate-500 hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs">
                  {q.isLoading ? "Yükleniyor…" : "Henüz uyarı yok — tüm bayiler normal aralıkta 🎉"}
                </div>
              ) : (
                <ul className="divide-y divide-slate-800/60">
                  {items.map((a) => (
                    <li
                      key={a.id}
                      data-testid={`threat-alert-${a.id}`}
                      className={`p-3 hover:bg-slate-900/60 transition-colors ${
                        !a.seen ? "bg-rose-500/[0.03] border-l-2 border-rose-500" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-slate-200 leading-relaxed">
                            {a.message}
                          </div>
                          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500">
                            <span className="mono">{fmtRel(a.created_at)}</span>
                            <span>·</span>
                            <span className="mono">{a.mails} mail</span>
                            <span>·</span>
                            <span className={`mono font-semibold ${
                              a.ratio_pct >= 60 ? "text-rose-400" : "text-amber-400"
                            }`}>
                              %{a.ratio_pct}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {!a.seen && (
                            <button
                              data-testid={`threat-ack-${a.id}`}
                              onClick={() => ack.mutate(a.id)}
                              className="p-1 rounded hover:bg-slate-800 text-emerald-400"
                              title="Okundu"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <a
                            href={`/panel/resellers-admin?rid=${encodeURIComponent(a.reseller_id)}`}
                            className="p-1 rounded hover:bg-slate-800 text-indigo-400"
                            title="Detay"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-slate-800 flex items-center justify-between">
              <a
                href="/panel/master-live"
                className="text-[10px] text-indigo-400 hover:text-indigo-300"
              >
                → Canlı Bayi Trafiği
              </a>
              <span className="text-[10px] text-slate-600 mono">
                20sn otomatik yenileme
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
