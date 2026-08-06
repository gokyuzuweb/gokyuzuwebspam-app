import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { X, Trash2, Send, RefreshCw, Snowflake, Sun, Undo2 } from "lucide-react";

const LICKEY = () => (typeof window !== "undefined"
  ? (localStorage.getItem("gws.event_license") || "")
  : "");

const ACTIONS = [
  { key: "deliver", label: "İletmeyi Dene", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/20", Icon: Send },
  { key: "retry",   label: "Kuyruğu İşle", cls: "bg-sky-500/10 text-sky-300 border-sky-500/40 hover:bg-sky-500/20", Icon: RefreshCw },
  { key: "freeze",  label: "Dondur",       cls: "bg-slate-500/10 text-slate-300 border-slate-500/40 hover:bg-slate-500/20", Icon: Snowflake },
  { key: "thaw",    label: "Çöz",          cls: "bg-amber-500/10 text-amber-300 border-amber-500/40 hover:bg-amber-500/20", Icon: Sun },
  { key: "bounce",  label: "Geri Döndür",  cls: "bg-orange-500/10 text-orange-300 border-orange-500/40 hover:bg-orange-500/20", Icon: Undo2 },
  { key: "remove",  label: "Kuyruktan Sil", cls: "bg-rose-500/10 text-rose-300 border-rose-500/40 hover:bg-rose-500/20", Icon: Trash2 },
];

export default function QueueModal({ open, onClose }) {
  const [selected, setSelected] = useState(new Set());
  const [onlyFrozen, setOnlyFrozen] = useState(false);
  const [verdict, setVerdict] = useState("all");
  const [search, setSearch] = useState("");
  const [fwdOpen, setFwdOpen] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["queue-list", onlyFrozen, verdict, search],
    queryFn: () => api.queueList(LICKEY(), { only_frozen: onlyFrozen, verdict, search: search || undefined }),
    enabled: open,
    refetchInterval: open ? 6000 : false,
  });
  const stats = useQuery({
    queryKey: ["queue-stats"],
    queryFn: () => api.queueStats(LICKEY()),
    enabled: open,
    refetchInterval: open ? 8000 : false,
  });
  const bulk = useMutation({
    mutationFn: ({ action, forwardTo }) => api.queueBulk(LICKEY(), Array.from(selected), action, forwardTo || null),
    onSuccess: (data, vars) => {
      const badge = data.source === "mock" ? " [MOCK — Exim yok]" : "";
      toast.success(`${data.success}/${data.processed} mail için "${vars.action}" tamam${badge}`);
      setSelected(new Set());
      setFwdOpen(false);
      qc.invalidateQueries({ queryKey: ["queue-list"] });
      qc.invalidateQueries({ queryKey: ["queue-stats"] });
    },
    onError: (e) => toast.error("İşlem başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  if (!open) return null;
  const items = q.data?.items || [];
  const isMock = q.data?.source === "mock";
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.mid)));
  };
  const toggle = (mid) => {
    const n = new Set(selected);
    n.has(mid) ? n.delete(mid) : n.add(mid);
    setSelected(n);
  };

  return (
    <div data-testid="queue-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-6xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/95">
          <div>
            <h2 className="text-slate-100 font-semibold flex items-center gap-2">Kuyruk Yönetimi
              <span className={`text-[11px] mono px-2 py-0.5 rounded border ${
                isMock ? "bg-amber-500/15 text-amber-300 border-amber-500/40" : "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
              }`}>
                {q.data?.source ? (isMock ? "MOCK · Exim yok" : "EXIM · Canlı") : "…"}
              </span>
            </h2>
            <div className="text-xs text-slate-400 mono mt-1">
              Toplam: <span className="text-slate-100">{stats.data?.total ?? "-"}</span> ·
              Dondurulmuş: <span className="text-amber-300">{stats.data?.frozen ?? 0}</span> ·
              Yüksek Spam: <span className="text-rose-300">{stats.data?.high_spam ?? 0}</span> ·
              Virüs: <span className="text-fuchsia-300">{stats.data?.virus ?? 0}</span>
            </div>
          </div>
          <button data-testid="queue-modal-close" onClick={onClose} className="p-2 rounded hover:bg-slate-800 text-slate-400">
            <X className="w-4 h-4"/>
          </button>
        </div>

        {isMock && (
          <div className="px-5 py-2 bg-amber-500/5 border-b border-amber-500/20 text-[11px] text-amber-200">
            ⚠ Bu ortamda Exim mail queue erişimi yok — aksiyonlar mail_events tablosu üzerinde simüle edilir. Gerçek WHM sunucusunda `exim -Mrm/-M` çalışır.
          </div>
        )}

        {/* Filter bar */}
        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   data-testid="queue-search"
                   placeholder="Kimden / Kime / Konu ara…"
                   className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5 text-xs mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60"/>
          </div>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value)}
                  data-testid="queue-verdict"
                  className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-xs text-slate-200">
            <option value="all">Tüm verdictler</option>
            <option value="spam">spam</option>
            <option value="high_spam">high_spam</option>
            <option value="virus">virus</option>
            <option value="blocked">blocked</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" checked={onlyFrozen} onChange={(e) => setOnlyFrozen(e.target.checked)} className="accent-indigo-500"/>
            Yalnızca donmuş
          </label>
          <button data-testid="queue-toggle-all" onClick={toggleAll} className="text-xs text-indigo-300 hover:text-indigo-200 ml-auto">
            {selected.size === items.length && items.length > 0 ? "Seçimi kaldır" : `Filtrelenmişleri seç (${items.length})`}
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] mono text-slate-500">
            Seçili: <span className="text-indigo-300">{selected.size}</span> · Görüntülenen: <span className="text-slate-300">{items.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ACTIONS.map(({ key, label, cls, Icon }) => (
              <button
                key={key}
                data-testid={`queue-action-${key}`}
                disabled={selected.size === 0 || bulk.isPending}
                onClick={() => {
                  if (key === "deliver") { setFwdOpen(true); return; }
                  bulk.mutate({ action: key });
                }}
                className={`text-xs px-3 py-1.5 rounded-md border transition-colors
                  ${selected.size === 0 ? "bg-slate-800/50 text-slate-600 border-slate-800 cursor-not-allowed" : cls}`}
              >
                <Icon className="w-3 h-3 inline mr-1"/>{label}
                {selected.size > 0 && <span className="ml-1 text-slate-500">({selected.size})</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-950 sticky top-0 border-b border-slate-800">
              <tr className="text-left text-[11px] uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2 w-8"></th>
                <th className="px-3 py-2">Mid</th>
                <th className="px-3 py-2">Kimden</th>
                <th className="px-3 py-2">Kime</th>
                <th className="px-3 py-2">Konu</th>
                <th className="px-3 py-2 text-right">Skor</th>
                <th className="px-3 py-2">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {items.map((row) => (
                <tr
                  key={row.mid}
                  data-testid={`queue-row-${row.mid}`}
                  onClick={() => toggle(row.mid)}
                  className={`cursor-pointer transition-colors ${selected.has(row.mid) ? "bg-indigo-500/10" : "hover:bg-slate-800/40"}`}
                >
                  <td className="px-4 py-2"><input type="checkbox" readOnly checked={selected.has(row.mid)} className="accent-indigo-500"/></td>
                  <td className="px-3 py-2 mono text-[11px] text-slate-400 truncate max-w-[140px]">{row.mid}</td>
                  <td className="px-3 py-2 mono text-slate-300 truncate max-w-[160px]">{row.from_addr}</td>
                  <td className="px-3 py-2 mono text-slate-400 truncate max-w-[160px]">{row.to_addr}</td>
                  <td className="px-3 py-2 text-slate-300 truncate max-w-[280px]">{row.subject}</td>
                  <td className="px-3 py-2 mono text-right text-slate-300">{Number(row.score || 0).toFixed(1)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] mono px-2 py-0.5 rounded border
                      ${row.verdict === "high_spam" ? "bg-rose-500/10 text-rose-300 border-rose-500/40" :
                        row.verdict === "virus" ? "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/40" :
                        row.verdict === "blocked" ? "bg-orange-500/10 text-orange-300 border-orange-500/40" :
                        "bg-amber-500/10 text-amber-300 border-amber-500/40"}`}>
                      {row.frozen ? "❄ " : ""}{row.verdict}
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-500">Kuyruk boş 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {fwdOpen && (
          <QueueDeliverDialog
            count={selected.size}
            onClose={() => setFwdOpen(false)}
            onConfirm={(to) => bulk.mutate({ action: "deliver", forwardTo: to })}
            pending={bulk.isPending}
          />
        )}
      </div>
    </div>
  );
}

/* -------- Deliver / forward-to dialog ---------------------------------- */
function QueueDeliverDialog({ count, onClose, onConfirm, pending }) {
  const [to, setTo] = useState("");
  const [useAlt, setUseAlt] = useState(false);
  const valid = !useAlt || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="queue-deliver-dialog">
      <div className="w-full max-w-md bg-slate-900 border border-emerald-500/40 rounded-xl p-5 shadow-2xl">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-emerald-200 font-semibold flex items-center gap-2"><Send className="w-4 h-4"/> İletmeyi Dene</h3>
            <p className="text-xs text-slate-400 mt-1">Seçilen <span className="text-emerald-300 mono">{count}</span> mail için Exim `-M` (zorla teslim) çalışır. İsterseniz farklı bir adrese kopya iletebilirsiniz.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400"><X className="w-4 h-4"/></button>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" checked={useAlt} onChange={(e) => setUseAlt(e.target.checked)}
                 data-testid="queue-deliver-use-alt" className="accent-emerald-500"/>
          Farklı adrese kopyala
        </label>
        {useAlt && (
          <input value={to} onChange={(e) => setTo(e.target.value)}
                 placeholder="admin@sirketiniz.com"
                 data-testid="queue-deliver-to"
                 className="mt-2 w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-slate-200 focus:outline-none focus:border-emerald-500/60"/>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Vazgeç</button>
          <button onClick={() => valid && onConfirm(useAlt ? to : null)}
                  disabled={!valid || pending}
                  data-testid="queue-deliver-confirm"
                  className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
            {pending ? "İletiliyor…" : "İletmeyi Başlat"}
          </button>
        </div>
      </div>
    </div>
  );
}
