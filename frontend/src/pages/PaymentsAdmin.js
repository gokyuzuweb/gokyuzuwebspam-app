import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CreditCard, Building2, CheckCircle2, XCircle, Bell, Clock, RefreshCw, User, Mail, Hash,
  X, Upload, FileText, Wand2, Settings2, Eye, EyeOff, LayoutGrid,
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
          { k: "kanban", label: "📋 Kanban" },
          { k: "inbox", label: `Bildirimler${unread ? ` · ${unread}` : ""}` },
          { k: "all", label: "Tüm Siparişler" },
          { k: "smart_pos", label: "🎯 Akıllı POS" },
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

      {tab === "smart_pos" && <SmartPosPanel/>}
      {tab === "kanban" && <OrdersKanban orders={allOrders.data?.items || []} onApprove={(mid) => approve.mutate(mid)} onReject={(mid) => reject.mutate(mid)} onRefetch={() => allOrders.refetch()}/>}

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

function SmartPosPanel() {
  const [configProvider, setConfigProvider] = useState(null);
  const providers = useQuery({ queryKey: ["smart-pos-providers"], queryFn: api.smartPosProviders, refetchInterval: 30000 });
  const stats = useQuery({ queryKey: ["smart-pos-stats"], queryFn: api.smartPosStats, refetchInterval: 30000 });
  const items = providers.data?.providers || [];
  const stObj = stats.data?.stats || {};
  const totalRev = stats.data?.total_revenue_30d || 0;
  const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

  // Kategori grupla
  const groups = {
    gateway: items.filter((p) => p.category === "gateway"),
    bank_pos: items.filter((p) => p.category === "bank_pos"),
    manual: items.filter((p) => p.category === "manual"),
  };
  const GROUP_META = {
    gateway: { title: "💳 Sanal POS / Ödeme Ağ Geçitleri", subtitle: "PayTR, iyzico, Param, ipara, Shopier, Moka, SiPay" },
    bank_pos: { title: "🏛️ Banka Sanal POS'ları", subtitle: "Garanti · YKB · Akbank · İş Bankası · Ziraat · Halk · Vakıf · Deniz · TEB · QNB Finans · Kuveyt Türk · Albaraka" },
    manual: { title: "🏦 Manuel / Havale", subtitle: "Havale · EFT · FAST" },
  };

  return (
    <div className="space-y-4">
      {/* Total revenue */}
      <div className="bg-gradient-to-br from-emerald-500/10 to-indigo-500/10 border border-emerald-500/30 rounded-lg p-6">
        <div className="text-[10px] uppercase tracking-widest text-emerald-300 mb-1">Son 30 Gün Toplam Gelir</div>
        <div className="text-4xl font-bold mono text-emerald-100">{nfmt(totalRev)} TL</div>
        <div className="text-xs text-slate-400 mt-1">
          {items.length} sağlayıcı · {items.filter((p) => p.recommended).length} aktif · {items.filter((p) => p.configured).length} configured
        </div>
      </div>

      {/* Provider groups */}
      {Object.entries(groups).map(([cat, list]) => (
        <div key={cat} className="space-y-2">
          <div className="flex items-baseline justify-between">
            <div>
              <h3 className="text-slate-100 font-semibold text-sm">{GROUP_META[cat].title}</h3>
              <p className="text-[11px] text-slate-500">{GROUP_META[cat].subtitle}</p>
            </div>
            <span className="text-[11px] text-slate-500 mono">{list.length} sağlayıcı</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map((p) => {
              const st = stObj[p.key] || {};
              return (
                <div key={p.key}
                     data-testid={`smart-pos-provider-${p.key}`}
                     className={`rounded-lg border p-3 ${
                       p.recommended ? "bg-emerald-500/5 border-emerald-500/40"
                       : p.configured ? "bg-slate-900/40 border-slate-800"
                       : "bg-slate-900/20 border-slate-800 opacity-70"
                     }`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xl leading-none">{p.logo}</span>
                      <div className="min-w-0">
                        <div className="text-slate-100 font-semibold text-sm truncate">{p.name}</div>
                        <div className="text-[9px] text-slate-500 mono uppercase">
                          #{p.priority} · {p.type} · {p.commission}
                        </div>
                      </div>
                    </div>
                    {p.recommended ? <Badge tone="success">✓</Badge>
                    : p.configured ? <Badge tone="info">aktif</Badge>
                    : <Badge>test</Badge>}
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[10px] mb-2">
                    <div>
                      <div className="text-[8px] text-slate-500 uppercase">30G</div>
                      <div className="mono text-slate-200">{st.total || 0}</div>
                    </div>
                    <div>
                      <div className="text-[8px] text-slate-500 uppercase">Başarı</div>
                      <div className="mono text-emerald-300">%{st.success_rate || 0}</div>
                    </div>
                    <div>
                      <div className="text-[8px] text-slate-500 uppercase">Gelir</div>
                      <div className="mono text-emerald-200 truncate">{nfmt(st.revenue || 0)}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {(p.supports || []).slice(0, 6).map((s) => (
                      <span key={s} className="text-[8px] mono px-1 py-0.5 rounded bg-slate-800 text-slate-400 uppercase">{s}</span>
                    ))}
                  </div>
                  {!p.configured && p.category !== "manual" && (
                    <div className="text-[9px] text-amber-400/70 mt-2 border-t border-slate-800 pt-1.5 truncate"
                         title={p.configured_env.join(", ")}>
                      ⚠️ .env: <span className="mono">{p.configured_env[0]}...</span>
                    </div>
                  )}
                  <button
                    onClick={() => setConfigProvider(p.key)}
                    data-testid={`pos-config-btn-${p.key}`}
                    className="w-full mt-2 text-[10px] px-2 py-1.5 rounded bg-indigo-500/15 text-indigo-200 border border-indigo-500/30 hover:bg-indigo-500/25 inline-flex items-center justify-center gap-1"
                  >
                    ⚙️ API Anahtarlarını Ayarla
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Havale Ekstre Yükle */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="text-sm font-semibold text-emerald-200 mb-2">📄 Banka Ekstresi Yükle · Otomatik Havale Eşleştirme</div>
        <p className="text-xs text-slate-400 mb-3">
          Banka ekstrenizin metnini yapıştırın. Sistem TRF... referanslarını otomatik yakalar ve bekleyen havalelerle eşleştirir.
        </p>
        <StatementMatchForm/>
      </div>

      {/* Config Modal */}
      {configProvider && (
        <PosConfigModal
          providerKey={configProvider}
          onClose={() => setConfigProvider(null)}
          onSaved={() => { providers.refetch(); stats.refetch(); }}
        />
      )}

      <ModuleFooter
        title="Akıllı POS Router — Nasıl Çalışır?"
        howItWorks="Ödeme talebi geldiğinde /smart-pos/route endpoint'i sırayla değerlendirir: 1) 'prefer' varsa öncelik. 2) Configured olmayanlar sona atılır. 3) Son 1 saatte başarı oranı %40 altında ise 'unhealthy'. 4) Priority düşük olan seçilir. Failover chain (fallback_chain) client'a döner."
        technical={[
          "22 sağlayıcı: 7 gateway + 14 banka VPOS + 1 manuel (havale)",
          "Gateway'ler: PayTR/iyzico/Param/ipara/Shopier/Moka/SiPay",
          "Banka VPOS'ları: Garanti/YKB/Akbank/İş/Ziraat/Halk/Vakıf/Deniz/TEB/QNB/Kuveyt/Albaraka",
          "Her sağlayıcı için .env'e ilgili MERCHANT/TERMINAL bilgileri eklenir",
        ]}
        recommendations={[
          "En az 2 gateway + 1 banka POS configured yapın — failover için",
          "Havale'yi son fallback olarak bırakın (manuel onay)",
          "Aylık success_rate < %90 ise ilgili sağlayıcıyla iletişime geçin",
          "Banka POS'ları için EST/PosNet SDK'sı gerektirir (ek entegrasyon)",
        ]}
      />
    </div>
  );
}

// ============================================================================
// StatementMatchForm — Banka ekstresi yapıştır + otomatik havale eşleştir
// ============================================================================
function StatementMatchForm() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const match = useMutation({
    mutationFn: (payload) => api.havaleStatementMatch(payload),
    onSuccess: (data) => {
      setResult(data);
      if (data?.auto_approved?.length) {
        toast.success(`✓ ${data.auto_approved.length} sipariş otomatik onaylandı`);
        qc.invalidateQueries({ queryKey: ["admin-pending-havale"] });
        qc.invalidateQueries({ queryKey: ["all-orders"] });
      } else if (data?.matches?.length) {
        toast.info(`${data.matches.length} eşleşme bulundu`);
      } else {
        toast.warning(data?.message || "Eşleşme yok");
      }
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Eşleştirme başarısız"),
  });

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.name.toLowerCase().endsWith(".pdf")) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        const res = await fetch(
          `${process.env.REACT_APP_BACKEND_URL}/api/payments/havale/statement-upload`,
          { method: "POST", body: fd },
        );
        const data = await res.json();
        if (data.extracted_text) {
          setText(data.extracted_text);
          toast.success(`PDF okundu · ${data.pages} sayfa · ${data.extracted_text.length} karakter`);
        } else {
          toast.error(data.detail || "PDF okunamadı");
        }
      } catch (err) {
        toast.error("PDF yükleme hatası");
      }
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setText(ev.target.result || "");
        toast.success(`Dosya yüklendi · ${f.name}`);
      };
      reader.readAsText(f);
    }
    e.target.value = "";
  };

  return (
    <div className="space-y-3" data-testid="statement-match-form">
      <div className="flex items-center gap-2 flex-wrap">
        <input type="file" accept=".pdf,.txt,.csv" ref={fileRef} onChange={onFile}
               className="hidden" data-testid="statement-file-input"/>
        <button type="button" onClick={() => fileRef.current?.click()}
                className="text-xs px-3 py-1.5 rounded bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 inline-flex items-center gap-1.5"
                data-testid="statement-upload-btn">
          <Upload className="w-3 h-3"/> PDF / TXT / CSV Yükle
        </button>
        <label className="text-xs text-slate-400 inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)}
                 data-testid="statement-auto-approve"/>
          Tam eşleşenleri otomatik onayla
        </label>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)}
                placeholder="Banka ekstresi metnini buraya yapıştırın veya PDF yükleyin&#10;Örn: 15/03/2026  TRF3A5B7C9D1E2F3A5B7C9D1E  1.499,00 TL  GELEN HAVALE"
                rows={6}
                className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs mono text-slate-200 focus:border-emerald-500/50 outline-none"
                data-testid="statement-textarea"/>
      <div className="flex items-center gap-2">
        <button type="button" disabled={!text.trim() || match.isPending}
                onClick={() => match.mutate({ raw_text: text, auto_approve: autoApprove })}
                className="text-xs px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40 inline-flex items-center gap-1.5"
                data-testid="statement-match-btn">
          <Wand2 className="w-3 h-3"/> {match.isPending ? "Eşleştiriliyor..." : "Otomatik Eşleştir"}
        </button>
        {text && (
          <button type="button" onClick={() => { setText(""); setResult(null); }}
                  className="text-[10px] text-slate-500 hover:text-slate-300">temizle</button>
        )}
      </div>

      {result && (
        <div className="mt-2 space-y-2" data-testid="statement-result">
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <span className="text-slate-400"><span className="mono text-slate-200">{result.refs_found || 0}</span> referans</span>
            <span className="text-emerald-300"><span className="mono">{result.matches?.length || 0}</span> eşleşme</span>
            {!!result.auto_approved?.length && <Badge tone="success">{result.auto_approved.length} auto-onay</Badge>}
            {!!result.unmatched_refs?.length && (
              <span className="text-amber-300"><span className="mono">{result.unmatched_refs.length}</span> eşleşmeyen</span>
            )}
          </div>
          {result.matches?.length > 0 && (
            <div className="space-y-1">
              {result.matches.map((m) => (
                <div key={m.merchant_oid}
                     className={`p-2 rounded border text-xs ${
                       m.confidence >= 100
                         ? "bg-emerald-500/5 border-emerald-500/30"
                         : "bg-amber-500/5 border-amber-500/30"
                     }`}
                     data-testid={`statement-match-${m.merchant_oid}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="mono text-slate-200 truncate">{m.merchant_oid}</div>
                      <div className="text-[10px] text-slate-500">{m.user_name} · {m.email}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="mono text-emerald-200">{m.expected_amount} TL</div>
                      <div className="text-[10px] text-slate-500">
                        %{m.confidence} güven
                        {m.detected_amount != null && ` · ekstre: ${m.detected_amount}`}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {result.unmatched_refs?.length > 0 && (
            <div className="text-[10px] text-amber-300/80 mono">
              Eşleşmeyen: {result.unmatched_refs.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PosConfigModal — Sağlayıcı API anahtarları için modal form
// ============================================================================
function PosConfigModal({ providerKey, onClose, onSaved }) {
  const cfg = useQuery({
    queryKey: ["pos-config", providerKey],
    queryFn: () => api.smartPosGetConfig(providerKey),
  });
  const [values, setValues] = useState({});
  const [testMode, setTestMode] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [showSecrets, setShowSecrets] = useState({});
  const [initialized, setInitialized] = useState(false);

  if (cfg.data && !initialized) {
    setTestMode(!!cfg.data.test_mode);
    setEnabled(cfg.data.enabled !== false);
    setInitialized(true);
  }

  const save = useMutation({
    mutationFn: (payload) => api.smartPosSetConfig(providerKey, payload),
    onSuccess: (data) => {
      toast.success(`${cfg.data?.name || providerKey} kaydedildi · ${data.configured_fields}/${data.total_fields} alan dolu`);
      onSaved?.();
      onClose();
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Kaydetme başarısız"),
  });

  const test = useMutation({
    mutationFn: () => api.smartPosTestConfig(providerKey),
    onSuccess: (data) => {
      if (data.ok) toast.success(data.message);
      else toast.warning(data.message);
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Test başarısız"),
  });

  const submit = (e) => {
    e?.preventDefault?.();
    save.mutate({ values, test_mode: testMode, enabled });
  };

  const d = cfg.data;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
         data-testid="pos-config-modal">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl leading-none">{d?.logo || "⚙️"}</span>
            <div className="min-w-0">
              <div className="text-slate-100 font-semibold text-sm truncate">{d?.name || providerKey}</div>
              <div className="text-[10px] text-slate-500 mono uppercase">
                {d?.category || "..."} · komisyon: {d?.commission || "-"}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 p-1"
                  data-testid="pos-config-close">
            <X className="w-4 h-4"/>
          </button>
        </div>

        <form onSubmit={submit} className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          {cfg.isLoading ? (
            <div className="text-center text-sm text-slate-500 py-8">Yükleniyor...</div>
          ) : !d?.fields?.length ? (
            <div className="text-center text-sm text-slate-500 py-8">
              Bu sağlayıcı için config alanı yok (manuel).
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 pb-3 border-b border-slate-800">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={testMode}
                         onChange={(e) => setTestMode(e.target.checked)}
                         data-testid="pos-config-test-mode"/>
                  🧪 Test Modu
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={enabled}
                         onChange={(e) => setEnabled(e.target.checked)}
                         data-testid="pos-config-enabled"/>
                  ✅ Aktif (yönlendirmeye dahil)
                </label>
              </div>

              {d.fields.map((f) => (
                <div key={f.env_name}>
                  <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 flex items-center justify-between">
                    <span>{f.label}</span>
                    <span className="text-[9px] mono normal-case text-slate-600">
                      {f.env_name} · {f.source}
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      type={(f.sensitive && !showSecrets[f.env_name]) ? "password" : "text"}
                      value={values[f.env_name] ?? ""}
                      onChange={(e) => setValues({ ...values, [f.env_name]: e.target.value })}
                      placeholder={f.has_value ? f.value_masked : `${f.env_name} girin`}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs mono text-slate-200 focus:border-indigo-500/50 outline-none pr-8"
                      data-testid={`pos-config-field-${f.env_name}`}
                    />
                    {f.sensitive && (
                      <button type="button"
                              onClick={() => setShowSecrets({ ...showSecrets, [f.env_name]: !showSecrets[f.env_name] })}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                        {showSecrets[f.env_name] ? <EyeOff className="w-3.5 h-3.5"/> : <Eye className="w-3.5 h-3.5"/>}
                      </button>
                    )}
                  </div>
                  {f.has_value && (
                    <div className="text-[9px] text-slate-500 mt-0.5">
                      Mevcut (maskeli): <span className="mono">{f.value_masked}</span>
                      {" · "}boş bırakırsanız dokunulmaz
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </form>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-800 bg-slate-950/50">
          <button type="button" onClick={() => test.mutate()} disabled={test.isPending}
                  className="text-xs px-3 py-1.5 rounded bg-sky-500/15 text-sky-200 border border-sky-500/30 hover:bg-sky-500/25 inline-flex items-center gap-1.5"
                  data-testid="pos-config-test-btn">
            <Settings2 className="w-3 h-3"/> {test.isPending ? "Test..." : "Bağlantıyı Test Et"}
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose}
                    className="text-xs px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                    data-testid="pos-config-cancel">
              İptal
            </button>
            <button type="button" onClick={submit} disabled={save.isPending}
                    className="text-xs px-4 py-1.5 rounded bg-indigo-500/20 text-indigo-100 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40 inline-flex items-center gap-1.5"
                    data-testid="pos-config-save">
              <CheckCircle2 className="w-3 h-3"/> {save.isPending ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// OrdersKanban — Sürükle-bırak sipariş yönetimi
// ============================================================================
const KANBAN_COLUMNS = [
  { key: "awaiting", title: "⏳ Bekleyen", statuses: ["awaiting_transfer", "pending"],
    color: "border-slate-700 bg-slate-900/40" },
  { key: "notified", title: "🔔 Kullanıcı Bildirim", statuses: ["notified_by_user"],
    color: "border-amber-500/40 bg-amber-500/5" },
  { key: "paid", title: "✅ Onaylandı", statuses: ["paid"],
    color: "border-emerald-500/40 bg-emerald-500/5" },
  { key: "failed", title: "❌ Başarısız / Reddedildi", statuses: ["failed", "rejected"],
    color: "border-rose-500/30 bg-rose-500/5" },
];

function OrdersKanban({ orders, onApprove, onReject, onRefetch }) {
  const [dragOid, setDragOid] = useState(null);
  const columns = KANBAN_COLUMNS.map((col) => ({
    ...col,
    items: orders.filter((o) => col.statuses.includes(o.status)),
  }));

  const handleDrop = (targetKey, e) => {
    e.preventDefault();
    if (!dragOid) return;
    const order = orders.find((o) => o.merchant_oid === dragOid);
    setDragOid(null);
    if (!order) return;
    const movable = ["notified_by_user", "awaiting_transfer", "pending"];
    if (targetKey === "paid" && movable.includes(order.status)) {
      onApprove(order.merchant_oid);
    } else if (targetKey === "failed" && movable.includes(order.status)) {
      onReject(order.merchant_oid);
    } else {
      toast.info("Bu geçiş desteklenmiyor");
    }
  };

  return (
    <div className="space-y-3" data-testid="orders-kanban">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <LayoutGrid className="w-4 h-4 text-indigo-400"/>
          <span>Sürükle-bırak: kartı 'Onaylandı' veya 'Başarısız' sütununa taşı</span>
        </div>
        <button onClick={onRefetch}
                className="text-[10px] text-slate-500 hover:text-slate-300 inline-flex items-center gap-1"
                data-testid="kanban-refresh">
          <RefreshCw className="w-3 h-3"/> yenile
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {columns.map((col) => (
          <div key={col.key}
               onDragOver={(e) => e.preventDefault()}
               onDrop={(e) => handleDrop(col.key, e)}
               className={`rounded-lg border p-2 min-h-[60vh] ${col.color}`}
               data-testid={`kanban-col-${col.key}`}>
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="text-xs font-semibold text-slate-200">{col.title}</div>
              <span className="text-[10px] mono text-slate-500">{col.items.length}</span>
            </div>
            <div className="space-y-1.5">
              {col.items.length === 0 ? (
                <div className="text-center text-[10px] text-slate-600 py-4">boş</div>
              ) : col.items.slice(0, 40).map((o) => (
                <div key={o.merchant_oid}
                     draggable
                     onDragStart={() => setDragOid(o.merchant_oid)}
                     onDragEnd={() => setDragOid(null)}
                     className={`p-2 rounded border bg-slate-900/80 border-slate-800 text-[10px] cursor-move transition-opacity ${
                       dragOid === o.merchant_oid ? "opacity-50" : "hover:border-indigo-500/40"
                     }`}
                     data-testid={`kanban-card-${o.merchant_oid}`}>
                  <div className="flex items-center gap-1 mb-0.5">
                    {o.provider === "havale"
                      ? <Badge tone="success">HAV</Badge>
                      : <Badge tone="info">{(o.provider || "?").toUpperCase().slice(0, 4)}</Badge>}
                    <span className="mono text-emerald-300 ml-auto">{o.amount} TL</span>
                  </div>
                  <div className="text-slate-200 truncate">{o.user_name || "—"}</div>
                  <div className="text-slate-500 truncate">{o.email}</div>
                  <div className="mono text-slate-600 truncate mt-0.5">{o.merchant_oid}</div>
                  <div className="text-slate-600 text-[9px] mt-0.5">
                    {(o.created_at || "").slice(0, 16).replace("T", " ")}
                  </div>
                </div>
              ))}
              {col.items.length > 40 && (
                <div className="text-center text-[9px] text-slate-600 py-1">
                  +{col.items.length - 40} daha...
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

