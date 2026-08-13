import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight, MailWarning, Ban, ClipboardList, Users, AlertTriangle,
  Search, RotateCcw, Trash2, ShieldOff, ShieldCheck, X, Download, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge, StatCard } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import SavedFiltersBar from "@/components/SavedFiltersBar";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);
const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
// Exim null-sender ("<>") bounce/DSN mesajlarını okunabilir etikete çevir.
// Bkz. RFC 5321 §4.5.5 — mail server bounce mesajları boş envelope sender ile döner.
const displaySender = (from_addr) => {
  const s = (from_addr || "").trim();
  if (!s || s === "<>" || s === "<>" || s === "<>" || s.toLowerCase() === "mailer-daemon" || /^mailer-daemon@/i.test(s)) {
    return { label: "MAILER-DAEMON (bounce)", isBounce: true, raw: s };
  }
  return { label: s, isBounce: false, raw: s };
};
const useDebounced = (val, ms = 300) => {
  const [v, setV] = useState(val);
  useEffect(() => { const t = setTimeout(() => setV(val), ms); return () => clearTimeout(t); }, [val, ms]);
  return v;
};

const verdictTone = (v) => {
  const x = (v || "").toLowerCase();
  if (x === "clean") return { tone: "success", label: "TEMİZ" };
  if (x === "spam") return { tone: "warning", label: "SPAM" };
  if (x === "high_spam") return { tone: "danger", label: "AŞIRI SPAM" };
  if (x === "virus") return { tone: "danger", label: "VİRÜS" };
  if (x === "blocked" || x === "block") return { tone: "danger", label: "BLOKLANDI" };
  if (x === "whitelisted") return { tone: "success", label: "GÜVENİLİR" };
  return { tone: "info", label: (v || "?").toUpperCase() };
};

