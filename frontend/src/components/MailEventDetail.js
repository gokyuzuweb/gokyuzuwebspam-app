import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X, Shield, Clock, Server, Hash, User, Mail, FileText, Paperclip, AlertOctagon,
  Code2, Ban, Send, Bug, Copy, Download, ShieldOff, Sparkles, Globe, Lock,
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
  const [tab, setTab] = useState("summary"); // summary | body | html | headers | attachments | scores | sa
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

  const markNotSpam = useMutation({
    mutationFn: () => api.whitelistFromEvent(licenseKey, event?.id),
    onSuccess: (data) => {
      toast.success(`✓ Whitelist'e eklendi · ${data.whitelisted}${data.sent_release ? " · release kuyruğa yazıldı" : ""}`,
                    { duration: 6000 });
      qc.invalidateQueries({ queryKey: ["live-events"] });
      qc.invalidateQueries({ queryKey: ["live-events-summary"] });
      qc.invalidateQueries({ queryKey: ["event-full", event?.id] });
      onClose?.();
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "İşlem başarısız"),
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
    { key: "summary", label: "Özet", Icon: FileText, count: null },
    hasBody     && { key: "body",        label: "Gövde",     Icon: FileText, count: null },
    hasHtml     && { key: "html",        label: "HTML",      Icon: Code2, count: null },
    hasHeaders  && { key: "headers",     label: "Başlıklar", Icon: Mail, count: null },
    { key: "attachments", label: "Ekler",     Icon: Paperclip, count: attachments.length },
    hasScores   && { key: "scores",      label: "Motorlar",  Icon: Shield, count: null },
    saReport    && { key: "sa",          label: "SA Rapor",  Icon: AlertOctagon, count: null },
  ].filter(Boolean);
  const activeTab = availableTabs.find(t => t.key === tab)?.key || availableTabs[0]?.key || "summary";

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

        {/* SENDER IP · COUNTRY · BLOCK */}
        <SenderIPPanel event={e} licenseKey={licenseKey} />

        {/* MARK AS SPAM / NOT SPAM primary CTA */}
        <div className="px-5 py-3 border-b border-slate-800 bg-gradient-to-r from-rose-500/10 to-emerald-500/10 space-y-2">
          {!isSpam ? (
            <button
              onClick={() => markSpam.mutate()}
              disabled={markSpam.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 text-white text-sm font-bold shadow-lg shadow-rose-500/25 hover:shadow-rose-500/40 disabled:opacity-50 transition"
              data-testid="detail-mark-spam"
            >
              <ShieldOff className="w-4 h-4" />
              {markSpam.isPending ? "İşaretleniyor…" : "Bu SPAM · Kara Listeye Ekle + Filtreye Öğret"}
            </button>
          ) : (
            <button
              onClick={() => markNotSpam.mutate()}
              disabled={markNotSpam.isPending}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-bold shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 disabled:opacity-50 transition"
              data-testid="detail-mark-not-spam"
            >
              <Shield className="w-4 h-4" />
              {markNotSpam.isPending ? "İşleniyor…" : "Bu SPAM Değil · Otomatik Whitelist + Serbest Bırak"}
            </button>
          )}
          <div className="text-[10px] text-slate-500 text-center">
            {!isSpam
              ? "Gönderen blacklist'e eklenir · sa-learn kuyruğa yazılır · verdict → high_spam"
              : "Gönderen whitelist'e eklenir · kuyruktan serbest bırakılır · verdict → whitelisted"}
          </div>
        </div>

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

          {activeTab === "summary" && (
            <div className="space-y-3" data-testid="detail-tab-summary-content">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Mail Özeti</div>
              <SumRow label="Konu" value={e.subject || "(yok)"} copy={() => copyText(e.subject || "", "Konu")} />
              <SumRow label="Gönderen" value={e.from_addr || "-"} mono copy={() => copyText(e.from_addr || "", "Gönderen")} />
              <SumRow label="Alıcı"    value={e.to_addr   || "-"} mono copy={() => copyText(e.to_addr   || "", "Alıcı")} />
              <SumRow label="Verdict"  value={<span style={{ color: verdictColor }} className="uppercase font-semibold">{e.verdict}</span>} />
              <SumRow label="Skor"     value={<span className="mono">{typeof e.total_score === "number" ? e.total_score.toFixed(2) : e.total_score}</span>} />
              <SumRow label="Aksiyon"  value={<span className="mono uppercase text-xs">{e.action || "-"}</span>} />
              <SumRow label="Exim MID" value={e.exim_mid || "-"} mono copy={() => copyText(e.exim_mid || "", "Exim MID")} />
              <SumRow label="Sunucu"   value={e.server_hostname || "-"} mono />
              <SumRow label="Sunucu IP"value={e.server_ip || "-"} mono />
              <SumRow label="Zaman"    value={e.ts ? new Date(e.ts).toLocaleString("tr-TR", { hour12: false }) : "-"} mono />
              {hasScores && (
                <div className="pt-2 border-t border-slate-800 mt-3">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Motor Skorları</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(scores).filter(([k]) => k !== "sa_report").map(([k, v]) => (
                      <span key={k} className="mono text-[11px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-slate-300">
                        {k}: <span className={typeof v === "number" && v >= 5 ? "text-rose-400 font-semibold" : "text-slate-100"}>{typeof v === "number" ? v.toFixed(2) : String(v).slice(0, 30)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!hasBody && !hasHtml && !hasHeaders && attachments.length === 0 && (
                <div className="mt-3 p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
                  ⚠ Bu mailin gövdesi, başlıkları ve ekleri henüz panele senkronize edilmedi.
                  WHM plugin'inizi güncelledikten sonra (↻ Guncelle) yeni mailler tam içerikle gelecek.
                  Eski kayıtlar sadece meta veriyle gösterilir.
                </div>
              )}

              {/* AI-powered natural-language explanation */}
              <AIExplainPanel event={e} isSpam={isSpam} />
            </div>
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

function SumRow({ label, value, mono, copy }) {
  return (
    <div className="flex items-start gap-2 text-xs group">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 w-24 pt-0.5 shrink-0">{label}</div>
      <div className={`flex-1 min-w-0 break-all ${mono ? "mono" : ""} text-slate-200`}>{value}</div>
      {copy && (
        <button onClick={copy}
                className="opacity-0 group-hover:opacity-100 transition text-slate-500 hover:text-slate-200 shrink-0 p-0.5"
                title="Kopyala">
          <Copy className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/* --------------------------- Sender IP panel ------------------------------ */
const CC_FLAG = (cc) => cc && cc.length === 2 && cc !== "LOCAL"
  ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 127397 + c.charCodeAt(0))) : "🌐";
const CC_NAME = {
  US: "ABD", CN: "Çin", RU: "Rusya", DE: "Almanya", TR: "Türkiye", GB: "Birleşik Krallık",
  IN: "Hindistan", BR: "Brezilya", JP: "Japonya", KR: "G. Kore", NL: "Hollanda",
  FR: "Fransa", IT: "İtalya", ES: "İspanya", CA: "Kanada", AU: "Avustralya",
  UA: "Ukrayna", PL: "Polonya", VN: "Vietnam", TH: "Tayland", ID: "Endonezya",
  IR: "İran", PK: "Pakistan", EG: "Mısır", SA: "S. Arabistan", ZA: "G. Afrika",
  LOCAL: "Yerel Ağ",
};

function SenderIPPanel({ event, licenseKey }) {
  const qc = useQueryClient();
  const ip = event.sender_ip || event.client_ip;
  const status = useQuery({
    queryKey: ["ip-status", ip],
    queryFn: () => api.ipStatus(ip),
    enabled: !!ip,
    staleTime: 30000,
  });
  const block = useMutation({
    mutationFn: () => api.ipBlock({ ip, license_key: licenseKey,
      reason: `Mail: ${event.subject || event.id?.slice(0,8)}` }),
    onSuccess: () => {
      toast.success(`✓ ${ip} kalıcı olarak bloklandı`);
      qc.invalidateQueries({ queryKey: ["ip-status", ip] });
      qc.invalidateQueries({ queryKey: ["live-events"] });
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Blok başarısız"),
  });
  const unblock = useMutation({
    mutationFn: () => api.ipUnblock({ ip }),
    onSuccess: () => {
      toast.success(`✓ ${ip} bloğu kaldırıldı`);
      qc.invalidateQueries({ queryKey: ["ip-status", ip] });
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "İşlem başarısız"),
  });

  if (!ip) return null;
  const s = status.data || {};
  const cc = s.country;
  const isBlocked = s.blocked;
  const flag = CC_FLAG(cc);
  const country = CC_NAME[cc] || cc || "Bilinmiyor";

  return (
    <div className="px-5 py-3 border-b border-slate-800 bg-slate-900/30">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
        <Globe className="w-3 h-3"/> Gönderen Kaynağı
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-2xl leading-none" title={country}>{flag}</span>
          <div className="min-w-0">
            <div className="mono text-sm text-slate-100 truncate" data-testid="detail-sender-ip">{ip}</div>
            <div className="text-[11px] text-slate-500">
              {country}{" · "}
              {s.total_events !== undefined && <span>{s.total_events} mail</span>}
              {s.spam_events > 0 && <span className="text-rose-400"> · {s.spam_events} spam</span>}
            </div>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {!isBlocked ? (
            <button
              onClick={() => block.mutate()}
              disabled={block.isPending}
              className="text-xs px-3 py-1.5 rounded bg-rose-500/20 text-rose-200 border border-rose-500/40 hover:bg-rose-500/30 disabled:opacity-40 inline-flex items-center gap-1.5"
              data-testid="detail-block-ip"
            ><Ban className="w-3 h-3"/> IP'yi Blokla</button>
          ) : (
            <button
              onClick={() => unblock.mutate()}
              disabled={unblock.isPending}
              className="text-xs px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40 inline-flex items-center gap-1.5"
              data-testid="detail-unblock-ip"
            ><Lock className="w-3 h-3"/> Bloğu Kaldır</button>
          )}
          <a
            href={`/panel?ip=${encodeURIComponent(ip)}`}
            className="text-xs px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 inline-flex items-center gap-1.5"
            title="Bu IP'den gelen tüm maillerı filtrele"
          ><FileText className="w-3 h-3"/> Trafiği Gör</a>
        </div>
      </div>
      {isBlocked && (
        <div className="mt-2 text-[10px] text-rose-300 flex items-center gap-1">
          <ShieldOff className="w-3 h-3"/> BU IP AKTİF BLOK LİSTESİNDE — yeni mailler otomatik reddedilir
        </div>
      )}
    </div>
  );
}

/* --------------------------- AI explanation panel ------------------------- */
function AIExplainPanel({ event, isSpam }) {
  const [state, setState] = useState({ loading: false, text: null, cached: false, error: null });
  const explain = async () => {
    setState({ loading: true, text: null, cached: false, error: null });
    try {
      const r = await api.aiExplainSpam({
        sender: event.from_addr,
        recipient: event.to_addr,
        subject: event.subject,
        body_preview: event.body_preview,
        verdict: event.verdict,
        score: event.total_score,
        rules_matched: event.rules_matched,
        scores: event.scores,
      });
      setState({ loading: false, text: r.text, cached: r.cached, error: null });
    } catch (err) {
      const msg = err?.response?.data?.detail || "AI açıklama alınamadı";
      setState({ loading: false, text: null, cached: false, error: msg });
      toast.error(msg);
    }
  };
  return (
    <div className="mt-4 p-3 rounded-lg border border-indigo-500/25 bg-gradient-to-br from-indigo-500/10 via-slate-900/40 to-transparent" data-testid="ai-explain-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-xs font-medium text-slate-100">AI Açıklama</span>
          {state.cached && <span className="text-[9px] mono px-1 rounded bg-slate-800 text-slate-500">önbellek</span>}
        </div>
        {!state.text && !state.loading && (
          <button
            onClick={explain}
            className="text-[11px] px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30 font-medium inline-flex items-center gap-1"
            data-testid="ai-explain-btn"
          >
            <Sparkles className="w-3 h-3" />
            {isSpam ? "Neden Spam?" : "Bu mail hakkında"}
          </button>
        )}
      </div>
      {state.loading && (
        <div className="text-xs text-slate-400 flex items-center gap-2 animate-pulse">
          <Sparkles className="w-3 h-3 text-indigo-400 animate-spin" />
          Claude düşünüyor…
        </div>
      )}
      {state.text && (
        <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap" data-testid="ai-explain-text">
          {state.text}
        </p>
      )}
      {state.error && (
        <p className="text-xs text-rose-300">{state.error}</p>
      )}
      {!state.text && !state.loading && !state.error && (
        <p className="text-[10px] text-slate-500">
          Bu maili neden spam/temiz olarak sınıflandırdığımızı yapay zekaya sade Türkçe ile açıklat.
        </p>
      )}
    </div>
  );
}
