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
        <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <div data-testid="q-preview-modal" className="w-full max-w-3xl max-h-[85vh] bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-slate-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">{verdictBadge(preview.verdict)}
                  <span className="mono text-xs text-amber-300">{preview.score.toFixed(2)}</span>
                  <span className="mono text-xs text-slate-500 uppercase">{preview.engine}</span>
                </div>
                <h2 className="text-lg font-semibold text-slate-100 truncate">{preview.subject}</h2>
                <p className="text-xs text-slate-500 mono truncate">{preview.sender} → {preview.recipient}</p>
              </div>
              <button onClick={() => setPreview(null)} data-testid="q-preview-close" className="text-slate-500 hover:text-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 border-b border-slate-800 text-xs">
              <div className="p-4 border-r border-slate-800">
                <div className="text-slate-500 uppercase tracking-widest text-[10px] mb-1 flex items-center gap-1"><Server className="w-3 h-3"/> {t("quarantine.modal_ip")}</div>
                <div className="mono text-slate-200">{preview.sender_ip}</div>
              </div>
              <div className="p-4 border-r border-slate-800">
                <div className="text-slate-500 uppercase tracking-widest text-[10px] mb-1 flex items-center gap-1"><Mail className="w-3 h-3"/> {t("quarantine.modal_size")}</div>
                <div className="mono text-slate-200">{preview.size_kb} KB</div>
              </div>
              <div className="p-4">
                <div className="text-slate-500 uppercase tracking-widest text-[10px] mb-1 flex items-center gap-1"><Hash className="w-3 h-3"/> {t("quarantine.modal_rules_count")}</div>
                <div className="mono text-slate-200">{preview.rules_matched?.length || 0}</div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="p-5">
                <h4 className="text-xs uppercase tracking-widest text-slate-500 mb-2">{t("quarantine.matched_rules")}</h4>
                <div className="flex flex-wrap gap-1.5 mb-5">
                  {(preview.rules_matched || []).map((r) => (
                    <span key={r} className="mono text-[11px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-slate-300">{r}</span>
                  ))}
                </div>
                <h4 className="text-xs uppercase tracking-widest text-slate-500 mb-2">{t("quarantine.headers")}</h4>
                <pre className="mono text-[11px] bg-slate-950 border border-slate-800 rounded p-3 text-slate-400 overflow-x-auto mb-5">{preview.headers}</pre>
                <h4 className="text-xs uppercase tracking-widest text-slate-500 mb-2">{t("quarantine.body_preview")}</h4>
                <pre className="mono text-[12px] bg-slate-950 border border-slate-800 rounded p-3 text-slate-300 whitespace-pre-wrap">{preview.body_preview}</pre>
              </div>
            </div>
            <div className="p-4 border-t border-slate-800 flex items-center justify-end gap-2">
              <button data-testid="q-preview-report" onClick={() => { bulk.mutate({ action: "report", ids: [preview.id] }); setPreview(null); }}
                className="px-3 py-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 text-sm">
                {t("quarantine.teach_bayes")}
              </button>
              <button data-testid="q-preview-delete" onClick={() => { bulk.mutate({ action: "delete", ids: [preview.id] }); setPreview(null); }}
                className="px-3 py-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-sm">
                {t("quarantine.preview_delete")}
              </button>
              <button data-testid="q-preview-release" onClick={() => { bulk.mutate({ action: "release", ids: [preview.id] }); setPreview(null); }}
                className="px-3 py-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-sm">
                {t("quarantine.preview_release")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
