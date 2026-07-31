import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { Send, ShieldCheck, ShieldAlert, Bug, Ban, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import MailEventDetail from "@/components/MailEventDetail";

const VERDICT_META = {
  clean:       { tone: "success", label: "CLEAN",     Icon: ShieldCheck,   row: "" },
  whitelisted: { tone: "success", label: "WHITELIST", Icon: ShieldCheck,   row: "" },
  spam:        { tone: "warning", label: "SPAM",      Icon: AlertTriangle, row: "bg-amber-500/5" },
  high_spam:   { tone: "danger",  label: "HIGH SPAM", Icon: ShieldAlert,   row: "bg-rose-500/5" },
  virus:       { tone: "danger",  label: "VIRUS",     Icon: Bug,           row: "bg-rose-500/5" },
  blocked:     { tone: "danger",  label: "BLOCKED",   Icon: Ban,           row: "bg-rose-500/5" },
};

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("tr-TR", { hour12: false });
}
function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}dk`;
  if (s < 86400) return `${Math.floor(s/3600)}sa`;
  return `${Math.floor(s/86400)}g`;
}

function VerdictDonut({ byVerdict, total, activeVerdict, onSelect }) {
  const segments = [
    { key: "clean",     color: "#10b981", label: "Temiz" },
    { key: "spam",      color: "#f59e0b", label: "Spam" },
    { key: "high_spam", color: "#f43f5e", label: "Yük.Spam" },
    { key: "virus",     color: "#dc2626", label: "Virüs" },
    { key: "blocked",   color: "#7c3aed", label: "Blocked" },
  ];
  const parts = segments.map((s) => ({ ...s, count: byVerdict[s.key] || 0 }))
                        .filter((s) => s.count > 0);
  const sum = parts.reduce((a, b) => a + b.count, 0) || 1;
  const R = 42, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width="110" height="110" viewBox="0 0 110 110" className="shrink-0">
        <circle cx="55" cy="55" r={R} fill="none" stroke="#1e293b" strokeWidth="12" />
        {parts.map((p) => {
          const pct = p.count / sum;
          const dash = pct * C;
          const gap  = C - dash;
          const el = (
            <circle
              key={p.key}
              cx="55" cy="55" r={R}
              fill="none"
              stroke={p.color}
              strokeWidth="12"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 55 55)"
              opacity={activeVerdict === "all" || activeVerdict === p.key ? 1 : 0.25}
              onClick={() => onSelect(activeVerdict === p.key ? "all" : p.key)}
              style={{ cursor: "pointer", transition: "opacity .2s" }}
            />
          );
          offset += dash;
          return el;
        })}
        <text x="55" y="52" textAnchor="middle" fill="#e2e8f0" fontSize="18" fontWeight="700"
              fontFamily="JetBrains Mono, monospace">{total}</text>
        <text x="55" y="68" textAnchor="middle" fill="#64748b" fontSize="9">mail</text>
      </svg>
      <div className="text-xs space-y-1">
        {parts.map((p) => (
          <button
            key={p.key}
            onClick={() => onSelect(activeVerdict === p.key ? "all" : p.key)}
            className={`flex items-center gap-2 px-2 py-0.5 rounded transition ${
              activeVerdict === p.key ? "bg-slate-800" : "hover:bg-slate-800/50"
            }`}
            data-testid={`donut-legend-${p.key}`}
          >
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }}></span>
            <span className="text-slate-300">{p.label}</span>
            <span className="mono text-slate-500">{p.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function LiveMailEvents() {
  // URL query params: ?scope=user&user=<cpuser> — cPanel end-user modu
  //                   ?ip=<sender_ip> — Top Suspicious IPs chart drilldown
  const [urlTick, setUrlTick] = useState(0); // bumps on popstate to re-read URL
  useEffect(() => {
    const onPop = () => setUrlTick((n) => n + 1);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const urlParams = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const scopeUser = urlParams.get("scope") === "user" ? urlParams.get("user") : null;
  const ipFilter = urlParams.get("ip") || "";
  void urlTick; // trigger re-render on URL change

  const [licenseKey, setLicenseKey] = useState(() =>
    localStorage.getItem("gws.event_license") || "MS-C02AB012652A4FE692D69676"
  );
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState(licenseKey);
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState("all");
  const [newIds, setNewIds] = useState(new Set());
  const [detailEvent, setDetailEvent] = useState(null);
  const seenIdsRef = useRef(new Set());
  const qc = useQueryClient();

  async function handleAction(action, evt) {
    try {
      await api.quarantineAction(licenseKey, evt.id, action);
      toast.success(`${action} kuyruğa alındı — ~10sn içinde sunucuda uygulanır`);
      setDetailEvent(null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Aksiyon başarısız");
    }
  }

  useEffect(() => { localStorage.setItem("gws.event_license", licenseKey); }, [licenseKey]);

  const events = useQuery({
    queryKey: ["live-events", licenseKey, scopeUser, verdictFilter],
    queryFn: () => api.liveEvents(licenseKey, 100, scopeUser, verdictFilter),
    refetchInterval: 8000,
    enabled: !!licenseKey && licenseKey.length >= 8,
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["live-events-summary", licenseKey, scopeUser],
    queryFn: () => api.liveEventsSummary(licenseKey, scopeUser),
    refetchInterval: 15000,
    enabled: !!licenseKey && licenseKey.length >= 8,
    retry: false,
  });

  // Detect newly arrived rows and highlight them for 2 seconds (glow animation)
  useEffect(() => {
    const items = events.data?.items || [];
    if (!items.length) return;
    const currentIds = new Set(items.map((e) => e.id));
    const seen = seenIdsRef.current;
    if (seen.size === 0) {
      // First load - don't glow existing rows
      seenIdsRef.current = currentIds;
      return;
    }
    const fresh = items.filter((e) => !seen.has(e.id)).map((e) => e.id);
    if (fresh.length) {
      setNewIds((prev) => {
        const next = new Set(prev);
        fresh.forEach((id) => next.add(id));
        return next;
      });
      // Clear glow after 2.5s
      setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          fresh.forEach((id) => next.delete(id));
          return next;
        });
      }, 2500);
    }
    seenIdsRef.current = currentIds;
  }, [events.data]);

  async function handleTestIngest() {
    try {
      await api.testIngestEvents(licenseKey);
      toast.success("5 örnek event oluşturuldu");
      qc.invalidateQueries({ queryKey: ["live-events", licenseKey] });
      qc.invalidateQueries({ queryKey: ["live-events-summary", licenseKey] });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Test event başarısız");
    }
  }

  function handleExportCSV() {
    const rows = filtered.length ? filtered : items;
    if (!rows.length) return toast.error("Dışa aktarılacak event yok");
    const cols = ["ts", "verdict", "total_score", "from_addr", "to_addr", "subject", "server_hostname", "exim_mid"];
    const header = cols.join(",");
    const esc = (v) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[,"\n]/.test(s) ? `"${s}"` : s;
    };
    const body = rows.map(r => cols.map(c => esc(r[c])).join(",")).join("\n");
    const csv = header + "\n" + body;
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mail-events-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} event CSV olarak indirildi`);
  }

  const items = events.data?.items || [];
  const total = summary.data?.total || 0;
  const invalid = events.isError;

  // Client-side filtering — subject/from/to arama + verdict dropdown + IP drilldown
  const filtered = items.filter((e) => {
    if (verdictFilter !== "all" && e.verdict !== verdictFilter) return false;
    if (ipFilter && !(e.from_addr || "").includes(ipFilter) && !(e.server_ip || "").includes(ipFilter)) {
      // Also check for X-Originating-IP inside headers
      const headers = e.headers_full || e.headers_preview || "";
      if (!headers.includes(ipFilter)) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const hay = `${e.from_addr || ""} ${e.to_addr || ""} ${e.subject || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <Card data-testid="live-events-card">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="relative inline-flex w-2 h-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Canlı Mail Trafiği
          </span>
        }
        subtitle={
          <>
            <span className="mono">Lisans: </span>
            <button
              onClick={() => { setDraft(licenseKey); setEditOpen(v => !v); }}
              className="text-indigo-400 hover:text-indigo-300 mono"
              data-testid="live-events-license-edit-btn"
            >{licenseKey.slice(0, 12)}…</button>
            {scopeUser && <> {" · "}<span className="text-amber-400" data-testid="live-events-scope-badge">scope: {scopeUser}</span></>}
            {ipFilter && <> {" · "}<span className="text-rose-400 mono" data-testid="live-events-ip-filter">
              filtre: {ipFilter}
              <button onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.delete("ip");
                window.location.href = url.toString();
              }} className="ml-1 text-rose-300 hover:text-rose-200 underline">temizle</button>
            </span></>}
            {" · "}Toplam: <span className="mono text-slate-300" data-testid="live-events-total">{total}</span>
            {summary.data?.last_event_at && <> {" · "}Son: <span className="mono text-slate-300">{timeAgo(summary.data.last_event_at)} önce</span></>}
          </>
        }
        right={
          <div className="flex gap-2">
            <button
              onClick={handleExportCSV}
              className="text-xs px-3 py-1.5 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition"
              data-testid="live-events-export-csv-btn"
              title="Filtreli sonuçları CSV indir"
            >⬇ CSV</button>
            <button
              onClick={handleTestIngest}
              className="text-xs px-3 py-1.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition flex items-center gap-1.5"
              data-testid="live-events-test-btn"
            >
              <Send className="w-3 h-3" /> Test Event
            </button>
          </div>
        }
      />
      <CardBody>
        {editOpen && (
          <div className="mb-3 flex gap-2 items-center bg-slate-900/60 rounded p-2 border border-slate-800">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-sm mono text-slate-200"
              placeholder="MS-XXXXXXXXXXXXXX"
              data-testid="live-events-license-input"
            />
            <button onClick={() => { setLicenseKey(draft.trim()); setEditOpen(false); }}
                    className="text-xs px-3 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                    data-testid="live-events-license-save-btn">Kaydet</button>
            <button onClick={() => setEditOpen(false)}
                    className="text-xs px-2 py-1 rounded text-slate-400 hover:text-slate-200">İptal</button>
          </div>
        )}

        {invalid && (
          <div className="text-xs text-rose-400 bg-rose-500/10 p-2 rounded mb-2" data-testid="live-events-error">
            {events.error?.response?.data?.detail || "Lisans anahtarı geçersiz."}
          </div>
        )}

        {!invalid && items.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm" data-testid="live-events-empty">
            Henüz mail event yok. Sunucuda milter'ı bağlayın veya <button
              onClick={handleTestIngest} className="text-indigo-400 underline">5 test eventi</button> gönderin.
          </div>
        )}

        {!invalid && items.length > 0 && (
          <>
            {/* Verdict donut + filter shortcut */}
            <div className="mb-4 p-3 bg-slate-900/40 rounded border border-slate-800" data-testid="verdict-donut">
              <VerdictDonut
                byVerdict={summary.data?.by_verdict || {}}
                total={total}
                activeVerdict={verdictFilter}
                onSelect={setVerdictFilter}
              />
            </div>

            {/* Filter bar */}
            <div className="flex gap-2 mb-3 flex-wrap" data-testid="live-events-filters">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ara: from / to / subject"
                className="flex-1 min-w-[220px] bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                data-testid="live-events-search-input"
              />
              <select
                value={verdictFilter}
                onChange={(e) => setVerdictFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                data-testid="live-events-verdict-filter"
              >
                <option value="all">Tümü ({items.length})</option>
                <option value="clean">Temiz</option>
                <option value="spam">Spam</option>
                <option value="high_spam">Yüksek Spam</option>
                <option value="virus">Virüs</option>
                <option value="blocked">Blocked</option>
              </select>
              {(search || verdictFilter !== "all") && (
                <button
                  onClick={() => { setSearch(""); setVerdictFilter("all"); }}
                  className="text-xs px-3 py-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  data-testid="live-events-filters-reset"
                >Temizle</button>
              )}
              <span className="text-xs text-slate-500 self-center" data-testid="live-events-filter-count">
                Gösterilen: <span className="mono text-slate-300">{filtered.length}</span> / {items.length}
              </span>
            </div>
          </>
        )}

        {!invalid && items.length > 0 && filtered.length === 0 && (
          <div className="text-center py-6 text-slate-500 text-sm" data-testid="live-events-filtered-empty">
            Filtreye uyan event yok. <button onClick={() => { setSearch(""); setVerdictFilter("all"); }} className="text-indigo-400 underline">Filtreyi temizle</button>
          </div>
        )}

        {!invalid && filtered.length > 0 && (
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto rounded border border-slate-800">
            <table className="w-full text-xs" data-testid="live-events-table">
              <thead className="bg-slate-900 sticky top-0 z-10">
                <tr className="text-slate-400 text-left border-b border-slate-800">
                  <th className="px-3 py-2 font-medium w-8"></th>
                  <th className="px-3 py-2 font-medium">Date/Time</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium">From / To</th>
                  <th className="px-3 py-2 font-medium">Subject</th>
                  <th className="px-3 py-2 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, idx) => {
                  const m = VERDICT_META[e.verdict] || { tone: "default", label: e.verdict?.toUpperCase(), Icon: ShieldCheck, row: "" };
                  const Icon = m.Icon;
                  const isNew = newIds.has(e.id);
                  return (
                    <tr
                      key={e.id}
                      className={`border-b border-slate-800/50 hover:bg-slate-800/40 cursor-pointer ${m.row} ${isNew ? "gws-row-glow" : ""}`}
                      onClick={() => setDetailEvent(e)}
                      data-testid={`live-event-row-${e.id}`}
                    >
                      <td className="px-3 py-2 text-slate-600">{idx + 1}</td>
                      <td className="px-3 py-2 mono text-slate-300 whitespace-nowrap">
                        {fmtTime(e.ts)}
                      </td>
                      <td className={`px-3 py-2 mono font-semibold whitespace-nowrap ${
                        e.total_score >= 8 ? "text-rose-400" :
                        e.total_score >= 5 ? "text-amber-400" :
                        e.total_score < 0 ? "text-emerald-400" : "text-slate-300"
                      }`}>
                        {e.total_score?.toFixed?.(2) ?? e.total_score}
                      </td>
                      <td className="px-3 py-2 mono text-slate-400 max-w-[280px]">
                        <div className="truncate" title={e.from_addr}>{e.from_addr || "-"}</div>
                        <div className="truncate text-slate-500" title={e.to_addr}>{e.to_addr || "-"}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-200 max-w-[420px]">
                        <div className="truncate" title={e.subject}>{e.subject || "(konu yok)"}</div>
                        {e.server_hostname && (
                          <div className="text-slate-600 text-[10px] mono truncate">{e.server_hostname}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon className="w-3 h-3" />
                          <Badge tone={m.tone}>{m.label}</Badge>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
      {detailEvent && (
        <MailEventDetail
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onAction={handleAction}
        />
      )}
    </Card>
  );
}
