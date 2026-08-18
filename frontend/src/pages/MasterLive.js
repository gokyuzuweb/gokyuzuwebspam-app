import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity, Users2, ShieldAlert, Search, RefreshCw, ArrowRight,
  Circle, TrendingUp, ChevronRight, Zap, Loader2, LayoutDashboard, List, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge, StatCard } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const LICKEY = () =>
  (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) ||
  "";

const fmtDT = (iso) =>
  iso ? new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const PERIOD_OPTS = [
  { v: 1, label: "1 sa" },
  { v: 6, label: "6 sa" },
  { v: 24, label: "24 sa" },
  { v: 72, label: "3 gün" },
  { v: 168, label: "7 gün" },
];

const PLAN_TONE = {
  starter: "bg-slate-800/70 text-slate-300 border-slate-700",
  pro: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  enterprise: "bg-fuchsia-500/10 text-fuchsia-200 border-fuchsia-500/30",
};

export default function MasterLive() {
  const [hours, setHours] = useState(24);
  const [q, setQ] = useState("");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [pingWatchList, setPingWatchList] = useState(null); // ping sonrası izlenen license'lar
  const [tab, setTab] = useState(() => localStorage.getItem("gws.ml.tab") || "all");
  const chooseTab = (id) => { setTab(id); try { localStorage.setItem("gws.ml.tab", id); } catch {} };
  const qc = useQueryClient();

  const live = useQuery({
    queryKey: ["master-live", hours],
    queryFn: () => api.adminResellersLive(LICKEY(), hours),
    // Ping izleme modunda 5sn'de bir yenile ki yeşile dönenler otomatik çıksın
    refetchInterval: pingWatchList ? 5000 : 15000,
    retry: false,
  });

  const pingRed = useMutation({
    mutationFn: () => api.adminBayiHealthPingRed(LICKEY()),
    onSuccess: (d) => {
      toast.success(`🔔 ${d.pinged} kırmızı bayiye canlan pingi yollandı`, {
        description: "Yeşile dönenler listeden otomatik çıkar (60sn)",
      });
      // Ping edilen listeyi watch'a al — 60sn sonra otomatik temizlensin
      setPingWatchList(new Set((d.licenses || []).map((r) => r.license_key)));
      setTimeout(() => setPingWatchList(null), 60000);
      qc.invalidateQueries({ queryKey: ["master-live"] });
    },
    onError: (e) => toast.error("Ping başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  const rows = live.data?.resellers || [];
  const redCount = rows.filter((r) => r.health === "red").length;
  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.mails += r.counters.mails;
        acc.spam += r.counters.spam;
        acc.virus += r.counters.virus;
        acc.phish += r.counters.phish;
        acc.blocks += r.counters.blocks;
        acc.violations += r.violations_period || 0;
        return acc;
      },
      { mails: 0, spam: 0, virus: 0, phish: 0, blocks: 0, violations: 0 }
    );
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (onlineOnly && !r.online) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (r.email || "").toLowerCase().includes(s)
        || (r.company || "").toLowerCase().includes(s)
        || (r.license_key || "").toLowerCase().includes(s);
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            Master · Canlı Bayi Trafiği
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Tüm bayilerin son <b className="text-slate-300">{hours}s</b> mail trafiği · 15sn otomatik yenileme
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-800/50 rounded-md p-1 gap-0.5">
            {PERIOD_OPTS.map((o) => (
              <button
                key={o.v}
                data-testid={`ml-period-${o.v}`}
                onClick={() => setHours(o.v)}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${
                  hours === o.v ? "bg-indigo-500/25 text-indigo-200" : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            data-testid="ml-refresh"
            onClick={() => live.refetch()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            <RefreshCw className={`w-3 h-3 ${live.isFetching ? "animate-spin" : ""}`} /> Yenile
          </button>
          {/* Kırmızıları toplu canlan pingle — 30dk+ heartbeat yok olan tüm bayilere sinyal */}
          {redCount > 0 && (
            <button
              data-testid="ml-ping-red"
              onClick={() => {
                if (confirm(`${redCount} kırmızı bayiye canlan pingi göndermek istediğinize emin misiniz?`)) {
                  pingRed.mutate();
                }
              }}
              disabled={pingRed.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-rose-500 to-orange-500 text-white shadow-lg shadow-rose-500/20 border border-rose-400/40 hover:brightness-110 disabled:opacity-60"
            >
              {pingRed.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Zap className="w-3.5 h-3.5"/>}
              🔔 {redCount} Kırmızıyı Pingle
            </button>
          )}
        </div>
      </div>

      {/* v43.95 — Tab Bar (Genel Bakış / Tüm Bayiler / Kırmızı Durum) */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3 sticky top-14 bg-slate-950/80 backdrop-blur z-10" data-testid="ml-tabs">
        {[
          { k: "overview", l: "Genel Bakış", Icon: LayoutDashboard, tone: "indigo"  },
          { k: "all",      l: `Tüm Bayiler (${rows.length})`, Icon: List, tone: "emerald" },
          { k: "red",      l: `Kırmızı Durum${redCount ? ` · ${redCount}` : ""}`, Icon: AlertTriangle, tone: "rose" },
        ].map(({ k, l, Icon, tone }) => {
          const tones = {
            indigo:  "border-indigo-500/50 bg-indigo-500/15 text-indigo-200",
            emerald: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
            rose:    "border-rose-500/50 bg-rose-500/15 text-rose-200",
          };
          const active = tab === k;
          return (
            <button key={k} type="button" onClick={() => chooseTab(k)}
              data-testid={`ml-tab-${k}`}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-all ${
                active ? tones[tone] + " shadow-md" : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}>
              <Icon className="w-4 h-4" />
              {l}
            </button>
          );
        })}
      </div>

      {/* Ping watch banner — hangi bayiler izleniyor */}
      {pingWatchList && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 flex items-center gap-2 text-xs text-emerald-100" data-testid="ml-ping-watch">
          <Activity className="w-4 h-4 text-emerald-300 animate-pulse"/>
          <div className="flex-1">
            <b className="text-emerald-200">İzleniyor:</b> {pingWatchList.size} bayi pingle edildi.
            Yeşile dönenler otomatik listeden çıkar — 60sn sonra izleme durur.
          </div>
          <button onClick={() => setPingWatchList(null)} className="text-emerald-300 hover:text-emerald-100 text-[11px]">
            İzlemeyi durdur
          </button>
        </div>
      )}

      {/* Aggregate stats — always visible on overview */}
      {tab === "overview" && (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Bayi" value={rows.length} icon={Users2} testid="ml-stat-resellers" />
        <StatCard label="Çevrim İçi" value={live.data?.online_count || 0} icon={Circle} tone="emerald" testid="ml-stat-online" />
        <StatCard label="Toplam Mail" value={totals.mails.toLocaleString("tr-TR")} icon={TrendingUp} testid="ml-stat-mails" />
        <StatCard label="Spam" value={totals.spam.toLocaleString("tr-TR")} icon={ShieldAlert} tone="rose" testid="ml-stat-spam" />
        <StatCard label="Virüs" value={totals.virus.toLocaleString("tr-TR")} icon={ShieldAlert} tone="rose" testid="ml-stat-virus" />
        <StatCard label="İhlal" value={totals.violations.toLocaleString("tr-TR")} icon={ShieldAlert} tone="amber" testid="ml-stat-violations" />
      </div>
      )}

      {/* Overview quick-red-preview */}
      {tab === "overview" && redCount > 0 && (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-400"/> {redCount} bayi kırmızı — hızlı bakış</span>}
            subtitle="Detay için 'Kırmızı Durum' sekmesine geçin"
          />
          <CardBody className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {rows.filter(r => r.health === "red").slice(0, 6).map(r => (
              <ResellerCard key={r.id} r={r} hours={hours} />
            ))}
          </CardBody>
        </Card>
      )}

      {/* Filters — visible on all/red */}
      {(tab === "all" || tab === "red") && (
      <Card>
        <CardBody className="flex flex-wrap items-center gap-3 py-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              data-testid="ml-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="E-posta, şirket veya lisans anahtarında ara…"
              className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
            <input
              data-testid="ml-online-only"
              type="checkbox"
              checked={onlineOnly}
              onChange={(e) => setOnlineOnly(e.target.checked)}
              className="accent-indigo-500"
            />
            Sadece çevrim içi
          </label>
          <span className="text-[11px] text-slate-500 mono">
            {filtered.length}/{rows.length} bayi görüntüleniyor
          </span>
        </CardBody>
      </Card>
      )}

      {/* Side-by-side cards — filtered by tab */}
      {(tab === "all" || tab === "red") && (
      <>{live.isLoading ? (
        <div className="text-center py-16 text-slate-500 text-sm">Yükleniyor…</div>
      ) : (() => {
        const tabFiltered = tab === "red" ? filtered.filter(r => r.health === "red") : filtered;
        if (tabFiltered.length === 0) {
          return (
            <Card>
              <CardBody className="py-16 text-center text-slate-500">
                {tab === "red" ? "🟢 Tüm bayiler yeşil — kırmızı durumdaki bayi yok." : (rows.length === 0 ? "Henüz kayıtlı bayi yok" : "Filtreye uyan bayi bulunamadı")}
              </CardBody>
            </Card>
          );
        }
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {tabFiltered.map((r) => (
              <ResellerCard key={r.id} r={r} hours={hours} />
            ))}
          </div>
        );
      })()}</>
      )}
    </div>
  );
}

function ResellerCard({ r, hours }) {
  const c = r.counters || {};
  const total = c.mails || 0;
  const bad = c.spam + c.virus + c.phish;
  const badPct = total ? Math.min(100, Math.round((bad / total) * 100)) : 0;
  const qc = useQueryClient();
  const isRed = r.health === "red";
  const isYellow = r.health === "yellow";
  const pingSingle = useMutation({
    mutationFn: () => api.adminBayiHealthPingSingle(r.license_key, LICKEY()),
    onSuccess: (d) => {
      toast.success(`🔔 ${d.customer_name} pinglendi`, {
        description: "Bir sonraki heartbeat'te yeşile dönmesi bekleniyor",
      });
      qc.invalidateQueries({ queryKey: ["master-live"] });
      qc.invalidateQueries({ queryKey: ["wake-history"] });
    },
    onError: (e) => toast.error("Ping başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  return (
    <Link
      to={`/panel/resellers-admin?rid=${encodeURIComponent(r.id)}`}
      data-testid={`ml-card-${r.id}`}
      className="block rounded-lg border border-slate-800 bg-slate-950/40 hover:border-indigo-500/40 hover:bg-slate-900 transition-all group"
    >
      <div className="p-4 space-y-3">
        {/* header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm text-slate-200 truncate font-medium">
              <HealthDot health={r.health} />
              <span className="truncate">{r.company || r.email}</span>
            </div>
            <div className="text-[11px] text-slate-500 mono truncate mt-0.5">{r.email}</div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${PLAN_TONE[r.plan] || PLAN_TONE.starter}`}>
              {r.plan || "starter"}
            </span>
            {!r.active && <Badge tone="danger">PASİF</Badge>}
            {(isRed || isYellow) && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  pingSingle.mutate();
                }}
                disabled={pingSingle.isPending}
                data-testid={`ml-ping-single-${r.id}`}
                title="Canlan pingi yolla"
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                  isRed
                    ? "bg-rose-500/15 text-rose-200 border-rose-400/40 hover:bg-rose-500/25"
                    : "bg-amber-500/15 text-amber-200 border-amber-400/40 hover:bg-amber-500/25"
                } disabled:opacity-50`}
              >
                {pingSingle.isPending ? "..." : "🔔 PİNG"}
              </button>
            )}
          </div>
        </div>

        {/* main counter */}
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-slate-100 tabular-nums">
            {total.toLocaleString("tr-TR")}
          </span>
          <span className="text-[11px] text-slate-500 uppercase tracking-widest">mail / {hours}s</span>
        </div>

        {/* breakdown pills */}
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          {c.clean > 0 && (
            <span className="mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              {c.clean} temiz
            </span>
          )}
          {c.spam > 0 && (
            <span className="mono px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">
              {c.spam} spam
            </span>
          )}
          {c.virus > 0 && (
            <span className="mono px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-200 border border-rose-500/30">
              {c.virus} virüs
            </span>
          )}
          {c.phish > 0 && (
            <span className="mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
              {c.phish} phishing
            </span>
          )}
          {c.blocks > 0 && (
            <span className="mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
              {c.blocks} blok
            </span>
          )}
          {r.violations_period > 0 && (
            <span className="mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-500/30">
              ⚠ {r.violations_period} ihlal
            </span>
          )}
        </div>

        {/* threat ratio bar */}
        <div>
          <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
            <span>Tehdit oranı</span>
            <span className="mono">%{r.spam_ratio_pct}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
            <div
              className={`h-full transition-all ${
                badPct >= 40 ? "bg-rose-500" : badPct >= 15 ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.max(2, badPct)}%` }}
            />
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <span className="text-[10px] text-slate-500">
            Son görülme: <span className="mono text-slate-400">{fmtDT(r.last_seen_at)}</span>
          </span>
          <span className="text-[11px] text-indigo-400 group-hover:text-indigo-300 inline-flex items-center gap-1">
            Detay <ChevronRight className="w-3 h-3" />
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * HealthDot — bayi bağlantı durumu göstergesi:
 *   green  → son 5dk içinde heartbeat (aktif ping)
 *   yellow → 5-30dk (yavaşlamış)
 *   red    → 30dk+ veya hiç (kopuk)
 */
function HealthDot({ health }) {
  const map = {
    green:  { cls: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]", anim: "animate-pulse", title: "Aktif · <5dk" },
    yellow: { cls: "bg-amber-400  shadow-[0_0_8px_rgba(251,191,36,0.7)]", anim: "", title: "Yavaşlamış · 5-30dk" },
    red:    { cls: "bg-rose-500   shadow-[0_0_8px_rgba(244,63,94,0.7)]",  anim: "", title: "Bağlantı kopuk · 30dk+" },
  };
  const t = map[health] || map.red;
  return (
    <span
      data-testid={`ml-health-${health}`}
      title={t.title}
      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${t.cls} ${t.anim}`}
    />
  );
}
