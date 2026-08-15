/**
 * v43.23 — Gmail-style Mail Reader Modal
 *
 * Shared component used by both Outbound and Quarantine pages. Receives an
 * `eventId` (or item id), a `fetcher` function that returns normalized mail
 * content (see backend `/api/outbound/event/{id}/content` and
 * `/api/quarantine/{id}/content` — both share the same response schema), and
 * an `onClose` handler.
 *
 * Expected content shape:
 *   { id, ts, from_addr, from_user, to_addr, subject, verdict, total_score,
 *     scores, sender_ip, size_bytes, message_id, headers_full, body_preview,
 *     body_html, attachments[], action, clam_verdict, clam_threats[],
 *     content_source }
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, X, ShieldCheck, ShieldAlert, Ban } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("tr-TR", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function WebmailReader({ eventId, fetcher, onClose, queryKey = "mail-content" }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [queryKey, eventId],
    queryFn: () => fetcher(eventId),
    enabled: !!eventId,
    staleTime: 30_000,
    retry: false,
  });

  // v43.28 — "Buna benzer maili engelle" → Rule ekle
  const blockSimilar = useMutation({
    mutationFn: async () => {
      const c = q.data;
      if (!c) throw new Error("İçerik henüz yüklenmedi");
      // Konu regex (özel karakterleri escape et)
      const escapeRe = (s) => (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const subject = (c.subject || "").trim();
      const senderDom = c.from_addr && c.from_addr.includes("@") ? c.from_addr.split("@")[1] : "";
      // 3 kural önerisi — kullanıcıya seçtir
      const proposals = [];
      if (subject) {
        // İlk 3 kelimeyi al (uzun konu regex'i çok tetiklenir)
        const words = subject.split(/\s+/).slice(0, 3).map(escapeRe).join("\\s+");
        if (words) {
          proposals.push({
            name: `Konu: ${subject.slice(0, 40)}`,
            pattern: `/${words}/i`,
            score: 7.0, target: "subject", enabled: true,
            description: `Karantina modalinden üretildi (${subject.slice(0, 60)})`,
          });
        }
      }
      if (senderDom) {
        proposals.push({
          name: `Gönderen alan: ${senderDom}`,
          pattern: `/@${escapeRe(senderDom)}\\b/i`,
          score: 6.0, target: "from", enabled: true,
          description: `Karantina modalinden üretildi (gönderen alanı: ${senderDom})`,
        });
      }
      if (proposals.length === 0) {
        throw new Error("Kural üretecek yeterli veri yok (konu/gönderen)");
      }
      // Kullanıcıya sor: hangisi eklensin
      const labels = proposals.map((p, i) => `${i+1}. ${p.name}\n   ${p.pattern} (skor ${p.score}, hedef ${p.target})`).join("\n\n");
      const choice = window.prompt(
        `Aşağıdaki kurallardan hangisini eklemek istiyorsunuz? (numarayı yazın veya boş bırakıp iptal edin)\n\n${labels}\n\nTümünü eklemek için 'a' yazın`,
        "1"
      );
      if (!choice) throw new Error("İptal edildi");
      const c2 = choice.trim().toLowerCase();
      const targets = c2 === "a" ? proposals : (proposals[parseInt(c2, 10) - 1] ? [proposals[parseInt(c2, 10) - 1]] : []);
      if (targets.length === 0) throw new Error("Geçersiz seçim");
      const results = [];
      for (const p of targets) {
        try {
          const r = await api.ruleAdd(p);
          results.push({ ok: true, name: p.name, id: r.id });
        } catch (e) {
          results.push({ ok: false, name: p.name, error: e?.response?.data?.detail || e.message });
        }
      }
      return { added: results.filter(r => r.ok).length, results };
    },
    onSuccess: (d) => {
      toast.success(`${d.added} kural eklendi — Kurallar sayfasında düzenleyebilirsiniz`);
      qc.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });

  if (!eventId) return null;

  return (
    <div
      className="fixed inset-0 bg-black/85 z-50 flex items-start justify-center p-2 sm:p-4 overflow-y-auto"
      onClick={onClose}
      data-testid="webmail-reader-backdrop"
    >
      <div
        className="bg-white text-slate-900 rounded-xl max-w-5xl w-full my-4 shadow-2xl border border-slate-300 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        data-testid="webmail-reader-modal"
      >
        {/* Top bar (dark) */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900 text-slate-100 border-b border-slate-800">
          <div className="flex items-center gap-2 text-xs">
            <Eye className="w-4 h-4 text-cyan-400" />
            <span className="font-semibold">Mail Okuyucu</span>
            {q.data?.content_source === "db" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/30 text-emerald-300 border border-emerald-500/40">DB</span>
            )}
            {q.data?.content_source && q.data.content_source.startsWith("Exim") && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-600/30 text-amber-300 border border-amber-500/40">Spool</span>
            )}
            {/* v43.23 — ClamAV verdict badge */}
            {q.data?.clam_verdict === "clean" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1" data-testid="wm-clam-clean">
                <ShieldCheck className="w-3 h-3" /> ClamAV: temiz
              </span>
            )}
            {(q.data?.clam_verdict === "infected" || q.data?.clam_verdict === "suspicious") && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-600/30 text-rose-300 border border-rose-500/40 inline-flex items-center gap-1" data-testid="wm-clam-infected">
                <ShieldAlert className="w-3 h-3" /> Virüs: {(q.data.clam_threats || []).slice(0, 2).join(", ") || q.data.clam_verdict}
              </span>
            )}
          </div>
          <button
            onClick={() => blockSimilar.mutate()}
            disabled={blockSimilar.isPending || !q.data}
            className="text-[10px] px-2 py-1 rounded bg-rose-500/15 text-rose-300 border border-rose-500/40 hover:bg-rose-500/25 disabled:opacity-40 inline-flex items-center gap-1"
            title="Bu maile benzer mailleri engellemek için AI önerisiyle SpamAssassin kuralı ekle"
            data-testid="wm-block-similar"
          >
            <Ban className="w-3 h-3" />
            {blockSimilar.isPending ? "Kural üretiliyor…" : "Buna benzer maili engelle"}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
            aria-label="close"
            data-testid="wm-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {q.isLoading && (
          <div className="p-16 text-center text-slate-500 text-sm">Yükleniyor…</div>
        )}
        {q.isError && (
          <div className="p-16 text-center text-rose-600 text-sm" data-testid="wm-error">
            {q.error?.response?.data?.detail || "İçerik alınamadı"}
          </div>
        )}
        {q.data && <MailBody c={q.data} />}
      </div>
    </div>
  );
}

