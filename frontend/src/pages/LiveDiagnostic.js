import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Stethoscope, CheckCircle2, XCircle, AlertCircle, Terminal, Copy, Server,
  Zap, RefreshCw, HeartPulse, Package, MailX, Activity,
} from "lucide-react";
import { Card, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

export default function LiveDiagnostic() {
  const status = useQuery({
    queryKey: ["live-diag-status"],
    queryFn: api.liveDiagnostic,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const commands = useQuery({
    queryKey: ["live-diag-commands"], queryFn: api.liveDiagnosticCommands,
  });

  const s = status.data;
  const rows = s?.rows || [];

  return (
    <div className="p-6 space-y-4" data-testid="live-diagnostic-page">
      {/* Hero */}
      <div className="rounded-xl border border-rose-500/40 bg-gradient-to-br from-rose-500/10 via-slate-900/70 to-emerald-500/5 p-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0">
            <Stethoscope className="w-5 h-5 text-rose-300"/>
          </div>
          <div className="flex-1">
            <div className="text-slate-100 text-lg font-bold">Canlı Sunucu Tanı Sihirbazı</div>
            <div className="text-xs text-slate-400 mt-0.5 max-w-3xl leading-relaxed">
              Bayi WHM sunucularınızın <b>tam durumunu</b> gösterir: heartbeat.pl aktif mi? Exim tailer push ediyor mu? Outbound veri geliyor mu? Hangi adım başarısız olursa <b>düzeltmenin SSH komutunu</b> yanında yazar.
            </div>
          </div>
          <button
            onClick={() => { status.refetch(); toast.success("Yeniden tarandı"); }}
            data-testid="live-diag-refresh"
            className="text-xs px-3 py-2 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 inline-flex items-center gap-1.5"
          ><RefreshCw className="w-3.5 h-3.5"/> Yeniden Tara</button>
        </div>
      </div>

      {/* v43.43 — DOCKER DEPLOYMENT için tek-satır Exim log tailer kurulumu */}
      <DockerDeploymentInstaller />

      {/* License rows */}
      {status.isLoading && <div className="p-8 text-center text-slate-500 text-sm">Tanı yapılıyor…</div>}
      {rows.length === 0 && !status.isLoading && (
        <Card>
          <div className="p-8 text-center text-slate-400 text-sm">
            <AlertCircle className="w-8 h-8 mx-auto mb-3 text-amber-400"/>
            <div>Henüz aktif bayi lisansı yok — sunucunuzda GökyüzüWebSpam plugin kurulu değil.</div>
            <div className="mt-2 text-xs text-slate-500">
              SSH ile bağlanıp <code className="mono text-emerald-300 bg-slate-900 px-2 py-0.5 rounded">bash &lt;(wget -qO- panel.gokyuzuhosting.com/install)</code> ile başlayın.
            </div>
          </div>
        </Card>
      )}
      {rows.map((r) => <LicenseCard key={r.license_key} row={r} />)}

      {/* Step-by-step commands */}
      {commands.data && (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Terminal className="w-4 h-4 text-emerald-400"/> SSH Komut Listesi (Kopyala-Yapıştır)</span>}
            subtitle="Bu 4 fazı sırayla sunucunuzda çalıştırın — her komutun beklenen çıktısı yanında yazıyor"
          />
          <div className="p-5 space-y-4">
            {commands.data.phases.map((phase) => (
              <div key={phase.id} className="border border-slate-800 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-800">
                  <div className="text-sm font-semibold text-indigo-300">{phase.title}</div>
                </div>
                <div className="divide-y divide-slate-800">
                  {phase.commands.map((c, i) => <PhaseCommand key={i} cmd={c} />)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function LicenseCard({ row }) {
  const overallTone = {
    healthy: { border: "border-emerald-500/40", bg: "bg-emerald-500/10", text: "text-emerald-300", label: "SAĞLIKLI", icon: <CheckCircle2 className="w-4 h-4"/> },
    degraded: { border: "border-amber-500/40", bg: "bg-amber-500/10", text: "text-amber-300", label: "KISMEN", icon: <AlertCircle className="w-4 h-4"/> },
    critical: { border: "border-rose-500/40", bg: "bg-rose-500/10", text: "text-rose-300", label: "KRİTİK", icon: <XCircle className="w-4 h-4"/> },
  }[row.overall] || {};
  return (
    <Card data-testid={`live-diag-lic-${row.license_masked}`}>
      <div className={`px-5 py-3 border-b ${overallTone.border} ${overallTone.bg} flex items-center gap-3`}>
        <span className={overallTone.text}>{overallTone.icon}</span>
        <div className="flex-1">
          <div className="text-sm text-slate-100 font-semibold flex items-center gap-2">
            <Server className="w-4 h-4 text-slate-400"/>
            <span>{row.hostname || row.license_masked}</span>
            <span className="text-[10px] text-slate-500 mono">{row.license_masked}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-3 flex-wrap">
            {row.server_ip && <span className="mono">IP: {row.server_ip}</span>}
            <span>Kurulum: <span className="text-indigo-300">{row.installation_label || row.plugin_version || "—"}</span></span>
            <span>Son 1s outbound: <span className="mono text-emerald-300">{nfmt(row.outbound_1h)}</span></span>
            <span>Son 24s: <span className="mono text-emerald-300">{nfmt(row.outbound_24h)}</span></span>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold mono ${overallTone.text}`}>{row.health_pct}%</div>
          <div className={`text-[9px] uppercase tracking-widest ${overallTone.text}`}>{overallTone.label}</div>
        </div>
      </div>
      <div className="p-4 space-y-2">
        {row.checks.map((c) => <CheckRow key={c.id} check={c} />)}
      </div>
    </Card>
  );
}

function CheckRow({ check }) {
  return (
    <div className={`px-3 py-2 rounded border flex items-start gap-3 ${
      check.pass ? "border-emerald-500/25 bg-emerald-500/5"
                 : "border-rose-500/30 bg-rose-500/5"
    }`} data-testid={`check-${check.id}`}>
      <div className="shrink-0 mt-0.5">
        {check.pass
          ? <CheckCircle2 className="w-4 h-4 text-emerald-400"/>
          : <XCircle className="w-4 h-4 text-rose-400"/>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-200">{check.label}</div>
        <div className="text-[11px] text-slate-500 mono mt-0.5">{check.detail}</div>
        {!check.pass && (
          <div className="text-[11px] text-amber-300 mt-1 flex items-start gap-1">
            <Terminal className="w-3 h-3 shrink-0 mt-0.5"/>
            <code className="mono bg-slate-950 px-2 py-0.5 rounded break-all">{check.hint}</code>
          </div>
        )}
      </div>
    </div>
  );
}

function PhaseCommand({ cmd }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    navigator.clipboard.writeText(cmd.cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="p-3 space-y-1.5 hover:bg-slate-900/30">
      <div className="flex items-center gap-2">
        <code className="mono flex-1 text-[12px] bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-emerald-300 select-all">
          {cmd.cmd}
        </code>
        <button
          onClick={doCopy}
          className="text-[11px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 inline-flex items-center gap-1"
        >
          <Copy className="w-3 h-3"/> {copied ? "kopyalandı" : "Kopyala"}
        </button>
      </div>
      <div className="text-[11px] pl-1">
        <span className="text-emerald-500">✓ Beklenen:</span>
        <span className="text-slate-400 ml-1">{cmd.expects}</span>
      </div>
      {cmd.if_not && (
        <div className="text-[11px] pl-1">
          <span className="text-rose-500">✗ Değilse:</span>
          <span className="text-slate-400 ml-1">{cmd.if_not}</span>
        </div>
      )}
    </div>
  );
}

// v43.43 — Docker deployment kullanıcıları için tek-satır Exim log tailer kurulumu
// v44.00.04 — Öncelik `sudo gwsm-update` — install.sh artık gws-exim-push'ı otomatik kuruyor.
function DockerDeploymentInstaller() {
  const [copied, setCopied] = useState(false);
  const [copiedManual, setCopiedManual] = useState(false);
  const masterKey = typeof window !== "undefined"
    ? (localStorage.getItem("gws.master_license") || "MS-YOUR-KEY-HERE")
    : "MS-YOUR-KEY-HERE";
  const panelHost = typeof window !== "undefined" ? window.location.origin : "https://panel.gokyuzuhosting.com";
  const primaryCmd = "sudo gwsm-update";
  const fallbackCmd = `bash <(curl -sSf "${panelHost}/api/tools/install-exim-push.sh?license_key=${masterKey}")`;
  const doCopy = (text, setter) => {
    navigator.clipboard.writeText(text);
    setter(true);
    toast.success("Komut kopyalandı — sunucunuzda root olarak yapıştırıp çalıştırın");
    setTimeout(() => setter(false), 2500);
  };
  return (
    <Card data-testid="docker-installer" className="border-emerald-500/40">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
            <span className="text-2xl">⚡</span>
          </div>
          <div className="flex-1">
            <div className="text-slate-100 font-bold text-base">Tek-Adım Kurulum · Diagnostics'i yeşile çevirir</div>
            <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">
              v44.00.04'ten itibaren <code className="mono text-emerald-300">install.sh</code> Exim log push tailer'ı
              (<code className="mono text-amber-300">gws-exim-push</code>), heartbeat timer ve otomatik güncelleme
              servislerini <b className="text-emerald-300">tek seferde otomatik kurar</b>. Bu ekrandaki tüm kırmızı
              işaretleri sıfırlamak için aşağıdaki komutu bir kere çalıştırmanız yeterli:
            </div>
            <div className="mt-3 flex items-center gap-2">
              <code className="mono flex-1 text-sm bg-slate-950 border border-emerald-500/30 rounded px-3 py-2.5 text-emerald-300 font-bold select-all">
                {primaryCmd}
              </code>
              <button
                onClick={() => doCopy(primaryCmd, setCopied)}
                data-testid="gwsmupdate-copy"
                className="text-xs px-3 py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1 font-semibold"
              >
                <Copy className="w-3.5 h-3.5"/>
                {copied ? "Kopyalandı" : "Kopyala"}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 text-[11px]">
              <div className="bg-slate-950/60 border border-emerald-500/30 rounded p-2">
                <div className="text-emerald-400 font-semibold mb-0.5">✓ gws-exim-push</div>
                <div className="text-slate-500">Outbound tailer + 15sn timer</div>
              </div>
              <div className="bg-slate-950/60 border border-emerald-500/30 rounded p-2">
                <div className="text-emerald-400 font-semibold mb-0.5">✓ gws-exim-inotify</div>
                <div className="text-slate-500">Real-time push (inotify)</div>
              </div>
              <div className="bg-slate-950/60 border border-emerald-500/30 rounded p-2">
                <div className="text-emerald-400 font-semibold mb-0.5">✓ gws-simple-push</div>
                <div className="text-slate-500">Heartbeat timer (5 dk)</div>
              </div>
              <div className="bg-slate-950/60 border border-emerald-500/30 rounded p-2">
                <div className="text-emerald-400 font-semibold mb-0.5">✓ gwsm-auto-update</div>
                <div className="text-slate-500">Günlük otomatik update</div>
              </div>
            </div>
            <div className="mt-3 text-[11px] text-emerald-300 flex items-start gap-1.5 bg-emerald-500/5 border border-emerald-500/20 rounded p-2.5">
              <span>💡</span>
              <span>
                <b>Ne yapar?</b> <code className="mono text-emerald-200">sudo gwsm-update</code> Master'dan en yeni
                tarball'ı indirir + <code className="mono">install.sh</code>'ı çalıştırır. Mevcut config KORUNUR,
                yalnızca eksik servisler tamamlanır. 1-2 dk sonra bu ekrandaki tüm satırlar 🟢 olur.
              </span>
            </div>
            {/* Fallback / Docker-only sadece SSH engelli sistemler için */}
            <details className="mt-3">
              <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-300">
                Alternatif · Sadece Exim tailer kur (Docker deployment / SSH kısıtlı)
              </summary>
              <div className="mt-2 flex items-center gap-2">
                <code className="mono flex-1 text-[11px] bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-400 select-all break-all">
                  {fallbackCmd}
                </code>
                <button
                  onClick={() => doCopy(fallbackCmd, setCopiedManual)}
                  data-testid="docker-installer-copy"
                  className="text-[10px] px-2.5 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 inline-flex items-center gap-1"
                >
                  <Copy className="w-3 h-3"/>
                  {copiedManual ? "OK" : "Kopyala"}
                </button>
              </div>
            </details>
          </div>
        </div>
      </div>
    </Card>
  );
}

