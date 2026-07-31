import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { Send, ShieldCheck, ShieldAlert, Bug, Ban, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

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

export default function LiveMailEvents() {
  const [licenseKey, setLicenseKey] = useState(() =>
    localStorage.getItem("gws.event_license") || "MS-C02AB012652A4FE692D69676"
  );
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState(licenseKey);
  const qc = useQueryClient();

  useEffect(() => { localStorage.setItem("gws.event_license", licenseKey); }, [licenseKey]);

  const events = useQuery({
    queryKey: ["live-events", licenseKey],
    queryFn: () => api.liveEvents(licenseKey, 30),
    refetchInterval: 8000,
    enabled: !!licenseKey && licenseKey.length >= 8,
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["live-events-summary", licenseKey],
    queryFn: () => api.liveEventsSummary(licenseKey),
    refetchInterval: 15000,
    enabled: !!licenseKey && licenseKey.length >= 8,
    retry: false,
  });

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

  const items = events.data?.items || [];
  const total = summary.data?.total || 0;
  const invalid = events.isError;

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
            {" · "}Toplam: <span className="mono text-slate-300" data-testid="live-events-total">{total}</span>
            {summary.data?.last_event_at && <> {" · "}Son: <span className="mono text-slate-300">{timeAgo(summary.data.last_event_at)} önce</span></>}
          </>
        }
        right={
          <button
            onClick={handleTestIngest}
            className="text-xs px-3 py-1.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition flex items-center gap-1.5"
            data-testid="live-events-test-btn"
          >
            <Send className="w-3 h-3" /> Test Event
          </button>
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
                {items.map((e, idx) => {
                  const m = VERDICT_META[e.verdict] || { tone: "default", label: e.verdict?.toUpperCase(), Icon: ShieldCheck, row: "" };
                  const Icon = m.Icon;
                  return (
                    <tr
                      key={e.id}
                      className={`border-b border-slate-800/50 hover:bg-slate-800/40 ${m.row}`}
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
    </Card>
  );
}