function MailBody({ c }) {
  const senderInitial = (c.from_addr || "?").charAt(0).toUpperCase();
  const senderName = c.from_addr ? c.from_addr.split("@")[0] : "(bilinmeyen)";
  const senderDomain = c.from_addr && c.from_addr.includes("@") ? c.from_addr.split("@")[1] : "";
  const avatarHue = Math.abs((c.from_addr || "").split("").reduce((h, ch) => h * 31 + ch.charCodeAt(0), 5) % 360);
  return (
    <div className="bg-white">
      {/* Subject */}
      <div className="px-6 pt-5 pb-3">
        <h2 className="text-xl font-semibold text-slate-900 leading-tight" data-testid="wm-subject">
          {c.subject || "(konusuz)"}
        </h2>
        <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
          {c.verdict && (
            <span className={`px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold border ${
              c.verdict === "clean" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : c.verdict === "spam" || c.verdict === "high_spam" ? "bg-amber-50 text-amber-700 border-amber-200"
              : c.verdict === "virus" || c.verdict === "phishing" || c.verdict === "phish" ? "bg-rose-50 text-rose-700 border-rose-200"
              : "bg-slate-100 text-slate-700 border-slate-200"
            }`}>{c.verdict}</span>
          )}
          {typeof c.total_score === "number" && (
            <span className="text-slate-500">Skor: <span className="font-semibold text-slate-700">{Number(c.total_score).toFixed(1)}</span></span>
          )}
        </div>
      </div>

      {/* Sender row */}
      <div className="px-6 py-3 border-t border-slate-100 flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
             style={{ background: `hsl(${avatarHue}, 60%, 45%)` }}>
          {senderInitial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <span className="font-semibold text-slate-900" data-testid="wm-sender">{senderName}</span>
              {senderDomain && <span className="text-slate-500"> &lt;{c.from_addr}&gt;</span>}
            </div>
            <div className="text-[11px] text-slate-500 mono" data-testid="wm-time">{fmtTime(c.ts)}</div>
          </div>
          <div className="text-xs text-slate-600 mt-0.5">
            <span className="text-slate-400">alıcı:</span> <span data-testid="wm-recipient">{c.to_addr || "—"}</span>
            {c.from_user && <span className="ml-3"><span className="text-slate-400">user:</span> {c.from_user}</span>}
            {c.sender_ip && <span className="ml-3"><span className="text-slate-400">ip:</span> <span className="mono">{c.sender_ip}</span></span>}
          </div>
        </div>
      </div>

      {/* Attachments */}
      {c.attachments && c.attachments.length > 0 && (
        <div className="px-6 py-3 border-t border-slate-100" data-testid="wm-attachments">
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">📎 {c.attachments.length} Ek</div>
          <div className="flex flex-wrap gap-2">
            {c.attachments.map((a, i) => {
              const ct = (a.content_type || "").toLowerCase();
              const isImage = ct.startsWith("image/");
              const isPdf = ct === "application/pdf";
              const isText = ct.startsWith("text/") || ct.includes("json") || ct.includes("xml");
              const dataUrl = a.content_base64 ? `data:${a.content_type || "application/octet-stream"};base64,${a.content_base64}` : null;
              const icon = isImage ? "🖼" : isPdf ? "📕" : isText ? "📝" : "📎";
              // v43.23 — per-attachment ClamAV verdict
              const attClam = a.clam_verdict;
              return (
                <div key={i} className={`border rounded-lg transition-colors ${
                  attClam === "infected" ? "border-rose-300 bg-rose-50"
                  : attClam === "clean" ? "border-emerald-200 bg-emerald-50/60"
                  : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                }`}>
                  <div className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span>{icon}</span>
                    <span className={`font-medium truncate max-w-[220px] ${attClam === "infected" ? "text-rose-800 line-through" : "text-slate-800"}`} title={a.filename}>
                      {a.filename || "(isimsiz)"}
                    </span>
                    <span className="text-slate-400 text-[10px]">{a.size ? `${(a.size / 1024).toFixed(1)}KB` : ""}</span>
                    {attClam === "infected" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500 text-white font-bold uppercase tracking-wide mono" data-testid={`wm-att-clam-infected-${i}`}>
                        VİRÜS: {a.clam_threat || "yakalandı"}
                      </span>
                    )}
                    {attClam === "clean" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 border border-emerald-400 uppercase tracking-wide mono" data-testid={`wm-att-clam-clean-${i}`}>
                        ✓ temiz
                      </span>
                    )}
                    {dataUrl && attClam !== "infected" ? (
                      <a href={dataUrl} download={a.filename || "attachment.bin"}
                         data-testid={`wm-att-download-${i}`}
                         className="ml-1 text-blue-600 hover:text-blue-800 text-[10px] no-underline">⬇ İndir</a>
                    ) : !dataUrl ? (
                      <span className="text-amber-600 text-[10px]" title="Milter içerik ingest etmedi">(içerik yok)</span>
                    ) : null}
                  </div>
                  {dataUrl && isImage && attClam !== "infected" && (
                    <img src={dataUrl} alt={a.filename} data-testid={`wm-att-preview-img-${i}`}
                         className="max-h-40 max-w-full rounded-b-lg object-contain bg-white block" />
                  )}
                  {dataUrl && isPdf && attClam !== "infected" && (
                    <embed src={dataUrl} type="application/pdf" data-testid={`wm-att-preview-pdf-${i}`}
                           className="w-72 h-56 bg-white block border-t border-slate-200" />
                  )}
                  {dataUrl && isText && attClam !== "infected" && (
                    <pre data-testid={`wm-att-preview-text-${i}`}
                         className="w-72 max-h-40 overflow-auto text-[10px] p-2 bg-white text-slate-700 border-t border-slate-200 whitespace-pre-wrap">
                      {(() => { try { return atob(a.content_base64).slice(0, 4000); } catch (_) { return "(decode error)"; } })()}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="border-t border-slate-200 bg-slate-50/50" data-testid="wm-body-area">
        {c.body_html ? (
          <iframe
            data-testid="wm-content-html"
            srcDoc={c.body_html}
            sandbox=""
            title="mail-html"
            className="w-full min-h-[400px] bg-white block border-0"
          />
        ) : c.body_preview ? (
          <pre data-testid="wm-content-body"
               className="w-full min-h-[300px] p-6 bg-white text-[13px] text-slate-800 whitespace-pre-wrap leading-relaxed font-sans">
            {c.body_preview}
          </pre>
        ) : (
          <div className="p-8 text-center" data-testid="wm-content-fallback">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 text-amber-600 mb-3">
              <span className="text-2xl">✉</span>
            </div>
            <div className="text-slate-700 font-semibold mb-1">Bu mail için gövde kaydedilmemiş</div>
            <div className="text-slate-500 text-xs max-w-md mx-auto leading-relaxed">
              Milter body ingest (v43.15+) etkinleştirildikten sonra <b>yeni gelen/giden mailler</b> otomatik tam içerikli görünecek.
              Eski maillerin gövdesi log-only ingest edildiği için mevcut değil.
            </div>
          </div>
        )}
      </div>

      {/* Debug */}
      <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 text-xs space-y-2">
        {c.scores && Object.keys(c.scores).length > 0 && (
          <details>
            <summary className="cursor-pointer text-slate-600 hover:text-slate-900 select-none">
              🎯 Motor Skorları ({Object.keys(c.scores).length})
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(c.scores).map(([k, v]) => (
                <span key={k} className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 mono text-[10px]">
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          </details>
        )}
        {c.headers_full && (
          <details>
            <summary className="cursor-pointer text-slate-600 hover:text-slate-900 select-none">
              📋 SMTP Headers
            </summary>
            <pre data-testid="wm-content-headers"
                 className="mt-1 p-3 bg-white border border-slate-200 rounded max-h-56 overflow-auto text-[10px] mono text-slate-700 whitespace-pre-wrap">{c.headers_full}</pre>
          </details>
        )}
        {c.message_id && (
          <div className="text-[10px] text-slate-400 mono select-all">
            message-id: {c.message_id}
          </div>
        )}
      </div>
    </div>
  );
}
