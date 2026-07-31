import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X, Shield, Clock, Server, Hash, User, Mail, FileText, Paperclip, AlertOctagon,
  Code2, Ban, Send, Bug, Copy, Download, ShieldOff,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

/**
 * MailEventDetail — full-content drawer with body preview, HTML view, headers, attachments
 * and one-click "Mark as Spam" (adds sender to blacklist + queues sa-learn).
 */
export default function MailEventDetail({ event, onClose, onAction }) {
  const licenseKey = (event?.license_key)
    || (typeof window !== "undefined" && localStorage.getItem("gws.event_license"))
    || "";

  const qc = useQueryClient();
  const [tab, setTab] = useState("body"); // body | html | headers | attachments | scores
  const [rendered, setRendered] = useState(false);

  // Fetch full event (body + headers + attachments) on demand
  const full = useQuery({
    queryKey: ["event-full", event?.id],
    queryFn: () => api.eventGet(licenseKey, event.id),
    enabled: !!event?.id && !!licenseKey,
    retry: false,
    staleTime: 30000,
  });

  const markSpam = useMutation({
    mutationFn: () => api.eventMarkSpam(licenseKey, event?.id),
    onSuccess: (data) => {
      toast.success(
        `✓ SPAM olarak işaretlendi${data.blacklisted ? ` · ${data.blacklisted} kara listeye eklendi` : ""}`,
        { duration: 6000 }
      );
      qc.invalidateQueries({ queryKey: ["live-events"] });
      qc.invalidateQueries({ queryKey: ["live-events-summary"] });
      qc.invalidateQueries({ queryKey: ["event-full", event?.id] });
      onClose?.();
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "İşaretleme başarısız"),
  });

  if (!event) return null;
  const e = full.data || event;

  const scores = e.scores || {};
  const saReport = scores.sa_report;
  const isSpam = ["spam", "high_spam", "virus", "blocked"].includes(e.verdict);

  const verdictColor = {
    clean:       "#10b981",
    spam:        "#f59e0b",
    high_spam:   "#f43f5e",
    virus:       "#dc2626",
    blocked:     "#7c3aed",
    whitelisted: "#10b981",
  }[e.verdict] || "#64748b";

  const attachments = Array.isArray(e.attachments) ? e.attachments : [];
  const hasBody     = !!e.body_preview;
  const hasHtml     = !!e.body_html;
  const hasHeaders  = !!e.headers_full || !!e.headers_preview;
  const hasScores   = Object.keys(scores).filter(k => k !== "sa_report").length > 0;

  const copyText = async (text, label) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${label} kopyalandı`); }
    catch { toast.error("Kopyalanamadı"); }
  };

  const humanSize = (n) => {
    if (!n) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  };

  const availableTabs = [
    hasBody     && { key: "body",        label: "Gövde",     Icon: FileText, count: null },
    hasHtml     && { key: "html",        label: "HTML",      Icon: Code2, count: null },
    hasHeaders  && { key: "headers",     label: "Başlıklar", Icon: Mail, count: null },
    { key: "attachments", label: "Ekler",     Icon: Paperclip, count: attachments.length },
    hasScores   && { key: "scores",      label: "Motorlar",  Icon: Shield, count: null },
    saReport    && { key: "sa",          label: "SA Rapor",  Icon: AlertOctagon, count: null },
  ].filter(Boolean);
  const activeTab = availableTabs.find(t => t.key === tab)?.key || availableTabs[0]?.key || "body";

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/60 z-40" data-testid="mail-detail-backdrop" />
      <div
        className="fixed top-0 right-0 h-full w-full max-w-2xl bg-slate-950 border-l border-slate-800 z-50 overflow-y-auto shadow-2xl"
        data-testid="mail-detail-drawer"
      >
        {/* Header */}
        <div className="sticky top-0 bg-slate-950 border-b border-slate-800 px-5 py-3 flex items-start justify-between z-10">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-slate-500 mono uppercase tracking-widest">MAIL DETAY</div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span
                className="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
                style={{ background: `${verdictColor}22`, color: verdictColor }}
                data-testid="detail-verdict-chip"
              >{e.verdict}</span>
              <span className="mono text-sm text-slate-300">
                skor {e.total_score?.toFixed?.(2) ?? e.total_score}
              </span>
              <span className="text-[11px] text-slate-500 mono truncate">
                {e.ts && new Date(e.ts).toLocaleString("tr-TR", { hour12: false })}
              </span>
            </div>
            <div className="text-slate-100 mt-2 font-medium text-[15px] leading-tight truncate" data-testid="detail-subject" title={e.subject}>
              {e.subject || <span className="text-slate-500 italic">(konu yok)</span>}
            </div>
            <div className="text-xs text-slate-400 mono mt-1 truncate" data-testid="detail-from">
              <User className="w-3 h-3 inline mr-1 -mt-0.5 text-slate-500" />
              {e.from_addr || "-"}
              <span className="text-slate-600 mx-2">→</span>
              {e.to_addr || "-"}
            </div>
          </div>
          <button onClick={onClose}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400"
                  data-testid="mail-detail-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Meta strip */}
        <div className="px-5 py-2.5 border-b border-slate-800 grid grid-cols-3 gap-3 text-[11px] mono bg-slate-900/40">
          <div className="min-w-0">
            <div className="text-slate-500 text-[9px] uppercase tracking-widest">Sunucu</div>
            <div className="text-slate-300 truncate">{e.server_hostname || "-"}</div>
          </div>
          <div className="min-w-0">
            <div className="text-slate-500 text-[9px] uppercase tracking-widest">IP</div>
            <div className="text-slate-300 truncate">{e.server_ip || "-"}</div>
          </div>
          <div className="min-w-0">
            <div className="text-slate-500 text-[9px] uppercase tracking-widest">Exim MID</div>
            <div className="text-indigo-300 truncate" title={e.exim_mid}>{e.exim_mid || "-"}</div>
          </div>
        </div>

        {/* MARK AS SPAM primary CTA */}
        {!isSpam && (
          <div className="px-5 py-3 border-b border-slate-800 bg-gradient-to-r from-rose-500/10 to-transparent">
            <button
              onClick={() => markSpam.mutate()}
              disabled={markSpam.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 text-white text-sm font-bold shadow-lg shadow-rose-500/25 hover:shadow-rose-500/40 disabled:opacity-50 transition"
              data-testid="detail-mark-spam"
            >
              <ShieldOff className="w-4 h-4" />
              {markSpam.isPending ? "İşaretleniyor…" : "Bu SPAM · Kara Listeye Ekle + Filtreye Öğret"}
            </button>
            <div className="text-[10px] text-slate-500 mt-1 text-center">
              Gönderen ({e.from_addr}) blacklist'e eklenir · sa-learn kuyruğa yazılır · verdict "high_spam" olur
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="px-5 pt-3 border-b border-slate-800 flex gap-1 overflow-x-auto">
          {availableTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-t-md border-b-2 whitespace-nowrap transition ${
                activeTab === t.key
                  ? "border-indigo-400 text-indigo-300 bg-slate-900/50"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
              data-testid={`detail-tab-${t.key}`}
            >
              <t.Icon className="w-3.5 h-3.5" />
              {t.label}
              {t.count !== null && t.count !== undefined && (
                <span className="text-[10px] mono px-1.5 rounded bg-slate-800 text-slate-400">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-5 min-h-[200px]">
          {full.isLoading && (
            <div className="text-center text-xs text-slate-500 py-8">Detaylar yükleniyor…</div>
          )}

          {activeTab === "body" && hasBody && (
            <div className="space-y-2" data-testid="detail-tab-body-content">
              <div className="flex justify-between items-center">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Metin Gövdesi</div>
                <button onClick={() => copyText(e.body_preview, "Gövde")}
                        className="text-[10px] text-slate-400 hover:text-slate-200 inline-flex items-center gap-1">
                  <Copy className="w-2.5 h-2.5" /> kopyala
                </button>
              </div>
              <pre className="text-xs mono text-slate-200 bg-slate-900/60 p-3 rounded whitespace-pre-wrap break-all border border-slate-800 max-h-[45vh] overflow-y-auto leading-relaxed">
{e.body_preview}
              </pre>
            </div>
          )}

          {activeTab === "html" && hasHtml && (
            <div className="space-y-2" data-testid="detail-tab-html-content">
              <div className="flex justify-between items-center gap-2">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">HTML Gövde</div>
                <div className="flex gap-1">
                  <button onClick={() => setRendered(v => !v)}
                          className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">
                    {rendered ? "Kodu göster" : "Sanitize edilmiş önizleme"}
                  </button>
                  <button onClick={() => copyText(e.body_html, "HTML")}
                          className="text-[10px] text-slate-400 hover:text-slate-200 inline-flex items-center gap-1 px-1">
                    <Copy className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
              {rendered ? (
                <div className="text-xs text-slate-800 bg-white p-3 rounded max-h-[45vh] overflow-auto border border-slate-800">
                  <iframe
                    sandbox=""
                    srcDoc={e.body_html}
                    title="mail-html-preview"
                    className="w-full min-h-[300px] bg-white"
                    data-testid="detail-html-iframe"
                  />
                  <div className="text-[9px] text-rose-500 mt-1">
                    ⚠ İçerik izole sandbox iframe'de gösterilir — hiçbir script veya harici istek çalışmaz
                  </div>
                </div>
              ) : (
                <pre className="text-[10px] mono text-slate-300 bg-slate-900/60 p-3 rounded whitespace-pre-wrap break-all border border-slate-800 max-h-[45vh] overflow-y-auto">
{e.body_html}
                </pre>
              )}
            </div>
          )}

          {activeTab === "headers" && hasHeaders && (
            <div className="space-y-2" data-testid="detail-tab-headers-content">
              <div className="flex justify-between items-center">
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Ham Başlıklar</div>
                <button onClick={() => copyText(e.headers_full || e.headers_preview, "Başlıklar")}
                        className="text-[10px] text-slate-400 hover:text-slate-200 inline-flex items-center gap-1">
                  <Copy className="w-2.5 h-2.5" /> kopyala
                </button>
              </div>
              <pre className="text-[10px] mono text-slate-300 bg-slate-900/60 p-3 rounded whitespace-pre-wrap break-all border border-slate-800 max-h-[45vh] overflow-y-auto leading-relaxed">
{e.headers_full || e.headers_preview}
              </pre>
            </div>
          )}

          {activeTab === "attachments" && (
            <div className="space-y-2" data-testid="detail-tab-attachments-content">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
                Ekler ({attachments.length})
              </div>
              {attachments.length === 0 ? (
                <div className="text-center text-xs text-slate-500 py-6 border border-dashed border-slate-800 rounded">
                  Bu mailde ek yok
                </div>
              ) : (
                <div className="space-y-2">
                  {attachments.map((a, i) => (
                    <div key={i} className={`p-3 rounded-lg border flex items-start gap-3 ${
                      a.malware ? "border-rose-500/30 bg-rose-500/5" : "border-slate-800 bg-slate-900/40"
                    }`} data-testid={`detail-attachment-${i}`}>
                      <div className={`w-9 h-9 rounded flex items-center justify-center shrink-0 ${
                        a.malware ? "bg-rose-500/20 text-rose-300" : "bg-slate-800 text-slate-400"
                      }`}>
                        {a.malware ? <Bug className="w-4 h-4" /> : <Paperclip className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-slate-100 text-sm font-medium truncate mono" title={a.filename}>
                          {a.filename}
                        </div>
                        <div className="text-[10px] text-slate-500 mono flex flex-wrap gap-2 mt-0.5">
                          <span>{a.content_type || "?"}</span>
                          <span>·</span>
                          <span>{humanSize(a.size)}</span>
                          {a.sha256 && <><span>·</span><span title={a.sha256}>sha256: {String(a.sha256).slice(0, 8)}…</span></>}
                        </div>
                        {a.malware && (
                          <div className="text-[11px] text-rose-300 mt-1 flex items-center gap-1">
                            <AlertOctagon className="w-3 h-3" /> Zararlı: <span className="mono">{a.malware}</span>
                          </div>
                        )}
                      </div>
                      {!a.malware && (
                        <button className="p-1.5 rounded hover:bg-slate-800 text-slate-400" title="Sadece meta veri saklanır — dosya sunucudadır">
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-800">
                💡 Panel yalnızca ek meta verisini (isim, boyut, hash, malware raporu) saklar — mail içeriği ve ekler sunucunuzun spool'unda kalır (KVKK uyumu için)
              </div>
            </div>
          )}

          {activeTab === "scores" && hasScores && (
            <div className="space-y-1.5" data-testid="detail-tab-scores-content">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Motor Skorları</div>
              {Object.entries(scores).filter(([k]) => k !== "sa_report").map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-xs bg-slate-900/60 px-3 py-2 rounded border border-slate-800">
                  <span className="text-slate-400 mono">{k}</span>
                  <span className={`mono font-semibold ${
                    typeof v === "number" && v >= 5 ? "text-rose-400" : "text-slate-300"
                  }`}>{typeof v === "number" ? v.toFixed(2) : String(v).slice(0, 60)}</span>
                </div>
              ))}
            </div>
          )}

          {activeTab === "sa" && saReport && (
            <div className="space-y-2" data-testid="detail-tab-sa-content">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">SpamAssassin Ham Rapor</div>
              <pre className="text-[10px] mono text-slate-400 bg-slate-900/60 p-3 rounded whitespace-pre-wrap break-all border border-slate-800 max-h-[45vh] overflow-y-auto">
{saReport}
              </pre>
            </div>
          )}
        </div>

        {/* Actions footer */}
        {isSpam && e.exim_mid && (
          <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/80 sticky bottom-0">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Kuyruk Aksiyonları</div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => onAction?.("delete", e)}
                className="text-xs px-3 py-1.5 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition inline-flex items-center gap-1"
                data-testid="detail-action-delete"
              ><Ban className="w-3 h-3" /> Sil (exim -Mrm)</button>
              <button
                onClick={() => onAction?.("release", e)}
                className="text-xs px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition inline-flex items-center gap-1"
                data-testid="detail-action-release"
              ><Send className="w-3 h-3" /> Serbest Bırak (exim -M)</button>
              <button
                onClick={() => onAction?.("report_spam", e)}
                className="text-xs px-3 py-1.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition inline-flex items-center gap-1"
                data-testid="detail-action-report"
              ><Shield className="w-3 h-3" /> Spam Öğret (sa-learn)</button>
            </div>
            <p className="text-[10px] text-slate-500 mt-2">
              Aksiyon sunucudaki logtail daemon tarafından ~10sn içinde spool'da uygulanır
            </p>
          </div>
        )}
      </div>
    </>
  );
}
