/**
 * v43.70 — SMTP Ayarları (Bayı Erişimli)
 *
 * Bayı kendi panelinden mail trafiği/rapor gönderimi için SMTP credentials'ını
 * girer. Master panelde bayı → 403 (kendi sunucusuna gitsin).
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Save, TestTube2, CheckCircle2, XCircle, Eye, EyeOff, Info } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const PRESETS = {
  gmail:      { host: "smtp.gmail.com",       port: 587, use_tls: "starttls", hint: "Google Hesap → Güvenlik → Uygulama şifresi oluşturun" },
  office365:  { host: "smtp.office365.com",   port: 587, use_tls: "starttls", hint: "Outlook.com veya iş hesabınızın normal şifresi" },
  yandex:     { host: "smtp.yandex.com",      port: 465, use_tls: "ssl",       hint: "Yandex → Ayarlar → Uygulama şifreleri" },
  cpanel:     { host: "mail.SUNUCUNUZ.com",   port: 465, use_tls: "ssl",       hint: "Kendi WHM sunucunuzun mail hostname'i (cPanel → Email Accounts)" },
  sendgrid:   { host: "smtp.sendgrid.net",    port: 587, use_tls: "starttls", hint: "Username: 'apikey' · Password: SendGrid API anahtarınız" },
  mailgun:    { host: "smtp.mailgun.org",     port: 587, use_tls: "starttls", hint: "postmaster@mg.sizindomain.com · Mailgun panelinden SMTP şifresi" },
};

export default function SmtpSettings() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    enabled: false, host: "", port: 587, username: "", password: "",
    from_addr: "", use_tls: "starttls", auto_mode: true,
  });
  const [showPw, setShowPw] = useState(false);
  const [pwTouched, setPwTouched] = useState(false);
  const [testEmail, setTestEmail] = useState("");

  const q = useQuery({ queryKey: ["smtp-settings"], queryFn: api.smtpGet, staleTime: 5000 });
  useEffect(() => {
    if (q.data) setForm({
      enabled: q.data.enabled, host: q.data.host || "", port: q.data.port || 587,
      username: q.data.username || "", password: q.data.password === "********" ? "" : (q.data.password || ""),
      from_addr: q.data.from_addr || "", use_tls: q.data.use_tls || "starttls",
      auto_mode: q.data.auto_mode ?? true,
    });
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form };
      // Boş şifre → mevcut korunur (backend logic)
      if (!pwTouched) payload.password = "";
      return api.smtpPut(payload);
    },
    onSuccess: () => {
      toast.success("SMTP ayarları kaydedildi", { description: "Test göndererek doğrulayın" });
      qc.invalidateQueries({ queryKey: ["smtp-settings"] });
      setPwTouched(false);
    },
    onError: (e) => {
      const s = e?.response?.status;
      if (s === 403 && e?.response?.data?.code === "BAYI_ON_MASTER_PANEL") {
        toast.error("Bu master panel — SMTP değiştiremezsiniz", {
          description: "Kendi sunucunuzdaki bayi paneline giriş yapıp oradan değiştirin",
          duration: 10000,
        });
      } else {
        toast.error("Kaydedilemedi: " + (e?.response?.data?.detail || e.message));
      }
    },
  });

  const test = useMutation({
    mutationFn: () => api.weeklyMailTest(),
    onSuccess: (r) => toast.success(`✓ Test mail gönderildi (${r?.to || "raporlanan alıcıya"})`),
    onError: (e) => toast.error("Test başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  const applyPreset = (key) => {
    const p = PRESETS[key];
    if (!p) return;
    setForm((f) => ({ ...f, host: p.host, port: p.port, use_tls: p.use_tls }));
    toast.info(`${key.toUpperCase()} preset uygulandı`, { description: p.hint, duration: 8000 });
  };

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <Card data-testid="smtp-settings-card">
        <CardHeader
          title={<span className="flex items-center gap-2"><Mail className="w-4 h-4 text-cyan-400"/> SMTP Mail Ayarları</span>}
          subtitle="Rapor, bounce digest, uyarı mail'lerinin nereden gönderileceğini yapılandırın"
          right={form.enabled ? <Badge tone="success">Aktif</Badge> : <Badge tone="default">Pasif</Badge>}
        />
        <CardBody className="space-y-4">
          {/* Uyarı & Rehber */}
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 text-xs text-indigo-200 flex gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-indigo-400"/>
            <div>
              <b className="text-indigo-100">Bayi bilgisi:</b> Bu ayar sizin sunucunuzda çalışan panelin
              mail gönderimini yapılandırır. Master panelde (panel.gokyuzuhosting.com) bu ayarı
              değiştiremezsiniz — yalnızca kendi WHM sunucunuzdaki panelden değiştirin.
              <div className="mt-1 text-indigo-300">
                Test etmek için önce Kaydet, sonra "Test Gönder" butonuna basın.
              </div>
            </div>
          </div>

          {/* Presets */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Hızlı Ayar</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(PRESETS).map((k) => (
                <button key={k} onClick={() => applyPreset(k)}
                        data-testid={`smtp-preset-${k}`}
                        className="text-xs px-2.5 py-1 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-slate-100 mono">
                  {k}
                </button>
              ))}
            </div>
          </div>

          {/* Enable toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.enabled}
                   onChange={(e) => setForm({...form, enabled: e.target.checked})}
                   data-testid="smtp-enabled"
                   className="w-4 h-4 accent-indigo-500"/>
            <span className="text-sm text-slate-200 font-semibold">SMTP mail göndermeyi aktif et</span>
            <span className="text-[11px] text-slate-500">(kapalıyken raporlar sadece panelde görünür)</span>
          </label>

          {/* Form */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="SMTP Host">
              <input value={form.host} onChange={(e) => setForm({...form, host: e.target.value})}
                     data-testid="smtp-host" placeholder="smtp.gmail.com veya mail.sunucunuz.com"
                     className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono"/>
            </Field>
            <Field label="Port">
              <input type="number" value={form.port}
                     onChange={(e) => setForm({...form, port: Number(e.target.value) || 587})}
                     data-testid="smtp-port"
                     className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono"/>
            </Field>
            <Field label="Kullanıcı Adı">
              <input value={form.username} onChange={(e) => setForm({...form, username: e.target.value})}
                     data-testid="smtp-user" placeholder="hesap@sunucunuz.com"
                     className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono"/>
            </Field>
            <Field label="Şifre / Uygulama Şifresi">
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={form.password}
                       onChange={(e) => { setForm({...form, password: e.target.value}); setPwTouched(true); }}
                       data-testid="smtp-password"
                       placeholder={q.data?.password === "********" ? "•••••••• (kayıtlı)" : "SMTP şifresi"}
                       className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 pr-9 text-sm mono"/>
                <button onClick={() => setShowPw(!showPw)} type="button"
                        data-testid="smtp-pw-toggle"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200">
                  {showPw ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                </button>
              </div>
            </Field>
            <Field label='"From" Adresi'>
              <input value={form.from_addr} onChange={(e) => setForm({...form, from_addr: e.target.value})}
                     data-testid="smtp-from" placeholder="reports@sizinsirketiniz.com"
                     className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono"/>
            </Field>
            <Field label="Şifreleme">
              <select value={form.use_tls} onChange={(e) => setForm({...form, use_tls: e.target.value})}
                      data-testid="smtp-tls"
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm">
                <option value="starttls">STARTTLS (587 · önerilen)</option>
                <option value="ssl">SSL/TLS (465)</option>
                <option value="none">Şifresiz (25 · önerilmez)</option>
              </select>
            </Field>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
            <button onClick={() => save.mutate()} disabled={save.isPending}
                    data-testid="smtp-save"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-semibold disabled:opacity-50">
              <Save className="w-4 h-4"/> {save.isPending ? "Kaydediliyor…" : "Kaydet"}
            </button>
            <button onClick={() => test.mutate()} disabled={!form.enabled || test.isPending}
                    data-testid="smtp-test"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm hover:bg-emerald-500/20 disabled:opacity-50">
              <TestTube2 className="w-4 h-4"/> {test.isPending ? "Test gönderiliyor…" : "Test Gönder"}
            </button>
            <div className="ml-auto text-[11px] text-slate-500">
              Ayarlar sunucunuzun <span className="mono">db.settings</span> koleksiyonunda saklanır
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Hızlı rehber */}
      <Card>
        <CardHeader title={<span className="text-sm">📚 Hızlı Rehber</span>} subtitle="En sık kullanılan sağlayıcılar"/>
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(PRESETS).map(([k, v]) => (
              <div key={k} className="p-2.5 rounded-lg border border-slate-800 bg-slate-950/50">
                <div className="font-semibold text-slate-200 mono text-sm mb-1 uppercase">{k}</div>
                <div className="text-[11px] text-slate-500">{v.host}:{v.port} · {v.use_tls}</div>
                <div className="text-[11px] text-indigo-300 mt-1">{v.hint}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
