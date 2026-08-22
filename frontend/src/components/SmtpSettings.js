import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { Server, Save, Send, Mail, Lock, KeyRound, CheckCircle2, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

/**
 * SMTP relay settings + Real "Test Mail" delivery.
 * Uses configured SMTP host, or falls back to local /usr/sbin/sendmail (Exim on WHM).
 */
const PRESETS = {
  custom:  { label: "Özel SMTP",       host: "",                port: 587, use_tls: "starttls" },
  gmail:   { label: "Gmail",            host: "smtp.gmail.com",  port: 587, use_tls: "starttls" },
  yandex:  { label: "Yandex",           host: "smtp.yandex.com", port: 465, use_tls: "ssl" },
  yandex2: { label: "Yandex (starttls)",host: "smtp.yandex.com", port: 587, use_tls: "starttls" },
  ms365:   { label: "Microsoft 365",    host: "smtp.office365.com", port: 587, use_tls: "starttls" },
  outlook: { label: "Outlook.com",      host: "smtp-mail.outlook.com", port: 587, use_tls: "starttls" },
  sendgrid:{ label: "SendGrid",         host: "smtp.sendgrid.net", port: 587, use_tls: "starttls" },
  resend:  { label: "Resend",           host: "smtp.resend.com", port: 587, use_tls: "starttls" },
  ses:     { label: "Amazon SES (EU)",  host: "email-smtp.eu-west-1.amazonaws.com", port: 587, use_tls: "starttls" },
  local:   { label: "Local Exim (WHM)", host: "127.0.0.1",       port: 25,  use_tls: "none" },
};

export default function SmtpSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["smtp"], queryFn: api.smtpGet, retry: false });
  const [form, setForm] = useState(null);
  const [testTo, setTestTo] = useState(() => localStorage.getItem("gws.mail_test_to") || "");
  const [showPw, setShowPw] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (q.data && !form) setForm(q.data);
  }, [q.data]); // eslint-disable-line

  const save = useMutation({
    mutationFn: (p) => api.smtpPut(p),
    onSuccess: () => { toast.success("SMTP ayarları kaydedildi");
      qc.invalidateQueries({ queryKey: ["smtp"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kayıt hatası"),
  });

  const test = useMutation({
    mutationFn: (payload) => api.mailTest(payload),
    onSuccess: (data) => toast.success(`✓ Gönderildi → ${data.to} (${data.via})`, { duration: 6000 }),
    onError: (e) => toast.error(e?.response?.data?.detail || "Gönderilemedi"),
  });

  if (!form) return (
    <Card><CardBody className="text-slate-500 py-6 text-center text-sm">SMTP ayarları yükleniyor…</CardBody></Card>
  );

  const patch = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const applyPreset = (p) => {
    const preset = PRESETS[p];
    if (!preset) return;
    setForm((s) => ({ ...s, host: preset.host, port: preset.port, use_tls: preset.use_tls }));
    toast.info(`${preset.label} ayarları önizleme yüklendi — kullanıcı adı ve parola girin`);
  };

  const detectedPreset = (() => {
    const match = Object.entries(PRESETS).find(([k, p]) =>
      p.host && form.host && p.host.toLowerCase() === form.host.toLowerCase() &&
      Number(p.port) === Number(form.port));
    return match ? match[1].label : null;
  })();

  const handleTest = () => {
    if (!testTo || !/\S+@\S+\.\S+/.test(testTo)) {
      return toast.error("Geçerli bir e-posta adresi girin");
    }
    localStorage.setItem("gws.mail_test_to", testTo);
    test.mutate({ to: testTo });
  };

  return (
    <Card data-testid="smtp-card">
      <CardHeader
        title={
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-2 text-left hover:text-slate-100 transition"
            data-testid="smtp-card-toggle"
          >
            {expanded ? <ChevronDown className="w-4 h-4 text-indigo-400" /> : <ChevronRight className="w-4 h-4 text-indigo-400" />}
            <Server className="w-4 h-4 text-indigo-400" />
            <span>SMTP Relay & Test Mail</span>
            {form.enabled && form.host ? (
              <Badge tone="success"><CheckCircle2 className="w-3 h-3 inline mr-1" /> aktif · {form.host}</Badge>
            ) : (
              <Badge tone="warning">yerel sendmail (Exim)</Badge>
            )}
          </button>
        }
        subtitle="Gerçek mail gönderimi için SMTP yapılandır — devre dışıysa yerel Exim/sendmail kullanılır"
      />
      {expanded && (
      <CardBody className="space-y-4">
        {/* v44.00.04 — Master'dan devralınmış SMTP uyarısı */}
        {form.inherited_from_master && (
          <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 flex items-start gap-2.5" data-testid="smtp-inherited-banner">
            <div className="w-5 h-5 rounded-full bg-amber-500/30 border border-amber-500/50 flex items-center justify-center shrink-0 mt-0.5">
              <Mail className="w-3 h-3 text-amber-300" />
            </div>
            <div className="text-xs text-amber-100 leading-relaxed">
              <b>Master'ın SMTP ayarları görüntüleniyor.</b> Aşağıdaki alanları düzenleyip <b>Kaydet</b>'e basarak
              kendi bayı SMTP relay'inizi tanımlayabilirsiniz. Kaydettiğinizde bu bayı sunucusu ARTIK master'a
              bağımlı olmaz — kendi relay'inizden mail gönderir.
            </div>
          </div>
        )}
        {/* AUTO MODE — WHM/cPanel sendmail */}
        <div className={`p-3 rounded-lg border ${
          form.auto_mode !== false ? "border-emerald-500/40 bg-emerald-500/10" : "border-slate-800 bg-slate-900/40"
        }`}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.auto_mode !== false}
              onChange={(e) => setForm((s) => ({ ...s, auto_mode: e.target.checked }))}
              data-testid="smtp-auto-mode"
              className="mt-1 w-4 h-4 accent-emerald-500"
            />
            <div>
              <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                🎯 Otomatik Mod (WHM/cPanel sendmail)
                {form.auto_mode !== false && <Badge tone="success">aktif</Badge>}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Bu mod açıkken hiçbir SMTP ayarı yapmanıza gerek yok. E-postalar sunucudaki <span className="mono text-emerald-300">/usr/sbin/sendmail</span> ile
                gönderilir. FROM adresi otomatik olarak lisans domain'inden çözülür (örn: <span className="mono">noreply@gokyuzuhosting.com</span>).
                Bayilere gönderilen mailler onların kendi domain'lerinden çıkar.
              </div>
              <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-3 flex-wrap">
                <span>✓ Ayar gerekmez</span>
                <span>✓ Lisansa göre FROM otomatik</span>
                <span>✓ WHM Exim ile uyumlu</span>
              </div>
              <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
                <b>⚠️ Preview / Test Ortamı Kısıtlaması:</b> Şu an bulunduğumuz Emergent preview sunucusu <b>sadece local mail</b> gönderebilir
                (dış domain'lere Exim relay yok). Bu yüzden <span className="mono">info@gokyuzuweb.com</span> gibi adreslere test maili
                gitmiyor. <b>Kendi WHM sunucunuza kurduğunuzda</b> Otomatik Mod tam çalışacaktır.
                <br/>Şu an test için: aşağıya <b>Gmail SMTP</b> veya <b>Sendgrid/Resend</b> bilgilerini girip Otomatik Modu kapatın.
              </div>
            </div>
          </label>
        </div>

        {/* Test mail (always visible) */}
        <div className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Mail className="w-4 h-4 text-emerald-400" />
            <span className="text-sm text-slate-200 font-medium">Test Mail Gönder</span>
            <span className="text-[10px] text-slate-500 ml-auto">
              Kanal: {form.enabled && form.host ? `SMTP (${form.host})` : "yerel sendmail"}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="siz@ornek.com"
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100 mono focus:outline-none focus:border-emerald-500/60"
              data-testid="smtp-test-to"
            />
            <button
              onClick={handleTest}
              disabled={test.isPending || !testTo}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50 text-sm font-medium"
              data-testid="smtp-test-send"
            >
              <Send className="w-4 h-4" />
              {test.isPending ? "Gönderiliyor..." : "Gönder"}
            </button>
          </div>
          <div className="text-[10px] text-slate-500 mt-1.5">
            {form.enabled && form.host
              ? "SMTP relay üzerinden gerçek mail iletir — dış dünyaya çıkar"
              : "Preview ortamında yerel Exim dış domainlere göndermez. WHM sunucunuzda gerçek gider — ya da yukarıda SMTP açıp harici relay kullanın"}
          </div>
        </div>

        {/* SMTP config */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <div>
            <div className="text-sm text-slate-200">Harici SMTP kullan</div>
            <div className="text-xs text-slate-500">
              {form.enabled ? "SMTP relay etkin" : "Kapalı — yerel sendmail çalışır"}
            </div>
          </div>
          <button
            onClick={() => patch("enabled", !form.enabled)}
            className={`relative w-11 h-6 rounded-full transition ${form.enabled ? "bg-emerald-500" : "bg-slate-700"}`}
            data-testid="smtp-enabled-toggle"
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${form.enabled ? "translate-x-5" : ""}`} />
          </button>
        </div>

        {/* Preset */}
        <div>
          <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Hazır Sağlayıcı</label>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(PRESETS).map(([k, p]) => (
              <button
                key={k}
                onClick={() => applyPreset(k)}
                className={`text-xs px-2.5 py-1 rounded border transition ${
                  detectedPreset === p.label
                    ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200"
                    : "border-slate-700 bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:border-slate-500"
                }`}
                data-testid={`smtp-preset-${k}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-3">
          <Field label="SMTP Host" className="col-span-12 md:col-span-6">
            <input
              value={form.host}
              onChange={(e) => patch("host", e.target.value)}
              placeholder="smtp.ornek.com"
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100 mono"
              data-testid="smtp-host"
            />
          </Field>
          <Field label="Port" className="col-span-6 md:col-span-2">
            <input
              type="number"
              value={form.port}
              onChange={(e) => patch("port", parseInt(e.target.value) || 587)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono text-right text-slate-100"
              data-testid="smtp-port"
            />
          </Field>
          <Field label="Şifreleme" className="col-span-6 md:col-span-4">
            <select
              value={form.use_tls}
              onChange={(e) => patch("use_tls", e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-2 text-sm text-slate-100"
              data-testid="smtp-tls"
            >
              <option value="starttls">STARTTLS (587)</option>
              <option value="ssl">SSL/TLS (465)</option>
              <option value="none">Şifreleme yok (25)</option>
            </select>
          </Field>

          <Field label="Kullanıcı Adı" className="col-span-12 md:col-span-6">
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={form.username}
                onChange={(e) => patch("username", e.target.value)}
                placeholder="siz@ornek.com veya apikey"
                className="w-full bg-slate-950 border border-slate-800 rounded pl-9 pr-3 py-2 text-sm text-slate-100 mono"
                data-testid="smtp-user"
              />
            </div>
          </Field>
          <Field label="Parola / API Key" className="col-span-12 md:col-span-6">
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type={showPw ? "text" : "password"}
                value={form.password}
                onChange={(e) => patch("password", e.target.value)}
                placeholder={form.password === "********" ? "(saklı — değiştirmek için yeni parola girin)" : "••••••••"}
                className="w-full bg-slate-950 border border-slate-800 rounded pl-9 pr-16 py-2 text-sm text-slate-100 mono"
                data-testid="smtp-pw"
              />
              <button
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-slate-200 px-2 py-1 rounded bg-slate-800"
                type="button"
              >
                {showPw ? "gizle" : "göster"}
              </button>
            </div>
          </Field>

          <Field label="Gönderen (From)" className="col-span-12">
            <input
              value={form.from_addr}
              onChange={(e) => patch("from_addr", e.target.value)}
              placeholder="noreply@sizindomaininiz.com"
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100 mono"
              data-testid="smtp-from"
            />
            <div className="text-[10px] text-slate-500 mt-1">
              Domain doğrulaması yapılmış bir adres kullanın — aksi hâlde mail SPAM klasörüne düşer
            </div>
          </Field>
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
          <button
            onClick={() => save.mutate(form)}
            disabled={save.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-50 text-sm font-medium"
            data-testid="smtp-save"
          >
            <Save className="w-4 h-4" /> {save.isPending ? "Kaydediliyor…" : "SMTP Ayarlarını Kaydet"}
          </button>
          <span className="text-[10px] text-slate-500 ml-auto">
            Parola sadece "değiştirmek" isterseniz yeniden girin — boş bırakırsanız mevcut korunur
          </span>
        </div>
      </CardBody>
      )}
    </Card>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <div className={className}>
      <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">{label}</label>
      {children}
    </div>
  );
}
