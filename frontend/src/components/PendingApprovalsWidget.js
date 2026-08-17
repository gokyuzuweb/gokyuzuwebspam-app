/**
 * v43.76 — Pending Approvals Widget (Master Dashboard)
 *
 * Master'ın Dashboard tepesinde onay bekleyen sipariş/upgrade işlemlerini gösterir.
 * Havale + PayTR pending sayaçları + son 5 kayıt.
 *
 * Bayı görürse null render eder. 0 pending ise de gizlenir.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DollarSign, Clock, ChevronRight, CheckCircle2, Landmark, CreditCard, Loader2 } from "lucide-react";
import { client, api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const providerIcon = (p) => p === "havale" ? Landmark : CreditCard;
const providerLabel = (p) => p === "havale" ? "Havale/EFT" : "PayTR";

function fmtWhen(iso) {
  try {
    const d = new Date(iso);
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diffMin < 60) return `${diffMin}dk önce`;
    if (diffMin < 60 * 24) return `${Math.floor(diffMin/60)}sa önce`;
    return `${Math.floor(diffMin/(60*24))}g önce`;
  } catch { return ""; }
}

export default function PendingApprovalsWidget() {
  const { isMaster } = useIsMaster();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["pending-approvals-summary"],
    queryFn: () => client.get("/payments/pending-approvals").then(r => r.data),
    enabled: isMaster,
    refetchInterval: 10_000, // v43.77 — 30s → 10s (yakın-realtime)
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true, // pencereye dönünce anında refresh
    staleTime: 5_000,
    retry: false,
  });

  // v43.77 — Tek tık onay
  const [approvingOid, setApprovingOid] = useState(null);
  const approve = useMutation({
    mutationFn: (merchant_oid) => api.havaleApprove({ merchant_oid, admin_note: "Dashboard hızlı onay" }),
    onMutate: (oid) => setApprovingOid(oid),
    onSuccess: (data, oid) => {
      // v43.77 — Upgrade sonucunu göster
      const u = data?.upgrade || {};
      if (u.upgraded) {
        toast.success(`✓ ${oid} onaylandı — Plan ${u.from_plan?.toUpperCase()} → ${u.to_plan?.toUpperCase()} 🎉`, {
          description: `${u.license_key?.slice(0, 20)}… · Bitiş: ${u.expires_at?.slice(0, 10)}`,
          duration: 6000,
        });
      } else {
        toast.success(`✓ ${oid} onaylandı`, {
          description: u.reason || "Ödeme paid olarak işaretlendi",
          duration: 5000,
        });
      }
      qc.invalidateQueries({ queryKey: ["pending-approvals-summary"] });
      qc.invalidateQueries({ queryKey: ["threat-alerts"] });
      setApprovingOid(null);
    },
    onError: (e, _oid) => {
      toast.error("Onaylanamadı: " + (e?.response?.data?.detail || e.message));
      setApprovingOid(null);
    },
  });
  if (!isMaster) return null;
  if (!q.data) return null;
  const { total_pending, by_provider = {}, last_24h = 0, latest = [] } = q.data;
  if (total_pending === 0) return null;

  return (
    <div
      data-testid="pending-approvals-widget"
      className="rounded-lg border border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-amber-500/25">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-amber-500/25 border border-amber-500/40 flex items-center justify-center">
            <Clock className="w-4 h-4 text-amber-300"/>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-amber-300">Onay Bekleyen Siparişler</div>
            <div className="text-sm text-slate-100">
              <b className="text-amber-200 text-lg">{total_pending}</b> işlem onayınızı bekliyor
              {last_24h > 0 && <span className="text-[11px] text-slate-400 ml-2">· son 24s: {last_24h}</span>}
            </div>
          </div>
        </div>
        <a
          href="/panel/payments-admin"
          data-testid="pending-approvals-open-admin"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-bold transition-colors"
        >
          Ödeme Panosu <ChevronRight className="w-3.5 h-3.5"/>
        </a>
      </div>

      {/* Provider breakdown */}
      <div className="flex flex-wrap gap-4 px-4 py-2 border-b border-amber-500/20 text-[11px]">
        {Object.entries(by_provider).map(([prov, cnt]) => (
          cnt > 0 && (
            <span key={prov} className="inline-flex items-center gap-1 mono text-slate-400">
              {(() => { const Ic = providerIcon(prov); return <Ic className="w-3 h-3"/>; })()}
              {providerLabel(prov)} · <b className="text-amber-200">{cnt}</b>
            </span>
          )
        ))}
      </div>

      {/* Latest 5 */}
      <div className="divide-y divide-amber-500/10">
        {latest.slice(0, 5).map((r) => {
          const ProvIc = providerIcon(r.provider);
          const canApprove = r.provider === "havale" && ["awaiting_transfer", "awaiting_admin_confirm"].includes(r.status);
          const isApproving = approvingOid === r.merchant_oid;
          return (
            <div
              key={r.merchant_oid}
              data-testid={`pending-row-${r.merchant_oid}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-amber-500/5 transition-colors"
            >
              <ProvIc className="w-3.5 h-3.5 text-slate-500 shrink-0"/>
              <a href="/panel/payments-admin" className="flex-1 min-w-0">
                <div className="text-sm text-slate-200 truncate">
                  <b>{r.user_name || r.email || "İsimsiz"}</b>
                  {r.plan && <span className="ml-2 text-[10px] uppercase mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{r.plan}</span>}
                </div>
                <div className="text-[11px] text-slate-500 mono truncate">{r.merchant_oid} · {fmtWhen(r.created_at)}</div>
              </a>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold text-amber-200">{Number(r.amount || 0).toFixed(2)} {r.currency || "TL"}</div>
                <div className="text-[10px] text-slate-500">{r.status}</div>
              </div>
              {canApprove && (
                <button
                  data-testid={`pending-approve-${r.merchant_oid}`}
                  onClick={(e) => {
                    e.preventDefault();
                    if (!window.confirm(`${r.user_name || r.email} · ${r.plan} · ${Number(r.amount || 0).toFixed(2)} ${r.currency || "TL"} — Onaylıyor musunuz?`)) return;
                    approve.mutate(r.merchant_oid);
                  }}
                  disabled={isApproving}
                  title="Havale onayla (hızlı)"
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 hover:text-emerald-100 text-xs font-semibold transition-colors disabled:opacity-40"
                >
                  {isApproving ? <Loader2 className="w-3 h-3 animate-spin"/> : <CheckCircle2 className="w-3 h-3"/>}
                  Onayla
                </button>
              )}
            </div>
          );
        })}
      </div>

      {latest.length > 5 && (
        <a
          href="/panel/payments-admin"
          className="block px-4 py-2 text-center text-xs text-amber-300 hover:text-amber-200 bg-amber-500/5 hover:bg-amber-500/10 transition-colors"
        >
          {latest.length - 5} daha fazla → Panoyu aç
        </a>
      )}
    </div>
  );
}
