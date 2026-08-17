/**
 * v43.74 — Slash Command Bar
 *
 * Master için hızlı uzak yönetim komut kutusu (Header'a mount edilir).
 * Örn: `/run health-check @bayı1@example.com`, `/logs exim_main 50 @all`
 *
 * Komut grameri:
 *   /run <command> @<bayı-email-or-key>[ ...args]
 *   /run <command> @all                (tüm bayilerv, uyarı gösterir)
 *
 * Komutlar: health-check, version-check, disk-usage, log-tail, service-status
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Terminal, Send, X, ArrowUp, Info } from "lucide-react";
import { client } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const CMD_ALIASES = {
  "health-check": "health_check",
  "health":       "health_check",
  "version":      "version_check",
  "version-check": "version_check",
  "disk":         "disk_usage",
  "disk-usage":   "disk_usage",
  "log":          "log_tail",
  "log-tail":     "log_tail",
  "logs":         "log_tail",
  "svc":          "service_status",
  "service":      "service_status",
  "service-status": "service_status",
};

const COMMAND_HELP = [
  "/run health-check @bayı",
  "/run version-check @bayı",
  "/run disk-usage @bayı",
  "/run log exim_main 100 @bayı",
  "/run service exim @bayı",
];

function parseSlash(input, bayilervMap) {
  // Örn: "/run log exim_main 100 @user@ex.com"  → {command, params, target}
  const m = input.trim().match(/^\/run\s+(\S+)(.*?)\s*@(\S+)\s*$/i);
  if (!m) return { error: "Format: /run <komut> [args...] @bayı" };
  const rawCmd = m[1].toLowerCase();
  const cmd = CMD_ALIASES[rawCmd];
  if (!cmd) return { error: `Bilinmeyen komut: ${rawCmd}. Kullanılabilir: ${Object.keys(CMD_ALIASES).join(", ")}` };
  const argsRaw = m[2].trim();
  const targetSpec = m[3].trim();
  // Args'ı komuta göre yorumla
  const params = {};
  if (cmd === "log_tail") {
    const parts = argsRaw.split(/\s+/).filter(Boolean);
    params.log = parts[0] || "exim_main";
    params.lines = parseInt(parts[1] || "200", 10);
  } else if (cmd === "service_status") {
    params.service = argsRaw || "gws-exim-daemon";
  }
  // Hedef: @all veya @<email/prefix/key>
  let targets = [];
  if (targetSpec === "all") {
    targets = Object.keys(bayilervMap);
  } else {
    const needle = targetSpec.toLowerCase();
    for (const [lk, meta] of Object.entries(bayilervMap)) {
      if (lk.toLowerCase().includes(needle) || (meta.email || "").toLowerCase().includes(needle)) {
        targets.push(lk);
      }
    }
  }
  if (targets.length === 0) return { error: `Bayı bulunamadı: @${targetSpec}` };
  return { command: cmd, params, targets };
}

export default function SlashCommandBar() {
  const { isMaster } = useIsMaster();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const inputRef = useRef(null);

  // Bayı listesi (fuzzy match)
  const bayilervQ = useQuery({
    queryKey: ["remote-bayilerv-slash"],
    queryFn: () => client.get("/remote-admin/bayilerv").then(r => r.data),
    enabled: isMaster && open,
    staleTime: 60_000,
  });
  const bayilervMap = (bayilervQ.data?.items || []).reduce((acc, b) => ({ ...acc, [b.license_key]: b }), {});

  // Global keyboard shortcut: Ctrl+Shift+K veya Cmd+Shift+K (Ctrl+K komut paleti kullanır)
  useEffect(() => {
    if (!isMaster) return;
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [isMaster]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  if (!isMaster) return null;

  const exec = async () => {
    if (!input.trim()) return;
    const parsed = parseSlash(input, bayilervMap);
    if (parsed.error) {
      toast.error(parsed.error);
      return;
    }
    if (parsed.targets.length > 3) {
      const ok = window.confirm(`${parsed.targets.length} bayıya "${parsed.command}" göndermek istediğine emin misin?`);
      if (!ok) return;
    }
    setRunning(true);
    const results = [];
    for (const target of parsed.targets) {
      try {
        const r = await client.post("/remote-admin/dispatch", {
          license_key: target,
          command: parsed.command,
          params: parsed.params,
        });
        results.push({ target, ok: true, id: r.data?.action_id });
      } catch (e) {
        results.push({ target, ok: false, err: e?.response?.data?.detail || e.message });
      }
    }
    setRunning(false);
    const okCount = results.filter(r => r.ok).length;
    const failCount = results.length - okCount;
    if (failCount === 0) {
      toast.success(`✓ ${okCount} bayıya "${parsed.command}" gönderildi`, {
        description: "Sonuçlar ThreatBell + Uzak Yönetim sayfasında görünür",
        duration: 5000,
      });
    } else {
      toast.warning(`${okCount} başarılı, ${failCount} başarısız`, {
        description: results.filter(r => !r.ok).map(r => `${r.target.slice(0, 12)}: ${r.err}`).join(" · "),
        duration: 8000,
      });
    }
    setInput("");
    setOpen(false);
  };

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        data-testid="slash-command-trigger"
        onClick={() => setOpen(true)}
        title="Slash komutu (Ctrl+K)"
        className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-700 hover:border-indigo-500/40 bg-slate-900/60 hover:bg-indigo-500/10 text-xs text-slate-400 hover:text-indigo-300 transition-all"
      >
        <Terminal className="w-3 h-3"/>
        <span className="mono">/run</span>
        <kbd className="ml-1 px-1 py-0.5 rounded bg-slate-800 text-[9px] mono text-slate-500 border border-slate-700">⌘⇧K</kbd>
      </button>

      {/* Modal */}
      {open && (
        <div
          data-testid="slash-command-modal"
          className="fixed inset-0 z-[9997] flex items-start justify-center pt-32 bg-slate-950/70 backdrop-blur-sm px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-slate-700/70 bg-slate-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Input */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
              <Terminal className="w-4 h-4 text-indigo-400 shrink-0"/>
              <input
                ref={inputRef}
                data-testid="slash-command-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") exec(); }}
                placeholder="/run health-check @bayı1"
                className="flex-1 bg-transparent outline-none mono text-sm text-slate-100 placeholder:text-slate-500"
                disabled={running}
              />
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4"/></button>
            </div>

            {/* Help / autocomplete */}
            <div className="px-4 py-3 text-xs">
              {input.trim() ? (() => {
                const parsed = parseSlash(input, bayilervMap);
                if (parsed.error) return <div className="text-rose-400">{parsed.error}</div>;
                return (
                  <div className="space-y-1">
                    <div className="text-emerald-300 font-semibold">✓ Komut hazır</div>
                    <div className="text-slate-400">
                      <b className="text-emerald-200">{parsed.command}</b>
                      {Object.keys(parsed.params).length > 0 && (
                        <span className="mono ml-2 text-slate-500">{JSON.stringify(parsed.params)}</span>
                      )}
                    </div>
                    <div className="text-slate-500">
                      Hedef: <b className="text-slate-300">{parsed.targets.length} bayı</b>
                      {parsed.targets.length <= 3 && (
                        <span className="mono ml-2 text-[10px]">{parsed.targets.map((k) => (bayilervMap[k]?.email || k.slice(0, 14))).join(", ")}</span>
                      )}
                    </div>
                  </div>
                );
              })() : (
                <div className="space-y-1">
                  <div className="text-slate-500 flex items-center gap-1"><Info className="w-3 h-3"/> Örnek komutlar:</div>
                  {COMMAND_HELP.map((c) => (
                    <button
                      key={c}
                      onClick={() => setInput(c)}
                      className="block w-full text-left px-2 py-1 mono text-[11px] text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 rounded"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Action */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 bg-slate-950/40">
              <div className="text-[10px] text-slate-500 flex items-center gap-2">
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 mono text-slate-400 border border-slate-700">Enter</kbd> çalıştır
                <kbd className="px-1.5 py-0.5 rounded bg-slate-800 mono text-slate-400 border border-slate-700">Esc</kbd> iptal
              </div>
              <button
                data-testid="slash-command-run"
                onClick={exec}
                disabled={running || !input.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gradient-to-r from-indigo-500 to-cyan-500 text-white text-xs font-semibold disabled:opacity-40 shadow-lg"
              >
                {running ? "Gönderiliyor…" : <><Send className="w-3 h-3"/> Çalıştır</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
