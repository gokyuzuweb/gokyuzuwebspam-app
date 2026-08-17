/**
 * v43.72 — Bayi Uzak Yönetim (Master-only)
 *
 * Master, bir bayinin sunucusuna güvenli read-only komut gönderir.
 *   - log_tail (exim / gws-daemon logları)
 *   - health_check (docker + servis durumu)
 *   - version_check (uname + docker + plugin)
 *   - disk_usage (df -h /)
 *   - service_status (systemctl status <svc>)
 *
 * Komut queue'lanır → bayi heartbeat çeker → çalıştırır → sonuç master'a döner.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Terminal, PlayCircle, Server, Clock, CheckCircle2, XCircle, Loader2,
  ShieldAlert, RefreshCw, Copy,
} from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { client } from "@/lib/api";

const COMMANDS = [
  { key: "health_check",   label: "Health Check",        hint: "Docker + servis durumu" },
  { key: "version_check",  label: "Version Check",       hint: "uname + docker + plugin sürümü" },
  { key: "disk_usage",     label: "Disk Kullanımı",      hint: "df -h /" },
  { key: "log_tail",       label: "Log Tail",             hint: "Belirli logun son N satırı" },
  { key: "service_status", label: "Servis Durumu",       hint: "systemctl status <servis>" },
];
const LOG_OPTIONS = [
  { value: "exim_main",       label: "exim_mainlog" },
  { value: "exim_reject",     label: "exim_rejectlog" },
  { value: "exim_panic",      label: "exim_paniclog" },
  { value: "gws_daemon",      label: "gws-exim-daemon.log" },
  { value: "gws_push",        label: "gws-simple-push.log" },
  { value: "system_messages", label: "system messages" },
];
const SERVICE_OPTIONS = [
  "exim", "docker", "gws-exim-daemon", "gws-simple-push.timer",
  "mailscanner", "clamav-daemon", "spamassassin",
];

const remote = {
  bayilerv:   () => client.get("/remote-admin/bayilerv").then(r => r.data),
  history:  (target) => client.get("/remote-admin/history", { params: target ? { target } : {} }).then(r => r.data),
  dispatch: (payload) => client.post("/remote-admin/dispatch", payload).then(r => r.data),
  action:   (id) => client.get(`/remote-admin/action/${id}`).then(r => r.data),
};

function StatusBadge({ row }) {
  if (row.completed_at && row.ok === true) return <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"><CheckCircle2 className="w-3 h-3"/> tamamlandı</span>;
  if (row.completed_at && row.ok === false) return <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30"><XCircle className="w-3 h-3"/> başarısız</span>;
  if (row.completed_at) return <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700"><CheckCircle2 className="w-3 h-3"/> tamamlandı</span>;
  return <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30"><Loader2 className="w-3 h-3 animate-spin"/> bekliyor</span>;
}

export default function RemoteAdmin() {
  const qc = useQueryClient();
  const bayilerv = useQuery({ queryKey: ["remote-bayilerv"], queryFn: remote.bayilerv });
  const [target, setTarget] = useState("");
  const [command, setCommand] = useState("health_check");
  const [logKey, setLogKey] = useState("exim_main");
  const [lines, setLines] = useState(200);
  const [service, setService] = useState("gws-exim-daemon");
  const [openOutput, setOpenOutput] = useState(null);
  const history = useQuery({
    queryKey: ["remote-history", target],
    queryFn: () => remote.history(target || null),
    refetchInterval: 5000,
  });
  const dispatch = useMutation({
    mutationFn: () => {
      if (!target) throw new Error("Bayı seçin");
      const params = {};
      if (command === "log_tail") { params.log = logKey; params.lines = lines; }
      if (command === "service_status") { params.service = service; }
      return remote.dispatch({ license_key: target, command, params });
    },
    onSuccess: (d) => {
      toast.success("Komut kuyruğa alındı", { description: `action_id: ${(d?.action_id || "").slice(0, 8)}…` });
      qc.invalidateQueries({ queryKey: ["remote-history"] });
    },
    onError: (e) => toast.error("Gönderilemedi: " + (e?.response?.data?.detail || e.message)),
  });

  const items = history.data?.items || [];
  const bayilervItems = bayilerv.data?.items || [];

  const copyOutput = (txt) => {
    try { navigator.clipboard.writeText(txt || ""); toast.success("Çıktı kopyalandı"); } catch (_) {}
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <Terminal className="w-5 h-5 text-indigo-400" />
            Bayı Uzak Yönetim (Read-Only)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Bayilerinin sunucusuna güvenli read-only komut gönderin (log tail, health, versiyon). Restart / write komutları asla gönderilmez.
          </p>
        </div>
        <span className="text-[11px] mono text-slate-500 flex items-center gap-1">
          <ShieldAlert className="w-3 h-3 text-amber-400" /> Master-only
        </span>
      </div>

      {/* Command form */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><PlayCircle className="w-4 h-4 text-emerald-400"/> Komut Gönder</span>}
        />
        <CardBody className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Hedef Bayı</label>
              <select
                data-testid="remote-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-100"
              >
                <option value="">— Bayı seçin ({bayilervItems.length}) —</option>
                {bayilervItems.map((b) => (
                  <option key={b.license_key} value={b.license_key}>
                    {(b.email || b.license_key.slice(0, 24))} · {b.plan || "?"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Komut</label>
              <select
                data-testid="remote-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-100"
              >
                {COMMANDS.map((c) => (
                  <option key={c.key} value={c.key}>{c.label} — {c.hint}</option>
                ))}
              </select>
            </div>
          </div>
          {command === "log_tail" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Log Dosyası</label>
                <select
                  data-testid="remote-log-select"
                  value={logKey}
                  onChange={(e) => setLogKey(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-100"
                >
                  {LOG_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Satır Sayısı (1–1000)</label>
                <input
                  type="number" min="1" max="1000"
                  data-testid="remote-lines"
                  value={lines}
                  onChange={(e) => setLines(Math.max(1, Math.min(1000, parseInt(e.target.value || "200", 10))))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-slate-100"
                />
              </div>
            </div>
          )}
          {command === "service_status" && (
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Servis</label>
              <select
                data-testid="remote-service"
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="w-full md:w-1/2 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-100"
              >
                {SERVICE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
          <button
            data-testid="remote-dispatch-btn"
            onClick={() => dispatch.mutate()}
            disabled={!target || dispatch.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-gradient-to-r from-emerald-500 to-cyan-500 text-white text-sm font-semibold shadow-lg hover:shadow-emerald-500/30 disabled:opacity-40"
          >
            {dispatch.isPending ? <Loader2 className="w-4 h-4 animate-spin"/> : <PlayCircle className="w-4 h-4"/>}
            Komutu Kuyruğa Al
          </button>
          <div className="text-[11px] text-slate-500 leading-relaxed">
            Bayı sunucusundaki heartbeat daemon kuyruktan komutu çeker (~10sn). Sonuç bu sayfada 5sn'de bir yenilenir.
          </div>
        </CardBody>
      </Card>

      {/* History */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-400"/> Komut Geçmişi</span>}
          right={
            <button
              onClick={() => history.refetch()}
              className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200"
              data-testid="remote-history-refresh"
            >
              <RefreshCw className={`w-3 h-3 ${history.isFetching ? "animate-spin" : ""}`} /> Yenile
            </button>
          }
        />
        <CardBody className="p-0">
          {history.isLoading ? (
            <div className="p-8 text-center text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-2"/> Yükleniyor…</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">Henüz komut gönderilmedi</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/50 text-[10px] uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-2">Zaman</th>
                    <th className="text-left px-4 py-2">Bayı</th>
                    <th className="text-left px-4 py-2">Komut</th>
                    <th className="text-left px-4 py-2">Durum</th>
                    <th className="text-left px-4 py-2">Sonuç</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {items.map((r) => (
                    <tr key={r.id} data-testid={`remote-row-${r.id}`} className="hover:bg-slate-900/40">
                      <td className="px-4 py-2 mono text-[11px] text-slate-400 whitespace-nowrap">{new Date(r.created_at).toLocaleString("tr-TR")}</td>
                      <td className="px-4 py-2 text-slate-300 truncate max-w-[180px]" title={r.license_key}>{r.bayi_label}</td>
                      <td className="px-4 py-2">
                        <span className="text-[11px] mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">{(r.action_type || "").replace(/^remote_/, "")}</span>
                        {r.params?.log && <span className="ml-1 text-[10px] mono text-slate-500">{r.params.log}·{r.params.lines}</span>}
                        {r.params?.service && <span className="ml-1 text-[10px] mono text-slate-500">{r.params.service}</span>}
                      </td>
                      <td className="px-4 py-2"><StatusBadge row={r}/></td>
                      <td className="px-4 py-2">
                        {r.output ? (
                          <button
                            data-testid={`remote-out-${r.id}`}
                            onClick={() => setOpenOutput({ id: r.id, text: r.output, label: r.bayi_label, cmd: r.action_type })}
                            className="text-xs text-indigo-300 hover:text-indigo-200 underline underline-offset-2"
                          >
                            görüntüle
                          </button>
                        ) : r.completed_at ? (
                          <span className="text-[11px] text-slate-500">(çıktısız)</span>
                        ) : (
                          <span className="text-[11px] text-slate-500">bekleniyor</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Output modal */}
      {openOutput && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4" onClick={() => setOpenOutput(null)}>
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-3xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-100">{openOutput.cmd}</div>
                <div className="text-[11px] text-slate-500 mono">{openOutput.label}</div>
              </div>
              <div className="flex items-center gap-2">
                <button data-testid="remote-copy-btn" onClick={() => copyOutput(openOutput.text)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-700 text-slate-300 hover:text-slate-100">
                  <Copy className="w-3 h-3"/> Kopyala
                </button>
                <button onClick={() => setOpenOutput(null)} className="text-slate-400 hover:text-slate-200 text-xl leading-none">×</button>
              </div>
            </div>
            <pre className="p-4 overflow-auto text-[11px] mono text-emerald-200 bg-slate-950 whitespace-pre-wrap">
{openOutput.text}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