export default function Outbound() {
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [toSearch, setToSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [ipSearch, setIpSearch] = useState("");
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [hoursFilter, setHoursFilter] = useState("");
  const [verdict, setVerdict] = useState("all");
  const [limit, setLimit] = useState(200);
  const [advOpen, setAdvOpen] = useState(false);
  const [throttleModalOpen, setThrottleModalOpen] = useState(false);
  const [throttleUser, setThrottleUser] = useState("");
  // v43.4 Mail içeriği okuma modal state
  const [contentEventId, setContentEventId] = useState(null);
  const contentQuery = useQuery({
    queryKey: ["outbound-content", contentEventId],
    queryFn: () => api.outboundEventContent(contentEventId, { license_key: LICKEY() }),
    enabled: !!contentEventId,
  });

  // v43.5 WebSocket canlı outbound feed — yeni event ve bulk alert için toast + live counter
  const [liveCount, setLiveCount] = useState(0);
  useEffect(() => {
    const backend = process.env.REACT_APP_BACKEND_URL || "";
    const wsUrl = backend.replace(/^http/, "ws") + "/api/maintenance/ws/outbound";
    let ws;
    let reconnectTimer;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "bulk_alert") {
              toast.warning(`⚠️ Toplu Mail Uyarısı`, {
                description: `${msg.from_user} son 1 saatte ${msg.sent_count} mail atmış (limit: ${msg.limit}). Otomatik throttle uygulandı.`,
                duration: 12000,
              });
              qc.invalidateQueries({ queryKey: ["outbound-bulk-alerts"] });
              qc.invalidateQueries({ queryKey: ["outbound-throttles"] });
              qc.invalidateQueries({ queryKey: ["outbound-stats"] });
            } else if (msg.type === "event") {
              setLiveCount((c) => c + 1);
              // İlk ekran yenilenene kadar yeni event canlı sayaçta görünsün
              if (liveCount === 0) {
                qc.invalidateQueries({ queryKey: ["outbound-events"] });
              }
            }
            // "ping" mesajları görmezden gel
          } catch (_) {}
        };
        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => { try { ws.close(); } catch (_) {} };
      } catch (_) {}
    };
    connect();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) try { ws.close(); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dSearch = useDebounced(search);
  const dTo = useDebounced(toSearch);
  const dSubj = useDebounced(subjectSearch);
  const dIp = useDebounced(ipSearch);
  const dMinS = useDebounced(minScore);
  const dMaxS = useDebounced(maxScore);
  const dHours = useDebounced(hoursFilter);

  const eventsQuery = useQuery({
    queryKey: ["outbound-events", { dSearch, dTo, dSubj, dIp, dMinS, dMaxS, dHours, verdict, limit }],
    queryFn: () => api.outboundEvents({
      limit,
      search: dSearch || undefined,
      to_search: dTo || undefined,
      subject_search: dSubj || undefined,
      ip_search: dIp || undefined,
      min_score: dMinS ? Number(dMinS) : undefined,
      max_score: dMaxS ? Number(dMaxS) : undefined,
      hours: dHours ? Number(dHours) : undefined,
      verdict: verdict !== "all" ? verdict : undefined,
    }),
    refetchInterval: 20000,
  });

  const statsQuery = useQuery({ queryKey: ["outbound-stats"], queryFn: () => api.outboundStats(), refetchInterval: 20000 });
  const bulkAlertsQuery = useQuery({ queryKey: ["outbound-bulk-alerts"], queryFn: () => api.outboundBulkAlerts(), refetchInterval: 30000 });
  const throttlesQuery = useQuery({ queryKey: ["outbound-throttles"], queryFn: () => api.outboundThrottles(), refetchInterval: 30000 });

  const s = statsQuery.data || { top_users: [], today_total: 0, today_spam: 0, today_blocked: 0, throttled_users: 0, limit_per_hour: 200 };
  const bulk = bulkAlertsQuery.data?.items || [];
  const throttles = throttlesQuery.data?.items || [];
  const events = eventsQuery.data?.items || [];

  const LICKEY = () => (typeof window !== "undefined"
    ? (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license") || "")
    : "");

  const actionMut = useMutation({
    mutationFn: ({ id, action }) => api.outboundEventAction(id, { action, license_key: LICKEY() }),
    onSuccess: (_, vars) => {
      const labels = { delete: "silindi", quarantine: "karantinaya alındı", whitelist_sender: "gönderen whitelist'e eklendi", throttle_sender: "gönderen throttle edildi" };
      toast.success(`Mail ${labels[vars.action] || "işlendi"}`);
      qc.invalidateQueries({ queryKey: ["outbound-events"] });
      qc.invalidateQueries({ queryKey: ["outbound-stats"] });
      qc.invalidateQueries({ queryKey: ["outbound-throttles"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "İşlem başarısız"),
  });

  const throttleMut = useMutation({
    mutationFn: (u) => api.outboundThrottleAdd({ from_user: u, license_key: LICKEY(), reason: "manual_ui" }),
    onSuccess: () => {
      toast.success("Kullanıcı throttle edildi");
      qc.invalidateQueries({ queryKey: ["outbound-throttles"] });
      qc.invalidateQueries({ queryKey: ["outbound-stats"] });
      setThrottleModalOpen(false); setThrottleUser("");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Throttle uygulanamadı"),
  });

  const unthrottleMut = useMutation({
    mutationFn: (u) => api.outboundThrottleRemove({ from_user: u, license_key: LICKEY() }),
    onSuccess: () => {
      toast.success("Throttle kaldırıldı");
      qc.invalidateQueries({ queryKey: ["outbound-throttles"] });
      qc.invalidateQueries({ queryKey: ["outbound-stats"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kaldırılamadı"),
  });

  const resetFilters = () => {
    setSearch(""); setToSearch(""); setSubjectSearch(""); setIpSearch("");
    setMinScore(""); setMaxScore(""); setHoursFilter(""); setVerdict("all");
  };

  const exportCSV = () => {
    if (!events.length) return toast.info("Dışa aktarılacak veri yok");
    const rows = [["Zaman", "Gönderen", "Alıcı", "Konu", "Skor", "Verdict", "IP"]];
    events.forEach(e => rows.push([
      e.ts || "", e.from_addr || "", e.to_addr || "", (e.subject || "").replace(/,/g, ";"),
      e.total_score ?? 0, e.verdict || "", e.sender_ip || e.client_ip || "",
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `outbound_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-4" data-testid="outbound-page">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Bugün Giden" value={nfmt(s.today_total)} icon={ArrowUpRight} tone="brand" testid="ob-today-total" />
        <StatCard label="Spam Giden" value={nfmt(s.today_spam)} icon={MailWarning} tone="warning" testid="ob-today-spam" />
        <StatCard label="Bloklanan" value={nfmt(s.today_blocked)} icon={Ban} tone="danger" testid="ob-today-blocked" />
        <StatCard label="Throttled User" value={nfmt(s.throttled_users)} icon={Users} tone="danger" testid="ob-throttled-users" />
        <StatCard label="Saatlik Limit" value={nfmt(s.limit_per_hour)} icon={ClipboardList} tone="info" testid="ob-limit" />
      </div>

      {bulk.length > 0 && (
        <Card data-testid="ob-bulk-banner">
          <div className="p-3 border-l-4 border-amber-500 bg-amber-500/5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-amber-300">
                {bulk.length} adet toplu giden mail uyarısı (son 24 saat)
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {bulk.slice(0, 6).map((a) => (
                  <span key={a.id} data-testid={`ob-bulk-${a.id}`}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-xs">
                    <span className="mono text-amber-200">{a.from_user}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-rose-300 mono">{a.sent_count}/{a.limit}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardBody className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-500" />
            <input data-testid="ob-search" value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Kullanıcı ara..."
                   className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
          </div>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value)} data-testid="ob-verdict"
                  className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200">
            <option value="all">Tüm Verdict</option>
            <option value="clean">Temiz</option>
            <option value="spam">Spam</option>
            <option value="high_spam">Aşırı Spam</option>
            <option value="virus">Virüs</option>
            <option value="blocked">Bloklu</option>
          </select>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200">
            {[100, 200, 500, 1000, 5000].map(n => <option key={n} value={n}>{n} kayıt</option>)}
          </select>
          <button onClick={() => setAdvOpen(v => !v)} data-testid="ob-adv-toggle"
                  className="text-xs text-indigo-300 hover:text-indigo-200 underline">
            {advOpen ? "Gelişmiş −" : "Gelişmiş +"}
          </button>
          <button onClick={resetFilters} data-testid="ob-reset"
                  className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> Sıfırla
          </button>
          <button onClick={exportCSV} data-testid="ob-export-csv"
                  className="ml-auto text-xs text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/5">
            <Download className="w-3 h-3" /> CSV
          </button>
          <button onClick={() => setThrottleModalOpen(true)} data-testid="ob-open-throttle-modal"
                  className="text-xs text-amber-300 hover:text-amber-200 inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/30 bg-amber-500/5">
            <ShieldOff className="w-3 h-3" /> Manuel Throttle
          </button>
        </CardBody>

        {advOpen && (
          <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-3 gap-2" data-testid="ob-adv-panel">
            <input value={toSearch} onChange={(e) => setToSearch(e.target.value)} data-testid="ob-adv-to"
                   placeholder="Alıcı (regex)..." className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
            <input value={subjectSearch} onChange={(e) => setSubjectSearch(e.target.value)} data-testid="ob-adv-subject"
                   placeholder="Konu (regex)..." className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
            <input value={ipSearch} onChange={(e) => setIpSearch(e.target.value)} data-testid="ob-adv-ip"
                   placeholder="IP (regex)..." className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
            <input value={minScore} onChange={(e) => setMinScore(e.target.value)} data-testid="ob-adv-min"
                   type="number" step="0.1" placeholder="Min skor" className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
            <input value={maxScore} onChange={(e) => setMaxScore(e.target.value)} data-testid="ob-adv-max"
                   type="number" step="0.1" placeholder="Max skor" className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
            <input value={hoursFilter} onChange={(e) => setHoursFilter(e.target.value)} data-testid="ob-adv-hours"
                   type="number" placeholder="Son N saat" className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
          </div>
        )}

        <div className="px-3 pb-3 border-t border-slate-800 pt-2">
          <SavedFiltersBar
            module="outbound_events"
            currentFilters={{ search, verdict, limit, toSearch, subjectSearch, ipSearch, minScore, maxScore, hoursFilter }}
            onLoad={(f) => {
              setSearch(f.search ?? ""); setVerdict(f.verdict ?? "all");
              if (f.limit && Number.isFinite(Number(f.limit))) setLimit(Number(f.limit));
              setToSearch(f.toSearch ?? ""); setSubjectSearch(f.subjectSearch ?? "");
              setIpSearch(f.ipSearch ?? ""); setMinScore(f.minScore ?? "");
              setMaxScore(f.maxScore ?? ""); setHoursFilter(f.hoursFilter ?? "");
              if (f.toSearch || f.subjectSearch || f.ipSearch || f.minScore || f.maxScore || f.hoursFilter) setAdvOpen(true);
            }}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2" data-testid="ob-live-header">
              Giden Mail Trafiği
              <span data-testid="ob-live-indicator" className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-emerald-400 mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> canlı
              </span>
              {liveCount > 0 && (
                <button
                  data-testid="ob-live-count"
                  onClick={() => { qc.invalidateQueries({ queryKey: ["outbound-events"] }); setLiveCount(0); }}
                  className="text-[10px] mono px-1.5 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30 animate-pulse">
                  +{liveCount} yeni · tıkla yenile
                </button>
              )}
            </span>
          }
          subtitle={eventsQuery.isFetching ? "Yükleniyor…" : `${events.length} kayıt (limit: ${limit})`}
          right={<Badge tone="brand">v43 Filtering</Badge>}
        />
        <div className="overflow-x-auto max-h-[600px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-950/95 z-10">
              <tr className="text-[11px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                <th className="text-left px-3 py-2 font-semibold">Zaman</th>
                <th className="text-left px-3 py-2 font-semibold">Gönderen</th>
                <th className="text-left px-3 py-2 font-semibold">Alıcı</th>
                <th className="text-left px-3 py-2 font-semibold">Konu</th>
                <th className="text-right px-3 py-2 font-semibold">Skor</th>
                <th className="text-center px-3 py-2 font-semibold">Verdict</th>
                <th className="text-center px-3 py-2 font-semibold">İşlem</th>
              </tr>
            </thead>
            <tbody data-testid="ob-events-tbody">
              {events.map((e) => {
                const vt = verdictTone(e.verdict);
                const ds = displaySender(e.from_addr);
                return (
                  <tr key={e.id} data-testid={`ob-row-${e.id}`} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                    <td className="px-3 py-2 mono text-[11px] text-slate-500 whitespace-nowrap">{fmtTime(e.ts)}</td>
                    <td className={`px-3 py-2 mono truncate max-w-[200px] ${ds.isBounce ? "text-slate-500 italic" : "text-slate-200"}`}
                        title={ds.isBounce ? `Bounce mesajı — envelope sender boş (${ds.raw || "<>"})` : e.from_addr}>
                      {ds.isBounce ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 uppercase tracking-widest">bounce</span>
                          <span className="text-slate-500">MAILER-DAEMON</span>
                        </span>
                      ) : ds.label}
                    </td>
                    <td className="px-3 py-2 mono text-slate-300 truncate max-w-[180px]" title={e.to_addr}>{e.to_addr}</td>
                    <td className="px-3 py-2 text-slate-300 truncate max-w-[240px]" title={e.subject}>{e.subject || "(konusuz)"}</td>
                    <td className="px-3 py-2 text-right mono text-amber-300">{Number(e.total_score ?? 0).toFixed(1)}</td>
                    <td className="px-3 py-2 text-center"><Badge tone={vt.tone}>{vt.label}</Badge></td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <button title="Mail içeriğini oku" data-testid={`ob-read-${e.id}`}
                              onClick={() => setContentEventId(e.id)}
                              className="p-1 rounded hover:bg-cyan-500/10 text-cyan-300 mr-1"><Eye className="w-3.5 h-3.5" /></button>
                      <button title="Karantinaya al" data-testid={`ob-quar-${e.id}`}
                              onClick={() => actionMut.mutate({ id: e.id, action: "quarantine" })}
                              className="p-1 rounded hover:bg-amber-500/10 text-amber-300 mr-1"><MailWarning className="w-3.5 h-3.5" /></button>
                      <button title="Gönderen whitelist" data-testid={`ob-wl-${e.id}`}
                              onClick={() => actionMut.mutate({ id: e.id, action: "whitelist_sender" })}
                              className="p-1 rounded hover:bg-emerald-500/10 text-emerald-300 mr-1"><ShieldCheck className="w-3.5 h-3.5" /></button>
                      <button title="Kullanıcıyı throttle" data-testid={`ob-throt-${e.id}`}
                              onClick={() => actionMut.mutate({ id: e.id, action: "throttle_sender" })}
                              className="p-1 rounded hover:bg-orange-500/10 text-orange-300 mr-1"><ShieldOff className="w-3.5 h-3.5" /></button>
                      <button title="Sil" data-testid={`ob-del-${e.id}`}
                              onClick={() => { if (confirm("Bu mail kaydını sil?")) actionMut.mutate({ id: e.id, action: "delete" }); }}
                              className="p-1 rounded hover:bg-rose-500/10 text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500 text-sm">
                  {eventsQuery.isLoading ? "Yükleniyor…" : "Giden mail kaydı yok"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><ShieldOff className="w-4 h-4 text-amber-400" /> Sınırlandırılmış Kullanıcılar</span>}
          subtitle={`${throttles.length} kullanıcı aktif olarak throttle ediliyor`}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                <th className="text-left px-3 py-2 font-semibold">Kullanıcı</th>
                <th className="text-left px-3 py-2 font-semibold">Neden</th>
                <th className="text-right px-3 py-2 font-semibold">Sayım</th>
                <th className="text-left px-3 py-2 font-semibold">Zaman</th>
                <th className="text-center px-3 py-2 font-semibold">İşlem</th>
              </tr>
            </thead>
            <tbody data-testid="ob-throttles-tbody">
              {throttles.map((t) => (
                <tr key={`${t.license_key}::${t.from_user}`} data-testid={`ob-throt-row-${t.from_user}`} className="border-b border-slate-800/60">
                  <td className="px-3 py-2 mono text-slate-100">{t.from_user}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{t.reason || "—"}</td>
                  <td className="px-3 py-2 text-right mono text-rose-300">{t.sent_count ?? "?"} / {t.limit ?? "?"}</td>
                  <td className="px-3 py-2 mono text-[11px] text-slate-500">{fmtTime(t.throttled_at)}</td>
                  <td className="px-3 py-2 text-center">
                    <button data-testid={`ob-unthrot-${t.from_user}`}
                            onClick={() => unthrottleMut.mutate(t.from_user)}
                            className="text-xs text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/5">
                      <X className="w-3 h-3" /> Kaldır
                    </button>
                  </td>
                </tr>
              ))}
              {throttles.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500 text-sm">Aktif throttle yok</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Bugün En Çok Mail Atan Kullanıcılar" subtitle="Rate limit'e yakın user'ları izleyin" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                <th className="text-left px-3 py-2 font-semibold">Kullanıcı</th>
                <th className="text-right px-3 py-2 font-semibold">Gönderilen</th>
                <th className="text-right px-3 py-2 font-semibold">Spam</th>
                <th className="text-right px-3 py-2 font-semibold">Bloklu</th>
                <th className="text-right px-3 py-2 font-semibold">Kullanım %</th>
              </tr>
            </thead>
            <tbody>
              {(s.top_users || []).map((u) => {
                const usagePct = Math.round((u.sent / Math.max(1, s.limit_per_hour * 8)) * 100);
                return (
                  <tr key={u.user} data-testid={`ob-topuser-${u.user}`} className="border-b border-slate-800/60">
                    <td className="px-3 py-2 mono text-slate-100">{u.user}</td>
                    <td className="px-3 py-2 text-right mono text-slate-200">{nfmt(u.sent)}</td>
                    <td className="px-3 py-2 text-right mono text-amber-300">{nfmt(u.spam)}</td>
                    <td className="px-3 py-2 text-right mono text-rose-400">{nfmt(u.blocked)}</td>
                    <td className={`px-3 py-2 text-right mono ${usagePct > 80 ? "text-rose-400 font-semibold" : usagePct > 50 ? "text-amber-300" : "text-slate-300"}`}>%{usagePct}</td>
                  </tr>
                );
              })}
              {(!s.top_users || s.top_users.length === 0) && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500 text-sm">Bugün için user verisi yok</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* v43.4 Mail İçeriği Oku Modal ------------------------------ */}
      {contentEventId && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-start justify-center p-4 overflow-y-auto"
             onClick={() => setContentEventId(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-4xl w-full my-8"
               onClick={(e) => e.stopPropagation()}
               data-testid="ob-content-modal">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <Eye className="w-4 h-4 text-cyan-400" /> Mail İçeriği
              </h3>
              <button onClick={() => setContentEventId(null)}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400" aria-label="close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {contentQuery.isLoading && (
              <div className="p-8 text-center text-slate-400 text-sm">Yükleniyor…</div>
            )}
            {contentQuery.isError && (
              <div className="p-8 text-center text-rose-400 text-sm" data-testid="ob-content-error">
                {contentQuery.error?.response?.data?.detail || "İçerik alınamadı"}
              </div>
            )}
            {contentQuery.data && (() => {
              const c = contentQuery.data;
              return (
                <div className="p-4 space-y-3">
                  {/* Zarf bilgisi */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-slate-500">Zaman:</span> <span className="mono text-slate-200 ml-1">{fmtTime(c.ts)}</span></div>
                    <div><span className="text-slate-500">Skor:</span> <span className="mono text-amber-300 ml-1">{Number(c.total_score ?? 0).toFixed(1)}</span></div>
                    <div><span className="text-slate-500">Gönderen:</span> <span className="mono text-slate-100 ml-1">{c.from_addr || "—"}</span></div>
                    <div><span className="text-slate-500">Alıcı:</span> <span className="mono text-slate-100 ml-1">{c.to_addr || "—"}</span></div>
                    <div><span className="text-slate-500">User:</span> <span className="mono text-slate-300 ml-1">{c.from_user || "—"}</span></div>
                    <div><span className="text-slate-500">IP:</span> <span className="mono text-slate-300 ml-1">{c.sender_ip || "—"}</span></div>
                    <div className="col-span-2"><span className="text-slate-500">Konu:</span> <span className="text-slate-200 ml-1">{c.subject || "(konusuz)"}</span></div>
                  </div>

                  {/* Motor skorları */}
                  {c.scores && Object.keys(c.scores).length > 0 && (
                    <div className="text-xs">
                      <div className="text-slate-500 mb-1 uppercase tracking-widest">Motor Skorları</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(c.scores).map(([k, v]) => (
                          <span key={k} className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 mono">
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Ekler */}
                  {c.attachments && c.attachments.length > 0 && (
                    <div className="text-xs">
                      <div className="text-slate-500 mb-1 uppercase tracking-widest">Ekler ({c.attachments.length})</div>
                      <ul className="space-y-1">
                        {c.attachments.map((a, i) => (
                          <li key={i} className="mono text-slate-300 text-[11px]">
                            📎 {a.filename || "(isimsiz)"} · {a.content_type || "?"} · {a.size ? `${(a.size/1024).toFixed(1)}KB` : ""} {a.sha256 && <span className="text-slate-500">sha256={a.sha256.slice(0,12)}...</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Headers */}
                  {c.headers_full && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-slate-400 hover:text-slate-200 py-1 select-none">
                        📋 SMTP Headers (aç/kapat)
                      </summary>
                      <pre data-testid="ob-content-headers"
                           className="mt-1 p-3 bg-slate-950 border border-slate-800 rounded max-h-56 overflow-auto text-[11px] mono text-slate-300 whitespace-pre-wrap">{c.headers_full}</pre>
                    </details>
                  )}

                  {/* Body (plain text) */}
                  {c.body_preview && (
                    <div className="text-xs">
                      <div className="text-slate-500 mb-1 uppercase tracking-widest">Metin Gövde (preview)</div>
                      <pre data-testid="ob-content-body"
                           className="p-3 bg-slate-950 border border-slate-800 rounded max-h-72 overflow-auto text-[11px] text-slate-200 whitespace-pre-wrap">{c.body_preview}</pre>
                    </div>
                  )}

                  {/* HTML body render — sandboxed iframe */}
                  {c.body_html && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-slate-400 hover:text-slate-200 py-1 select-none">
                        🎨 HTML Gövde (aç/kapat) — sandbox'ta güvenli
                      </summary>
                      <iframe
                        data-testid="ob-content-html"
                        srcDoc={c.body_html}
                        sandbox=""
                        title="mail-html"
                        className="mt-1 w-full h-80 bg-white rounded border border-slate-800"
                      />
                    </details>
                  )}

                  {c.content_source === "none" || (!c.body_preview && !c.body_html && !c.headers_full) ? (
                    <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-xs" data-testid="ob-content-fallback">
                      <div className="flex items-start gap-2 mb-2">
                        <span className="text-amber-300 text-base leading-none">⚠</span>
                        <div className="flex-1">
                          <div className="text-amber-200 font-semibold mb-1">Mail gövdesi henüz veritabanında yok</div>
                          <p className="text-slate-400 leading-relaxed">
                            Perl daemon (mailshield-logtail.pl) sadece Exim log satırlarını okur;
                            mail body ve header'lar log'da yer almadığı için doğrudan ingest edilmez.
                            <br/><br/>
                            <b className="text-slate-300">Mail'i görmek için 2 seçenek:</b>
                          </p>
                          <ol className="list-decimal ml-5 mt-2 space-y-1 text-slate-300">
                            <li>
                              <b>Hızlı — Exim spool'undan oku:</b> Mail hala Exim kuyruğundaysa
                              (genelde 3-7 gün) sunucuda şu dosyaları bulabilirsiniz:
                              {c.spool_hint ? (
                                <div className="mt-1 mono text-[10px] bg-slate-950 border border-slate-800 rounded p-2 text-emerald-300 select-all">
                                  {c.spool_hint}<br/>
                                  {c.spool_hint.replace("-H", "-D")}
                                </div>
                              ) : (
                                <span className="text-slate-500 italic"> (message_id yok — spool'da bulunamaz)</span>
                              )}
                              {c.message_id && (
                                <div className="mt-1 mono text-[10px] text-slate-500">
                                  message-id: <span className="text-slate-300 select-all">{c.message_id}</span>
                                </div>
                              )}
                            </li>
                            <li>
                              <b>Kalıcı çözüm — Milter body ingest:</b> WHM sunucunuzda
                              mailshield-milter.pl v43.15+ yüklüyse tüm gelen/giden mail body'leri
                              otomatik ingest edilir. Panelden <b>Güncelle</b> butonuna basmanız yeterli.
                            </li>
                          </ol>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {c.content_source && c.content_source.startsWith("Exim spool") && (
                    <div className="text-[10px] mono text-emerald-400 border-l-2 border-emerald-500/50 pl-2">
                      ✓ İçerik Exim spool'undan gerçek zamanlı okundu · {c.content_source}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {throttleModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setThrottleModalOpen(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()} data-testid="ob-throttle-modal">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">Kullanıcıyı Sınırla</h3>
            <input data-testid="ob-throttle-input" autoFocus value={throttleUser}
                   onChange={(e) => setThrottleUser(e.target.value)}
                   placeholder="Kullanıcı adı (örn: kobi)"
                   onKeyDown={(e) => { if (e.key === "Enter" && throttleUser.trim()) throttleMut.mutate(throttleUser.trim()); }}
                   className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm mb-3 focus:outline-none focus:border-indigo-500" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setThrottleModalOpen(false)} className="px-3 py-1.5 text-xs rounded text-slate-400 hover:bg-slate-800">İptal</button>
              <button data-testid="ob-throttle-submit"
                      disabled={!throttleUser.trim() || throttleMut.isPending}
                      onClick={() => throttleMut.mutate(throttleUser.trim())}
                      className="px-3 py-1.5 text-xs rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 hover:bg-amber-500/30 disabled:opacity-40">
                Sınırla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
