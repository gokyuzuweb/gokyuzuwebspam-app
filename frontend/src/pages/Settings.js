import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Sliders, Clock, Bell, ArrowUpRight, Sparkles, Lock, Cpu, Languages, Server, ShieldCheck, ShieldAlert, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import StripeConfigCard from "@/components/StripeConfigCard";
import SlashAliasesConfigCard from "@/components/SlashAliasesConfigCard";
import { api } from "@/lib/api";
import { useI18n, useT } from "@/i18n";

// v43.72 — İdle Auto-Lock master global ayar kartı (master-only)
function IdleLockConfigCard() {
  const t = useT();
  const q = useQuery({ queryKey: ["idle-lock"], queryFn: () => api.idleLockGet(), staleTime: 30_000 });
  const [enabled, setEnabled] = useState(true);
  const [minutes, setMinutes] = useState(15);
  const [warnSec, setWarnSec] = useState(30);
  useEffect(() => {
    if (q.data) {
      setEnabled(!!q.data.enabled);
      setMinutes(Number(q.data.minutes || 15));
      setWarnSec(Number(q.data.warn_seconds || 30));
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.idleLockSet({ enabled, minutes, warn_seconds: warnSec }),
    onSuccess: () => toast.success("Master global kilit ayarı kaydedildi"),
    onError: (e) => toast.error("Kaydedilemedi: " + (e?.response?.data?.detail || e.message)),
  });
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Lock className="w-4 h-4 text-amber-400" /> Otomatik Kilit (Master Global)</span>}
        subtitle="Bayiler kendi override etmezse bu ayar kullanılır."
      />
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-200">Aktif</div>
            <div className="text-xs text-slate-500 mt-0.5">Kapatırsanız kilit devre dışı</div>
          </div>
          <button
            data-testid="idle-lock-enable-toggle"
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? "bg-emerald-500/70" : "bg-slate-700"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
        <Row title="Kilit süresi (dakika)" hint="1–1440" testid="row-idle-minutes">
          <input type="number" min="1" max="1440"
            data-testid="idle-lock-minutes"
            value={minutes}
            onChange={(e) => setMinutes(Math.max(1, Math.min(1440, parseInt(e.target.value || "15", 10))))}
            className="w-24 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right" />
        </Row>
        <Row title="Uyarı süresi (saniye)" hint="Kilit öncesi banner" testid="row-idle-warn">
          <input type="number" min="0" max="300"
            data-testid="idle-lock-warn"
            value={warnSec}
            onChange={(e) => setWarnSec(Math.max(0, Math.min(300, parseInt(e.target.value || "30", 10))))}
            className="w-24 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right" />
        </Row>
        <button
          data-testid="idle-lock-save"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
        >
          <Save className="w-4 h-4" /> Master Global Ayarı Kaydet
        </button>
      </CardBody>
    </Card>
  );
}


