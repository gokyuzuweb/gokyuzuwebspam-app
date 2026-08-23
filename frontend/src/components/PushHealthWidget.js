/**
 * v43.62 — Push Sağlık Widget
 * v44.00.05 — "Onar" butonu artık tıklandığında modal açıp tek komutu net gösterir
 *
 * Dashboard'a eklenen canlı push durumu göstergesi.
 * Her bayinin (veya master'ın kendi sunucusunun) son Exim push zamanını
 * renk kodlu gösterir.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, CheckCircle2, Clock, Copy, X, Terminal } from "lucide-react";
import { Card } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { toast } from "sonner";

const fmtSince = (isoStr) => {
  if (!isoStr) return "hiç";
  const s = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (s < 60) return `${s}sn önce`;
  if (s < 3600) return `${Math.floor(s / 60)}dk önce`;
  return `${Math.floor(s / 3600)}sa önce`;
};

const healthTier = (isoStr) => {
  if (!isoStr) return { tone: "rose", label: "Push YOK", icon: AlertCircle, help: "Push servisleri henüz kurulmadı — 'Onar' butonuna basın" };
  const s = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (s < 15) return { tone: "emerald", label: "SAĞLIKLI", icon: CheckCircle2, help: "Real-time akış aktif · <15sn" };
  if (s < 60) return { tone: "yellow", label: "YAVAŞ", icon: Clock, help: "Timer'dan biraz uzun · normal olabilir" };
  if (s < 300) return { tone: "orange", label: "GECİKMİŞ", icon: Clock, help: "Push timer'ı yavaşladı — 'Onar' ile yeniden kurun" };
  return { tone: "rose", label: "PUSH DURDU", icon: AlertCircle, help: "Push servisi durdu — 'Onar' butonuyla yeniden kurun" };
};

const toneCls = (tone) => {
  switch (tone) {
    case "emerald": return { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-300", dot: "bg-emerald-400" };
    case "yellow":  return { bg: "bg-yellow-500/10",  border: "border-yellow-500/40",  text: "text-yellow-300",  dot: "bg-yellow-400" };
    case "orange":  return { bg: "bg-orange-500/10",  border: "border-orange-500/40",  text: "text-orange-300",  dot: "bg-orange-400" };
    case "rose":    return { bg: "bg-rose-500/10",    border: "border-rose-500/40",    text: "text-rose-300",    dot: "bg-rose-400" };
    default:        return { bg: "bg-slate-800",      border: "border-slate-700",      text: "text-slate-300",   dot: "bg-slate-400" };
  }
};

export default function PushHealthWidget() {
  const [showFix, setShowFix] = useState(false);  // v44.00.07 — Onar modal state
  const q = useQuery({
    queryKey: ["outbound-stats-widget"],
    queryFn: api.outboundStats,
    refetchInterval: 5000,          // 5sn'de bir güncelle
    staleTime: 0,
  });
  const lastPush = q.data?.last_push_at;
  const t = healthTier(lastPush);
  const cls = toneCls(t.tone);
  const Icon = t.icon;
  return (
    <Card data-testid="push-health-widget">
      <div className={`p-4 border-l-4 ${cls.border} ${cls.bg} rounded-r-lg flex items-center gap-4`}>
        <div className={`w-11 h-11 rounded-full ${cls.bg} border ${cls.border} flex items-center justify-center shrink-0`}>
          <Icon className={`w-5 h-5 ${cls.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs uppercase tracking-widest text-slate-500 font-semibold">Exim Push Sağlığı</span>
            <span className={`inline-flex items-center gap-1 text-[10px] mono px-1.5 py-0.5 rounded ${cls.bg} ${cls.text} border ${cls.border} font-bold`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cls.dot} animate-pulse`} />
              {t.label}
            </span>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className={`text-lg font-bold ${cls.text}`} data-testid="push-health-status">
              {lastPush ? `Son push: ${fmtSince(lastPush)}` : "Sunucudan push alınmadı"}
            </span>
            <span className="text-[11px] text-slate-500">{t.help}</span>
          </div>
        </div>
        {(t.tone === "orange" || t.tone === "rose") && (
          <button
            onClick={() => setShowFix(true)}
            data-testid="push-health-fix-link"
            className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 whitespace-nowrap font-semibold"
          >
            → Onar (tek komut)
          </button>
        )}
      </div>
      {/* v44.00.07 — Tek komutlu onarım modalı (Outbound sayfasındaki SSH listesine YÖNLENDİRMEZ) */}
      {showFix && <PushOnarModal onClose={() => setShowFix(false)} />}
    </Card>
  );
}

