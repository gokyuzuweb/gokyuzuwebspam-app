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

// v43.75 — Autocomplete için tam komut listesi (görsel önerilerle)
const CMD_SUGGESTIONS = [
  { alias: "health-check",  desc: "Bayı sunucusu docker + servis health kontrol", ex: "/run health-check @bayı" },
  { alias: "version-check", desc: "Uname + docker + plugin sürüm bilgisi",         ex: "/run version-check @bayı" },
  { alias: "disk-usage",    desc: "df -h / — disk kullanımı",                       ex: "/run disk-usage @bayı" },
  { alias: "log",           desc: "Belirli logun son N satırı",                     ex: "/run log exim_main 100 @bayı" },
  { alias: "service",       desc: "systemctl status <servis>",                      ex: "/run service exim @bayı" },
];

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
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef(null);

  // Bayı listesi (fuzzy match)
  const bayilervQ = useQuery({
    queryKey: ["remote-bayilerv-slash"],
    queryFn: () => client.get("/remote-admin/bayilerv").then(r => r.data),
    enabled: isMaster && open,
    staleTime: 60_000,
  });
  const bayilervMap = (bayilervQ.data?.items || []).reduce((acc, b) => ({ ...acc, [b.license_key]: b }), {});

  // v43.75 — Autocomplete listesi: /run <partial>  → command önerileri
  // "@" başlarsa bayı isim önerileri gösterir
  const suggestions = (() => {
    const s = input.trim();
    if (!s || !s.toLowerCase().startsWith("/run")) return [];
    const rest = s.slice(4).trim().toLowerCase();
    // Bayı suggestions (@ ile başlıyorsa)
    const atMatch = rest.match(/@(\S*)$/);
    if (atMatch) {
      const needle = atMatch[1].toLowerCase();
      const items = Object.entries(bayilervMap)
        .filter(([lk, meta]) => !needle || lk.toLowerCase().includes(needle) || (meta.email || "").toLowerCase().includes(needle))
        .slice(0, 8)
        .map(([lk, meta]) => ({
          type: "bayı",
          key: lk,
          label: meta.email || lk.slice(0, 20),
          hint: `${meta.plan || "?"} · ${lk.slice(0, 20)}...`,
          insert: (input.trim().replace(/@(\S*)$/, "@" + (meta.email || lk)) + " "),
        }));
      if (needle === "" || "all".startsWith(needle)) {
        items.unshift({
          type: "bayı",
          key: "@all",
          label: "@all — TÜM BAYİLER",
          hint: `${Object.keys(bayilervMap).length} bayı`,
          insert: input.trim().replace(/@(\S*)$/, "@all "),
        });
      }
      return items;
    }
    // Command suggestions
    const cmdPart = rest.split(/\s/)[0] || "";
    return CMD_SUGGESTIONS
      .filter((c) => !cmdPart || c.alias.startsWith(cmdPart))
      .slice(0, 6)
      .map((c) => ({
        type: "cmd",
        key: c.alias,
        label: `/run ${c.alias}`,
        hint: c.desc,
        insert: `/run ${c.alias} `,
        example: c.ex,
      }));
  })();

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

  // v43.75 — Reset selected index when input changes
  useEffect(() => { setSelectedIdx(0); }, [input]);

  // v43.75 — Klavye: ↑/↓ ile arasında dolan, Tab/Enter ile seç, Enter ile çalıştır (öneri boşken)
  const handleKeyDown = (e) => {
    if (suggestions.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setSelectedIdx((v) => {
        const n = suggestions.length;
        return (e.key === "ArrowDown" ? v + 1 : v - 1 + n) % n;
      });
      return;
    }
    if (suggestions.length > 0 && (e.key === "Tab" || (e.key === "Enter" && suggestions[selectedIdx]?.insert))) {
      // Tab veya Enter → seçili öneriyi input'a insert et (henüz çalıştırma)
      e.preventDefault();
      const sel = suggestions[selectedIdx];
      if (sel && sel.insert) {
        setInput(sel.insert);
        setTimeout(() => inputRef.current?.focus(), 20);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      exec();
    }
  };

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
                onKeyDown={handleKeyDown}
                placeholder="/run health-check @bayı1"
                className="flex-1 bg-transparent outline-none mono text-sm text-slate-100 placeholder:text-slate-500"
                disabled={running}
              />
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4"/></button>
            </div>

            {/* v43.75 — Autocomplete Dropdown */}
            {suggestions.length > 0 && (
              <div data-testid="slash-suggestions" className="border-b border-slate-800 max-h-72 overflow-y-auto">
                {suggestions.map((s, i) => (
                  <button
                    key={s.key}
                    type="button"
                    data-testid={`slash-suggest-${s.type}-${i}`}
                    onMouseEnter={() => setSelectedIdx(i)}
                    onClick={() => { setInput(s.insert); setTimeout(() => inputRef.current?.focus(), 20); }}
                    className={`w-full text-left px-4 py-2 flex items-center gap-3 border-l-2 transition-colors ${
                      selectedIdx === i
                        ? "bg-indigo-500/10 border-indigo-400 text-slate-100"
                        : "border-transparent hover:bg-slate-800/60 text-slate-300"
                    }`}
                  >
                    <span className={`text-[10px] mono px-1.5 py-0.5 rounded ${
                      s.type === "cmd" ? "bg-indigo-500/20 text-indigo-300" : "bg-emerald-500/20 text-emerald-300"
                    }`}>{s.type === "cmd" ? "CMD" : "BAYI"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="mono text-sm truncate">{s.label}</div>
                      <div className="text-[11px] text-slate-500 truncate">{s.hint}</div>
                    </div>
                    {selectedIdx === i && (
                      <kbd className="ml-auto px-1.5 py-0.5 rounded bg-slate-800 mono text-[9px] text-slate-400 border border-slate-700 shrink-0">Tab</kbd>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Help / preview */}
            <div className="px-4 py-3 text-xs">
              {input.trim() && suggestions.length === 0 ? (() => {
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
              })() : suggestions.length === 0 ? (
                <div className="space-y-1">
                  <div className="text-slate-500 flex items-center gap-1"><Info className="w-3 h-3"/> Örnek komutlar (tıklayın):</div>
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
              ) : null}
            </div>

            {/* Action */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 bg-slate-950/40">
              <div className="text-[10px] text-slate-500 flex items-center gap-2">
                {suggestions.length > 0 ? (
                  <>
                    <kbd className="px-1.5 py-0.5 rounded bg-slate-800 mono text-slate-400 border border-slate-700">↑↓</kbd> gez
                    <kbd className="px-1.5 py-0.5 rounded bg-slate-800 mono text-slate-400 border border-slate-700">Tab</kbd> tamamla
                  </>
                ) : (
                  <>
                    <kbd className="px-1.5 py-0.5 rounded bg-slate-800 mono text-slate-400 border border-slate-700">Enter</kbd> çalıştır
                  </>
                )}
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
