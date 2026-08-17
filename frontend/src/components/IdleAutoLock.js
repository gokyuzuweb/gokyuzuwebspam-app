/**
 * v43.81 — İdle Auto-Lock (PIN + Persist across page refresh)
 *
 * Kilit durumu localStorage'de saklanır → sayfa yenilense bile kilitli kalır.
 * Açma yöntemi: 4-8 haneli PIN (bayi kendi PIN'ini Settings > Otomatik Kilit'te belirler).
 * PIN yoksa (henüz atanmamış) → lisans key ile fallback açma (backward compat).
 * PIN backend'de PBKDF2-SHA256 ile hash'lenir, 5 yanlış deneme sonrası 5dk cooldown.
 *
 * Bayi kendi kilit ayarını `/api/settings/idle-lock/me` ile yönetir (per-user).
 * Master global config fallback olarak devrededir.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, Unlock, ShieldAlert, Clock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click", "wheel"];
const LS_LOCKED_AT = "gws.idle_locked_at";
const LS_LOCKED_OWNER = "gws.idle_locked_owner";
const LS_LOCKED_IP = "gws.idle_locked_from_ip";

function fmtTime(ms) {
  if (ms <= 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function _getSessionKey() {
  if (typeof window === "undefined") return "";
  return (localStorage.getItem("gws.master_license")
    || localStorage.getItem("gws.event_license")
    || "").trim();
}

export default function IdleAutoLock() {
  const cfg = useQuery({
    queryKey: ["idle-lock-me"],
    queryFn: () => api.idleLockMeGet(),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
  const enabled = cfg.data?.enabled ?? true;
  const minutes = Math.max(1, Math.min(1440, cfg.data?.minutes ?? 15));
  const warnSec = Math.max(0, Math.min(300, cfg.data?.warn_seconds ?? 30));
  const hasPin = Boolean(cfg.data?.has_pin);
  const lockMs = minutes * 60_000;

  const [now, setNow] = useState(Date.now());
  // Persist: sayfa yenilendiğinde LS'de kilit varsa hemen locked başla
  const [locked, setLocked] = useState(() => {
    if (typeof window === "undefined") return false;
    const at = localStorage.getItem(LS_LOCKED_AT);
    return !!at;
  });
  const [keyIn, setKeyIn] = useState("");
  const [verifying, setVerifying] = useState(false);
  const lastRef = useRef(Date.now());
  const bumpActivity = () => { lastRef.current = Date.now(); };

  // IP fingerprint
  const [lockedFromIp, setLockedFromIp] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem(LS_LOCKED_IP) : null);
  const [currentIp, setCurrentIp] = useState(null);
  const [ipChanged, setIpChanged] = useState(false);
  const [ipConfirmed, setIpConfirmed] = useState(false);

  const canUsePin = hasPin;
  const inputMode = canUsePin ? "pin" : "license";

  // Persist locked_at when transitioning to locked
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (locked) {
      if (!localStorage.getItem(LS_LOCKED_AT)) {
        localStorage.setItem(LS_LOCKED_AT, String(Date.now()));
        localStorage.setItem(LS_LOCKED_OWNER, _getSessionKey());
      }
    } else {
      localStorage.removeItem(LS_LOCKED_AT);
      localStorage.removeItem(LS_LOCKED_OWNER);
      localStorage.removeItem(LS_LOCKED_IP);
    }
  }, [locked]);

  // Track activity
  useEffect(() => {
    if (!enabled) return;
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, bumpActivity, { passive: true });
    return () => { for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bumpActivity); };
  }, [enabled]);

  // 1sn tick
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);

  // Idle → locked
  useEffect(() => {
    if (!enabled || locked) return;
    const idle = Date.now() - lastRef.current;
    if (idle >= lockMs) {
      setLocked(true);
      try { toast.info("Hareketsizlik nedeniyle panel kilitlendi", { duration: 5000 }); } catch (_) {}
      const lk = _getSessionKey();
      try {
        fetch("/api/audit/idle-lock-event", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(lk ? { "X-Master-Key": lk } : {}) },
          body: JSON.stringify({ event: "lock", idle_seconds: Math.floor(idle / 1000), license_key: lk || undefined }),
        }).catch(() => {});
        fetch("/api/admin/whoami", { headers: lk ? { "X-Master-Key": lk } : {} })
          .then((r) => r.json())
          .then((d) => {
            if (d.client_ip) {
              setLockedFromIp(d.client_ip);
              try { localStorage.setItem(LS_LOCKED_IP, d.client_ip); } catch (_) {}
            }
          })
          .catch(() => {});
      } catch (_) {}
    }
  }, [now, enabled, locked, lockMs]);

  // Periyodik IP check while locked
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

  // Storage event: sync unlock across tabs
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

  const doUnlock = async () => {
    const provided = keyIn.trim();
    if (!provided) {
      toast.error(inputMode === "pin" ? "PIN kodunuzu girin" : "Lisans anahtarınızı girin");
      return;
    }
    // IP değiştiyse iki-adım onay
    if (ipChanged && !ipConfirmed) {
      toast.warning("IP adresiniz değişti — güvenlik için ek onay gerekiyor. Onaylayın ve tekrar deneyin.", { duration: 6000 });
      setIpConfirmed(true);
      return;
    }
    if (inputMode === "pin") {
      if (!/^\d{4,8}$/.test(provided)) {
        toast.error("PIN 4-8 haneli sayı olmalı");
        return;
      }
      setVerifying(true);
      try {
        await api.idleLockVerifyPin(provided);
      } catch (ex) {
        setVerifying(false);
        const detail = ex?.response?.data?.detail || ex?.message || "PIN doğrulanamadı";
        toast.error(detail);
        return;
      }
      setVerifying(false);
    } else {
      // License fallback: aktif lisans ile eşleşmeli
      if (!provided.startsWith("MS-")) {
        toast.error("Geçersiz anahtar — MS- ile başlamalı");
        return;
      }
      const master = _getSessionKey();
      if (master && provided !== master) {
        toast.error("Anahtar mevcut oturumla eşleşmiyor");
        return;
      }
    }
    setLocked(false);
    lastRef.current = Date.now();
    setKeyIn("");
    setIpChanged(false);
    setIpConfirmed(false);
    try {
      localStorage.setItem("gws.idle_unlock_at", String(Date.now()));
      localStorage.removeItem(LS_LOCKED_AT);
      localStorage.removeItem(LS_LOCKED_OWNER);
      localStorage.removeItem(LS_LOCKED_IP);
    } catch (_) {}
    toast.success("Panel kilidi açıldı");
    // Audit
    try {
      const lk = _getSessionKey();
      fetch("/api/audit/idle-lock-event", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(lk ? { "X-Master-Key": lk } : {}) },
        body: JSON.stringify({
          event: "unlock",
          license_key: lk || undefined,
          method: inputMode,
          ip_changed: ipChanged,
          previous_ip: lockedFromIp,
          current_ip: currentIp,
        }),
      }).catch(() => {});
    } catch (_) {}
  };

  const warningChip = useMemo(() => {
    if (locked || !enabled) return null;
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
    return null;
  }, [now, locked, enabled, lockMs, warnSec]);

  if (!enabled || !locked) return warningChip;

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
            güvenlik için oturumunuz kilitlendi. Devam etmek için {canUsePin ? "PIN kodunuzu" : "lisans anahtarınızı"} girin.
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
                    ? <div className="mt-1 text-emerald-300">✓ Onaylandı — {canUsePin ? "PIN" : "anahtarı"} girip tekrar tıklayın</div>
                    : <div className="mt-1">Session hijack koruması için ek onay gerekiyor. "Kilidi Aç" butonuna 2 kere basın.</div>}
                </div>
              </div>
            </div>
          )}

          <label className="w-full text-left text-[11px] uppercase tracking-widest text-slate-500 mb-1">
            {canUsePin ? "PIN Kodunuz" : "Lisans Anahtarınız"}
          </label>
          <input
            data-testid="idle-lock-input"
            autoFocus
            type={canUsePin ? "text" : "password"}
            inputMode={canUsePin ? "numeric" : "text"}
            pattern={canUsePin ? "[0-9]*" : undefined}
            maxLength={canUsePin ? 8 : 128}
            value={keyIn}
            onChange={(e) => {
              const v = canUsePin ? e.target.value.replace(/\D/g, "").slice(0, 8) : e.target.value;
              setKeyIn(v);
            }}
            onKeyDown={(e) => e.key === "Enter" && !verifying && doUnlock()}
            placeholder={canUsePin ? "••••" : "MS-..."}
            className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500/60 rounded-lg px-3 py-2.5 mono text-lg text-slate-100 outline-none text-center tracking-widest"
          />

          <button
            data-testid="idle-lock-unlock-btn"
            onClick={doUnlock}
            disabled={verifying}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold text-sm hover:shadow-lg hover:shadow-amber-500/30 transition-all disabled:opacity-60"
          >
            <Unlock className="w-4 h-4" /> {verifying ? "Doğrulanıyor…" : "Kilidi Aç"}
          </button>

          <div className="mt-5 flex items-start gap-2 text-[11px] text-slate-500">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span>
              {canUsePin
                ? <>PIN'inizi <b>Ayarlar → Otomatik Kilit</b>'ten değiştirebilirsiniz. 5 yanlış denemede 5dk kilit uygulanır.</>
                : <>PIN henüz oluşturulmadı. <b>Ayarlar → Otomatik Kilit</b> menüsünden PIN oluşturun (önerilir).</>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
