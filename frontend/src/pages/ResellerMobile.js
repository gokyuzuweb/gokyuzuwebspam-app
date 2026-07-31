import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  ShieldAlert, Bell, Inbox, LogOut, ChevronRight, Clock,
  AlertTriangle, Bug, ShieldCheck, RefreshCw, Menu,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

const TOKEN_KEY = "gws_reseller_token";

/**
 * Reseller mobile — a phone-optimised view of quarantine + alerts + verdict summary.
 * Accessible via /reseller?mobile=1 or automatically when viewport < 640px.
 */
export default function ResellerMobile({ token: propToken, brand }) {
  const nav = useNavigate();
  const token = propToken || (typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : "");
  const [tab, setTab] = useState("inbox"); // inbox | alerts | account
  const qc = useQueryClient();

  const me = useQuery({ queryKey: ["reseller-me"], queryFn: () => api.resellerMe(token), enabled: !!token, retry: false });
  const q  = useQuery({ queryKey: ["reseller-quarantine"], queryFn: () => api.resellerQuarantine(token), enabled: !!token, refetchInterval: 20000 });
  const alertsRecent = useQuery({
    queryKey: ["reseller-alerts", me.data?.reseller?.license_key],
    queryFn: () => api.alertsRecent(me.data.reseller.license_key, 20),
    enabled: !!me.data?.reseller?.license_key,
    refetchInterval: 15000,
  });

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    nav("/reseller");
  };

  if (!token) { nav("/reseller"); return null; }
  if (me.isLoading) return <FullScreenLoading />;

  const reseller = me.data?.reseller || {};
  const items = q.data || [];
  const alerts = alertsRecent.data?.items || [];

  const primary = brand?.primary_color || "#6366f1";
  const accent  = brand?.accent_color  || "#10b981";
  const name    = brand?.brand_name    || "GökyüzüWebSpam";
  const logo    = brand?.logo_url;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-20"
         data-testid="reseller-mobile"
         style={{ "--primary": primary, "--accent": accent }}>
      {/* App-style top bar */}
      <header
        className="sticky top-0 z-30 backdrop-blur-md bg-slate-950/80 border-b"
        style={{ borderColor: `${primary}40` }}
      >
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center shrink-0"
                 style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
              {logo
                ? <img src={logo} alt="" className="w-full h-full object-contain p-1"
                       onError={(e) => { e.currentTarget.style.display = "none"; }} />
                : <ShieldAlert className="w-5 h-5 text-white" />}
            </div>
            <div className="leading-tight min-w-0">
              <div className="font-bold text-slate-100 text-[15px] truncate">{name}</div>
              <div className="text-[10px] uppercase tracking-widest mono truncate" style={{ color: accent }}>
                Mobil Bayi Paneli
              </div>
            </div>
          </div>
          <button onClick={logout}
                  data-testid="mobile-logout"
                  className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Sticky summary strip */}
      <div className="px-4 py-3 grid grid-cols-3 gap-2 text-center border-b border-slate-800/50 bg-slate-900/30">
        <SummaryPill Icon={Inbox}     label="Karantina" value={items.length} color="#f59e0b" />
        <SummaryPill Icon={Bell}      label="Alarm"     value={alerts.length} color="#ef4444" />
        <SummaryPill Icon={ShieldCheck} label="Kota"    value={`${me.data?.quota?.current || 0}/${me.data?.quota?.max_subaccounts || 0}`} color="#10b981" />
      </div>

      {/* Tab content */}
      <main className="p-4">
        {tab === "inbox" && (
          <InboxList items={items} loading={q.isLoading} onRefresh={() => qc.invalidateQueries({ queryKey: ["reseller-quarantine"] })} />
        )}
        {tab === "alerts" && (
          <AlertsList items={alerts} loading={alertsRecent.isLoading} />
        )}
        {tab === "account" && (
          <AccountCard reseller={reseller} onLogout={logout} />
        )}
      </main>

      {/* Bottom tab bar — iOS/Android app aesthetic */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-800 bg-slate-950/95 backdrop-blur-md">
        <div className="grid grid-cols-3 h-16 max-w-md mx-auto">
          {[
            { key: "inbox",   Icon: Inbox, label: "Karantina", badge: items.length },
            { key: "alerts",  Icon: Bell,  label: "Alarm",     badge: alerts.length },
            { key: "account", Icon: Menu,  label: "Hesap",     badge: 0 },
          ].map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                data-testid={`mobile-tab-${t.key}`}
                className={`relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition ${
                  active ? "" : "text-slate-500 hover:text-slate-300"
                }`}
                style={{ color: active ? primary : undefined }}
              >
                <t.Icon className="w-5 h-5" strokeWidth={active ? 2.2 : 1.6} />
                <span>{t.label}</span>
                {t.badge > 0 && (
                  <span className="absolute top-1.5 right-6 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
                        style={{ background: accent }}>
                    {t.badge > 99 ? "99+" : t.badge}
                  </span>
                )}
                {active && (
                  <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                        style={{ background: primary }} />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function FullScreenLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <RefreshCw className="w-6 h-6 text-slate-500 animate-spin" />
    </div>
  );
}

function SummaryPill({ Icon, label, value, color }) {
  return (
    <div className="rounded-lg py-2 flex flex-col items-center gap-0.5" style={{ background: `${color}12`, border: `1px solid ${color}30` }}>
      <Icon className="w-3.5 h-3.5" style={{ color }} />
      <div className="mono font-bold text-slate-100 text-sm">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-slate-400">{label}</div>
    </div>
  );
}

function InboxList({ items, loading, onRefresh }) {
  if (loading) return <FullScreenLoading />;
  if (items.length === 0) {
    return (
      <div className="mt-16 text-center text-slate-500 text-sm">
        <Inbox className="w-10 h-10 mx-auto mb-3 text-slate-700" />
        Karantinada mail yok · alt hesaplarınıza spam ulaşmamış
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="mobile-inbox-list">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{items.length} kayıt</span>
        <button onClick={onRefresh} className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> yenile
        </button>
      </div>
      {items.map((r) => (
        <div key={r.id}
             className="p-3 rounded-lg border border-slate-800 bg-slate-900/40 flex gap-3 active:bg-slate-800/60 transition"
             data-testid={`mobile-inbox-row-${r.id}`}>
          <div className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center ${
            r.score >= 10 ? "bg-rose-500/15 text-rose-400" : "bg-amber-500/15 text-amber-400"
          }`}>
            {r.score >= 10 ? <Bug className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-200 font-medium truncate">{r.subject || "(konu yok)"}</div>
            <div className="text-[11px] mono text-slate-500 truncate">
              {r.sender} → {r.recipient}
            </div>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
              <Clock className="w-2.5 h-2.5" />
              <span>{new Date(r.received_at).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <span className={`mono font-semibold ml-auto ${r.score >= 10 ? "text-rose-400" : "text-amber-400"}`}>
                {r.score?.toFixed?.(1) ?? r.score}
              </span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-600 shrink-0 self-center" />
        </div>
      ))}
    </div>
  );
}

function AlertsList({ items, loading }) {
  if (loading) return <FullScreenLoading />;
  if (items.length === 0) {
    return (
      <div className="mt-16 text-center text-slate-500 text-sm">
        <Bell className="w-10 h-10 mx-auto mb-3 text-slate-700" />
        Şu an alarm yok · her şey normal ✓
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="mobile-alerts-list">
      {items.map((a) => (
        <div key={a.id} className="p-3 rounded-lg border border-slate-800 bg-slate-900/40">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full ${a.webhook_status === "ok" ? "bg-emerald-400" : "bg-amber-400"}`}></span>
            <div className="text-sm font-medium text-slate-200 flex-1 truncate">{a.rule_name}</div>
            <span className="text-[10px] mono text-slate-500">
              {new Date(a.fired_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <div className="text-[11px] text-slate-400">{a.reason}</div>
          {a.sample_event && (
            <div className="mt-1 text-[10px] mono text-slate-500 truncate">
              {a.sample_event.from_addr} → {a.sample_event.verdict}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AccountCard({ reseller, onLogout }) {
  const fields = [
    ["E-posta",  reseller.email],
    ["Firma",    reseller.company],
    ["Plan",     (reseller.plan || "").toUpperCase()],
    ["Lisans",   (reseller.license_key || "").slice(0, 20) + "…"],
    ["Bitiş",    reseller.valid_until ? reseller.valid_until.slice(0, 10) : "-"],
  ];
  return (
    <div className="space-y-2" data-testid="mobile-account">
      <div className="p-4 rounded-lg border border-slate-800 bg-slate-900/40 space-y-2">
        {fields.map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-slate-500 text-xs uppercase tracking-widest">{k}</span>
            <span className="text-slate-200 mono truncate max-w-[60%] text-right">{v || "-"}</span>
          </div>
        ))}
      </div>
      <Link to="/reseller"
            className="block text-center text-sm text-indigo-400 hover:text-indigo-300 py-2 rounded border border-slate-800">
        Masaüstü panele geç →
      </Link>
      <button onClick={onLogout}
              data-testid="mobile-account-logout"
              className="w-full text-sm text-rose-400 hover:text-rose-300 py-2 rounded border border-rose-500/30 bg-rose-500/5 inline-flex items-center justify-center gap-1.5">
        <LogOut className="w-3.5 h-3.5" /> Çıkış Yap
      </button>
    </div>
  );
}
