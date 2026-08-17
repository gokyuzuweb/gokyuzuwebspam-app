/**
 * v43.72 — İdle Auto-Lock
 *
 * Ekranda hareketsizlik (mousemove / keydown / click / scroll / touchstart)
 * belirlenen süreyi aşarsa paneli overlay ile kilitler. Kullanıcı MS-… lisansı
 * girip "Kilidi Aç" tıklayarak paneli yeniden açar.
 *
 * Master tek yerden `POST /api/settings/idle-lock` ile süreyi ayarlar
 * (`enabled`, `minutes`, `warn_seconds`). Bu component her 60sn config'i
 * yeniler; ayar değişikliği anında herkeste yansır.
 *
 * Neden bu component:
 *   - Ekonomik güvenlik: kullanıcı bilgisayarını açık bıraksa bile 15dk sonra
 *     panel kilitli — bayi WHM oturumu koruma altına alınır.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, Unlock, ShieldAlert, Clock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click", "wheel"];

function fmtTime(ms) {
  if (ms <= 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export default function IdleAutoLock() {
  const cfg = useQuery({
    queryKey: ["idle-lock-config"],
    queryFn: () => api.idleLockGet(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const enabled = cfg.data?.enabled ?? true;
  const minutes = Math.max(1, Math.min(1440, cfg.data?.minutes ?? 15));
  const warnSec = Math.max(0, Math.min(300, cfg.data?.warn_seconds ?? 30));
  const lockMs = minutes * 60_000;

  const [now, setNow] = useState(Date.now());
  const [locked, setLocked] = useState(false);
  const [keyIn, setKeyIn] = useState("");
  const lastRef = useRef(Date.now());
  const bumpActivity = () => { lastRef.current = Date.now(); };

  // v43.74 — Kilit anında client IP'yi hatırla; unlock'ta değişmişse re-auth uyarısı
  const [lockedFromIp, setLockedFromIp] = useState(null);
  const [currentIp, setCurrentIp] = useState(null);
  const [ipChanged, setIpChanged] = useState(false);
  const [ipConfirmed, setIpConfirmed] = useState(false);

  // Track activity
  useEffect(() => {
    if (!enabled) return;
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, bumpActivity, { passive: true });
    return () => { for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bumpActivity); };
  }, [enabled]);

  // 1sn tick — check idle
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || locked) return;
    const idle = Date.now() - lastRef.current;
    if (idle >= lockMs) {
      setLocked(true);
      try { toast.info("Hareketsizlik nedeniyle panel kilitlendi", { duration: 5000 }); } catch (_) {}
      // v43.73 — Audit log event
      try {
        const lk = (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license") || "").trim();
        fetch("/api/audit/idle-lock-event", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(lk ? { "X-Master-Key": lk } : {}) },
          body: JSON.stringify({ event: "lock", idle_seconds: Math.floor(idle / 1000), license_key: lk || undefined }),
        }).catch(() => {});
        // v43.74 — Client IP fingerprint (unlock'ta karşılaştırılır)
        fetch("/api/admin/whoami", { headers: lk ? { "X-Master-Key": lk } : {} })
          .then((r) => r.json())
          .then((d) => setLockedFromIp(d.client_ip || null))
          .catch(() => {});
      } catch (_) {}
    }
  }, [now, enabled, locked, lockMs]);

  // v43.74 — Kilitliyken periyodik IP check (session hijack koruma)
  useEffect(() => {
    if (!locked || !lockedFromIp) return;
    const check = () => {
      fetch("/api/admin/whoami").then((r) => r.json()).then((d) => {
        if (d.client_ip && d.client_ip !== lockedFromIp) {
          setCurrentIp(d.client_ip);
          setIpChanged(true);
        }
      }).catch(() => {});
    };
    check();
    const t = setInterval(check, 10_000);
    return () => clearInterval(t);
  }, [locked, lockedFromIp]);

  // Storage event: aynı kullanıcı başka tab'da unlock ederse burada da unlock
  useEffect(() => {
    const h = (e) => {
      if (e.key === "gws.idle_unlock_at") {
        setLocked(false);
        lastRef.current = Date.now();
      }
    };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  if (!enabled || !locked) {
    // Sadece uyarı chip'i (warn_seconds içinde)
    if (enabled && !locked) {
      const remaining = lockMs - (now - lastRef.current);
      if (warnSec > 0 && remaining > 0 && remaining <= warnSec * 1000) {
        return (
          <div
            data-testid="idle-lock-warn"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9998] flex items-center gap-2 px-3 py-2 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs shadow-lg backdrop-blur"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Panel <b>{fmtTime(remaining)}</b> sonra kilitlenecek — hareket edin</span>
          </div>
        );
      }
    }
    return null;
  }
  const doUnlock = () => {
    const master = (typeof window !== "undefined"
      && (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license") || "")).trim();
    const provided = keyIn.trim();
    if (!provided) {
      toast.error("Lisans anahtarını girin");
      return;
    }
    if (!provided.startsWith("MS-")) {
      toast.error("Geçersiz anahtar — MS- ile başlamalı");
      return;
    }
    // Aktif lisans ile eşleşmeli (bir başkası kilidi açamasın)
    if (master && provided !== master) {
      toast.error("Anahtar mevcut oturumla eşleşmiyor");
      return;
    }
    // v43.74 — IP değiştiyse ek onay iste
    if (ipChanged && !ipConfirmed) {
      toast.warning("IP adresiniz değişti — güvenlik için ek onay gerekiyor. Onaylayın ve tekrar deneyin.", { duration: 6000 });
      setIpConfirmed(true);  // Bir sonraki tıkta geçerli olacak
      return;
    }
    setLocked(false);
    lastRef.current = Date.now();
    setKeyIn("");
    setIpChanged(false);
    setIpConfirmed(false);
    setLockedFromIp(null);
    try { localStorage.setItem("gws.idle_unlock_at", String(Date.now())); } catch (_) {}
    toast.success("Panel kilidi açıldı");
    // v43.73 — Audit log event
    try {
      fetch("/api/audit/idle-lock-event", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(provided ? { "X-Master-Key": provided } : {}) },
        body: JSON.stringify({
          event: "unlock",
          license_key: provided,
          ip_changed: ipChanged,       // v43.74
          previous_ip: lockedFromIp,   // v43.74
          current_ip: currentIp,       // v43.74
        }),
      }).catch(() => {});
    } catch (_) {}
  };

  return (
    <div
      data-testid="idle-lock-overlay"
      className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-md bg-slate-950/85"
    >
      <div className="w-full max-w-md mx-6 rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900 to-slate-950 shadow-2xl shadow-slate-950/60 p-8">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-amber-400" />
          </div>
          <h1 className="text-slate-100 text-xl font-semibold mb-1">Panel Kilitlendi</h1>
          <p className="text-slate-400 text-sm mb-6">
            <b className="text-slate-200">{minutes}</b> dakika hareketsizlik nedeniyle
            güvenlik için oturumunuz kilitlendi. Devam etmek için lisans anahtarınızı girin.
          </p>

          {ipChanged && (
            <div data-testid="idle-lock-ip-warn" className="w-full mb-4 p-3 rounded-md border border-rose-500/40 bg-rose-500/10 text-left">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <div className="text-xs text-rose-100">
                  <b>IP adresiniz değişti — güvenlik uyarısı</b>
                  <div className="mono text-[10px] text-rose-300/80 mt-0.5">
                    Kilit: {lockedFromIp || "-"} → Şu an: {currentIp || "-"}
                  </div>
                  {ipConfirmed
                    ? <div className="mt-1 text-emerald-300">✓ Onaylandı — anahtarı girip tekrar tıklayın</div>
                    : <div className="mt-1">Session hijack koruması için ek onay gerekiyor. "Kilidi Aç" butonuna 2 kere basın.</div>}
                </div>
              </div>
            </div>
          )}

          <label className="w-full text-left text-[11px] uppercase tracking-widest text-slate-500 mb-1">
            Lisans Anahtarınız
          </label>
          <input
            data-testid="idle-lock-input"
            autoFocus
            type="password"
            value={keyIn}
            onChange={(e) => setKeyIn(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doUnlock()}
            placeholder="MS-..."
            className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500/60 rounded-lg px-3 py-2.5 mono text-sm text-slate-100 outline-none"
          />

          <button
            data-testid="idle-lock-unlock-btn"
            onClick={doUnlock}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold text-sm hover:shadow-lg hover:shadow-amber-500/30 transition-all"
          >
            <Unlock className="w-4 h-4" /> Kilidi Aç
          </button>

          <div className="mt-5 flex items-start gap-2 text-[11px] text-slate-500">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span>
              Bu ekran her <b>{minutes}dk</b> hareketsizlikte otomatik açılır. Kilit süresini
              Master `/panel/settings` üzerinden değiştirebilir.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
