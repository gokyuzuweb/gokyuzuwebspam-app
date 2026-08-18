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
  const savedTheme = cfg.data?.theme || "dark";
  const themeSchedule = cfg.data?.theme_schedule || "off";   // v43.85
  // v43.85 — Zaman bazlı override: gece 22:00-06:00 arasında "alarm" tema
  const hour = new Date().getHours();
  const isNight = hour >= 22 || hour < 6;
  const theme = (themeSchedule === "night_alarm" && isNight) ? "alarm" : savedTheme;
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

  // v43.82 — PIN pad klavye desteği (rakam basınca ekle, Backspace sil, Enter aç)
  useEffect(() => {
    if (!locked || !canUsePin) return;
    const onKey = (e) => {
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        setKeyIn((v) => (v.length < 8 ? v + e.key : v));
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setKeyIn((v) => v.slice(0, -1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setKeyIn("");
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!verifying) doUnlock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, canUsePin, verifying]);

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

  // v43.83 — Tema paletleri
  const themeStyles = {
    dark: {
      backdrop: "backdrop-blur-md bg-slate-950/85",
      card: "border-slate-700/60 bg-gradient-to-br from-slate-900 to-slate-950",
      iconWrap: "bg-amber-500/15 border-amber-500/40",
      icon: "text-amber-400",
      title: "text-slate-100",
      subtitle: "text-slate-400",
      pinBtn: "bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-100 border-slate-700",
      pinAux: "bg-slate-900 hover:bg-slate-800 text-amber-300 border-slate-700",
      pinClear: "bg-slate-900 hover:bg-slate-800 text-rose-300 border-slate-700",
      input: "bg-slate-950 border-slate-700 focus:border-amber-500/60 text-slate-100",
      unlockBtn: "from-amber-500 to-orange-500 hover:shadow-amber-500/30 text-white",
      helper: "text-slate-500",
    },
    light: {
      backdrop: "backdrop-blur-md bg-slate-100/85",
      card: "border-slate-300 bg-gradient-to-br from-white to-slate-100",
      iconWrap: "bg-amber-100 border-amber-300",
      icon: "text-amber-600",
      title: "text-slate-900",
      subtitle: "text-slate-600",
      pinBtn: "bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-900 border-slate-300",
      pinAux: "bg-slate-50 hover:bg-slate-100 text-amber-700 border-slate-300",
      pinClear: "bg-slate-50 hover:bg-slate-100 text-rose-600 border-slate-300",
      input: "bg-white border-slate-300 focus:border-amber-500 text-slate-900",
      unlockBtn: "from-amber-500 to-orange-500 hover:shadow-amber-500/30 text-white",
      helper: "text-slate-500",
    },
    alarm: {
      backdrop: "backdrop-blur-md bg-rose-950/90",
      card: "border-rose-500/60 bg-gradient-to-br from-rose-950 to-slate-950 shadow-rose-500/20",
      iconWrap: "bg-rose-500/20 border-rose-500/60 animate-pulse",
      icon: "text-rose-300",
      title: "text-rose-100",
      subtitle: "text-rose-200/80",
      pinBtn: "bg-rose-900/40 hover:bg-rose-800/40 active:bg-rose-700/40 text-rose-100 border-rose-700/40",
      pinAux: "bg-rose-950 hover:bg-rose-900 text-amber-300 border-rose-700/40",
      pinClear: "bg-rose-950 hover:bg-rose-900 text-rose-300 border-rose-700/40",
      input: "bg-rose-950 border-rose-700/60 focus:border-rose-400 text-rose-100",
      unlockBtn: "from-rose-500 to-orange-500 hover:shadow-rose-500/50 text-white",
      helper: "text-rose-300/70",
    },
  };
  const ts = themeStyles[theme] || themeStyles.dark;

  return (
    <div
      data-testid="idle-lock-overlay"
      data-theme={theme}
      className={`fixed inset-0 z-[9999] flex items-center justify-center ${ts.backdrop}`}
    >
      <div className={`w-full max-w-md mx-6 rounded-2xl border shadow-2xl shadow-slate-950/60 p-8 ${ts.card}`}>
        <div className="flex flex-col items-center text-center">
          <div className={`w-16 h-16 rounded-full border flex items-center justify-center mb-4 ${ts.iconWrap}`}>
            <Lock className={`w-8 h-8 ${ts.icon}`} />
          </div>
          <h1 className={`text-xl font-semibold mb-1 ${ts.title}`}>
            {theme === "alarm" ? "⚠ Panel Kilitli — Güvenlik Uyarısı" : "Panel Kilitlendi"}
          </h1>
          <p className={`text-sm mb-6 ${ts.subtitle}`}>
            <b className={ts.title}>{minutes}</b> dakika hareketsizlik nedeniyle
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

          <label className={`w-full text-left text-[11px] uppercase tracking-widest mb-1 ${ts.helper}`}>
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
            readOnly={canUsePin}
            className={`w-full border rounded-lg px-3 py-2.5 mono text-lg outline-none text-center tracking-widest ${ts.input} ${canUsePin ? "cursor-default select-none" : ""}`}
          />

          {canUsePin && (
            <div data-testid="idle-lock-pinpad" className="w-full grid grid-cols-3 gap-2 mt-3">
              {["1","2","3","4","5","6","7","8","9"].map((n) => (
                <button
                  key={n}
                  type="button"
                  data-testid={`idle-lock-pin-${n}`}
                  onClick={() => setKeyIn((v) => (v.length < 8 ? v + n : v))}
                  className={`py-3 rounded-lg text-xl font-semibold mono transition-colors border ${ts.pinBtn}`}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                data-testid="idle-lock-pin-clear"
                onClick={() => setKeyIn("")}
                title="Temizle"
                className={`py-3 rounded-lg text-sm font-semibold transition-colors border ${ts.pinClear}`}
              >
                ⌫ TEM
              </button>
              <button
                key="0"
                type="button"
                data-testid="idle-lock-pin-0"
                onClick={() => setKeyIn((v) => (v.length < 8 ? v + "0" : v))}
                className="py-3 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-100 text-xl font-semibold mono transition-colors border border-slate-700"
              >
                0
              </button>
              <button
                type="button"
                data-testid="idle-lock-pin-back"
                onClick={() => setKeyIn((v) => v.slice(0, -1))}
                title="Sil"
                className={`py-3 rounded-lg text-sm font-semibold transition-colors border ${ts.pinAux}`}
              >
                ← SİL
              </button>
            </div>
          )}
          <button
            data-testid="idle-lock-unlock-btn"
            onClick={doUnlock}
            disabled={verifying}
            className={`mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-60 ${ts.unlockBtn}`}
          >
            <Unlock className="w-4 h-4" /> {verifying ? "Doğrulanıyor…" : "Kilidi Aç"}
          </button>

          <div className={`mt-5 flex items-start gap-2 text-[11px] ${ts.helper}`}>
            <ShieldAlert className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${ts.icon}`} />
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