function PushOnarModal({ onClose }) {
  const [copied, setCopied] = useState(false);
  const cmd = "sudo gwsm-update";
  const doCopy = () => {
    try {
      navigator.clipboard.writeText(cmd);
      setCopied(true);
      toast.success("Komut kopyalandı — sunucunuzda root olarak yapıştırın");
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {
      toast.error("Kopyalama başarısız — komutu manuel seçip kopyalayın");
    }
  };
  // v44.00.09 — Modal açılınca komutu otomatik clipboard'a kopyala (tek adım UX)
  useEffect(() => {
    // Küçük gecikme ile ki toast öncesi modal render bitsin
    const t = setTimeout(() => {
      try {
        navigator.clipboard.writeText(cmd).then(() => {
          setCopied(true);
          toast.success("✓ Komut otomatik kopyalandı — sunucunuza yapıştırın (Ctrl+V)", {
            duration: 4000,
          });
          setTimeout(() => setCopied(false), 3000);
        }).catch(() => { /* clipboard izni yok — sessizce geç */ });
      } catch (_) { /* eski tarayıcı — sessizce geç */ }
    }, 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="push-onar-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-emerald-500/40 bg-slate-900 shadow-2xl shadow-emerald-500/20 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-emerald-950/60 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-100">Tek Adım Onarım</div>
              <div className="text-[11px] text-slate-500">Push sağlığını yeşile çevirir — sıfır ekstra komut</div>
            </div>
          </div>
          <button onClick={onClose} data-testid="push-onar-close" className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-sm text-slate-300 leading-relaxed">
            <b className="text-emerald-300">GökyüzüWebSpam v44.00.07</b> ile <code className="mono text-amber-300">install.sh</code>
            {" "}Exim push tailer'ı, heartbeat timer'ı ve otomatik güncelleme servislerini <b>tek seferde otomatik kuruyor</b>.
            Aşağıdaki komutu sunucunuzda bir kere çalıştırmanız yeterli — 1-2 dakika içinde bu ekran <b className="text-emerald-300">yeşil</b> olur.
          </div>
          <div className="flex items-center gap-2">
            <code className="mono flex-1 text-base bg-slate-950 border border-emerald-500/40 rounded px-4 py-3 text-emerald-300 font-bold select-all text-center">
              {cmd}
            </code>
            <button
              onClick={doCopy}
              data-testid="push-onar-copy"
              className="text-sm px-4 py-3 rounded bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1.5 font-semibold"
            >
              <Copy className="w-4 h-4" />
              {copied ? "Kopyalandı" : "Kopyala"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-slate-950/60 border border-emerald-500/30 rounded p-2">
              <div className="text-emerald-400 font-semibold mb-0.5">✓ gws-exim-push.timer</div>
              <div className="text-slate-500">15 sn'de bir outbound push</div>
            </div>
            <div className="bg-slate-950/60 border border-emerald-500/30 rounded p-2">
              <div className="text-emerald-400 font-semibold mb-0.5">✓ gws-simple-push.timer</div>
              <div className="text-slate-500">Heartbeat 5 dk'da bir</div>
            </div>
            <div className="bg-slate-950/60 border border-emerald-500/30 rounded p-2">
              <div className="text-emerald-400 font-semibold mb-0.5">✓ gws-exim-inotify</div>
              <div className="text-slate-500">Real-time push (inotify)</div>
            </div>
            <div className="bg-slate-950/60 border border-emerald-500/30 rounded p-2">
              <div className="text-emerald-400 font-semibold mb-0.5">✓ gwsm-auto-update</div>
              <div className="text-slate-500">Günlük otomatik güncelleme</div>
            </div>
          </div>
          {/* v44.00.11 — SSH Copy Assist: master admin uzaktan tek satırla tetikleyebilsin */}
          <SshAssist />
          <div className="text-[11px] text-emerald-200 bg-emerald-500/5 border border-emerald-500/20 rounded p-2.5">
            💡 <b>Ne yapar?</b> Master'dan yeni tarball'ı indirir → <code className="mono">install.sh</code> çalıştırır → eksik systemd timer'ları otomatik kurar. Mevcut yapılandırma KORUNUR.
          </div>
        </div>
      </div>
    </div>
  );
}

// v44.00.11 — SSH ile uzaktan tetikleme yardımcısı. Master admin müşteri
// panele erişemediğinde direkt SSH üzerinden komutu koşturmak için kullanılır.
function SshAssist() {
  const [host, setHost] = useState("customer-server.com");
  const [copied, setCopied] = useState(false);
  const sshCmd = `ssh root@${host} "sudo gwsm-update"`;
  const doCopy = () => {
    try {
      navigator.clipboard.writeText(sshCmd);
      setCopied(true);
      toast.success("SSH komutu kopyalandı — kendi terminalinize yapıştırın");
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {
      toast.error("Kopyalama başarısız");
    }
  };
  return (
    <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-3 space-y-2" data-testid="push-onar-ssh-assist">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-sky-400 font-bold">Uzaktan tetikle (opsiyonel)</span>
        <span className="text-[10px] text-slate-500">— müşteri panele giremiyorsa SSH ile siz koşun</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 mono shrink-0">ssh root@</span>
        <input
          data-testid="push-onar-ssh-host"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="customer-server.com"
          className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs mono text-sky-200 focus:border-sky-500 focus:outline-none"
        />
        <span className="text-xs text-slate-500 mono shrink-0">"sudo gwsm-update"</span>
      </div>
      <div className="flex items-center gap-2">
        <code className="mono flex-1 text-[11px] bg-slate-950 border border-sky-500/30 rounded px-3 py-2 text-sky-300 select-all truncate">
          {sshCmd}
        </code>
        <button
          onClick={doCopy}
          data-testid="push-onar-ssh-copy"
          className="text-xs px-3 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white inline-flex items-center gap-1.5 font-semibold shrink-0"
        >
          <Copy className="w-3.5 h-3.5" />
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
    </div>
  );
}
