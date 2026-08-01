import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CreditCard, Building2, CheckCircle2, XCircle, Bell, Clock, RefreshCw, User, Mail, Hash,
} from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import ModuleFooter from "@/components/ModuleFooter";

export default function PaymentsAdmin() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("pending");
  const pending = useQuery({
    queryKey: ["admin-pending-havale"],
    queryFn: api.adminPendingHavale,
    refetchInterval: 15000,
  });
  const inbox = useQuery({
    queryKey: ["admin-inbox"],
    queryFn: () => api.adminInbox({ limit: 30 }),
    refetchInterval: 15000,
  });
  const allOrders = useQuery({
    queryKey: ["all-orders"],
    queryFn: () => api.paymentOrders({ limit: 100 }),
  });

  const approve = useMutation({
    mutationFn: (mid) => api.havaleApprove({ merchant_oid: mid, admin_note: "" }),
    onSuccess: () => {
      toast.success("✓ Havale onaylandı, lisans aktif olacak");
      qc.invalidateQueries({ queryKey: ["admin-pending-havale"] });
      qc.invalidateQueries({ queryKey: ["admin-inbox"] });
      qc.invalidateQueries({ queryKey: ["all-orders"] });
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Onay başarısız"),
  });
  const reject = useMutation({
    mutationFn: (mid) => api.havaleReject({ merchant_oid: mid, reason: "Eşleşen ödeme bulunamadı" }),
    onSuccess: () => {
      toast.success("Havale reddedildi");
      qc.invalidateQueries({ queryKey: ["admin-pending-havale"] });
      qc.invalidateQueries({ queryKey: ["admin-inbox"] });
    },
  });

  const p = pending.data || {};
  const inboxItems = inbox.data?.items || [];
  const unread = inbox.data?.unread || 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-400"/> Ödeme Yönetim Panosu
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Havale onaylama · Bildirimler · Sipariş geçmişi
          </p>
        </div>
        <button onClick={() => { pending.refetch(); inbox.refetch(); allOrders.refetch(); }}
                className="text-xs px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 inline-flex items-center gap-1.5"
                data-testid="pa-refresh">
          <RefreshCw className="w-3 h-3"/> Yenile
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Onay Bekleyen" value={p.notified_count || 0} tone="text-amber-300"
              icon={<Bell className="w-4 h-4 text-amber-400"/>}/>
        <Stat label="IBAN Bekleyen" value={(p.count || 0) - (p.notified_count || 0)}
              tone="text-slate-300" icon={<Clock className="w-4 h-4 text-slate-400"/>}/>
        <Stat label="Okunmamış Bildirim" value={unread} tone="text-rose-300"
              icon={<Bell className="w-4 h-4 text-rose-400"/>}/>
        <Stat label="Toplam Sipariş" value={allOrders.data?.count || 0} tone="text-emerald-300"
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-400"/>}/>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-800">
        {[
          { k: "pending", label: `Bekleyen (${p.notified_count || 0})` },
          { k: "inbox", label: `Bildirimler${unread ? ` · ${unread}` : ""}` },
          { k: "all", label: "Tüm Siparişler" },
        ].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
                  data-testid={`pa-tab-${t.k}`}
                  className={`px-4 py-2 text-sm transition-all border-b-2 -mb-px ${
                    tab === t.k
                      ? "border-indigo-500 text-slate-100"
                      : "border-transparent text-slate-500 hover:text-slate-300"
                  }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Pending Approvals */}
      {tab === "pending" && (
        <Card>
          <CardHeader
            title="Onay Bekleyen Havaleler"
            subtitle="Kullanıcının 'havale yaptım' dediği siparişler önce burada. Onaylandığında lisans aktive edilir."
          />
          <CardBody>
            {(p.items || []).length === 0 ? (
              <div className="text-center text-sm text-slate-500 py-10">
                <Bell className="w-10 h-10 text-slate-700 mx-auto mb-2"/>
                Bekleyen havale yok
              </div>
            ) : (
              <div className="space-y-2" data-testid="pa-pending-list">
                {(p.items || []).map((o) => (
                  <div key={o.merchant_oid} className={`p-4 rounded-lg border ${
                    o.status === "notified_by_user"
                      ? "bg-amber-500/10 border-amber-500/40"
                      : "bg-slate-900/40 border-slate-800"
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {o.status === "notified_by_user" && (
                            <Badge tone="warning">🔔 Kullanıcı bildirim yaptı</Badge>
                          )}
                          {o.status === "awaiting_transfer" && <Badge>Havale bekleniyor</Badge>}
                          <span className="mono text-[11px] text-slate-500">{o.merchant_oid}</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                          <Field icon={User} label="Alıcı" value={o.user_name}/>
                          <Field icon={Mail} label="E-posta" value={o.email}/>
                          <Field icon={Hash} label="Tutar" value={`${o.amount} TL`} mono/>
                          <Field icon={Clock} label="Oluşturma"
                                 value={(o.created_at || "").slice(0, 19).replace("T", " ")} mono/>
                        </div>
                        {o.user_transaction_ref && (
                          <div className="mt-2 text-xs bg-slate-950 border border-slate-800 rounded p-2 space-y-1">
                            <div><span className="text-slate-500">Banka Ref: </span><span className="mono text-slate-200">{o.user_transaction_ref}</span></div>
                            {o.user_sender_name && <div><span className="text-slate-500">Gönderen: </span>{o.user_sender_name}</div>}
                            {o.user_note && <div><span className="text-slate-500">Not: </span>{o.user_note}</div>}
                            {o.notified_at && <div className="text-slate-500 text-[10px]">Bildirim: {o.notified_at.slice(0, 19).replace("T", " ")}</div>}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button onClick={() => approve.mutate(o.merchant_oid)}
                                disabled={approve.isPending}
                                data-testid={`pa-approve-${o.merchant_oid}`}
                                className="text-xs px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40 inline-flex items-center gap-1.5">
                          <CheckCircle2 className="w-3 h-3"/> Onayla
                        </button>
                        <button onClick={() => reject.mutate(o.merchant_oid)}
                                disabled={reject.isPending}
                                data-testid={`pa-reject-${o.merchant_oid}`}
                                className="text-xs px-3 py-1.5 rounded bg-rose-500/20 text-rose-200 border border-rose-500/40 hover:bg-rose-500/30 disabled:opacity-40 inline-flex items-center gap-1.5">
                          <XCircle className="w-3 h-3"/> Reddet
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Inbox */}
      {tab === "inbox" && (
        <Card>
          <CardHeader title="Bildirim Kutusu" subtitle="Havale bildirimleri, kullanıcı iletileri"/>
          <CardBody>
            {inboxItems.length === 0 ? (
              <div className="text-center text-sm text-slate-500 py-10">Bildirim yok</div>
            ) : (
              <div className="space-y-1.5">
                {inboxItems.map((n) => (
                  <div key={n.id} className={`px-3 py-2 rounded border text-xs ${
                    n.read ? "bg-slate-900/40 border-slate-800 opacity-60" : "bg-amber-500/10 border-amber-500/30"
                  }`}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="mono text-[11px] text-slate-500">{(n.created_at || "").slice(11, 19)}</span>
                        <span className="text-slate-300 ml-2">💰 {n.user_name}</span>
                        <span className="text-slate-500 ml-1">({n.email})</span>
                        <span className="text-emerald-300 mono ml-2">{n.amount} TL</span>
                        <span className="text-slate-500 mono ml-2">ref: {n.transaction_ref || "-"}</span>
                      </div>
                      {!n.read && (
                        <button onClick={() => api.adminInboxRead(n.id).then(() => inbox.refetch())}
                                className="text-slate-400 hover:text-slate-200 text-[10px]">
                          okundu ✓
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* All Orders */}
      {tab === "all" && (
        <Card>
          <CardHeader title="Tüm Siparişler"/>
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="pa-all-table">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-800">
                    <th className="px-3 py-2">Zaman</th>
                    <th className="px-3 py-2">Sağlayıcı</th>
                    <th className="px-3 py-2">Kullanıcı</th>
                    <th className="px-3 py-2 text-right">Tutar</th>
                    <th className="px-3 py-2">Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {(allOrders.data?.items || []).map((o) => (
                    <tr key={o.merchant_oid} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                      <td className="px-3 py-2 mono text-slate-400">{(o.created_at || "").slice(0, 19).replace("T", " ")}</td>
                      <td className="px-3 py-2">
                        {o.provider === "paytr" ? <Badge tone="info">PayTR</Badge> : <Badge tone="success">Havale</Badge>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-slate-200">{o.user_name}</div>
                        <div className="text-[10px] text-slate-500">{o.email}</div>
                      </td>
                      <td className="px-3 py-2 mono text-right text-emerald-300">{o.amount} TL</td>
                      <td className="px-3 py-2">
                        {o.status === "paid" && <Badge tone="success">Ödendi ✓</Badge>}
                        {o.status === "pending" && <Badge>PayTR bekleniyor</Badge>}
                        {o.status === "awaiting_transfer" && <Badge tone="warning">Havale bekleniyor</Badge>}
                        {o.status === "notified_by_user" && <Badge tone="warning">Bildirim yapıldı</Badge>}
                        {o.status === "rejected" && <Badge tone="danger">Reddedildi</Badge>}
                        {o.status === "failed" && <Badge tone="danger">Başarısız</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      <ModuleFooter
        title="Ödeme Panosu — Nasıl Çalışır?"
        howItWorks="Kullanıcı Landing'de 'Havale Talebi Oluştur' derse status=awaiting_transfer olur. IBAN alır, havale yapar ve 'Havale Yaptım' butonuna basar → status=notified_by_user olur ve buraya bildirim düşer. Admin 'Onayla' der → status=paid + lisans e-posta ile gönderilir."
        technical={[
          "Endpoints: /api/payments/havale/notify · /admin/pending · /admin/inbox · /havale/approve",
          "notifications_inbox koleksiyonunda gerçek-zamanlı okuma bildirimi",
          "15sn otomatik yenileme (react-query refetchInterval)",
          "Onay/red kullanıcıya e-posta göndermez — o iş lisans yayın akışında (Licenses)",
        ]}
        recommendations={[
          "Onaylamadan önce banka hesabınızı kontrol edin (referans eşleşiyor mu?)",
          "Reddederken 'reject_reason' alanı log'lanır — sonra rapor için kullanışlı",
          "Bildirimleri 15sn'de bir alırsınız; browser tabındayken yeterli",
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

function Field({ icon: Icon, label, value, mono = false }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1 mb-0.5">
        <Icon className="w-2.5 h-2.5"/> {label}
      </div>
      <div className={`text-slate-200 truncate ${mono ? "mono" : ""}`}>{value || "-"}</div>
    </div>
  );
}