// v43.84 — Kilit ekranı teması için mini overlay preview (state'i etkilemez)
// v43.85 — Zaman bazlı schedule uyarısı da göster
function IdleLockThemePreview({ theme, minutes = 15, hasPin = false, schedule = "off" }) {
  const hour = new Date().getHours();
  const isNight = hour >= 22 || hour < 6;
  const scheduleActive = schedule === "night_alarm" && isNight;
  const effectiveTheme = scheduleActive ? "alarm" : theme;
  const styles = {
    dark: {
      wrap: "bg-slate-950 border-slate-700",
      panel: "bg-gradient-to-br from-slate-900 to-slate-950 border-slate-700/60",
      icon: "bg-amber-500/15 border-amber-500/40 text-amber-400",
      title: "text-slate-100",
      helper: "text-slate-400",
      pin: "bg-slate-800 text-slate-100 border-slate-700",
      btn: "from-amber-500 to-orange-500",
      lbl: "🌙 Karanlık",
    },
    light: {
      wrap: "bg-slate-100 border-slate-300",
      panel: "bg-gradient-to-br from-white to-slate-100 border-slate-300",
      icon: "bg-amber-100 border-amber-300 text-amber-600",
      title: "text-slate-900",
      helper: "text-slate-600",
      pin: "bg-white text-slate-900 border-slate-300",
      btn: "from-amber-500 to-orange-500",
      lbl: "☀️ Aydınlık",
    },
    alarm: {
      wrap: "bg-rose-950 border-rose-500/40",
      panel: "bg-gradient-to-br from-rose-950 to-slate-950 border-rose-500/60",
      icon: "bg-rose-500/20 border-rose-500/60 text-rose-300 animate-pulse",
      title: "text-rose-100",
      helper: "text-rose-200/80",
      pin: "bg-rose-900/40 text-rose-100 border-rose-700/40",
      btn: "from-rose-500 to-orange-500",
      lbl: "🚨 Kırmızı-Alarm",
    },
  };
  const s = styles[effectiveTheme] || styles.dark;
  return (
    <div className="mt-3" data-testid="idle-lock-theme-preview">
      <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-2">
        Önizleme · {s.lbl}
        {scheduleActive && (
          <span className="text-[10px] text-amber-300 bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 rounded normal-case tracking-normal">
            ⏰ Gece Alarm aktif (saat {hour}:00)
          </span>
        )}
        {schedule === "night_alarm" && !scheduleActive && (
          <span className="text-[10px] text-slate-400 bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded normal-case tracking-normal">
            ⏰ Gündüz — Alarm 22:00'de devreye girer
          </span>
        )}
      </div>
      <div className={`rounded-lg border overflow-hidden ${s.wrap}`}>
        <div className={`p-4 border ${s.panel}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-full border flex items-center justify-center ${s.icon}`}>
              <Lock className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-semibold ${s.title}`}>
                {theme === "alarm" ? "⚠ Panel Kilitli" : "Panel Kilitlendi"}
              </div>
              <div className={`text-[11px] ${s.helper}`}>
                {minutes} dk hareketsizlik · {hasPin ? "PIN sorulur" : "Lisans key sorulur"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            {["1","2","3","4","5","6"].map((n) => (
              <div key={n} className={`text-center text-xs py-1.5 rounded border mono ${s.pin}`}>{n}</div>
            ))}
          </div>
          <div className={`text-center text-xs py-1.5 rounded bg-gradient-to-r ${s.btn} text-white font-semibold`}>
            Kilidi Aç (önizleme)
          </div>
        </div>
      </div>
    </div>
  );
}


// v43.81 — Per-user Otomatik Kilit + PIN (her bayi kendisi)
function IdleLockPersonalCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["idle-lock-me"], queryFn: () => api.idleLockMeGet(), staleTime: 15_000, retry: 1 });
  const [enabled, setEnabled] = useState(true);
  const [minutes, setMinutes] = useState(15);
  const [warnSec, setWarnSec] = useState(30);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [theme, setTheme] = useState("dark");  // v43.83
  const [themeSchedule, setThemeSchedule] = useState("off");  // v43.85
  useEffect(() => {
    if (q.data) {
      setEnabled(!!q.data.enabled);
      setMinutes(Number(q.data.minutes || 15));
      setWarnSec(Number(q.data.warn_seconds || 30));
      setTheme(q.data.theme || "dark");
      setThemeSchedule(q.data.theme_schedule || "off");
    }
  }, [q.data]);
  const hasPin = q.data?.has_pin;
  const owner = q.data?.owner || "";

  const saveSettings = useMutation({
    mutationFn: () => api.idleLockMeSet({ enabled, minutes, warn_seconds: warnSec, theme, theme_schedule: themeSchedule }),
    onSuccess: () => {
      toast.success("Kişisel kilit ayarı kaydedildi");
      qc.invalidateQueries({ queryKey: ["idle-lock-me"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kaydedilemedi"),
  });
  const savePin = useMutation({
    mutationFn: () => {
      if (!/^\d{4,8}$/.test(newPin)) throw new Error("PIN 4-8 haneli sayı olmalı");
      if (newPin !== confirmPin) throw new Error("PIN doğrulama eşleşmiyor");
      const payload = { new_pin: newPin };
      if (hasPin && currentPin) payload.current_pin = currentPin;
      return api.idleLockMeSet(payload);
    },
    onSuccess: () => {
      toast.success(hasPin ? "PIN güncellendi" : "PIN oluşturuldu — kilit ekranı bundan sonra PIN soracak");
      setNewPin(""); setConfirmPin(""); setCurrentPin("");
      qc.invalidateQueries({ queryKey: ["idle-lock-me"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message || "PIN kaydedilemedi"),
  });
  const clearPin = useMutation({
    mutationFn: () => api.idleLockMeSet({ clear_pin: true, current_pin: currentPin }),
    onSuccess: () => {
      toast.success("PIN kaldırıldı — kilit ekranı lisans key soracak");
      setCurrentPin("");
      qc.invalidateQueries({ queryKey: ["idle-lock-me"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Silinemedi"),
  });

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Lock className="w-4 h-4 text-cyan-400" /> Otomatik Kilit (Kişisel) <Badge tone="info">v43.81</Badge></span>}
        subtitle={owner === "master"
          ? "Master hesabınıza özel kilit + PIN. Global ayarı override eder."
          : "Kendi kilit sürenizi ve PIN'inizi belirleyin. Kilit sayfa yenilendiğinde de kalıcı."}
      />
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-200">Aktif</div>
            <div className="text-xs text-slate-500 mt-0.5">Kişisel kilit modu</div>
          </div>
          <button
            data-testid="idle-lock-me-enable"
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? "bg-emerald-500/70" : "bg-slate-700"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
        <Row title="Kilit süresi (dakika)" hint="Hareketsizlik bu süreyi aşarsa kilitlenir" testid="row-me-minutes">
          <input type="number" min="1" max="1440" value={minutes}
            data-testid="idle-lock-me-minutes"
            onChange={(e) => setMinutes(Math.max(1, Math.min(1440, parseInt(e.target.value || "15", 10))))}
            className="w-24 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right" />
        </Row>
        <Row title="Uyarı süresi (saniye)" hint="Kilit öncesi alt banner" testid="row-me-warn">
          <input type="number" min="0" max="300" value={warnSec}
            data-testid="idle-lock-me-warn"
            onChange={(e) => setWarnSec(Math.max(0, Math.min(300, parseInt(e.target.value || "30", 10))))}
            className="w-24 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right" />
        </Row>
        <Row title="Kilit ekranı teması" hint="Karanlık / Aydınlık / Kırmızı-Alarm (yüksek dikkat)" testid="row-me-theme">
          <select value={theme}
            data-testid="idle-lock-me-theme"
            onChange={(e) => setTheme(e.target.value)}
            className="w-40 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200">
            <option value="dark">🌙 Karanlık (varsayılan)</option>
            <option value="light">☀️ Aydınlık</option>
            <option value="alarm">🚨 Kırmızı-Alarm</option>
          </select>
        </Row>
        <Row title="Zaman bazlı otomatik tema" hint="Gece 22:00-06:00 arası alarm tema devreye girer (gündüz normal tema)" testid="row-me-schedule">
          <select value={themeSchedule}
            data-testid="idle-lock-me-schedule"
            onChange={(e) => setThemeSchedule(e.target.value)}
            className="w-52 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200">
            <option value="off">Kapalı (sabit tema kullan)</option>
            <option value="night_alarm">🌙→🚨 Gece Alarm (22:00-06:00)</option>
          </select>
        </Row>

        {/* v43.84 — Kilit tema önizlemesi */}
        <IdleLockThemePreview theme={theme} minutes={minutes} hasPin={hasPin} schedule={themeSchedule} />
        <button
          data-testid="idle-lock-me-save"
          onClick={() => saveSettings.mutate()}
          disabled={saveSettings.isPending}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          <Save className="w-4 h-4" /> Kişisel Ayarları Kaydet
        </button>

        <div className="border-t border-slate-800 pt-4">
          <div className="text-sm text-slate-200 mb-1 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> PIN Kodu
            {hasPin ? <Badge tone="success">Aktif</Badge> : <Badge tone="warning">Atanmamış</Badge>}
          </div>
          <div className="text-xs text-slate-500 mb-3">
            {hasPin
              ? "Kilit ekranında lisans yerine PIN girin. Değiştirmek için mevcut PIN'i de girin."
              : "PIN atarsanız kilit ekranı 4-8 haneli PIN sorar. Aksi halde lisans key sorar."}
          </div>
          {hasPin && (
            <div className="mb-3">
              <label className="text-[11px] uppercase tracking-widest text-slate-500">Mevcut PIN</label>
              <input type="password" inputMode="numeric" maxLength={8}
                data-testid="idle-lock-me-current-pin"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="••••"
                className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm mono mt-1" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500">Yeni PIN (4-8)</label>
              <input type="password" inputMode="numeric" maxLength={8}
                data-testid="idle-lock-me-new-pin"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="••••"
                className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm mono mt-1" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500">Yeni PIN (Tekrar)</label>
              <input type="password" inputMode="numeric" maxLength={8}
                data-testid="idle-lock-me-confirm-pin"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="••••"
                className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm mono mt-1" />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              data-testid="idle-lock-me-save-pin"
              onClick={() => savePin.mutate()}
              disabled={savePin.isPending || !newPin || !confirmPin}
              className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {hasPin ? "PIN Güncelle" : "PIN Oluştur"}
            </button>
            {hasPin && (
              <button
                data-testid="idle-lock-me-clear-pin"
                onClick={() => {
                  if (!currentPin) { toast.error("PIN'i kaldırmak için mevcut PIN'i girin"); return; }
                  if (!window.confirm("PIN kaldırılsın mı? Kilit ekranı bundan sonra lisans key soracak.")) return;
                  clearPin.mutate();
                }}
                className="px-3 py-2 rounded-md text-sm border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
              >
                PIN Kaldır
              </button>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-3">
            5 yanlış PIN denemesinde 5 dakika PIN doğrulama devre dışı bırakılır.
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// v43.86 — Master Protection Card (silme koruması bypass)
function MasterProtectionCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["master-protection"], queryFn: () => api.masterProtectionGet(),
                       refetchInterval: (data) => data?.bypass_active ? 5000 : false, staleTime: 4000 });
  const [minutes, setMinutes] = useState(5);
  const [reason, setReason] = useState("");
  const [c1, setC1] = useState(false);
  const [c2, setC2] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const disable = useMutation({
    mutationFn: () => api.masterProtectionDisable({ disable_minutes: minutes, confirm_1: c1, confirm_2: c2, reason }),
    onSuccess: () => { toast.success(`Koruma ${minutes} dakika devre dışı`); setModalOpen(false); setC1(false); setC2(false); setReason("");
                       qc.invalidateQueries({ queryKey: ["master-protection"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Devre dışı bırakılamadı"),
  });
  const enable = useMutation({
    mutationFn: () => api.masterProtectionEnable(),
    onSuccess: () => { toast.success("Koruma tekrar etkin"); qc.invalidateQueries({ queryKey: ["master-protection"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Etkinleştirilemedi"),
  });
  const active = q.data?.protection_active;
  const rem = q.data?.bypass_remaining_seconds || 0;
  return (
    <>
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Master Silme Koruması <Badge tone={active ? "success" : "danger"}>{active ? "AKTIF" : "BYPASS"}</Badge></span>}
        subtitle="Master lisansın silme koruması. Devre dışı bırakırsanız 5-60 dakika süreyle master lisans silinebilir." />
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-200">Durum</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {active
                ? "Master lisans silinemez, askıya alınamaz (default: güvenli)"
                : `⚠ Bypass aktif — kalan süre: ${Math.floor(rem / 60)}dk ${rem % 60}sn`}
            </div>
            {q.data?.last_disabled_at && (
              <div className="text-[10px] text-slate-500 mt-1">
                Son devre dışı: {q.data.last_disabled_at.slice(0, 19)} · IP: {q.data.last_disabled_by_ip} · Sebep: {q.data.last_reason || "-"}
              </div>
            )}
          </div>
          {active
            ? <button data-testid="mp-disable-open" onClick={() => setModalOpen(true)}
                className="px-3 py-2 rounded-md text-sm border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20">
                Devre Dışı Bırak
              </button>
            : <button data-testid="mp-enable" onClick={() => enable.mutate()}
                className="px-3 py-2 rounded-md text-sm border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20">
                Şimdi Yeniden Etkinleştir
              </button>}
        </div>
      </CardBody>
    </Card>
    {modalOpen && (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-md bg-slate-950/85 p-6" data-testid="mp-modal">
        <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-gradient-to-br from-slate-900 to-slate-950 p-6">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
            <div className="text-slate-100 font-semibold">Silme Koruması Bypass</div>
          </div>
          <div className="text-xs text-rose-200/80 mb-4 leading-relaxed">
            ⚠ <b>Kritik güvenlik uyarısı.</b> Bu işlem master lisansın silinmesine izin verir. Master silinirse tüm heartbeat/plan matrix/tenant scope çöker. Yalnızca acil rotation için kullanın.
          </div>
          <label className="block mb-3">
            <span className="text-[11px] uppercase tracking-widest text-slate-500">Süre (dakika)</span>
            <input type="number" min={1} max={60} value={minutes} data-testid="mp-minutes"
              onChange={(e) => setMinutes(Math.max(1, Math.min(60, parseInt(e.target.value || "5"))))}
              className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm mono" />
          </label>
          <label className="block mb-3">
            <span className="text-[11px] uppercase tracking-widest text-slate-500">Sebep (min 3 karakter)</span>
            <input type="text" value={reason} data-testid="mp-reason"
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ör: annual rotation, IP göç, disaster recovery"
              className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm" />
          </label>
          <label className="flex items-start gap-2 mb-2 cursor-pointer">
            <input type="checkbox" checked={c1} data-testid="mp-confirm-1"
              onChange={(e) => setC1(e.target.checked)}
              className="mt-0.5 rounded border-slate-600 bg-slate-950" />
            <span className="text-xs text-slate-300">Bu işlemin master lisansı silinebilir hale getirdiğini anlıyorum.</span>
          </label>
          <label className="flex items-start gap-2 mb-4 cursor-pointer">
            <input type="checkbox" checked={c2} data-testid="mp-confirm-2"
              onChange={(e) => setC2(e.target.checked)}
              className="mt-0.5 rounded border-slate-600 bg-slate-950" />
            <span className="text-xs text-slate-300">Master silinirse tüm bayi heartbeat'lerinin durabileceğini ve tam sistem restart gerekebileceğini anlıyorum.</span>
          </label>
          <div className="flex gap-2">
            <button data-testid="mp-cancel" onClick={() => { setModalOpen(false); setC1(false); setC2(false); }}
              className="flex-1 px-3 py-2 rounded-md text-sm border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800">
              İptal
            </button>
            <button data-testid="mp-confirm-disable"
              disabled={!c1 || !c2 || reason.trim().length < 3 || disable.isPending}
              onClick={() => disable.mutate()}
              className="flex-1 px-3 py-2 rounded-md text-sm border border-rose-500/40 bg-rose-500 text-white font-semibold hover:bg-rose-600 disabled:opacity-40">
              {disable.isPending ? "Uygulanıyor…" : "Devre Dışı Bırak"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}


// v43.86 — Master Key Rotation Wizard
function MasterRotationCard() {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState("");
  const [newKey, setNewKey] = useState("");
  const [nextSteps, setNextSteps] = useState([]);
  const [oldKey, setOldKey] = useState(() => {
    if (typeof window !== "undefined")
      return localStorage.getItem("gws.master_license") || "";
    return "";
  });
  const gen = useMutation({
    mutationFn: () => api.masterRotateGenerate(reason),
    onSuccess: (d) => { setNewKey(d.new_candidate_key); setNextSteps(d.next_steps || []); setStep(2);
                        toast.success("Yeni master key üretildi — talimatları uygulayın"); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Üretilemedi"),
  });
  const complete = useMutation({
    mutationFn: () => api.masterRotateComplete(oldKey),
    onSuccess: () => { toast.success("Rotation tamamlandı — eski key revoke edildi"); setStep(4); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Tamamlanamadı"),
  });
  const cancel = useMutation({
    mutationFn: () => api.masterRotateCancel(),
    onSuccess: () => { toast.info("Rotation iptal edildi"); setStep(1); setNewKey(""); setNextSteps([]); },
  });

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 text-indigo-400" /> Master Key Rotation <Badge tone="warning">Adım {step}/4</Badge></span>}
        subtitle="Master lisans anahtarını güvenle döndürün. 3 adım: üret → env güncelle → tamamla." />
      <CardBody className="space-y-3">
        {step === 1 && (
          <div className="space-y-3">
            <div className="text-xs text-slate-400">
              <b>Adım 1:</b> Yeni master key adayı üretilecek. Henüz sistem değişmez — sadece candidate hazırlanır.
            </div>
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-slate-500">Rotation sebebi (min 3 karakter)</span>
              <input type="text" value={reason} data-testid="mr-reason"
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ör: annual rotation, güvenlik incident, IP göç"
                className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm" />
            </label>
            <button data-testid="mr-generate"
              disabled={reason.trim().length < 3 || gen.isPending}
              onClick={() => gen.mutate()}
              className="w-full px-3 py-2 rounded-md text-sm border border-indigo-500/40 bg-indigo-500 text-white font-semibold hover:bg-indigo-600 disabled:opacity-40">
              {gen.isPending ? "Üretiliyor…" : "Yeni Master Key Üret"}
            </button>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/40 rounded p-2">
              <b>⚠ Bu key sadece bir kez gösterilir</b> — güvenli bir yere kopyalayın!
            </div>
            <div className="p-3 bg-slate-950 border border-indigo-500/40 rounded-md">
              <div className="text-[10px] uppercase text-slate-500 mb-1">YENI MASTER KEY</div>
              <div className="mono text-emerald-300 break-all text-sm select-all" data-testid="mr-newkey">{newKey}</div>
            </div>
            <button data-testid="mr-copy"
              onClick={() => { navigator.clipboard.writeText(newKey); toast.success("Kopyalandı"); }}
              className="w-full px-3 py-1.5 rounded-md text-xs border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800">
              📋 Kopyala
            </button>
            <div className="text-xs text-slate-400 space-y-1 border-l-2 border-indigo-500/40 pl-3">
              {nextSteps.map((s, i) => (<div key={i} className="text-[11px]">{s}</div>))}
            </div>
            <div className="flex gap-2 pt-2">
              <button data-testid="mr-cancel"
                onClick={() => cancel.mutate()}
                className="flex-1 px-3 py-2 rounded-md text-sm border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800">
                İptal
              </button>
              <button data-testid="mr-go-step3"
                onClick={() => setStep(3)}
                className="flex-1 px-3 py-2 rounded-md text-sm border border-emerald-500/40 bg-emerald-500 text-white font-semibold hover:bg-emerald-600">
                Env Güncelledim
              </button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <div className="text-xs text-slate-400">
              <b>Adım 3:</b> Env güncellendi ve backend yeniden başlatıldıysa <b>Rotation'ı Tamamla</b>'ya basın. Sistem env değişkenini doğrulayıp eski key'i revoke edecek.
            </div>
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-slate-500">Eski Master Key (revoke için)</span>
              <input type="password" value={oldKey} data-testid="mr-oldkey"
                onChange={(e) => setOldKey(e.target.value)}
                placeholder="MS-..."
                className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm mono" />
            </label>
            <div className="flex gap-2">
              <button data-testid="mr-back-step2"
                onClick={() => setStep(2)}
                className="px-3 py-2 rounded-md text-sm border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800">
                ← Geri
              </button>
              <button data-testid="mr-complete"
                disabled={complete.isPending || !oldKey.startsWith("MS-")}
                onClick={() => complete.mutate()}
                className="flex-1 px-3 py-2 rounded-md text-sm border border-rose-500/40 bg-rose-500 text-white font-semibold hover:bg-rose-600 disabled:opacity-40">
                {complete.isPending ? "Doğrulanıyor…" : "Rotation'ı Tamamla"}
              </button>
            </div>
          </div>
        )}
        {step === 4 && (
          <div className="text-center py-6 space-y-2">
            <div className="text-4xl">✅</div>
            <div className="text-emerald-300 font-semibold">Rotation Tamamlandı</div>
            <div className="text-xs text-slate-400">Eski key revoke edildi, yeni key aktif. Localstorage'ınızı da yeni key ile güncellemeyi unutmayın.</div>
            <button onClick={() => { setStep(1); setReason(""); setNewKey(""); setNextSteps([]); }}
              className="mt-3 px-3 py-1.5 rounded-md text-xs border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800">
              Yeni Rotation Başlat
            </button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}


// v43.87 — Foreign IP Session Kill yönetimi
function KilledIpsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["killed-ips"], queryFn: () => api.killedIpsList(), staleTime: 15_000 });
  const toggleAuto = useMutation({
    mutationFn: (enabled) => api.killedIpsToggleAuto(enabled),
    onSuccess: (d) => { toast.success(`Auto-kill ${d.auto_kill_enabled ? "AÇIK" : "KAPALI"}`);
                       qc.invalidateQueries({ queryKey: ["killed-ips"] }); },
  });
  const unblock = useMutation({
    mutationFn: (ip) => api.killedIpsUnblock(ip),
    onSuccess: () => { toast.success("IP unblocked"); qc.invalidateQueries({ queryKey: ["killed-ips"] }); },
  });
  const items = q.data?.items || [];
  const activeCount = q.data?.total_active || 0;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-rose-400" /> Foreign IP Session Kill <Badge tone="danger">{activeCount} aktif</Badge></span>}
        subtitle="Master key farklı IP'den kullanılırsa o IP otomatik blocklistedendi. Uzak session takeover'ı önler." />
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-200">Otomatik Session-Kill</div>
            <div className="text-xs text-slate-500 mt-0.5">Farklı IP algılanınca hemen bloke et</div>
          </div>
          <button
            data-testid="ki-toggle-auto"
            onClick={() => toggleAuto.mutate(!q.data?.auto_kill_enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${q.data?.auto_kill_enabled ? "bg-emerald-500/70" : "bg-slate-700"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${q.data?.auto_kill_enabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
        {items.length > 0 ? (
          <div className="space-y-1 max-h-52 overflow-y-auto">
            {items.slice(0, 15).map((it) => (
              <div key={it.ip} data-testid={`ki-row-${it.ip}`}
                className={`flex items-center justify-between p-2 rounded border ${it.active ? "border-rose-500/30 bg-rose-500/5" : "border-slate-700 bg-slate-900/50"}`}>
                <div className="min-w-0 flex-1">
                  <div className="mono text-xs text-slate-200 truncate">{it.ip}</div>
                  <div className="text-[10px] text-slate-500 truncate">{it.killed_at?.slice(0,19)} · {it.reason}</div>
                </div>
                {it.active
                  ? <button data-testid={`ki-unblock-${it.ip}`} onClick={() => unblock.mutate(it.ip)}
                      className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 whitespace-nowrap">
                      Kaldır
                    </button>
                  : <Badge tone="success">unblocked</Badge>}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500 text-center py-4">Blocklistedeki IP yok — güvenli.</div>
        )}
      </CardBody>
    </Card>
  );
}


function Row({ title, hint, children, testid }) {
  return (
    <div data-testid={testid} className="flex items-start justify-between gap-6 py-4 border-b border-slate-800 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-200">{title}</div>
        {hint ? <div className="text-xs text-slate-500 mt-1">{hint}</div> : null}      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, testid }) {
  return (
    <button
      data-testid={testid}
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-150 border ${
        checked ? "bg-indigo-500/30 border-indigo-500/50" : "bg-slate-800 border-slate-700"
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full transition-transform duration-150 ${
          checked ? "translate-x-5 bg-indigo-300" : "translate-x-0.5 bg-slate-500"
        }`}
      />
    </button>
  );
}

