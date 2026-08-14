import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, RotateCcw, GraduationCap, X, Mail, Server, Hash, Filter, BarChart3, Flame, Forward, Calendar, AlertTriangle, Calculator, Download, Eye } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useT, useI18n } from "@/i18n";
import SavedFiltersBar from "@/components/SavedFiltersBar";
import WebmailReader from "@/components/WebmailReader";

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
  const [ageFilter, setAgeFilter] = useState("all"); // all | 1d | 7d | 30d
  const [direction, setDirection] = useState("all"); // v43: all | in | out
  const [selected, setSelected] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const [webmailId, setWebmailId] = useState(null); // v43.23 — Gmail-style modal
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [fwdOpen, setFwdOpen] = useState(false);
  const locale = { tr: "tr-TR", en: "en-US", de: "de-DE", fr: "fr-FR", es: "es-ES", ar: "ar-SA" }[effective] || "en-US";

  const stats = useQuery({
    queryKey: ["quarantine-stats"],
    queryFn: () => api.quarantineStats(),
    refetchInterval: 30000,
  });

  const list = useQuery({
    queryKey: ["quarantine", search, verdict, engine, ageFilter, direction],
    queryFn: () => api.quarantine({
      search, verdict, engine, limit: 300,
      ...(direction !== "all" ? { direction } : {}),
    }),
    refetchInterval: 30000,
  });

  const rawRows = list.data || [];
  const rows = ageFilter === "all" ? rawRows : rawRows.filter(r => {
    if (!r.received_at) return true;
    const days = (Date.now() - new Date(r.received_at).getTime()) / (1000 * 60 * 60 * 24);
    return days <= ({ "1d": 1, "7d": 7, "30d": 30 }[ageFilter] || Infinity);
  });
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
      qc.invalidateQueries({ queryKey: ["quarantine-stats"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
    onError: () => toast.error(t("quarantine.fail_msg")),
  });

  const forwardMut = useMutation({
    mutationFn: ({ ids, to }) => api.quarantineForward({ ids, to }),
    onSuccess: (data) => {
      toast.success(`${data.forwarded}/${data.total} mesaj iletildi → ${data.to}`);
      setFwdOpen(false);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["quarantine"] });
    },
    onError: (e) => toast.error("İletim başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  const purgeMut = useMutation({
    mutationFn: ({ v, days }) => api.quarantinePurgeAll({ verdict: v, older_than_days: days }),
    onSuccess: (data) => {
      toast.success(`${data.deleted} kayıt kalıcı olarak silindi`);
      setPurgeOpen(false);
      qc.invalidateQueries({ queryKey: ["quarantine"] });
      qc.invalidateQueries({ queryKey: ["quarantine-stats"] });
    },
    onError: (e) => toast.error("Toplu temizleme başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  const rescoreMut = useMutation({
    mutationFn: () => api.eventsRescore(),
    onSuccess: (data) => {
      toast.success(`Skorlar yeniden hesaplandı: ${data.updated}/${data.scanned} kayıt düzeltildi (${data.fixed_verdicts} verdict değişti)`);
      qc.invalidateQueries({ queryKey: ["quarantine"] });
      qc.invalidateQueries({ queryKey: ["quarantine-stats"] });
      qc.invalidateQueries({ queryKey: ["queue-list"] });
      qc.invalidateQueries({ queryKey: ["queue-stats"] });
    },
    onError: (e) => toast.error("Yeniden hesaplama hatası: " + (e?.response?.data?.detail || e.message)),
  });

  const backfillMut = useMutation({
    mutationFn: () => api.eventsBackfill(),
    onSuccess: (data) => {
      toast.success(`Karantina dolduruldu: ${data.inserted} yeni kayıt eklendi (${data.already_in_quarantine} zaten vardı)`);
      qc.invalidateQueries({ queryKey: ["quarantine"] });
      qc.invalidateQueries({ queryKey: ["quarantine-stats"] });
    },
    onError: (e) => toast.error("Backfill hatası: " + (e?.response?.data?.detail || e.message)),
  });

  const runBulk = (action) => {
    if (selected.size === 0) return toast.error(t("quarantine.select_first"));
    bulk.mutate({ action, ids: Array.from(selected) });
  };

  return (
    <div className="p-6 space-y-4">
      {/* KPI band --------------------------------------------------------- */}
      <QuarantineKPIBand stats={stats.data} />

      {/* Direction tabs (v43) — Gelen / Giden / Tümü ---------------------- */}
      <div className="flex items-center gap-1 border-b border-slate-800" data-testid="q-direction-tabs">
        {[
          { key: "all", label: "Tümü", tone: "text-slate-300", active: "border-indigo-500 text-indigo-300" },
          { key: "in", label: "Gelen", tone: "text-slate-300", active: "border-emerald-500 text-emerald-300" },
          { key: "out", label: "Giden", tone: "text-slate-300", active: "border-amber-500 text-amber-300" },
        ].map((tab) => (
          <button
            key={tab.key}
            data-testid={`q-direction-${tab.key}`}
            onClick={() => setDirection(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              direction === tab.key
                ? tab.active
                : `border-transparent ${tab.tone} hover:text-slate-100`
            }`}
          >
            {tab.label}
            {direction === tab.key && (
              <span className="ml-1.5 mono text-[10px] opacity-70">({rows.length})</span>
            )}
          </button>
        ))}
      </div>

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
            <select data-testid="q-age" value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200"
              title="Tarih filtresi">
              <option value="all">Tüm tarihler</option>
              <option value="1d">Son 24 saat</option>
              <option value="7d">Son 7 gün</option>
              <option value="30d">Son 30 gün</option>
            </select>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="mono text-xs text-slate-500">{rows.length} {t("quarantine.records")}</span>
            <span className="mono text-xs text-indigo-400">{selected.size} {t("quarantine.selected")}</span>
          </div>
        </CardBody>
        <div className="px-3 pb-3 border-t border-slate-800 pt-2">
          <SavedFiltersBar
            module="quarantine"
            currentFilters={{ search, verdict, engine, ageFilter }}
            onLoad={(f) => {
              setSearch(f.search ?? "");
              setVerdict(f.verdict ?? "all");
              setEngine(f.engine ?? "all");
              setAgeFilter(f.ageFilter ?? "all");
            }}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
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
        <button data-testid="q-forward-open" onClick={() => {
            if (selected.size === 0) return toast.error(t("quarantine.select_first"));
            setFwdOpen(true);
          }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 text-sm">
          <Forward className="w-3.5 h-3.5" /> Farklı adrese ilet
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button data-testid="q-select-filtered" onClick={() => setSelected(new Set(rows.map(r => r.id)))}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800 text-xs"
            title="Filtreye uyan tüm kayıtları seç">
            Filtrelenmişleri seç ({rows.length})
          </button>
          <button data-testid="q-purge-open" onClick={() => setPurgeOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-sm font-medium"
            title="Filtreye uyan tümünü kalıcı olarak sil">
            <Flame className="w-3.5 h-3.5" /> Hepsini Temizle
          </button>
          <button data-testid="q-rescore" onClick={() => {
              if (!confirm("Tüm mail_events kayıtlarında SpamAssassin skoru üzerinden verdict yeniden hesaplanır. Devam edilsin mi?")) return;
              rescoreMut.mutate();
            }}
            disabled={rescoreMut.isPending}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-sm disabled:opacity-50"
            title="Plugin yanlış skorlar yolladıysa SA skoruna göre otomatik düzelt (ConfigServer Front-End paritesi)">
            <Calculator className="w-3.5 h-3.5" /> {rescoreMut.isPending ? "Hesaplanıyor…" : "Skorları Yeniden Hesapla"}
          </button>
          <button data-testid="q-backfill" onClick={() => {
              if (!confirm("mail_events içindeki tüm spam/virüs/phish kayıtları karantinaya taşınır (idempotent, dup yazmaz). Devam edilsin mi?")) return;
              backfillMut.mutate();
            }}
            disabled={backfillMut.isPending}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 text-sm disabled:opacity-50"
            title="Karantina sayfasında görünmüyor gibi görünen eski spam kayıtları buraya taşı">
            <Download className="w-3.5 h-3.5" /> {backfillMut.isPending ? "Dolduruluyor…" : "Karantinayı Doldur"}
          </button>
          <a data-testid="q-export-csv"
             href={api.eventsExport({ module: "quarantine", format: "csv",
               ...(verdict && verdict !== "all" ? { verdict } : {}),
               ...(search ? { subject_search: search } : {}) })}
             className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-sm"
             title="Filtreye uyan tüm kayıtları CSV olarak indir (max 50000)">
            <Download className="w-3.5 h-3.5" /> CSV İndir
          </a>
        </div>
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
                  <td className="px-4 py-2.5 text-right mono text-amber-300">{(r.score ?? r.total_score ?? 0).toFixed ? (r.score ?? r.total_score ?? 0).toFixed(2) : Number(r.score ?? r.total_score ?? 0).toFixed(2)}</td>
                  <td className="px-4 py-2.5">{verdictBadge(r.verdict)}</td>
                  <td className="px-4 py-2.5 mono text-xs text-slate-400 uppercase">
                    <div className="flex items-center gap-2">
                      <span>{r.engine}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setWebmailId(r.id); }}
                        data-testid={`q-webmail-${r.id}`}
                        title="Gmail-tarzı mail okuyucu"
                        className="text-cyan-400 hover:text-cyan-200 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
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

      {webmailId && (
        <WebmailReader
          eventId={webmailId}
          fetcher={api.quarantineContent}
          queryKey="quarantine-content"
          onClose={() => setWebmailId(null)}
        />
      )}

      {fwdOpen && (
        <ForwardDialog
          count={selected.size}
          onClose={() => setFwdOpen(false)}
          onConfirm={(to) => forwardMut.mutate({ ids: Array.from(selected), to })}
          pending={forwardMut.isPending}
        />
      )}

      {purgeOpen && (
        <PurgeAllDialog
          onClose={() => setPurgeOpen(false)}
          onConfirm={(v, days) => purgeMut.mutate({ v, days })}
          pending={purgeMut.isPending}
        />
      )}
    </div>
  );
}

/* -------- KPI Band ------------------------------------------------------ */
function QuarantineKPIBand({ stats }) {
  const items = [
    { label: "Toplam", value: stats?.total ?? "—", tone: "text-slate-100", testid: "kpi-total" },
    { label: "Bugün", value: stats?.today ?? "—", tone: "text-indigo-300", testid: "kpi-today" },
    { label: "Son 7 gün", value: stats?.week ?? "—", tone: "text-sky-300", testid: "kpi-week" },
    { label: "Teslim", value: stats?.released ?? "—", tone: "text-emerald-300", testid: "kpi-released" },
    { label: "Spam", value: stats?.verdicts?.spam ?? 0, tone: "text-amber-300", testid: "kpi-spam" },
    { label: "Virüs", value: stats?.verdicts?.virus ?? 0, tone: "text-rose-300", testid: "kpi-virus" },
    { label: "Phish", value: stats?.verdicts?.phish ?? 0, tone: "text-fuchsia-300", testid: "kpi-phish" },
  ];
  const dist = stats?.score_distribution || {};
  const distMax = Math.max(dist.clean || 0, dist.suspicious || 0, dist.spam || 0, dist.high_spam || 0, 1);
  const bars = [
    { label: "0–3", subtitle: "Temiz", value: dist.clean || 0, color: "bg-emerald-500/60", border: "border-emerald-500/40", testid: "hist-clean" },
    { label: "3–5", subtitle: "Şüpheli", value: dist.suspicious || 0, color: "bg-yellow-500/60", border: "border-yellow-500/40", testid: "hist-suspicious" },
    { label: "5–10", subtitle: "Spam", value: dist.spam || 0, color: "bg-amber-500/60", border: "border-amber-500/40", testid: "hist-spam" },
    { label: "10+", subtitle: "Yüksek", value: dist.high_spam || 0, color: "bg-rose-500/60", border: "border-rose-500/40", testid: "hist-high" },
  ];
  return (
    <Card>
      <CardBody className="p-3">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {items.map(it => (
            <div key={it.label} data-testid={it.testid}
                 className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">{it.label}</div>
              <div className={`mono text-lg font-semibold ${it.tone}`}>{it.value}</div>
            </div>
          ))}
        </div>

        {/* Skor kırılım histogram — SA skoruna göre 4 bucket (son 7 gün) */}
        <div className="mt-3 border-t border-slate-800 pt-3" data-testid="score-histogram">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-2">
              <BarChart3 className="w-3 h-3"/> SA Skor Dağılımı (son 7 gün)
            </div>
            <div className="text-[10px] text-slate-500 mono">
              {bars.reduce((s, b) => s + b.value, 0)} mail
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {bars.map(b => {
              const pct = distMax ? (b.value / distMax) * 100 : 0;
              return (
                <div key={b.label} data-testid={b.testid}
                     className={`rounded-md border ${b.border} bg-slate-950/60 p-2 flex flex-col justify-end min-h-[70px] relative overflow-hidden`}>
                  <div className={`absolute inset-x-0 bottom-0 ${b.color} transition-all`}
                       style={{ height: `${pct}%` }}/>
                  <div className="relative z-10">
                    <div className="mono text-sm font-semibold text-slate-100">{b.value}</div>
                    <div className="text-[10px] text-slate-300">{b.label} · {b.subtitle}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {stats?.top_senders?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5 items-center text-[11px]">
            <span className="text-slate-500 uppercase tracking-widest text-[10px] mr-1">En sık gönderici:</span>
            {stats.top_senders.map(s => (
              <span key={s.sender} className="mono px-2 py-0.5 rounded border border-slate-700 bg-slate-950 text-slate-300"
                    data-testid={`kpi-topsender-${s.sender}`}>
                {s.sender} <span className="text-slate-500">·{s.count}</span>
              </span>
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* -------- Forward dialog ------------------------------------------------- */
function ForwardDialog({ count, onClose, onConfirm, pending }) {
  const [to, setTo] = useState("");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="q-fwd-dialog">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-2xl">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-slate-100 font-semibold flex items-center gap-2"><Forward className="w-4 h-4"/> Farklı adrese ilet</h3>
            <p className="text-xs text-slate-400 mt-1">Seçilen <span className="text-indigo-300 mono">{count}</span> karantina mesajı belirlediğiniz adrese kopyalanır. Orijinal kayıt karantinada kalır.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400"><X className="w-4 h-4"/></button>
        </div>
        <label className="text-xs text-slate-400 uppercase tracking-widest">Hedef e-posta</label>
        <input value={to} onChange={(e) => setTo(e.target.value)}
               placeholder="admin@sirketiniz.com"
               data-testid="q-fwd-to"
               className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-slate-200 focus:outline-none focus:border-sky-500/60"/>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Vazgeç</button>
          <button onClick={() => valid && onConfirm(to)} disabled={!valid || pending}
                  data-testid="q-fwd-confirm"
                  className="text-xs px-3 py-1.5 rounded border border-sky-500/40 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
            {pending ? "İletiliyor…" : "İlet"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------- Purge-All dialog ---------------------------------------------- */
function PurgeAllDialog({ onClose, onConfirm, pending }) {
  const [verdict, setVerdict] = useState("all");
  const [days, setDays] = useState("");
  const [confirm, setConfirm] = useState("");
  const canGo = confirm.toLowerCase() === "sil";
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="q-purge-dialog">
      <div className="w-full max-w-md bg-slate-900 border border-rose-500/40 rounded-xl p-5 shadow-2xl">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-rose-200 font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4"/> Karantinayı Toplu Temizle</h3>
            <p className="text-xs text-slate-400 mt-1">Filtreye uyan <b>TÜM</b> karantina kayıtları kalıcı olarak silinir. Bu işlem geri alınamaz.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400"><X className="w-4 h-4"/></button>
        </div>

        <label className="text-xs text-slate-400 uppercase tracking-widest">Verdict filtresi</label>
        <select value={verdict} onChange={(e) => setVerdict(e.target.value)} data-testid="q-purge-verdict"
                className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200">
          <option value="all">Hepsi</option>
          <option value="spam">Sadece spam</option>
          <option value="high_spam">Sadece high_spam</option>
          <option value="virus">Sadece virüs</option>
          <option value="phish">Sadece phish</option>
        </select>

        <label className="text-xs text-slate-400 uppercase tracking-widest mt-3 block">Yaş (gün, opsiyonel)</label>
        <input value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))}
               placeholder="Örn: 30 (30 günden eski)"
               data-testid="q-purge-days"
               className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-slate-200"/>

        <label className="text-xs text-slate-400 uppercase tracking-widest mt-3 block">Onaylamak için &quot;sil&quot; yazın</label>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)}
               data-testid="q-purge-confirm-input"
               className="mt-1 w-full bg-slate-950 border border-rose-500/30 rounded-md px-3 py-2 text-sm mono text-rose-200"/>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">Vazgeç</button>
          <button onClick={() => canGo && onConfirm(verdict, days ? Number(days) : null)}
                  disabled={!canGo || pending}
                  aria-disabled={!canGo || pending}
                  data-testid="q-purge-confirm"
                  className={`text-xs px-3 py-1.5 rounded border transition ${
                    (!canGo || pending)
                      ? "border-slate-700 bg-slate-800 text-slate-500 cursor-not-allowed opacity-50 pointer-events-none"
                      : "border-rose-500/40 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30"
                  }`}>
            {pending ? "Siliniyor…" : "Kalıcı Olarak Sil"}
          </button>
        </div>
      </div>
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

        {/* Skor karşılaştırma bandı — Panel / MailScanner / SA */}
        <ScoreComparisonBand item={item} verdictColor={verdictColor}/>
        <ScoreTrendMini eventId={item.id}/>

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


/* -------- Skor Karşılaştırma Bandı ------------------------------------- */
function ScoreComparisonBand({ item, verdictColor }) {
  const scores = item.scores || {};
  const panelScore = Number(item.total_score ?? item.score ?? 0);
  // SA skoru → scores.spamassassin veya scores.sa
  const saScore = scores.spamassassin !== undefined ? Number(scores.spamassassin)
                : scores.sa !== undefined ? Number(scores.sa) : null;
  // MailScanner skoru → scores.mailscanner veya scores.msc veya scores.ms
  const msScore = scores.mailscanner !== undefined ? Number(scores.mailscanner)
                : scores.msc !== undefined ? Number(scores.msc)
                : scores.ms !== undefined ? Number(scores.ms) : null;
  const th = item.thresholds_used || { spam: 5, high_spam: 10 };
  const verdictFor = (s) => {
    if (s === null || s === undefined || Number.isNaN(s)) return null;
    if (s >= th.high_spam) return { label: "High Spam", color: "#f43f5e" };
    if (s >= th.spam) return { label: "Spam", color: "#f59e0b" };
    return { label: "Clean", color: "#10b981" };
  };
  const cells = [
    { title: "Panel Skoru", val: panelScore, verdict: verdictFor(panelScore),
      note: item.score_normalized ? "SA'dan normalize" : "Plugin toplam",
      testid: "score-panel" },
    { title: "MailScanner", val: msScore, verdict: verdictFor(msScore),
      note: msScore === null ? "Header eksik" : "X-MailScanner header",
      testid: "score-mailscanner" },
    { title: "SpamAssassin", val: saScore, verdict: verdictFor(saScore),
      note: saScore === null ? "SA çalışmamış" : "X-Spam-Score header",
      testid: "score-sa" },
  ];
  return (
    <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/40" data-testid="q-score-compare">
      <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-2">
        <span>Skor Karşılaştırma</span>
        <span className="text-slate-600">
          eşik: spam={th.spam} · high={th.high_spam}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {cells.map(c => (
          <div key={c.title} data-testid={c.testid}
               className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest">{c.title}</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="mono text-lg font-semibold"
                    style={{ color: c.verdict?.color || "#64748b" }}>
                {c.val === null || Number.isNaN(c.val) ? "—" : c.val.toFixed(2)}
              </span>
              {c.verdict && (
                <span className="text-[9px] uppercase font-medium"
                      style={{ color: c.verdict.color }}>
                  {c.verdict.label}
                </span>
              )}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">{c.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------- Skor Trend Mini Chart ---------------------------------------- */
function ScoreTrendMini({ eventId }) {
  const { data } = useQuery({
    queryKey: ["score-trend", eventId],
    queryFn: () => api.eventsScoreTrend(eventId, 24),
    enabled: !!eventId,
    staleTime: 60000,
  });
  const points = data?.points || [];
  if (points.length < 2) return null;
  const maxV = Math.max(15, ...points.map(p => Math.max(p.panel || 0, p.sa || 0, p.mailscanner || 0)));
  const W = 480, H = 90, PAD = 4;
  const toXY = (i, v) => [
    PAD + (i / (points.length - 1)) * (W - PAD * 2),
    H - PAD - ((v || 0) / maxV) * (H - PAD * 2),
  ];
  const linePath = (key) => points.map((p, i) => {
    if (p[key] === null || p[key] === undefined) return null;
    const [x, y] = toXY(i, p[key]);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter(Boolean).join(" ");
  return (
    <div className="px-5 py-3 border-b border-slate-800 bg-slate-950/40" data-testid="q-score-trend">
      <div className="text-[9px] uppercase tracking-widest text-slate-500 mb-1 flex items-center justify-between">
        <span>Skor Trendi — Aynı gönderici · son 24 saat · {points.length} kayıt</span>
        <span className="flex gap-2 text-[10px]">
          <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full bg-indigo-400"/>Panel</span>
          <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full bg-emerald-400"/>SA</span>
          <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full bg-amber-400"/>MailScanner</span>
        </span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block">
        {/* threshold guide lines (5 = spam, 10 = high_spam) */}
        {[5, 10].map(v => {
          const y = H - PAD - (v / maxV) * (H - PAD * 2);
          return <line key={v} x1={PAD} x2={W - PAD} y1={y} y2={y}
            stroke="#334155" strokeDasharray="2 3" strokeWidth="0.5"/>;
        })}
        <path d={linePath("panel")} fill="none" stroke="#818cf8" strokeWidth="1.5"/>
        <path d={linePath("sa")} fill="none" stroke="#34d399" strokeWidth="1.5"/>
        <path d={linePath("mailscanner")} fill="none" stroke="#fbbf24" strokeWidth="1.5"/>
      </svg>
    </div>
  );
}

