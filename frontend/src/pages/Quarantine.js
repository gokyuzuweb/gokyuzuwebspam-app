import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, RotateCcw, GraduationCap, X, Mail, Server, Hash, Filter } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useT, useI18n } from "@/i18n";

function useVerdictBadge() {
  const t = useT();
  return (v) => {
    const m = {
      spam: { tone: "warning", label: t("quarantine.v_spam") },
      high_spam: { tone: "danger", label: t("quarantine.v_high") },
      virus: { tone: "danger", label: t("quarantine.v_virus") },
      phish: { tone: "danger", label: t("quarantine.v_phish") },
    }[v] || { tone: "default", label: v };
    return <Badge tone={m.tone}>{m.label}</Badge>;
  };
}

function formatDate(iso, locale) {
  const d = new Date(iso);
  return d.toLocaleString(locale, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export default function Quarantine() {
  const qc = useQueryClient();
  const t = useT();
  const { effective } = useI18n();
  const verdictBadge = useVerdictBadge();
  const [search, setSearch] = useState("");
  const [verdict, setVerdict] = useState("all");
  const [engine, setEngine] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const locale = { tr: "tr-TR", en: "en-US", de: "de-DE", fr: "fr-FR", es: "es-ES", ar: "ar-SA" }[effective] || "en-US";

  const list = useQuery({
    queryKey: ["quarantine", search, verdict, engine],
    queryFn: () => api.quarantine({ search, verdict, engine, limit: 300 }),
    refetchInterval: 30000,
  });

  const rows = list.data || [];
  const allChecked = rows.length > 0 && selected.size === rows.length;

  const toggle = (id) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(rows.map(r => r.id)));
  };

  const bulk = useMutation({
    mutationFn: async ({ action, ids }) => {
      if (action === "release") return api.quarantineRelease(ids);
      if (action === "delete") return api.quarantineDelete(ids);
      if (action === "report") return api.quarantineReport(ids);
    },
    onSuccess: (data, vars) => {
      const n = vars.ids.length;
      if (vars.action === "release") toast.success(t("quarantine.delivered_msg", { n }));
      else if (vars.action === "delete") toast.success(t("quarantine.deleted_msg", { n }));
      else toast.success(t("quarantine.taught_msg", { n }));
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["quarantine"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
    onError: () => toast.error(t("quarantine.fail_msg")),
  });

  const runBulk = (action) => {
    if (selected.size === 0) return toast.error(t("quarantine.select_first"));
    bulk.mutate({ action, ids: Array.from(selected) });
  };

  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardBody className="p-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[240px] relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              data-testid="q-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("quarantine.search_placeholder")}
              className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-3 py-2 text-sm mono placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <select data-testid="q-verdict" value={verdict} onChange={(e) => setVerdict(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200">
              <option value="all">{t("quarantine.all_verdicts")}</option>
              <option value="spam">{t("dashboard.spam")}</option>
              <option value="high_spam">{t("dashboard.high_spam")}</option>
              <option value="phish">{t("dashboard.phishing")}</option>
              <option value="virus">{t("dashboard.virus")}</option>
            </select>
            <select data-testid="q-engine" value={engine} onChange={(e) => setEngine(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200">
              <option value="all">{t("quarantine.all_engines")}</option>
              <option value="spamassassin">SpamAssassin</option>
              <option value="clamav">ClamAV</option>
              <option value="dcc">DCC</option>
              <option value="razor">Razor</option>
              <option value="ai">AI</option>
            </select>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="mono text-xs text-slate-500">{rows.length} {t("quarantine.records")}</span>
            <span className="mono text-xs text-indigo-400">{selected.size} {t("quarantine.selected")}</span>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center gap-2">
        <button data-testid="q-release" onClick={() => runBulk("release")}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-sm">
          <RotateCcw className="w-3.5 h-3.5" /> {t("quarantine.release_action")}
        </button>
        <button data-testid="q-delete" onClick={() => runBulk("delete")}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-sm">
          <Trash2 className="w-3.5 h-3.5" /> {t("quarantine.delete_action")}
        </button>
        <button data-testid="q-report" onClick={() => runBulk("report")}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 text-sm">
          <GraduationCap className="w-3.5 h-3.5" /> {t("quarantine.report_action")}
        </button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                <th className="text-left px-4 py-3 font-semibold w-8">
                  <input type="checkbox" data-testid="q-check-all" checked={allChecked} onChange={toggleAll}
                         className="accent-indigo-500 w-3.5 h-3.5" />
                </th>
                <th className="text-left px-4 py-3 font-semibold">{t("quarantine.col_received")}</th>
                <th className="text-left px-4 py-3 font-semibold">{t("quarantine.col_sender")}</th>
                <th className="text-left px-4 py-3 font-semibold">{t("quarantine.col_recipient")}</th>
                <th className="text-left px-4 py-3 font-semibold">{t("quarantine.col_subject")}</th>
                <th className="text-right px-4 py-3 font-semibold">{t("quarantine.col_score")}</th>
                <th className="text-left px-4 py-3 font-semibold">{t("quarantine.col_verdict")}</th>
                <th className="text-left px-4 py-3 font-semibold">{t("quarantine.col_engine")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-row data-testid={`q-row-${r.id}`}
                    className="border-t border-slate-800 cursor-pointer" onClick={() => setPreview(r)}>
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="accent-indigo-500 w-3.5 h-3.5"
                           checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td className="px-4 py-2.5 mono text-xs text-slate-400">{formatDate(r.received_at, locale)}</td>
                  <td className="px-4 py-2.5">
                    <div className="text-slate-200 truncate max-w-[240px]">{r.sender}</div>
                    <div className="mono text-[11px] text-slate-500">{r.sender_ip}</div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-300 truncate max-w-[180px]">{r.recipient}</td>
                  <td className="px-4 py-2.5 text-slate-200 truncate max-w-[380px]">{r.subject}</td>
                  <td className="px-4 py-2.5 text-right mono text-amber-300">{r.score.toFixed(2)}</td>
                  <td className="px-4 py-2.5">{verdictBadge(r.verdict)}</td>
                  <td className="px-4 py-2.5 mono text-xs text-slate-400 uppercase">{r.engine}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">{t("common.no_records")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {preview && (
        <QuarantineDetail
          item={preview}
          onClose={() => setPreview(null)}
          onAction={(action, id) => {
            bulk.mutate({ action, ids: [id] });
            setPreview(null);
          }}
        />
      )}
    </div>
  );
}

/* -------- Quarantine detail drawer (tabbed like MailEventDetail) --------- */
function QuarantineDetail({ item, onClose, onAction }) {
  const [tab, setTab] = useState(item.body_html ? "html" : "body");
  const [rendered, setRendered] = useState(false);
  const attachments = Array.isArray(item.attachments) ? item.attachments : [];
  const rules = item.rules_matched || [];
  const scores = item.scores || {};
  const engineList = Object.keys(scores).filter(k => k !== "sa_report");

  const verdictColor = {
    clean: "#10b981", spam: "#f59e0b", high_spam: "#f43f5e",
    virus: "#dc2626", phish: "#a855f7", blocked: "#7c3aed",
  }[item.verdict] || "#64748b";

  const humanSize = (n) => !n ? "0 B" : n < 1024 ? n + " B" : n < 1024*1024 ? (n/1024).toFixed(1)+" KB" : (n/1024/1024).toFixed(2)+" MB";
  const copy = async (text, label) => { try { await navigator.clipboard.writeText(text); toast.success(`${label} kopyalandı`); } catch { toast.error("Kopyalanamadı"); } };

  const tabs = [
    item.body_preview && { key: "body",        label: "Gövde",     count: null },
    item.body_html    && { key: "html",        label: "HTML",      count: null },
    { key: "headers",     label: "Başlıklar", count: null },
    { key: "attachments", label: "Ekler",     count: attachments.length },
    { key: "rules",       label: "Kurallar",  count: rules.length },
    engineList.length   && { key: "engines",   label: "Motorlar",  count: engineList.length },
  ].filter(Boolean);
  const active = tabs.find(t => t.key === tab)?.key || tabs[0]?.key || "headers";

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/60 z-40" data-testid="q-detail-backdrop" />
      <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-slate-950 border-l border-slate-800 z-50 overflow-y-auto shadow-2xl"
           data-testid="q-detail-drawer">
        <div className="sticky top-0 bg-slate-950 border-b border-slate-800 px-5 py-3 flex items-start justify-between z-10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
                    style={{ background: `${verdictColor}22`, color: verdictColor }}>
                {item.verdict}
              </span>
              <span className="mono text-sm text-slate-300">skor {(item.score ?? 0).toFixed(2)}</span>
              <span className="mono text-[11px] text-slate-500 uppercase">{item.engine || "-"}</span>
            </div>
            <div className="text-slate-100 font-medium text-[15px] truncate" title={item.subject}>{item.subject || "(konu yok)"}</div>
            <div className="text-xs text-slate-400 mono mt-1 truncate">
              {item.sender} <span className="text-slate-600 mx-1">→</span> {item.recipient}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400" data-testid="q-detail-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-2.5 border-b border-slate-800 grid grid-cols-3 gap-3 text-[11px] mono bg-slate-900/40">
          <div><div className="text-slate-500 text-[9px] uppercase tracking-widest">Gönderen IP</div><div className="text-slate-300 truncate">{item.sender_ip || "-"}</div></div>
          <div><div className="text-slate-500 text-[9px] uppercase tracking-widest">Boyut</div><div className="text-slate-300">{item.size_kb ? `${item.size_kb} KB` : "-"}</div></div>
          <div><div className="text-slate-500 text-[9px] uppercase tracking-widest">Alındı</div><div className="text-slate-300 truncate">{item.received_at ? new Date(item.received_at).toLocaleString("tr-TR", { hour12: false }) : "-"}</div></div>
        </div>

        <div className="px-5 pt-3 border-b border-slate-800 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-t-md border-b-2 whitespace-nowrap transition ${
                active === t.key ? "border-indigo-400 text-indigo-300 bg-slate-900/50" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
              data-testid={`q-tab-${t.key}`}>
              {t.label}
              {t.count !== null && t.count !== undefined && (
                <span className="text-[10px] mono px-1.5 rounded bg-slate-800 text-slate-400">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="p-5 min-h-[240px]">
          {active === "body" && item.body_preview && (
            <div className="space-y-2" data-testid="q-tab-body">
              <div className="flex justify-between items-center">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Metin Gövdesi</div>
                <button onClick={() => copy(item.body_preview, "Gövde")} className="text-[10px] text-slate-400 hover:text-slate-200">kopyala</button>
              </div>
              <pre className="mono text-xs bg-slate-900/60 p-3 rounded whitespace-pre-wrap break-all border border-slate-800 max-h-[50vh] overflow-y-auto text-slate-200 leading-relaxed">{item.body_preview}</pre>
            </div>
          )}

          {active === "html" && item.body_html && (
            <div className="space-y-2" data-testid="q-tab-html">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">HTML Gövde (sandbox)</div>
                <button onClick={() => setRendered(v => !v)}
                        className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">
                  {rendered ? "Kodu göster" : "Sanitize önizleme"}
                </button>
              </div>
              {rendered ? (
                <div className="border border-slate-800 rounded overflow-hidden bg-white">
                  <iframe sandbox="" srcDoc={item.body_html} title="q-html" className="w-full min-h-[420px]" data-testid="q-html-iframe" />
                </div>
              ) : (
                <pre className="mono text-[10px] bg-slate-900/60 p-3 rounded whitespace-pre-wrap break-all border border-slate-800 max-h-[50vh] overflow-y-auto text-slate-400">{item.body_html}</pre>
              )}
              <div className="text-[9px] text-rose-500">⚠ Sandboxed iframe · script çalışmaz, hiçbir dış istek yapılmaz</div>
            </div>
          )}

          {active === "headers" && (
            <div className="space-y-2" data-testid="q-tab-headers">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Ham Başlıklar</div>
              <pre className="mono text-[10px] bg-slate-900/60 p-3 rounded whitespace-pre-wrap break-all border border-slate-800 max-h-[50vh] overflow-y-auto text-slate-300">{item.headers || item.headers_full || item.headers_preview || "(başlık kaydı yok)"}</pre>
            </div>
          )}

          {active === "attachments" && (
            <div className="space-y-2" data-testid="q-tab-attachments">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Ekler ({attachments.length})</div>
              {attachments.length === 0 ? (
                <div className="text-center text-xs text-slate-500 py-6 border border-dashed border-slate-800 rounded">Bu mesajda ek yok</div>
              ) : (
                <div className="space-y-2">
                  {attachments.map((a, i) => (
                    <div key={i} className={`p-3 rounded-lg border flex items-start gap-3 ${a.malware ? "border-rose-500/30 bg-rose-500/5" : "border-slate-800 bg-slate-900/40"}`}
                         data-testid={`q-attach-${i}`}>
                      <div className={`w-9 h-9 rounded flex items-center justify-center shrink-0 ${a.malware ? "bg-rose-500/20 text-rose-300" : "bg-slate-800 text-slate-400"}`}>📎</div>
                      <div className="flex-1 min-w-0">
                        <div className="mono text-sm font-medium text-slate-100 truncate" title={a.filename}>{a.filename}</div>
                        <div className="mono text-[10px] text-slate-500 flex gap-2 mt-0.5">
                          <span>{a.content_type || "?"}</span><span>·</span>
                          <span>{humanSize(a.size)}</span>
                          {a.sha256 && <><span>·</span><span title={a.sha256}>sha: {String(a.sha256).slice(0, 8)}…</span></>}
                        </div>
                        {a.malware && (
                          <div className="text-[11px] text-rose-300 mt-1">⚠ {a.malware}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-800">💡 Panel yalnızca meta veri saklar · ekler sunucunuzun spool'unda</div>
            </div>
          )}

          {active === "rules" && (
            <div className="space-y-2" data-testid="q-tab-rules">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Eşleşen Kurallar ({rules.length})</div>
              {rules.length === 0 ? (
                <div className="text-center text-xs text-slate-500 py-6">Kural eşleşmesi kaydı yok</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {rules.map((r) => (
                    <span key={r} className="mono text-[11px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-slate-300">{r}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {active === "engines" && (
            <div className="space-y-1.5" data-testid="q-tab-engines">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Motor Skorları</div>
              {engineList.map((k) => (
                <div key={k} className="flex justify-between text-xs bg-slate-900/60 px-3 py-2 rounded border border-slate-800">
                  <span className="mono text-slate-400">{k}</span>
                  <span className={`mono font-semibold ${typeof scores[k] === "number" && scores[k] >= 5 ? "text-rose-400" : "text-slate-300"}`}>
                    {typeof scores[k] === "number" ? scores[k].toFixed(2) : String(scores[k]).slice(0, 60)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 sticky bottom-0 flex gap-2 flex-wrap">
          <button onClick={() => onAction("report", item.id)}
                  className="text-xs px-3 py-1.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 inline-flex items-center gap-1"
                  data-testid="q-detail-report">
            <GraduationCap className="w-3 h-3" /> Bayes'e Öğret
          </button>
          <button onClick={() => onAction("release", item.id)}
                  className="text-xs px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 inline-flex items-center gap-1"
                  data-testid="q-detail-release">
            <RotateCcw className="w-3 h-3" /> Serbest Bırak
          </button>
          <button onClick={() => onAction("delete", item.id)}
                  className="text-xs px-3 py-1.5 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 inline-flex items-center gap-1 ml-auto"
                  data-testid="q-detail-delete">
            <Trash2 className="w-3 h-3" /> Sil
          </button>
        </div>
      </div>
    </>
  );
}
