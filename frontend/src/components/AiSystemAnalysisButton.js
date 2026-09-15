// v44.00.35 — AI System Analysis Modal (Claude Sonnet 4.6)
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, X, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { client } from "@/lib/api";

// Markdown → basit HTML render (external lib istemeden headings/lists/bold)
function renderMd(md) {
  if (!md) return null;
  const lines = md.split("\n");
  const html = [];
  let inList = false;
  const flushList = () => { if (inList) { html.push("</ul>"); inList = false; } };
  for (const line of lines) {
    const l = line.replace(/\r$/, "");
    if (/^#\s+/.test(l))       { flushList(); html.push(`<h1 class="text-xl font-bold mt-3 mb-2 text-indigo-200">${l.replace(/^#\s+/, "")}</h1>`); continue; }
    if (/^##\s+/.test(l))      { flushList(); html.push(`<h2 class="text-base font-semibold mt-3 mb-1.5 text-indigo-300">${l.replace(/^##\s+/, "")}</h2>`); continue; }
    if (/^###\s+/.test(l))     { flushList(); html.push(`<h3 class="text-sm font-semibold mt-2 mb-1 text-indigo-400">${l.replace(/^###\s+/, "")}</h3>`); continue; }
    if (/^---$/.test(l))       { flushList(); html.push('<hr class="my-3 border-slate-800"/>'); continue; }
    if (/^-\s+/.test(l) || /^\*\s+/.test(l)) {
      if (!inList) { html.push('<ul class="list-disc list-inside space-y-1 text-slate-200 pl-2">'); inList = true; }
      html.push(`<li>${boldify(l.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(l)) {
      if (!inList) { html.push('<ul class="list-decimal list-inside space-y-1 text-slate-200 pl-2">'); inList = true; }
      html.push(`<li>${boldify(l.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }
    if (!l.trim()) { flushList(); html.push("<div class=\"h-2\"></div>"); continue; }
    flushList();
    html.push(`<p class="text-slate-300 leading-relaxed">${boldify(l)}</p>`);
  }
  flushList();
  return html.join("");
}
function boldify(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<b class="text-slate-100">$1</b>');
}

export default function AiSystemAnalysisButton() {
  const [open, setOpen] = useState(false);
  const latest = useQuery({
    queryKey: ["ai-system-latest"],
    queryFn: () => client.get("/ai/system-analysis/latest").then(r => r.data),
    enabled: open,
    refetchOnWindowFocus: false,
  });
  const gen = useMutation({
    mutationFn: () => client.post("/ai/system-analysis").then(r => r.data),
    onSuccess: (d) => {
      toast.success("Yeni AI raporu hazır");
      latest.refetch();
    },
    onError: (e) => toast.error("Rapor üretilemedi: " + (e?.response?.data?.detail || e.message)),
  });

  const report = latest.data;
  const stale = report?.generated_at
    ? (Date.now() - new Date(report.generated_at).getTime()) / 3_600_000 > 6  // 6 saat+
    : false;

  return (
    <>
      <button
        data-testid="ai-system-analysis-btn"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md
                   border border-fuchsia-500/40 bg-gradient-to-r from-fuchsia-500/10 to-indigo-500/10
                   text-fuchsia-200 hover:from-fuchsia-500/20 hover:to-indigo-500/20 text-xs font-semibold
                   transition-all shadow-sm">
        <Sparkles className="w-3.5 h-3.5" /> AI Sistem Analizi
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
             onClick={(e) => e.target === e.currentTarget && setOpen(false)}
             data-testid="ai-system-modal">
          <div className="bg-slate-950 border border-slate-800 rounded-lg max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 bg-gradient-to-r from-fuchsia-900/20 to-indigo-900/20">
              <Sparkles className="w-5 h-5 text-fuchsia-400" />
              <div className="flex-1">
                <div className="text-sm font-bold text-fuchsia-200">AI Sistem Sağlık Analizi</div>
                <div className="text-[11px] text-slate-500 mono">Claude Sonnet 4.6 · Son 7 günlük sinyaller</div>
              </div>
              <button
                onClick={() => gen.mutate()}
                disabled={gen.isPending}
                data-testid="ai-system-regen"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-300 text-xs font-semibold disabled:opacity-50">
                {gen.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analiz Ediliyor…</>
                  : <><RefreshCw className="w-3.5 h-3.5" /> {report ? "Yenile" : "Analizi Başlat"}</>}
              </button>
              <button onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
                data-testid="ai-system-close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {latest.isPending && <div className="text-center text-slate-500 py-12">Yükleniyor…</div>}
              {!latest.isPending && !report && (
                <div className="text-center py-12">
                  <Sparkles className="w-10 h-10 text-fuchsia-500/50 mx-auto mb-3" />
                  <p className="text-slate-400 mb-1">Henüz AI raporu üretilmemiş</p>
                  <p className="text-xs text-slate-500">"Analizi Başlat" butonuna basarak Claude'un sisteminizi analiz etmesini isteyin.</p>
                </div>
              )}
              {report && (
                <>
                  {stale && (
                    <div className="mb-3 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-1.5">
                      ⚠ Bu rapor {Math.round((Date.now() - new Date(report.generated_at).getTime()) / 3600_000)} saat öncesine ait — yenilemek için "Yenile" butonuna basın.
                    </div>
                  )}
                  <div className="text-[11px] mono text-slate-500 mb-3">
                    Üretilme: {new Date(report.generated_at).toLocaleString("tr-TR")} · Model: {report.model}
                  </div>
                  <div className="prose prose-invert prose-sm max-w-none space-y-1"
                       data-testid="ai-system-report"
                       dangerouslySetInnerHTML={{ __html: renderMd(report.report_markdown) }} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
