import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Server, Save, Copy, CheckCircle, AlertCircle, Terminal, Loader2, Globe, Network, Mail,
  Activity, RefreshCw, Clock, ShieldCheck, KeyRound, Zap, HelpCircle, ChevronRight, Send,
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

  const testPing = useMutation({
    mutationFn: () => api.bayiTestPing(),
    onSuccess: () => {
      toast.success("🚀 Test ping gönderildi", {
        description: "Widget 10 saniye içinde 'CANLI' duruma geçmeli",
      });
      // Widget'ı hemen yenile — event backend'e düştü, count artmalı
      setTimeout(() => qc.invalidateQueries({ queryKey: ["bayi-my-server"] }), 1500);
    },
    onError: (e) => toast.error("Test ping başarısız: " + (e?.response?.data?.detail || e.message)),
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
      <VerificationWidget verification={q.data?.verification} refreshing={q.isFetching} onRefresh={() => q.refetch()} onTestPing={() => testPing.mutate()} testPinging={testPing.isPending} />

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
        <CardBody className="space-y-5">
          {/* Ön Koşullar */}
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-100 space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-amber-200">
              <ShieldCheck className="w-3.5 h-3.5" /> Kuruluma başlamadan kontrol edin
            </div>
            <ul className="list-disc list-inside space-y-0.5 marker:text-amber-400/60">
              <li>Sunucunuz <b>CentOS 7/8, AlmaLinux 8/9 veya Ubuntu 20/22</b> olmalı ve <b>root</b> erişiminiz bulunmalı.</li>
              <li>WHM/cPanel + Exim (veya MailScanner) aktif olmalı — log yolları otomatik tespit edilir.</li>
              <li>Sunucu <b>internet çıkışı</b> yapabilmeli (giden 443 portu). Aşağıdaki kurulum komutundaki master adresine dış bağlantı açık olmalı.</li>
              <li>Yukarıdaki <b>1. Sunucu Bilgileri</b> kartını doldurup kaydettiğinizden emin olun — aksi halde master doğrulama başarısız olur.</li>
            </ul>
          </div>

          {/* Adım 0: SSH Bağlantısı */}
          <StepBlock
            no="0"
            title="SSH ile sunucuya bağlanın"
            icon={KeyRound}
            desc="Yerel bilgisayarınızın terminalinden (Windows'ta PuTTY veya Windows Terminal) sunucuya root olarak bağlanın."
          >
            <CommandBlock
              testid="bs-ssh-cmd"
              cmd={`ssh root@${form.primary_ip || "SUNUCU_IP"}`}
              onCopy={() => copyCmd(`ssh root@${form.primary_ip || "SUNUCU_IP"}`)}
            />
            <ul className="text-[11px] text-slate-400 mt-2 space-y-0.5 list-disc list-inside marker:text-slate-600">
              <li>Root parolanız yoksa: <span className="mono">sudo su -</span> ile root'a geçin.</li>
              <li>SSH portunuz farklıysa <span className="mono">-p 2222</span> gibi port ekleyin.</li>
              <li>Windows kullanıcıları: PuTTY veya <span className="mono">Windows PowerShell</span>'den de aynı komut çalışır.</li>
            </ul>
          </StepBlock>

          {/* Adım A: Kurulum */}
          <StepBlock
            no="A"
            title="Kurulum komutunu çalıştırın"
            icon={Terminal}
            desc="Tek satırlık komut master sunucusundan installer'ı indirir, gerekli paketleri kurar ve mailshield-logtail.pl'i /opt/gokyuzuwebspam/ altına yerleştirir. Cron ve systemd unit otomatik oluşturulur."
          >
            <CommandBlock
              testid="bs-install-cmd"
              cmd={install?.install_cmd || ""}
              onCopy={() => install && copyCmd(install.install_cmd)}
            />
            <div className="text-[11px] text-slate-400 mt-2">
              Kurulum genellikle <b>30-60 saniye</b> sürer. Başarılı olunca konsolda{" "}
              <span className="mono text-emerald-300">"✔ GökyüzüWebSpam kuruldu"</span> mesajını görürsünüz.
            </div>
          </StepBlock>

          {/* Adım B: Log Ajanı */}
          <StepBlock
            no="B"
            title="Log ajanını kalıcı olarak başlatın (opsiyonel)"
            icon={Zap}
            desc="Kurulum systemd unit'ini otomatik enable eder. Manuel başlatmak veya farklı parametrelerle çalıştırmak isterseniz:"
          >
            <CommandBlock
              testid="bs-logtail-cmd"
              cmd={install?.logtail_cmd || ""}
              onCopy={() => install && copyCmd(install.logtail_cmd)}
            />
            <ul className="text-[11px] text-slate-400 mt-2 space-y-0.5 list-disc list-inside marker:text-slate-600">
              <li>Durumu kontrol: <span className="mono text-slate-300">systemctl status gokyuzuwebspam-logtail</span></li>
              <li>Logları izle: <span className="mono text-slate-300">journalctl -u gokyuzuwebspam-logtail -f</span></li>
              <li>Yeniden başlat: <span className="mono text-slate-300">systemctl restart gokyuzuwebspam-logtail</span></li>
            </ul>
          </StepBlock>

          {/* Adım C: Bağlantı Testi */}
          <StepBlock
            no="C"
            title="Bağlantıyı test edin"
            icon={Activity}
            desc="Aşağıdaki tek satırlık curl komutu sahte bir mail olayı gönderir. Yukarıdaki widget'ta 30 saniye içinde 'Son 1 Saat' sayacı 1 artmalı."
          >
            <CommandBlock
              testid="bs-test-cmd"
              cmd={install?.test_ingest_cmd || ""}
              onCopy={() => install && copyCmd(install.test_ingest_cmd)}
            />
            <div className="text-[11px] text-slate-400 mt-2">
              Beklenen cevap: <span className="mono text-emerald-300">{`{"ok":true,"event_id":"..."}`}</span>. Panelin üstündeki doğrulama widget'ı <b>YEŞİL / CANLI</b> duruma geçer.
            </div>
          </StepBlock>

          {/* Bağlantı bilgileri — sadece kendi lisans anahtarınız gösterilir.
              Master'ın IP/host bilgileri kurulum betiğinin içinde otomatik olarak
              gömülüdür, ayrıca ekranda gösterilmesine gerek yok. */}
          <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <MiniInfo label="Lisans Anahtarınız" value={install?.license_key} mono />
            <MiniInfo label="Sunucu Bağlantısı" value={q.data?.status === "connected" ? "Bağlı ✓" : q.data?.status === "waiting" ? "Bekleniyor" : "—"} />
          </div>

          {/* Sorun giderme */}
          <details className="rounded-md border border-slate-800 bg-slate-950/40 p-3 mt-2 group">
            <summary className="flex items-center gap-1.5 cursor-pointer text-[11px] font-semibold text-slate-300 hover:text-slate-100">
              <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
              Kurulum sonrası ingest gelmiyor / widget hâlâ "BEKLİYOR" mu?
              <ChevronRight className="w-3 h-3 text-slate-500 group-open:rotate-90 transition-transform ml-auto" />
            </summary>
            <ul className="mt-2 text-[11px] text-slate-400 space-y-1.5 pl-2 border-l-2 border-slate-800">
              <li>
                <b className="text-slate-300">1) Servis çalışıyor mu?</b>{" "}
                <span className="mono text-slate-200">systemctl status gokyuzuwebspam-logtail</span> — Active: running olmalı.
              </li>
              <li>
                <b className="text-slate-300">2) Log yolu doğru mu?</b>{" "}
                <span className="mono text-slate-200">tail -f /var/log/exim_mainlog</span> ile Exim'in canlı yazdığını doğrulayın.
              </li>
              <li>
                <b className="text-slate-300">3) Firewall kapatmış mı?</b>{" "}
                Adım A'da verilen kurulum komutundaki master adresine{" "}
                <span className="mono text-slate-200">curl -I</span> yapın, 200/404 dönmeli. Timeout dönerse dış çıkış kapalıdır.
              </li>
              <li>
                <b className="text-slate-300">4) Lisans doğru mu?</b>{" "}
                Kurulum komutundaki <span className="mono text-slate-200">LICENSE_KEY=</span> değeri size verilen anahtarla aynı olmalı.
              </li>
              <li>
                <b className="text-slate-300">5) Manuel test ping:</b>{" "}
                Yukarıdaki <b>Adım C</b> komutunu tekrar çalıştırın; hata mesajını yakalarsınız.
              </li>
              <li>
                <b className="text-slate-300">6) Hâlâ çözülmedi?</b>{" "}
                <span className="mono text-slate-200">journalctl -u gokyuzuwebspam-logtail -n 100</span> çıktısını master'a iletin — 15 dk içinde dönüş yaparız.
              </li>
            </ul>
          </details>
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

