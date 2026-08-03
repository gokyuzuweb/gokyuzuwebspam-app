import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Server, Save, Copy, CheckCircle, AlertCircle, Terminal, Loader2, Globe, Network, Mail,
  Activity, RefreshCw, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

/**
 * /panel/my-server — Bayi kendi WHM sunucu bilgilerini kaydeder ve master'a
 * bağlanmak için gerekli install/logtail komutlarını görür.
 *
 * Master aynı sayfayı açtığında bilgilendirme mesajı görür (kendi WHM'inde install
 * gerektiği için master bu sayfayı normalde kullanmaz).
 */
export default function BayiServer() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    hostname: "",
    primary_ip: "",
    ns_records: "",   // virgülle ayrılmış
    mail_domains: "", // virgülle ayrılmış
    contact_email: "",
    server_notes: "",
  });

  const q = useQuery({
    queryKey: ["bayi-my-server"],
    queryFn: api.bayiMyServer,
    refetchInterval: 10000,  // Widget canlı: 10sn'de bir yenile
    retry: false,
  });

  useEffect(() => {
    const s = q.data?.server;
    if (s) {
      setForm({
        hostname: s.hostname || "",
        primary_ip: s.primary_ip || "",
        ns_records: (s.ns_records || []).join(", "),
        mail_domains: (s.mail_domains || []).join(", "),
        contact_email: s.contact_email || "",
        server_notes: s.server_notes || "",
      });
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => api.bayiRegisterServer({
      hostname: form.hostname.trim(),
      primary_ip: form.primary_ip.trim(),
      ns_records: form.ns_records.split(",").map((s) => s.trim()).filter(Boolean),
      mail_domains: form.mail_domains.split(",").map((s) => s.trim()).filter(Boolean),
      contact_email: form.contact_email.trim(),
      server_notes: form.server_notes.trim(),
    }),
    onSuccess: () => {
      toast.success("Sunucu bilgileri kaydedildi", { description: "Master paneli bu bilgileri görebilir" });
      qc.invalidateQueries({ queryKey: ["bayi-my-server"] });
    },
    onError: (e) => toast.error("Kayıt başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  const install = q.data?.install;
  const s = q.data?.server;

  const copyCmd = (txt) => {
    navigator.clipboard?.writeText(txt);
    toast.success("Panoya kopyalandı");
  };

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
          <Server className="w-5 h-5 text-emerald-400" />
          Sunucumu Tanıt & Bağla
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Kendi WHM/cPanel sunucunuzun bilgilerini girin, ardından tek satırlık install komutu ile
          mail trafiğinizi master paneline aktarmaya başlayın.
        </p>
      </div>

      {/* Canlı Trafik Doğrulama Widget */}
      <VerificationWidget verification={q.data?.verification} refreshing={q.isFetching} onRefresh={() => q.refetch()} />

      {/* 1. Sunucu Bilgileri */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Globe className="w-4 h-4 text-indigo-400"/> 1. Sunucu Bilgileri</span>}
          subtitle="Hostname, IP ve NS bilgilerinizi girin — master doğrulama için kullanacak"
        />
        <CardBody className="grid grid-cols-12 gap-3">
          <Field label="Hostname *" testid="bs-hostname" hint="cpanel.bayi.com veya panel.sirket.com"
                 value={form.hostname} onChange={(v) => setForm({ ...form, hostname: v })} />
          <Field label="Birincil IP *" testid="bs-primary-ip" hint="Örn: 185.9.150.10"
                 value={form.primary_ip} onChange={(v) => setForm({ ...form, primary_ip: v })} />
          <Field label="NS Kayıtları" testid="bs-ns" hint="Virgülle ayır: ns1.bayi.com, ns2.bayi.com"
                 value={form.ns_records} onChange={(v) => setForm({ ...form, ns_records: v })} full />
          <Field label="Korunan Mail Domain'leri" testid="bs-mail-domains" hint="Virgülle ayır: bayi.com, hosting.com"
                 value={form.mail_domains} onChange={(v) => setForm({ ...form, mail_domains: v })} full />
          <Field label="İletişim E-postası" testid="bs-email" hint="Master sistem uyarılarını buraya iletir"
                 value={form.contact_email} onChange={(v) => setForm({ ...form, contact_email: v })} />
          <Field label="Notlar" testid="bs-notes" hint="Master için ek bilgi (opsiyonel)"
                 value={form.server_notes} onChange={(v) => setForm({ ...form, server_notes: v })} full />
          <div className="col-span-12 flex items-center justify-between pt-2 border-t border-slate-800/60">
            <div className="text-[11px] text-slate-500">
              {s?.verified ? (
                <span className="inline-flex items-center gap-1 text-emerald-300">
                  <CheckCircle className="w-3.5 h-3.5" /> Master tarafından onaylanmış
                </span>
              ) : s ? (
                <span className="inline-flex items-center gap-1 text-amber-300">
                  <AlertCircle className="w-3.5 h-3.5" /> Onay bekliyor
                </span>
              ) : "Henüz kaydedilmedi"}
            </div>
            <button
              data-testid="bs-save"
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.hostname || !form.primary_ip}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/20 border border-indigo-400/40 hover:brightness-110 disabled:opacity-50"
            >
              {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Save className="w-3.5 h-3.5"/>}
              Sunucu Bilgilerimi Kaydet
            </button>
          </div>
        </CardBody>
      </Card>

      {/* 2. Kurulum Komutları */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Terminal className="w-4 h-4 text-emerald-400"/> 2. Sunucuya Bağlan — Tek Satır Kurulum</span>}
          subtitle="Aşağıdaki komutu WHM sunucunuzda root olarak çalıştırın. mailshield-logtail.pl otomatik cron'a eklenir."
        />
        <CardBody className="space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Adım A · Kurulum</div>
            <CommandBlock
              testid="bs-install-cmd"
              cmd={install?.install_cmd || ""}
              onCopy={() => install && copyCmd(install.install_cmd)}
            />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Adım B · Log Ajanı Başlat (kalıcı daemon)</div>
            <CommandBlock
              testid="bs-logtail-cmd"
              cmd={install?.logtail_cmd || ""}
              onCopy={() => install && copyCmd(install.logtail_cmd)}
            />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Adım C · Bağlantı Testi (Opsiyonel)</div>
            <CommandBlock
              testid="bs-test-cmd"
              cmd={install?.test_ingest_cmd || ""}
              onCopy={() => install && copyCmd(install.test_ingest_cmd)}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
            <MiniInfo label="Master API URL" value={install?.master_api_url} />
            <MiniInfo label="Lisans Anahtarı" value={install?.license_key} mono />
          </div>
        </CardBody>
      </Card>

      {/* 3. Nasıl çalışır? */}
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Network className="w-4 h-4 text-sky-400"/> 3. Nasıl Çalışır?</span>} />
        <CardBody className="text-xs text-slate-300 space-y-2 leading-relaxed">
          <p><b className="text-sky-300">1)</b> <span className="mono">mailshield-logtail.pl</span> WHM sunucunuzda Exim ve MailScanner loglarını canlı okur.</p>
          <p><b className="text-sky-300">2)</b> Her mail olayını lisans anahtarınızla <span className="mono">POST /api/mail/ingest</span> endpoint'ine gönderir. Backend, olayı <b>sadece sizin lisansınız</b> altında kaydeder.</p>
          <p><b className="text-sky-300">3)</b> Panele girdiğinizde Dashboard/Canlı Trafik/Attack Map hepsi sadece <b>sizin sunucunuzun</b> verilerini gösterir. Diğer bayilerin veya master'ın verilerine erişemezsiniz (izolasyon çekirdeği <span className="mono">owner_license_key</span> alanı).</p>
          <p><b className="text-sky-300">4)</b> Master, "Bayi Görüntüle" özelliğiyle <b>sizin izninizle</b> panelinize bakabilir; ama motorları veya kurallarınızı manuel değiştirebilir.</p>
        </CardBody>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange, hint, testid, full }) {
  return (
    <div className={full ? "col-span-12" : "col-span-12 md:col-span-6"}>
      <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">{label}</label>
      <input
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono focus:border-indigo-500/60 outline-none"
      />
      {hint && <div className="text-[10px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function CommandBlock({ cmd, onCopy, testid }) {
  return (
    <div className="relative">
      <pre
        data-testid={testid}
        className="text-[11px] mono bg-slate-950 border border-slate-800 rounded-md p-3 pr-10 overflow-x-auto text-emerald-300 whitespace-pre-wrap break-all leading-relaxed"
      >
        {cmd || "…"}
      </pre>
      <button
        onClick={onCopy}
        className="absolute top-2 right-2 p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
        title="Kopyala"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function MiniInfo({ label, value, mono }) {
  return (
    <div className="p-2.5 rounded-md border border-slate-800 bg-slate-900/40">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`text-xs text-slate-200 mt-0.5 truncate ${mono ? "mono" : ""}`}>{value || "—"}</div>
    </div>
  );
}

function VerificationWidget({ verification: v, refreshing, onRefresh }) {
  if (!v) return null;
  const tone =
    v.status === "live" ? {
      bg: "border-emerald-500/40 bg-emerald-500/5",
      accent: "text-emerald-300",
      dot: "bg-emerald-400 animate-pulse",
      label: "CANLI",
    } : v.status === "stale" ? {
      bg: "border-amber-500/40 bg-amber-500/5",
      accent: "text-amber-300",
      dot: "bg-amber-400",
      label: "DURAKLADI",
    } : {
      bg: "border-slate-700 bg-slate-900/40",
      accent: "text-slate-400",
      dot: "bg-slate-600",
      label: "BEKLİYOR",
    };
  const fmtRel = (iso) => {
    if (!iso) return "—";
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "az önce";
    if (min < 60) return `${min}dk önce`;
    if (min < 1440) return `${Math.floor(min / 60)}sa önce`;
    return `${Math.floor(min / 1440)}g önce`;
  };
  return (
    <div data-testid="bs-verification" className={`rounded-lg border ${tone.bg} p-4`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Activity className={`w-5 h-5 ${tone.accent}`} />
            <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${tone.dot}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <b className={`text-sm ${tone.accent}`}>{tone.label}</b>
              <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                Canlı Trafik Doğrulama
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{v.hint}</p>
          </div>
        </div>
        <button
          data-testid="bs-verify-refresh"
          onClick={onRefresh}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
          title="Yenile"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <VerifStat label="Son 24 Saat" value={v.ingested_24h?.toLocaleString("tr-TR") || 0} unit="mail" icon={Mail} />
        <VerifStat label="Son 1 Saat" value={v.ingested_1h?.toLocaleString("tr-TR") || 0} unit="mail" icon={Activity} />
        <VerifStat label="Son Etkinlik" value={fmtRel(v.last_seen_at)} unit="" icon={Clock} />
      </div>
    </div>
  );
}

function VerifStat({ label, value, unit, icon: Icon }) {
  return (
    <div className="p-3 rounded-md border border-slate-800 bg-slate-950/40">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-lg font-semibold text-slate-100 tabular-nums">{value}</span>
        {unit && <span className="text-[11px] text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}
