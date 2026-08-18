import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CreditCard, Building2, CheckCircle2, XCircle, Bell, Clock, RefreshCw, User, Mail, Hash,
  X, Upload, FileText, Wand2, Settings2, Eye, EyeOff, LayoutGrid, Percent, Plus, Minus,
} from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import ModuleFooter from "@/components/ModuleFooter";

export default function PaymentsAdmin() {
  const qc = useQueryClient();
  const [tab, setTab] = useState(() => localStorage.getItem("gws.payments.tab") || "pending");
  const chooseTab = (id) => { setTab(id); try { localStorage.setItem("gws.payments.tab", id); } catch {} };
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

      {/* Gateway toggle (master default) */}
      <GatewayToggle />

      {/* Tabs — v43.94 restyled to big colored bar */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3 sticky top-14 bg-slate-950/80 backdrop-blur z-10" data-testid="pa-tabs">
        {[
          { k: "pending",   label: `Havale Kuyruğu${p.notified_count ? ` (${p.notified_count})` : ""}`, tone: "amber"   },
          { k: "kanban",    label: "Kanban Panosu",   tone: "indigo"  },
          { k: "inbox",     label: `Bildirimler${unread ? ` · ${unread}` : ""}`, tone: "rose"    },
          { k: "all",       label: "Faturalar",       tone: "emerald" },
          { k: "smart_pos", label: "Stripe & Akıllı POS", tone: "fuchsia" },
        ].map((t) => {
          const tones = {
            amber:   "border-amber-500/50 bg-amber-500/15 text-amber-200",
            indigo:  "border-indigo-500/50 bg-indigo-500/15 text-indigo-200",
            rose:    "border-rose-500/50 bg-rose-500/15 text-rose-200",
            emerald: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
            fuchsia: "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200",
          };
          const active = tab === t.k;
          return (
            <button key={t.k} onClick={() => chooseTab(t.k)}
              data-testid={`pa-tab-${t.k}`}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-all ${
                active ? tones[t.tone] + " shadow-md" : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}>
              {t.label}
            </button>
          );
        })}
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
                          <Field icon={Hash} label="Tutar" value={`${o.amount} ${o.currency || 'TL'}`} mono/>
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
          <CardHeader title="Bildirim Kutusu" subtitle="Havale bildirimleri, rozet açılışları, sistem alarmları"/>
          <CardBody>
            {inboxItems.length === 0 ? (
              <div className="text-center text-sm text-slate-500 py-10">Bildirim yok</div>
            ) : (
              <div className="space-y-1.5">
                {inboxItems.map((n) => {
                  const time = (n.created_at || "").slice(11, 19);
                  const date = (n.created_at || "").slice(0, 10);
                  const kind = n.kind || "havale_notified";
                  let icon = "💰", body = null, toneClass = n.read
                    ? "bg-slate-900/40 border-slate-800 opacity-70"
                    : "bg-amber-500/10 border-amber-500/30";
                  if (kind === "badge_unlocked") {
                    icon = "🏅";
                    toneClass = n.read ? "bg-slate-900/40 border-slate-800 opacity-70" : "bg-indigo-500/10 border-indigo-500/40";
                    body = (
                      <>
                        <span className="text-slate-100 ml-2 font-semibold">{n.title || "Rozet Açıldı"}</span>
                        {n.message && <span className="text-slate-400 ml-2">— {n.message}</span>}
                      </>
                    );
                  } else if (kind === "havale_notified") {
                    body = (
                      <>
                        <span className="text-slate-300 ml-2">{n.user_name || "-"}</span>
                        <span className="text-slate-500 ml-1">({n.email || "-"})</span>
                        <span className="text-emerald-300 mono ml-2">{n.amount} {n.currency || 'TL'}</span>
                        <span className="text-slate-500 mono ml-2">ref: {n.transaction_ref || "-"}</span>
                      </>
                    );
                  } else if (kind === "attack_alarm" || kind === "bulk_mail_alarm" || kind === "attack_alert" || kind === "bulk_mail_alert" || kind === "trust_score_alert") {
                    const isAttack = kind.startsWith("attack");
                    const isBulk = kind.startsWith("bulk");
                    icon = isAttack ? "🛡️" : isBulk ? "📤" : "📉";
                    toneClass = n.read ? "bg-slate-900/40 border-slate-800 opacity-70" : "bg-rose-500/10 border-rose-500/40";
                    const label = isAttack ? "Saldırı Alarmı" : isBulk ? "Toplu Mail Alarmı" : "Güven Skoru Uyarısı";
                    body = (
                      <>
                        <span className="text-rose-200 ml-2 font-semibold">{n.title || label}</span>
                        {n.message && <span className="text-slate-400 ml-2">— {n.message}</span>}
                      </>
                    );
                  } else {
                    icon = "🔔";
                    body = (
                      <>
                        <span className="text-slate-200 ml-2 font-semibold">{n.title || kind}</span>
                        {n.message && <span className="text-slate-400 ml-2">— {n.message}</span>}
                      </>
                    );
                  }
                  return (
                    <div key={n.id} data-testid={`inbox-item-${n.id}`} className={`px-3 py-2 rounded border text-xs ${toneClass}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="mono text-[11px] text-slate-500" title={n.created_at}>{date} {time}</span>
                          <span className="ml-2">{icon}</span>
                          {body}
                        </div>
                        {!n.read && (
                          <button onClick={() => api.adminInboxRead(n.id).then(() => inbox.refetch())}
                                  data-testid={`inbox-read-${n.id}`}
                                  className="text-slate-400 hover:text-slate-200 text-[10px] shrink-0">
                            okundu ✓
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
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
                      <td className="px-3 py-2 mono text-right text-emerald-300">{o.amount} {o.currency || 'TL'}</td>
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

function GatewayToggle() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-payment-settings"], queryFn: api.adminPaymentSettings });
  const s = q.data;
  const setGw = useMutation({
    mutationFn: (gw) => api.adminPaymentSettingsSet({
      default_gateway: gw,
      havale_enabled: s?.havale_enabled !== false,
      stripe_enabled: s?.stripe_enabled !== false,
    }),
    onSuccess: (d) => {
      toast.success(`Varsayılan gateway → ${d.default_gateway === "stripe" ? "💳 Stripe" : "🏦 Havale"}`);
      qc.invalidateQueries({ queryKey: ["admin-payment-settings"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kaydedilemedi"),
  });
  if (!s) return null;
  const current = s.default_gateway || "havale";
  const OptionCard = ({ id, icon, label, desc, badge }) => {
    const active = current === id;
    return (
      <button
        type="button"
        data-testid={`gateway-opt-${id}`}
        onClick={() => !active && setGw.mutate(id)}
        disabled={setGw.isPending}
        className={`relative flex-1 min-w-0 text-left px-4 py-3 rounded-lg border transition-all ${
          active
            ? "bg-gradient-to-br from-indigo-500/15 to-emerald-500/5 border-indigo-500/50 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/20"
            : "bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80"
        } disabled:opacity-60`}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${active ? "text-indigo-200" : "text-slate-200"}`}>{label}</span>
              {active && (
                <span className="text-[9.5px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 mono">Varsayılan</span>
              )}
              {badge && !active && (
                <span className="text-[9.5px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 mono">{badge}</span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate">{desc}</div>
          </div>
          <CheckCircle2 className={`w-4 h-4 shrink-0 ${active ? "text-emerald-400" : "text-slate-700"}`} />
        </div>
      </button>
    );
  };
  return (
    <Card data-testid="gateway-toggle-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><Settings2 className="w-4 h-4 text-indigo-400" /> Varsayılan Ödeme Yöntemi</span>}
        subtitle="Yeni satın alımlarda ve plan yükseltmelerinde otomatik kullanılacak gateway"
      />
      <CardBody className="flex gap-3 flex-col sm:flex-row">
        <OptionCard id="stripe" icon="💳" label="Stripe (Kart)" desc="Anında ödeme · Otomatik lisans aktivasyonu · Global kart desteği" badge="Önerilen" />
        <OptionCard id="havale" icon="🏦" label="Havale / EFT" desc="IBAN'a transfer · Manuel onay · Türk banka müşterileri için" />
      </CardBody>
    </Card>
  );
}

function SmartPosPanel() {
  const [configProvider, setConfigProvider] = useState(null);
  const [installmentProvider, setInstallmentProvider] = useState(null);
  const [subTab, setSubTab] = useState("gateway");
  const providers = useQuery({ queryKey: ["smart-pos-providers"], queryFn: api.smartPosProviders, refetchInterval: 30000 });
  const stats = useQuery({ queryKey: ["smart-pos-stats"], queryFn: api.smartPosStats, refetchInterval: 30000 });
  const items = providers.data?.providers || [];
  const stObj = stats.data?.stats || {};
  const totalRev = stats.data?.total_revenue_30d || 0;
  const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

  const groups = {
    gateway: items.filter((p) => p.category === "gateway"),
    bank_pos: items.filter((p) => p.category === "bank_pos"),
    manual: items.filter((p) => p.category === "manual"),
  };
  const configuredCount = items.filter((p) => p.configured).length;
  const recommendedCount = items.filter((p) => p.recommended).length;
  const installmentCount = items.filter((p) => (p.supports || []).includes("installment")).length;

  const SUB_TABS = [
    { key: "gateway",  label: "Sanal POS / Ödeme Ağ Geçitleri", icon: "💳", count: groups.gateway.length, hint: "PayTR · iyzico · Param · ipara · Shopier · Moka · SiPay" },
    { key: "bank_pos", label: "Banka Sanal POS'ları",             icon: "🏛️", count: groups.bank_pos.length, hint: "Garanti · YKB · Akbank · İş · Ziraat · Halk · Vakıf · Deniz · TEB · QNB · Kuveyt · Albaraka" },
    { key: "manual",   label: "Havale · EFT · FAST",              icon: "🏦", count: groups.manual.length, hint: "Manuel banka havalesi ve otomatik ekstre eşleşme" },
    { key: "installment", label: "Taksit Oranları",               icon: "📊", count: installmentCount,     hint: "Taksit oranları ve komisyon yansıtma yönetimi" },
  ];

  const list = groups[subTab] || [];

  return (
    <div className="space-y-4">
      {/* Üst istatistik kartları */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="col-span-1 md:col-span-2 relative overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-slate-900 to-indigo-500/10 p-5">
          <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-emerald-500/10 blur-3xl"/>
          <div className="text-[10px] uppercase tracking-widest text-emerald-300 mb-1">Son 30 Gün Toplam Gelir</div>
          <div className="text-3xl md:text-4xl font-bold mono text-emerald-100">{nfmt(totalRev)} ₺</div>
          <div className="text-[11px] text-slate-400 mt-1.5">
            {items.length} sağlayıcı · {recommendedCount} öneri · {configuredCount} yapılandırıldı
          </div>
        </div>
        <SmartPosMiniStat label="Aktif POS" value={recommendedCount} total={items.length} tone="emerald" icon="✅"/>
        <SmartPosMiniStat label="Taksitli Ödeme" value={installmentCount} total={items.length} tone="indigo" icon="📊"/>
      </div>

      {/* Alt tab bar — kategori sekmeleri */}
      <div className="flex gap-1 p-1 rounded-xl bg-slate-900/60 border border-slate-800 overflow-x-auto"
           data-testid="smart-pos-subtabs">
        {SUB_TABS.map((t) => (
          <button key={t.key}
                  onClick={() => setSubTab(t.key)}
                  data-testid={`sptab-${t.key}`}
                  className={`flex-1 min-w-[180px] px-3 py-2 rounded-lg text-xs transition-all ${
                    subTab === t.key
                      ? "bg-indigo-500/20 border border-indigo-500/40 text-indigo-100 shadow-lg shadow-indigo-500/10"
                      : "border border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`}>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <span className="text-base leading-none">{t.icon}</span> {t.label}
              </span>
              <span className={`mono text-[10px] px-1.5 rounded ${
                subTab === t.key ? "bg-indigo-500/30 text-indigo-100" : "bg-slate-800 text-slate-400"
              }`}>{t.count}</span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5 truncate normal-case text-left">{t.hint}</div>
          </button>
        ))}
      </div>

      {/* Ana içerik alanı */}
      {subTab === "manual" && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-300"/>
            <div className="text-sm font-semibold text-emerald-200">
              Banka Ekstresi Yükle · Otomatik Havale Eşleştirme
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Banka ekstre metnini yapıştırın veya PDF/TXT/CSV yükleyin. Sistem TRF... referanslarını otomatik yakalar ve bekleyen havalelerle eşleştirir.
          </p>
          <StatementMatchForm/>
        </div>
      )}

      {subTab === "installment" && (
        <InstallmentOverview providers={items.filter(p => (p.supports || []).includes("installment"))}
                             onOpen={(k) => setInstallmentProvider(k)}/>
      )}

      {(subTab === "gateway" || subTab === "bank_pos" || subTab === "manual") && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((p) => (
            <ProviderCard key={p.key} p={p} st={stObj[p.key] || {}} nfmt={nfmt}
                          onConfig={() => setConfigProvider(p.key)}
                          onInstallment={() => setInstallmentProvider(p.key)}/>
          ))}
          {list.length === 0 && (
            <div className="col-span-3 text-center text-sm text-slate-500 py-10">
              Bu kategoride sağlayıcı yok
            </div>
          )}
        </div>
      )}

      {/* Modallar */}
      {configProvider && (
        <PosConfigModal
          providerKey={configProvider}
          onClose={() => setConfigProvider(null)}
          onSaved={() => { providers.refetch(); stats.refetch(); }}
        />
      )}
      {installmentProvider && (
        <InstallmentConfigModal
          providerKey={installmentProvider}
          onClose={() => setInstallmentProvider(null)}
        />
      )}

      <ModuleFooter
        title="Akıllı POS Router — Nasıl Çalışır?"
        howItWorks="Ödeme talebi geldiğinde /smart-pos/route uç noktası sırayla değerlendirir: 1) 'tercih' varsa öncelik verilir. 2) Yapılandırılmamış sağlayıcılar sona atılır. 3) Son 1 saatte başarı oranı %40 altında ise 'sağlıksız' kabul edilir. 4) Önceliği düşük olan seçilir. Yedek zincir (fallback_chain) istemciye döner."
        technical={[
          "22 sağlayıcı: 7 ağ geçidi + 14 banka VPOS + 1 manuel (havale)",
          "Ağ geçitleri: PayTR / iyzico / Param / ipara / Shopier / Moka / SiPay",
          "Banka VPOS: Garanti · YKB · Akbank · İş · Ziraat · Halk · Vakıf · Deniz · TEB · QNB · Kuveyt · Albaraka",
          "Her sağlayıcı için ilgili MERCHANT/TERMINAL bilgileri panelden veya .env'den girilir",
          "Taksit oranları ve komisyon yansıtma (vade farkı) sağlayıcı bazında düzenlenir",
        ]}
        recommendations={[
          "En az 2 ağ geçidi + 1 banka POS yapılandırın (yedekleme için)",
          "Havale'yi son yedek olarak bırakın (manuel onay gerektirir)",
          "Aylık başarı oranı %90'ın altına düşen sağlayıcıyla iletişime geçin",
          "Taksit vade farkını müşteriye yansıtın (varsayılan), veya satıcı üstlensin",
        ]}
      />
    </div>
  );
}

function SmartPosMiniStat({ label, value, total, tone, icon }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  const colors = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200",
    indigo: "border-indigo-500/30 bg-indigo-500/5 text-indigo-200",
  }[tone] || "";
  return (
    <div className={`rounded-xl border ${colors} p-4`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest opacity-80">{label}</span>
        <span className="text-lg leading-none">{icon}</span>
      </div>
      <div className="text-2xl font-bold mono">{value}<span className="text-sm text-slate-500">/{total}</span></div>
      <div className="mt-1.5 h-1 rounded bg-slate-800/60 overflow-hidden">
        <div className={`h-full ${tone === "emerald" ? "bg-emerald-400" : "bg-indigo-400"}`}
             style={{ width: `${pct}%` }}/>
      </div>
    </div>
  );
}

function ProviderCard({ p, st, nfmt, onConfig, onInstallment }) {
  const supportsInstallment = (p.supports || []).includes("installment");
  const SUPPORT_LABELS = {
    visa: "Visa", mc: "MC", troy: "Troy", amex: "Amex", bonus: "Bonus", world: "World",
    axess: "Axess", maximum: "Maximum", cardfinans: "CardFinans", paraf: "Paraf",
    "3dsecure": "3D Secure", installment: "Taksit", recurring: "Abonelik",
  };
  return (
    <div data-testid={`smart-pos-provider-${p.key}`}
         className={`group relative rounded-xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
           p.recommended
             ? "bg-gradient-to-br from-emerald-500/10 to-slate-900 border-emerald-500/40 shadow-emerald-500/5"
             : p.configured
             ? "bg-slate-900/50 border-slate-800 hover:border-indigo-500/40"
             : "bg-slate-900/20 border-slate-800/60 hover:border-slate-700"
         }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-2xl leading-none">{p.logo}</span>
          <div className="min-w-0">
            <div className="text-slate-100 font-semibold text-sm truncate flex items-center gap-1">
              {p.name}
              {p.recommended && <span className="text-emerald-400 text-[10px]">●</span>}
            </div>
            <div className="text-[9px] text-slate-500 mono uppercase">
              #{p.priority} · {p.commission}
            </div>
          </div>
        </div>
        {p.recommended ? <Badge tone="success">Aktif</Badge>
        : p.configured ? <Badge tone="info">Hazır</Badge>
        : <Badge>Test</Badge>}
      </div>

      {/* İstatistikler */}
      <div className="grid grid-cols-3 gap-2 mb-3 p-2 rounded-lg bg-slate-950/50 border border-slate-800/40">
        <div>
          <div className="text-[8px] text-slate-500 uppercase">30 Gün</div>
          <div className="mono text-slate-200 text-xs">{st.total || 0}</div>
        </div>
        <div>
          <div className="text-[8px] text-slate-500 uppercase">Başarı</div>
          <div className="mono text-emerald-300 text-xs">%{st.success_rate || 0}</div>
        </div>
        <div>
          <div className="text-[8px] text-slate-500 uppercase">Gelir</div>
          <div className="mono text-emerald-200 text-xs truncate">{nfmt(st.revenue || 0)} ₺</div>
        </div>
      </div>

      {/* Kart aileleri / destekler */}
      <div className="flex flex-wrap gap-1 mb-3 min-h-[20px]">
        {(p.supports || []).slice(0, 6).map((s) => (
          <span key={s}
                className="text-[9px] mono px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-300 border border-slate-700/40">
            {SUPPORT_LABELS[s] || s}
          </span>
        ))}
      </div>

      {/* Yapılandırma durumu */}
      {!p.configured && p.category !== "manual" && (
        <div className="text-[9px] text-amber-400/70 mb-2 pb-2 border-b border-slate-800 truncate"
             title={(p.configured_env || []).join(", ")}>
          <span className="text-amber-500">⚠</span> Yapılandırılmadı: <span className="mono">{p.configured_env?.[0]}...</span>
        </div>
      )}

      {/* Butonlar */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onConfig}
          data-testid={`pos-config-btn-${p.key}`}
          className="flex-1 text-[10px] px-2 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-200 border border-indigo-500/30 hover:bg-indigo-500/25 hover:border-indigo-500/50 inline-flex items-center justify-center gap-1 transition-all">
          <Settings2 className="w-3 h-3"/> API Anahtarları
        </button>
        {supportsInstallment && (
          <button
            onClick={onInstallment}
            data-testid={`pos-installment-btn-${p.key}`}
            className="flex-1 text-[10px] px-2 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-200 border border-emerald-500/30 hover:bg-emerald-500/25 hover:border-emerald-500/50 inline-flex items-center justify-center gap-1 transition-all">
            <Percent className="w-3 h-3"/> Taksit Oranları
          </button>
        )}
      </div>
    </div>
  );
}

function InstallmentOverview({ providers, onOpen }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Percent className="w-4 h-4 text-indigo-300"/>
          <div className="text-sm font-semibold text-indigo-200">Taksit Oranları ve Komisyon Yansıtma</div>
        </div>
        <p className="text-xs text-slate-400">
          Taksitli ödemeyi destekleyen sağlayıcılar için aylık vade farklarını ve komisyon yansıtma modunu buradan yönetin.
          Müşteri checkout ekranında gördüğü aylık tutar bu oranlara göre hesaplanır.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="installment-overview">
        {providers.map((p) => (
          <button
            key={p.key}
            onClick={() => onOpen(p.key)}
            data-testid={`installment-tile-${p.key}`}
            className="text-left rounded-xl border border-slate-800 bg-slate-900/40 p-4 hover:border-emerald-500/40 hover:bg-slate-900/60 transition-all">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl leading-none">{p.logo}</span>
              <div className="min-w-0">
                <div className="text-slate-100 font-semibold text-sm truncate">{p.name}</div>
                <div className="text-[10px] text-slate-500">Komisyon: {p.commission}</div>
              </div>
            </div>
            <div className="text-xs text-slate-400 mb-2">
              1-12 taksit desteği · vade farkı yansıtma
            </div>
            <div className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
              <Settings2 className="w-3 h-3"/> Oranları Düzenle
            </div>
          </button>
        ))}
        {providers.length === 0 && (
          <div className="col-span-3 text-center text-sm text-slate-500 py-8">
            Taksit destekleyen sağlayıcı yok
          </div>
        )}
      </div>
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
                    <span className="mono text-emerald-300 ml-auto">{o.amount} {o.currency || 'TL'}</span>
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


// ============================================================================
// InstallmentConfigModal — Taksit oranları + komisyon yansıtma editörü
// ============================================================================
function InstallmentConfigModal({ providerKey, onClose }) {
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ["installment-config", providerKey],
    queryFn: () => api.smartPosGetInstallments(providerKey),
  });
  const [enabled, setEnabled] = useState(true);
  const [maxInstallments, setMaxInstallments] = useState(12);
  const [rates, setRates] = useState({});
  const [surchargeMode, setSurchargeMode] = useState("reflect_to_customer");
  const [surchargeExtra, setSurchargeExtra] = useState(0);
  const [minAmount, setMinAmount] = useState(100);
  const [previewAmount, setPreviewAmount] = useState(1499);
  const [preview, setPreview] = useState(null);
  const [initialized, setInitialized] = useState(false);

  if (cfg.data?.config && !initialized) {
    const c = cfg.data.config;
    setEnabled(!!c.enabled);
    setMaxInstallments(c.max_installments || 12);
    setRates(c.rates || {});
    setSurchargeMode(c.surcharge_mode || "reflect_to_customer");
    setSurchargeExtra(c.surcharge_extra || 0);
    setMinAmount(c.min_amount_for_installment || 100);
    setInitialized(true);
  }

  const save = useMutation({
    mutationFn: (payload) => api.smartPosSetInstallments(providerKey, payload),
    onSuccess: (data) => {
      toast.success(data.message || "Taksit oranları kaydedildi");
      qc.invalidateQueries({ queryKey: ["installment-config", providerKey] });
      onClose();
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Kaydetme başarısız"),
  });

  const previewCalc = () => {
    const opts = [];
    for (let n = 1; n <= maxInstallments; n++) {
      const rate = parseFloat(rates[String(n)] ?? 0);
      const extra = parseFloat(surchargeExtra || 0);
      const effective = surchargeMode === "absorb" ? 0 : (rate + (n > 1 ? extra : 0));
      const total = +(previewAmount * (1 + effective / 100)).toFixed(2);
      opts.push({
        n, rate: effective.toFixed(2),
        monthly: (total / n).toFixed(2),
        total: total.toFixed(2),
        surcharge: (total - previewAmount).toFixed(2),
      });
    }
    setPreview(opts);
  };

  const setRate = (n, v) => setRates({ ...rates, [String(n)]: v });
  const submit = () => {
    const cleaned = {};
    for (let n = 1; n <= maxInstallments; n++) {
      cleaned[String(n)] = parseFloat(rates[String(n)] ?? 0) || 0;
    }
    save.mutate({
      enabled,
      max_installments: parseInt(maxInstallments) || 12,
      rates: cleaned,
      surcharge_mode: surchargeMode,
      surcharge_extra: parseFloat(surchargeExtra) || 0,
      min_amount_for_installment: parseFloat(minAmount) || 0,
    });
  };
  const d = cfg.data;
  const nfmt = (n) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2 }).format(parseFloat(n) || 0);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
         data-testid="installment-modal">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-gradient-to-r from-emerald-500/5 to-indigo-500/5">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl leading-none">{d?.logo || "📊"}</span>
            <div className="min-w-0">
              <div className="text-slate-100 font-semibold text-sm truncate">
                Taksit Oranları · {d?.name || providerKey}
              </div>
              <div className="text-[10px] text-slate-500 mono">
                {d?.supports_installment ? "Taksitli ödeme destekleniyor" : "Bu sağlayıcı taksit desteklemiyor"}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 p-1"
                  data-testid="installment-close">
            <X className="w-4 h-4"/>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 p-5">
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Genel Ayarlar</div>
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input type="checkbox" checked={enabled}
                       onChange={(e) => setEnabled(e.target.checked)}
                       data-testid="installment-enabled"/>
                Taksitli ödeme etkin
              </label>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">
                  Maksimum Taksit Sayısı
                </label>
                <input type="number" min="1" max="12" value={maxInstallments}
                       onChange={(e) => setMaxInstallments(parseInt(e.target.value) || 12)}
                       className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs mono text-slate-200 focus:border-emerald-500/50 outline-none"
                       data-testid="installment-max"/>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">
                  Taksit için Minimum Tutar (₺)
                </label>
                <input type="number" min="0" step="10" value={minAmount}
                       onChange={(e) => setMinAmount(e.target.value)}
                       className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs mono text-slate-200 focus:border-emerald-500/50 outline-none"/>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Komisyon Yansıtma</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className={`p-2 rounded border cursor-pointer transition-all ${
                  surchargeMode === "reflect_to_customer"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                    : "border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700"
                }`}>
                  <input type="radio" checked={surchargeMode === "reflect_to_customer"}
                         onChange={() => setSurchargeMode("reflect_to_customer")}
                         className="mr-1.5" data-testid="surcharge-reflect"/>
                  Müşteriye Yansıt
                  <div className="text-[9px] text-slate-500 mt-0.5">Vade farkı müşteri tarafından ödenir</div>
                </label>
                <label className={`p-2 rounded border cursor-pointer transition-all ${
                  surchargeMode === "absorb"
                    ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-100"
                    : "border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700"
                }`}>
                  <input type="radio" checked={surchargeMode === "absorb"}
                         onChange={() => setSurchargeMode("absorb")}
                         className="mr-1.5" data-testid="surcharge-absorb"/>
                  Satıcı Üstlensin
                  <div className="text-[9px] text-slate-500 mt-0.5">Fiyatlar sabit kalır (siz komisyona katlanırsınız)</div>
                </label>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">
                  Ek Komisyon Yansıtma (%) <span className="text-slate-600 normal-case">— 2+ taksitlere ek</span>
                </label>
                <input type="number" min="0" max="20" step="0.1" value={surchargeExtra}
                       onChange={(e) => setSurchargeExtra(e.target.value)}
                       className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs mono text-slate-200 focus:border-emerald-500/50 outline-none"
                       data-testid="surcharge-extra"/>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                  Aylık Vade Farkı Oranları (%)
                </div>
                <button onClick={() => {
                  const defaults = { 1: 0, 2: 1.19, 3: 1.75, 4: 2.29, 5: 2.79, 6: 3.29,
                                     7: 3.79, 8: 4.29, 9: 4.79, 10: 5.29, 11: 5.79, 12: 6.29 };
                  setRates(Object.fromEntries(Object.entries(defaults).map(([k,v]) => [k, v])));
                }}
                className="text-[10px] text-indigo-400 hover:text-indigo-300">
                  varsayılan
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {Array.from({ length: maxInstallments }, (_, i) => i + 1).map((n) => (
                  <div key={n} className="flex items-center gap-1.5">
                    <span className="text-[10px] mono text-slate-500 w-6 shrink-0">{n}x</span>
                    <input type="number" step="0.01" min="0"
                           value={rates[String(n)] ?? ""}
                           onChange={(e) => setRate(n, e.target.value)}
                           placeholder="0.00"
                           className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[11px] mono text-slate-200 focus:border-emerald-500/50 outline-none"
                           data-testid={`rate-${n}`}/>
                    <span className="text-[10px] text-slate-500 w-3">%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold mb-2">
                Canlı Ödeme Simülatörü
              </div>
              <div className="flex items-center gap-2 mb-3">
                <label className="text-[10px] uppercase tracking-widest text-slate-500">Tutar</label>
                <input type="number" min="1" step="10" value={previewAmount}
                       onChange={(e) => setPreviewAmount(parseFloat(e.target.value) || 0)}
                       className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs mono text-slate-200 focus:border-emerald-500/50 outline-none"
                       data-testid="preview-amount"/>
                <span className="text-slate-400 text-xs">₺</span>
                <button onClick={previewCalc}
                        className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 inline-flex items-center gap-1"
                        data-testid="preview-calc-btn">
                  <Wand2 className="w-3 h-3"/> Hesapla
                </button>
              </div>
              {preview ? (
                <div className="rounded overflow-hidden border border-slate-800">
                  <table className="w-full text-[11px]" data-testid="preview-table">
                    <thead className="bg-slate-950">
                      <tr className="text-left text-slate-500">
                        <th className="px-2 py-1.5">Taksit</th>
                        <th className="px-2 py-1.5">Oran</th>
                        <th className="px-2 py-1.5 text-right">Aylık</th>
                        <th className="px-2 py-1.5 text-right">Toplam</th>
                        <th className="px-2 py-1.5 text-right">Fark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r) => (
                        <tr key={r.n} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                          <td className="px-2 py-1 mono text-slate-200">{r.n}x</td>
                          <td className="px-2 py-1 mono text-slate-400">%{r.rate}</td>
                          <td className="px-2 py-1 mono text-right text-slate-200">{nfmt(r.monthly)} ₺</td>
                          <td className="px-2 py-1 mono text-right text-emerald-300">{nfmt(r.total)} ₺</td>
                          <td className={`px-2 py-1 mono text-right ${
                            parseFloat(r.surcharge) > 0 ? "text-amber-300" : "text-slate-500"
                          }`}>
                            {parseFloat(r.surcharge) > 0 ? `+${nfmt(r.surcharge)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center text-[11px] text-slate-500 py-6 border border-dashed border-slate-800 rounded">
                  Hesapla butonuna basın · müşterinin göreceği taksit tablosu burada oluşur
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-[11px] text-slate-400 space-y-1.5">
              <div className="font-semibold text-slate-300 mb-1">Kart Aile Limitleri</div>
              {Object.entries(d?.card_family_caps || {}).map(([fam, cap]) => (
                <div key={fam} className="flex items-center justify-between">
                  <span className="capitalize">{fam}</span>
                  <span className="mono">{cap} taksit</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-800 bg-slate-950/50">
          <div className="text-[10px] text-slate-500">
            {surchargeMode === "reflect_to_customer"
              ? "💡 Müşteri taksit farkını görecek"
              : "💡 Fiyatlar sabit, komisyonu siz üstleneceksiniz"}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose}
                    className="text-xs px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                    data-testid="installment-cancel">
              İptal
            </button>
            <button onClick={submit} disabled={save.isPending}
                    className="text-xs px-4 py-1.5 rounded bg-emerald-500/20 text-emerald-100 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40 inline-flex items-center gap-1.5"
                    data-testid="installment-save">
              <CheckCircle2 className="w-3 h-3"/> {save.isPending ? "Kaydediliyor..." : "Oranları Kaydet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