function StepBlock({ no, title, icon: Icon, desc, children }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3 space-y-2">
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 w-6 h-6 rounded-md bg-gradient-to-br from-emerald-500/25 to-sky-500/20 border border-emerald-400/40 flex items-center justify-center text-[11px] font-bold text-emerald-200">
          {no}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            {Icon && <Icon className="w-3.5 h-3.5 text-emerald-400" />}
            {title}
          </div>
          {desc && <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{desc}</p>}
        </div>
      </div>
      <div className="pl-8">{children}</div>
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

function VerificationWidget({ verification: v, refreshing, onRefresh, onTestPing, testPinging }) {
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
      {/* Test Ping butonu — bayi kurulumu doğrular */}
      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] text-slate-500 leading-relaxed max-w-md">
          <b className="text-slate-300">Kurulumu tamamladıysanız</b> sağdaki butonla test event gönderin — widget 10 saniye içinde CANLI (yeşil) duruma geçmeli.
        </div>
        <button
          data-testid="bs-test-ping"
          onClick={onTestPing}
          disabled={testPinging}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-gradient-to-r from-emerald-500 to-sky-500 text-white shadow-lg shadow-emerald-500/20 border border-emerald-400/40 hover:brightness-110 disabled:opacity-60"
        >
          {testPinging ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Send className="w-3.5 h-3.5"/>}
          🚀 Test Ping Gönder
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