function LogSourceCard() {
  const qc = useQueryClient();
  const licenseKey = typeof window !== "undefined"
    ? (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license") || "")
    : "";
  const q = useQuery({ queryKey: ["log-source"], queryFn: api.logSourceGet });
  const save = useMutation({
    mutationFn: (mode) => api.logSourceSet(mode, licenseKey),
    onSuccess: (d) => {
      toast.success(`Log kaynağı '${d.mode}' olarak kaydedildi`, {
        description: "Sunucuda 'systemctl restart mailshield-logtail' çalıştırın",
        duration: 6000,
      });
      qc.invalidateQueries({ queryKey: ["log-source"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kayıt başarısız"),
  });
  const current = q.data?.mode || "auto";
  const options = [
    { mode: "auto",        Icon: Zap,         label: "Otomatik (önerilir)",
      desc: "MailScanner varsa onu, yoksa Exim'i kullan. En esnek." },
    { mode: "exim",        Icon: Server,      label: "Sadece Exim mainlog",
      desc: "Yerel WHM sunucusu — MailScanner kurulu değilse veya bağımsız çalışmak istersen." },
    { mode: "mailscanner", Icon: ShieldCheck, label: "Sadece MailScanner",
      desc: "ConfigServer MSFE ile birebir parite. MailScanner header'ları kullanılır." },
  ];
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Server className="w-4 h-4 text-indigo-400"/> Log Kaynağı · Mail Trafik Toplama</span>}
        subtitle="GökyüzüWebSpam'in mail olaylarını hangi log/spool'dan okuyacağını seçin. MailScanner opsiyoneldir."
      />
      <CardBody className="space-y-3" data-testid="log-source-card">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {options.map(({ mode, Icon, label, desc }) => (
            <button
              key={mode}
              data-testid={`log-source-${mode}`}
              onClick={() => save.mutate(mode)}
              disabled={save.isPending}
              className={`text-left p-3 rounded-lg border transition-colors ${
                current === mode
                  ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-100"
                  : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-4 h-4 ${current === mode ? "text-indigo-300" : "text-slate-500"}`}/>
                <span className="text-sm font-semibold">{label}</span>
                {current === mode && (
                  <span className="ml-auto text-[10px] mono px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300">AKTİF</span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 leading-relaxed">{desc}</div>
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-500 bg-slate-900/60 rounded p-2 border border-slate-800">
          <b className="text-amber-300">Not:</b> Değişiklik sunucudaki Perl daemon'un yeniden başlatılmasıyla aktif olur.
          Ayar kaydedildikten sonra sunucunuzda şu komutu çalıştırın: <br/>
          <code className="mono text-emerald-300">systemctl restart mailshield-logtail</code>
        </div>
      </CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const t = useT();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const langs = useQuery({ queryKey: ["i18n-langs"], queryFn: api.i18nLanguages });
  const { lang: uiLang, setLang: setUiLang } = useI18n();
  const [state, setState] = useState(null);

  useEffect(() => { if (settings.data && !state) setState(settings.data); }, [settings.data]); // eslint-disable-line

  const save = useMutation({
    mutationFn: async (p) => {
      // 1) Legacy settings collection'a yaz (global config için)
      await api.settingsPut(p);
      // 2) Yeni per-license eşiklere de yaz — ConfigServer paritesi
      //    ingest_event bu eşikleri okur ve verdict'i yeniden hesaplar.
      //    Master session yoksa (bayi tarayıcısı) license_key'i localStorage'dan al.
      try {
        const spam = Number(p.spam_threshold_low);
        const high = Number(p.spam_threshold_high);
        if (Number.isFinite(spam) && Number.isFinite(high) && high >= spam) {
          const lk = (typeof window !== "undefined"
            ? (localStorage.getItem("gws.event_license")
               || localStorage.getItem("gws.master_license")
               || "")
            : "");
          await api.setThresholds(
            { spam_threshold: spam, high_spam_threshold: high },
            lk ? { license_key: lk } : {},
          );
        }
      } catch (_) {
        // per-license set edilemezse settings save yine başarılı sayılır
      }
      return p;
    },
    onSuccess: () => {
      toast.success(t("settings.saved"));
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["thresholds"] });
      if (state?.ui_language) setUiLang(state.ui_language);
    },
    onError: () => toast.error(t("settings.save_fail")),
  });

  if (!state) return <div className="p-6 text-slate-500">{t("common.loading")}</div>;

  const patch = (k, v) => setState((s) => ({ ...s, [k]: v }));

  return (
    <div className="p-6 grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-8 space-y-4">
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Languages className="w-4 h-4 text-indigo-400" /> {t("settings.ui_language_title")} · Interface Language</span>}
            subtitle={t("settings.ui_language_sub")}
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(langs.data || []).map((L) => (
                <button
                  key={L.code}
                  data-testid={`lang-${L.code}`}
                  onClick={() => {
                    setUiLang(L.code);
                    patch("ui_language", L.code);
                    save.mutate({ ...state, ui_language: L.code });
                  }}
                  className={`px-3 py-2 rounded-md text-sm border transition-colors ${
                    uiLang === L.code
                      ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200"
                      : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <div className="text-sm">{L.name_native}</div>
                  <div className="mono text-[10px] text-slate-500 uppercase tracking-widest">{L.code}</div>
                </button>
              ))}
            </div>
            <div className="text-[11px] text-slate-500">
              {t("settings.ui_lang_hint")}
            </div>
          </CardBody>
        </Card>

        <LogSourceCard />

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Sliders className="w-4 h-4 text-indigo-400" /> {t("settings.thresholds_title")}</span>}
            subtitle={t("settings.thresholds_sub")}
          />
          <CardBody className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300">{t("settings.threshold_low")}</span>
                <span className="mono text-amber-300">{state.spam_threshold_low.toFixed(1)}</span>
              </div>
              <input type="range" min="1" max="15" step="0.1"
                data-testid="threshold-low"
                value={state.spam_threshold_low}
                onChange={(e) => patch("spam_threshold_low", parseFloat(e.target.value))}
                className="w-full accent-amber-400" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300">{t("settings.threshold_high")}</span>
                <span className="mono text-rose-400">{state.spam_threshold_high.toFixed(1)}</span>
              </div>
              <input type="range" min="1" max="20" step="0.1"
                data-testid="threshold-high"
                value={state.spam_threshold_high}
                onChange={(e) => patch("spam_threshold_high", parseFloat(e.target.value))}
                className="w-full accent-rose-500" />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Cpu className="w-4 h-4 text-indigo-400" /> {t("settings.engines_title")}</span>}
            subtitle={t("settings.engines_sub")}
          />
          <CardBody className="space-y-1">
            <Row title={t("settings.active_engine")} hint={t("settings.active_engine_hint")}
                 testid="row-active-engine">
              <select value={state.active_engine} onChange={(e) => patch("active_engine", e.target.value)}
                data-testid="active-engine"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm">
                <option value="spamassassin">Apache SpamAssassin</option>
                <option value="rspamd">Rspamd</option>
              </select>
            </Row>
            <Row title={t("settings.bayes")} hint={t("settings.bayes_hint")}
                 testid="row-bayes">
              <Toggle checked={state.bayes_learning} onChange={(v) => patch("bayes_learning", v)} testid="toggle-bayes" />
            </Row>
            <Row title={<span className="flex items-center gap-2">{t("settings.ai_row")} <Badge tone="brand">{t("settings.new")}</Badge></span>}
                 hint={t("settings.ai_hint")}
                 testid="row-ai">
              <Toggle checked={state.ai_classification} onChange={(v) => patch("ai_classification", v)} testid="toggle-ai" />
            </Row>
            {state.ai_classification && (
              <Row title={t("settings.ai_model_row")}
                   hint={t("settings.ai_model_hint")}
                   testid="row-ai-model">
                <select
                  data-testid="ai-model"
                  value={state.ai_model}
                  onChange={(e) => patch("ai_model", e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm"
                >
                  <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
                  <option value="gpt-5.2">GPT-5.2</option>
                  <option value="gemini-3-flash">Gemini 3 Flash</option>
                </select>
              </Row>
            )}
            <Row title={t("settings.tls")} hint={t("settings.tls_hint")}
                 testid="row-tls">
              <Toggle checked={state.tls_enforce} onChange={(v) => patch("tls_enforce", v)} testid="toggle-tls" />
            </Row>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><ArrowUpRight className="w-4 h-4 text-indigo-400" /> {t("settings.outbound_title")}</span>}
            subtitle={t("settings.outbound_sub")}
          />
          <CardBody className="space-y-1">
            <Row title={t("settings.outbound_block")}
                 hint={t("settings.outbound_block_hint")}
                 testid="row-outbound-block">
              <Toggle checked={state.outbound_block_enabled} onChange={(v) => patch("outbound_block_enabled", v)}
                      testid="toggle-outbound" />
            </Row>
            <Row title={t("settings.outbound_limit")}
                 hint={t("settings.outbound_limit_hint")}
                 testid="row-outbound-limit">
              <input type="number" min="10" max="10000"
                data-testid="outbound-limit"
                value={state.outbound_limit_per_hour}
                onChange={(e) => patch("outbound_limit_per_hour", parseInt(e.target.value || "0", 10))}
                className="w-28 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right" />
            </Row>
          </CardBody>
        </Card>

        {/* Stripe API Key - master only */}
        <StripeConfigCard />

        {/* v43.72 — İdle Auto-Lock master ayarı */}
        <IdleLockConfigCard />

        {/* v43.81 — Kişisel Otomatik Kilit + PIN (per-user, tüm bayilere görünür) */}
        <IdleLockPersonalCard />

        {/* v43.77 — Slash Command Aliases */}
        <SlashAliasesConfigCard />

        {/* v43.86/87 — Master Protection + Rotation + Foreign IP Kill */}
        <MasterProtectionCard />
        <MasterRotationCard />
        <KilledIpsCard />
      </div>

      <div className="col-span-12 lg:col-span-4 space-y-4">
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-400" /> {t("settings.quarantine_title")}</span>}
          />
          <CardBody className="space-y-1">
            <Row title={t("settings.retention")}
                 hint={t("settings.retention_hint")}
                 testid="row-retention">
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="90"
                  data-testid="quarantine-days"
                  value={state.quarantine_days}
                  onChange={(e) => patch("quarantine_days", parseInt(e.target.value || "0", 10))}
                  className="w-20 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right" />
                <span className="text-xs text-slate-500">{t("settings.days")}</span>
              </div>
            </Row>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Bell className="w-4 h-4 text-indigo-400" /> {t("settings.notif_title")}</span>}
          />
          <CardBody className="space-y-1">
            <Row title={t("settings.report_freq")}
                 hint={t("settings.report_freq_hint")}
                 testid="row-report-freq">
              <select value={state.report_frequency} onChange={(e) => patch("report_frequency", e.target.value)}
                data-testid="report-frequency"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm">
                <option value="off">{t("settings.off")}</option>
                <option value="daily">{t("settings.daily")}</option>
                <option value="weekly">{t("settings.weekly")}</option>
              </select>
            </Row>
          </CardBody>
        </Card>

        <button
          data-testid="settings-save"
          onClick={() => save.mutate(state)}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
        >
          <Save className="w-4 h-4" /> {t("settings.save_btn")}
        </button>

        <Card>
          <CardBody className="text-xs text-slate-500 space-y-2">
            <div className="flex items-center gap-2 text-slate-400">
              <Lock className="w-3.5 h-3.5" /> {t("settings.lock_hint")}
            </div>
            <div className="mono text-[11px] text-slate-600">/etc/mailshield/policy.conf</div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
