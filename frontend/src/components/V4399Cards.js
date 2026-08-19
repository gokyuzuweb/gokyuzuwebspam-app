/**
 * v43.99 — Master 2FA (TOTP) Setup + Verify Card + Deep Link tracker.
 * Mounted from Settings > Güvenlik tab.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert, KeyRound, Copy, Check, X, Smartphone, Loader2, ExternalLink } from "lucide-react";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

export function Master2FACard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["master-2fa-status"], queryFn: () => api.master2FAStatus(), refetchInterval: 30_000 });
  const [step, setStep] = useState("idle");   // idle | setup | enabled | disable
  const [secret, setSecret] = useState("");
  const [qrPng, setQrPng] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState([]);
  const [disableCode, setDisableCode] = useState("");
  const [verifyCode, setVerifyCode] = useState("");

  const initMut = useMutation({
    mutationFn: () => api.master2FASetupInit(),
    onSuccess: (d) => { setSecret(d.secret); setQrPng(d.qr_png_base64); setOtpauth(d.otpauth_url); setStep("setup"); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Setup başlatılamadı"),
  });
  const enableMut = useMutation({
    mutationFn: () => api.master2FAEnable(secret, code.trim()),
    onSuccess: (d) => {
      setBackupCodes(d.backup_codes || []);
      setCode("");
      setStep("enabled");
      qc.invalidateQueries({ queryKey: ["master-2fa-status"] });
      toast.success("2FA etkinleştirildi ✓ — Yedek kodları kaydedin!");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kod doğrulanamadı"),
  });
  const verifyMut = useMutation({
    mutationFn: () => api.master2FAVerify(verifyCode.trim()),
    onSuccess: (d) => {
      setVerifyCode("");
      qc.invalidateQueries({ queryKey: ["master-2fa-status"] });
      toast.success(d.used_backup_code ? `Yedek kod kullanıldı (${d.backup_codes_remaining} kaldı)` : "Doğrulandı ✓ — 8 saat aktif");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kod hatalı"),
  });
  const disableMut = useMutation({
    mutationFn: () => api.master2FADisable(disableCode.trim()),
    onSuccess: () => {
      setDisableCode(""); setBackupCodes([]); setStep("idle");
      qc.invalidateQueries({ queryKey: ["master-2fa-status"] });
      toast.success("2FA kapatıldı");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kod hatalı"),
  });

  const s = status.data || {};
  const enabled = !!s.enabled;
  const verified = !!s.verified;

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-400" /> Master 2FA (Google Authenticator / Authy)</span>}
        subtitle="TOTP tabanlı iki-faktörlü doğrulama. Master keyi çalınsa bile telefondaki uygulama olmadan hassas işlem yapılamaz."
        right={<Badge tone={enabled ? "emerald" : "slate"} data-testid="m2fa-status-badge">
          {enabled ? (verified ? "AKTİF · DOĞRULANDI" : "AKTİF") : "KAPALI"}
        </Badge>}
      />
      <CardBody className="space-y-4">
        {!enabled && step !== "setup" && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              2FA'yı etkinleştirmek için önce bir TOTP uygulaması kurun (Google Authenticator, Authy, 1Password, Microsoft Authenticator vb).
            </p>
            <button
              data-testid="m2fa-setup-start"
              type="button"
              onClick={() => initMut.mutate()}
              disabled={initMut.isPending}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 text-sm font-semibold disabled:opacity-50"
            >
              {initMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
              2FA Kurulumu Başlat
            </button>
          </div>
        )}

        {step === "setup" && qrPng && (
          <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-xs font-semibold text-amber-200">1. QR kodu telefon uygulamanızla okutun</div>
            <div className="flex flex-col md:flex-row gap-4 items-start">
              <img src={`data:image/png;base64,${qrPng}`} alt="TOTP QR" className="w-40 h-40 rounded border border-slate-800 bg-white p-1" data-testid="m2fa-qr" />
              <div className="flex-1 space-y-2 text-xs">
                <div className="text-slate-400">Veya secret'ı manuel girin:</div>
                <div className="flex gap-2">
                  <code data-testid="m2fa-secret" className="flex-1 mono text-emerald-300 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] break-all">{secret}</code>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(secret); toast.success("Kopyalandı"); }}
                    className="p-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="text-slate-500 pt-2">2. Uygulamada oluşan 6 haneli kodu girin:</div>
                <div className="flex gap-2">
                  <input data-testid="m2fa-code-input" type="text" inputMode="numeric" maxLength={6}
                    value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="123456"
                    className="w-40 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-center tracking-widest focus:border-amber-500/50 focus:outline-none" />
                  <button data-testid="m2fa-enable" type="button" onClick={() => enableMut.mutate()}
                    disabled={code.length !== 6 || enableMut.isPending}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 text-sm font-semibold disabled:opacity-50">
                    <Check className="w-4 h-4" /> Etkinleştir
                  </button>
                  <button type="button" onClick={() => { setStep("idle"); setSecret(""); setQrPng(""); setCode(""); }}
                    className="px-3 py-2 rounded border border-slate-700 text-slate-400 hover:text-slate-200 text-sm">Vazgeç</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "enabled" && backupCodes.length > 0 && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 space-y-2" data-testid="m2fa-backups">
            <div className="text-xs font-bold text-rose-200">🔐 Yedek Kodlarınızı ŞİMDİ Kaydedin — Bir daha gösterilmeyecek!</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {backupCodes.map((b, i) => (
                <code key={i} className="mono text-[11px] px-2 py-1 rounded bg-slate-950 text-rose-100 border border-rose-500/30 text-center">{b}</code>
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { navigator.clipboard.writeText(backupCodes.join("\n")); toast.success("Yedek kodlar kopyalandı"); }}
                className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 inline-flex items-center gap-1">
                <Copy className="w-3.5 h-3.5" /> Hepsini Kopyala
              </button>
              <button type="button" onClick={() => { setStep("idle"); setBackupCodes([]); }}
                className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Kaydettim, kapat
              </button>
            </div>
          </div>
        )}

        {enabled && step === "idle" && (
          <div className="space-y-3">
            {!verified && (
              <div className="rounded-md border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2">
                <div className="text-xs font-semibold text-indigo-200">Bu oturumu doğrulamak için 6 haneli TOTP kodu girin</div>
                <div className="flex gap-2">
                  <input data-testid="m2fa-verify-input" type="text" inputMode="numeric" maxLength={14}
                    value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)}
                    placeholder="123456 veya XXXX-XXXX"
                    className="w-56 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-center focus:border-indigo-500/50 focus:outline-none" />
                  <button data-testid="m2fa-verify" type="button" onClick={() => verifyMut.mutate()}
                    disabled={verifyCode.trim().length < 6 || verifyMut.isPending}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 text-sm font-semibold disabled:opacity-50">
                    <Check className="w-4 h-4" /> Doğrula
                  </button>
                </div>
              </div>
            )}
            {verified && (
              <div className="text-xs text-emerald-300 flex items-center gap-2">
                <Check className="w-4 h-4" /> Bu oturum doğrulandı — 8 saat boyunca hassas işlemlere onay verebilirsiniz.
              </div>
            )}
            <div className="text-[11px] text-slate-500">
              Kalan yedek kod: <span className="mono text-amber-300">{s.backup_codes_remaining}</span>
            </div>
            <div className="border-t border-slate-800 pt-3">
              <div className="text-xs font-semibold text-slate-300 mb-2">2FA'yı kapatmak için TOTP kodu girin:</div>
              <div className="flex gap-2">
                <input data-testid="m2fa-disable-input" value={disableCode} onChange={(e) => setDisableCode(e.target.value)}
                  placeholder="6 haneli kod veya yedek kod"
                  className="w-56 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-center focus:border-rose-500/50 focus:outline-none" />
                <button data-testid="m2fa-disable" type="button" onClick={() => disableMut.mutate()}
                  disabled={disableCode.trim().length < 6 || disableMut.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 text-sm font-semibold disabled:opacity-50">
                  <X className="w-4 h-4" /> 2FA Kapat
                </button>
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}


// v43.99 — Deep Link: "Kaldığın Yerden Devam Et" (last visited panel path)
export function ResumeSessionCard() {
  const [last, setLast] = useState(() => {
    try { return localStorage.getItem("gws.last_visited") || "/panel/dashboard"; }
    catch { return "/panel/dashboard"; }
  });
  const [lastAt, setLastAt] = useState(() => {
    try { return localStorage.getItem("gws.last_visited_at") || ""; }
    catch { return ""; }
  });

  const currentPath = typeof window !== "undefined" ? window.location.pathname : "";
  const showResume = last && last !== currentPath;

  if (!showResume) return null;

  const relTime = (() => {
    if (!lastAt) return "";
    try {
      const diff = (Date.now() - new Date(lastAt).getTime()) / 1000;
      if (diff < 60) return `${Math.floor(diff)}sn önce`;
      if (diff < 3600) return `${Math.floor(diff / 60)}dk önce`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}sa önce`;
      return `${Math.floor(diff / 86400)}g önce`;
    } catch { return ""; }
  })();

  return (
    <div
      data-testid="resume-session-chip"
      className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 flex items-center gap-3 text-xs cursor-pointer hover:bg-indigo-500/20 transition-colors"
      onClick={() => { window.location.href = last; }}
      title={`Son ziyaret: ${last} · ${lastAt}`}
    >
      <ExternalLink className="w-4 h-4 text-indigo-300 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-indigo-200 font-semibold">Kaldığın yerden devam et →</div>
        <div className="text-indigo-400/70 mono text-[10px] truncate">{last} {relTime && <>· {relTime}</>}</div>
      </div>
    </div>
  );
}
