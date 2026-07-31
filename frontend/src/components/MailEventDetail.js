import { X, Shield, Clock, Server, Hash, User, Mail, FileText, ChevronRight } from "lucide-react";

/**
 * MailEventDetail — right-side slide-in drawer showing full event context.
 * Renders as portal-ish fixed panel; parent controls open/close via `event` prop.
 */
export default function MailEventDetail({ event, onClose, onAction }) {
  if (!event) return null;
  const scores = event.scores || {};
  const saReport = scores.sa_report;
  const isSpam = ["spam", "high_spam", "virus", "blocked"].includes(event.verdict);

  const verdictColor = {
    clean:       "#10b981",
    spam:        "#f59e0b",
    high_spam:   "#f43f5e",
    virus:       "#dc2626",
    blocked:     "#7c3aed",
    whitelisted: "#10b981",
  }[event.verdict] || "#64748b";

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 z-40"
        data-testid="mail-detail-backdrop"
      />
      {/* drawer */}
      <div
        className="fixed top-0 right-0 h-full w-full max-w-md bg-slate-950 border-l border-slate-800 z-50 overflow-y-auto shadow-2xl"
        data-testid="mail-detail-drawer"
      >
        <div className="sticky top-0 bg-slate-950 border-b border-slate-800 px-5 py-3 flex items-start justify-between z-10">
          <div>
            <div className="text-xs text-slate-500 mb-1 mono">MAIL DETAY</div>
            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0.5 rounded text-xs font-bold"
                style={{ background: `${verdictColor}22`, color: verdictColor }}
                data-testid="detail-verdict-chip"
              >
                {event.verdict?.toUpperCase()}
              </span>
              <span className="mono text-sm text-slate-300">
                score {event.total_score?.toFixed?.(2) ?? event.total_score}
              </span>
            </div>
          </div>
          <button onClick={onClose}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400"
                  data-testid="mail-detail-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Row icon={FileText} label="Konu">
            <div className="text-slate-100" data-testid="detail-subject">
              {event.subject || <span className="text-slate-500 italic">(yok)</span>}
            </div>
          </Row>
          <Row icon={User} label="Gönderen">
            <div className="mono text-slate-200 text-xs break-all" data-testid="detail-from">
              {event.from_addr || "-"}
            </div>
          </Row>
          <Row icon={Mail} label="Alıcı">
            <div className="mono text-slate-200 text-xs break-all" data-testid="detail-to">
              {event.to_addr || "-"}
            </div>
          </Row>
          <Row icon={Clock} label="Zaman">
            <div className="mono text-slate-300 text-xs">
              {event.ts && new Date(event.ts).toLocaleString("tr-TR", { hour12: false })}
            </div>
          </Row>
          <Row icon={Server} label="Sunucu">
            <div className="mono text-slate-300 text-xs">
              {event.server_hostname}
              {event.server_ip && <span className="text-slate-500"> · {event.server_ip}</span>}
            </div>
          </Row>
          {event.exim_mid && (
            <Row icon={Hash} label="Exim Message ID">
              <div className="mono text-indigo-300 text-xs break-all">{event.exim_mid}</div>
            </Row>
          )}
          <Row icon={Shield} label="Aksiyon">
            <div className="mono text-amber-300 text-xs">{event.action || "accept"}</div>
          </Row>

          {/* Engine scores breakdown */}
          {Object.keys(scores).filter(k => k !== "sa_report").length > 0 && (
            <div>
              <div className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Motor Skorları</div>
              <div className="space-y-1.5">
                {Object.entries(scores).filter(([k]) => k !== "sa_report").map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-xs bg-slate-900/60 px-3 py-1.5 rounded">
                    <span className="text-slate-400 mono">{k}</span>
                    <span className={`mono font-semibold ${
                      typeof v === "number" && v >= 5 ? "text-rose-400" : "text-slate-300"
                    }`}>{typeof v === "number" ? v.toFixed(2) : String(v).slice(0, 40)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {saReport && (
            <div>
              <div className="text-xs text-slate-500 mb-2 uppercase tracking-wider">SpamAssassin Rapor</div>
              <pre className="text-[10px] mono text-slate-400 bg-slate-900/60 p-3 rounded whitespace-pre-wrap break-all border border-slate-800 max-h-40 overflow-y-auto"
                   data-testid="detail-sa-report">{saReport}</pre>
            </div>
          )}

          {isSpam && event.exim_mid && (
            <div className="pt-3 border-t border-slate-800">
              <div className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Aksiyonlar</div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => onAction?.("delete", event)}
                  className="text-xs px-3 py-1.5 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition"
                  data-testid="detail-action-delete"
                >Sil (exim -Mrm)</button>
                <button
                  onClick={() => onAction?.("release", event)}
                  className="text-xs px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition"
                  data-testid="detail-action-release"
                >Serbest Bırak (exim -M)</button>
                <button
                  onClick={() => onAction?.("report_spam", event)}
                  className="text-xs px-3 py-1.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition"
                  data-testid="detail-action-report"
                >Spam Öğret (sa-learn)</button>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                Aksiyon sunucudaki logtail daemon tarafından ~10sn içinde uygulanır (Exim spool'unda gerçek işlem).
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex gap-3">
      <Icon className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
        {children}
      </div>
    </div>
  );
}
