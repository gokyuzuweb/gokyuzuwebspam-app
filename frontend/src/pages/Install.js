import { useState } from "react";
import { Copy, Check, PackageOpen, Server, ShieldCheck, Terminal, Wrench, GitBranch, Download } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";

function CodeBlock({ code, testid }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Panoya kopyalandı");
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error("Kopyalanamadı"); }
  };
  return (
    <div data-testid={testid} className="relative group">
      <pre className="mono text-[12px] bg-slate-950 border border-slate-800 rounded-md p-4 text-slate-300 overflow-x-auto">
        <code>{code}</code>
      </pre>
      <button onClick={copy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1">
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        {copied ? "kopyalandı" : "kopyala"}
      </button>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 mono w-8 h-8 rounded-full border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 flex items-center justify-center text-sm">
        {n}
      </div>
      <div className="flex-1 space-y-3 pb-6 border-b border-slate-800/60">
        <h3 className="text-slate-100 font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export default function Install() {
  return (
    <div className="p-6 grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-8 space-y-4">
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><PackageOpen className="w-4 h-4 text-indigo-400" /> GökyüzüWebSpam — WHM Plugin Kurulumu</span>}
            subtitle="cPanel/WHM 136.0.32 için AppConfig üzerinden entegrasyon"
            right={<Badge tone="brand">Perl · PHP · MongoDB</Badge>}
          />
          <CardBody className="space-y-2 text-sm text-slate-300">
            <p>
              Bu panelin kaynak kodu, aşağıdaki adımlarla WHM sunucunuza kurulur. Kurulum betiği; AppConfig kaydını, milter servisini,
              SpamAssassin/ClamAV/DCC/Razor entegrasyonlarını ve cPanel kullanıcıları için MailControl arayüzünü otomatik yapılandırır.
            </p>
            <p className="text-xs text-slate-500 mono">Paket dizini: /app/whm-plugin</p>
            <div className="pt-2 flex flex-wrap gap-2">
              <a
                data-testid="download-html-guide"
                href="/kurulum-kilavuzu.html"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 text-sm"
              >
                <Download className="w-3.5 h-3.5" /> Detaylı HTML Kılavuzu (yazdırılabilir)
              </a>
              <a
                data-testid="download-md-guide"
                href="/kurulum-kilavuzu.html"
                download="GökyüzüWebSpam-Kurulum-Kilavuzu.html"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm"
              >
                <Download className="w-3.5 h-3.5" /> Kılavuzu İndir
              </a>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-6">
            <Step n={1} title="Gereksinimleri kontrol edin">
              <ul className="text-sm text-slate-400 space-y-1 list-disc pl-5">
                <li>cPanel/WHM 110+ (test edildi: <span className="mono text-slate-300">136.0.32</span>)</li>
                <li>Root SSH erişimi</li>
                <li>Exim + Apache SpamAssassin (WHM &gt; Service Manager)</li>
                <li>ClamAV, DCC, Vipul's Razor (opsiyonel; GökyüzüWebSpam aracısı devreye alır)</li>
                <li>MongoDB 5+ (paket ile birlikte otomatik kurulur)</li>
              </ul>
            </Step>

            <Step n={2} title="Paketi sunucuya aktarın">
              <CodeBlock
                testid="install-scp"
                code={`# Yerel geliştirme makinenizden:
scp -r /app/whm-plugin root@sunucunuz.com:/root/

# ya da git ile:
ssh root@sunucunuz.com
git clone https://ornek.git/gokyuzuwebspam.git /root/whm-plugin`}
              />
            </Step>

            <Step n={3} title="Kurulum betiğini çalıştırın">
              <CodeBlock
                testid="install-run"
                code={`cd /root/whm-plugin
chmod +x install.sh
./install.sh --domain=mailshield.sunucunuz.com`}
              />
              <p className="text-xs text-slate-500">
                Betik; <span className="mono">/usr/local/cpanel/whostmgr/docroot/cgi/mailshield</span> altına CGI kabuğunu,
                <span className="mono"> /var/cpanel/apps/mailshield.conf</span> AppConfig dosyasını ve
                <span className="mono"> /etc/mailshield/</span> dizinine yapılandırmaları yazar.
              </p>
            </Step>

            <Step n={4} title="AppConfig'i WHM'ye tanıtın">
              <CodeBlock
                testid="install-appconfig"
                code={`/usr/local/cpanel/bin/register_appconfig /var/cpanel/apps/mailshield.conf
/scripts/restartsrv_cpsrvd`}
              />
              <p className="text-xs text-slate-500">
                Kayıt tamamlandığında WHM &gt; Plugins altında <span className="text-indigo-300">GökyüzüWebSpam</span> menüsü görünür.
              </p>
            </Step>

            <Step n={5} title="Milter'ı Exim'e bağlayın">
              <p className="text-sm text-slate-400">
                WHM &gt; Exim Configuration Manager &gt; Advanced Editor'ü açın. <span className="mono">exim.conf.localopts</span>'a şu satırı ekleyin:
              </p>
              <CodeBlock
                testid="install-exim"
                code={`milters=inet:127.0.0.1:33333`}
              />
              <p className="text-xs text-slate-500">
                Alternatif: <span className="mono">/scripts/buildeximconf</span> çalıştırın. GökyüzüWebSpam milter'ı 33333 portunda dinler.
              </p>
            </Step>

            <Step n={6} title="Motor entegrasyonlarını etkinleştirin">
              <CodeBlock
                testid="install-engines"
                code={`# SpamAssassin (WHM'de zaten kurulu ise atlayın)
/scripts/reinstall_sa_plugins

# ClamAV
yum -y install clamav clamav-update && freshclam

# DCC
mailshieldctl engine enable dcc

# Vipul's Razor
mailshieldctl engine enable razor

# Rspamd (opsiyonel alternatif)
mailshieldctl engine install rspamd`}
              />
            </Step>

            <Step n={7} title="Servisleri başlatın">
              <CodeBlock
                testid="install-services"
                code={`systemctl enable --now mailshield-api
systemctl enable --now mailshield-milter
systemctl enable --now mailshield-quarantine

# Durum kontrolü
mailshieldctl status`}
              />
            </Step>

            <Step n={8} title="Paneli açın">
              <p className="text-sm text-slate-400">
                Root olarak WHM'ye giriş yapın, sol menüde <span className="text-indigo-300">Plugins &gt; GökyüzüWebSpam</span>'ya
                tıklayın. cPanel kullanıcılarınız da kendi cPanel arayüzlerinde <span className="text-indigo-300">Email &gt;
                GökyüzüWebSpam MailControl</span> ikonundan kendi karantinalarını yönetebilir.
              </p>
            </Step>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Terminal className="w-4 h-4 text-indigo-400" /> Kullanışlı Komutlar</span>}
          />
          <CardBody>
            <CodeBlock
              testid="install-commands"
              code={`# Anlık durum
mailshieldctl status

# Politikayı bir dosyadan yükle
mailshieldctl policy import /root/policy.json

# Karantina temizleme (retention süresi geçenler)
mailshieldctl quarantine prune

# Bayes yeniden eğitimi
mailshieldctl bayes rebuild

# Servisleri yeniden başlat
mailshieldctl restart

# Kaldırma
./uninstall.sh`}
            />
          </CardBody>
        </Card>
      </div>

      <div className="col-span-12 lg:col-span-4 space-y-4">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Server className="w-4 h-4 text-indigo-400" /> Sistem Mimarisi</span>} />
          <CardBody className="text-xs text-slate-400 space-y-3">
            <div className="mono text-slate-300">
              Exim → milter (33333) → GökyüzüWebSpam Daemon
              <br/>&nbsp;&nbsp;├── SpamAssassin
              <br/>&nbsp;&nbsp;├── ClamAV
              <br/>&nbsp;&nbsp;├── DCC
              <br/>&nbsp;&nbsp;├── Razor
              <br/>&nbsp;&nbsp;└── AI (Emergent LLM, opsiyonel)
              <br/>GökyüzüWebSpam API (127.0.0.1:8001)
              <br/>MongoDB (yerel, quarantine + logs)
              <br/>WHM CGI ⇄ cPanel MailControl UI
            </div>
            <div className="text-slate-500">
              Yapılandırmalar <span className="mono text-slate-300">/etc/mailshield/</span> altında tutulur.
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Güvenlik Notları</span>} />
          <CardBody className="text-xs text-slate-400 space-y-2">
            <p>• API yalnızca localhost'tan dinler; WHM CGI proxy'si kimlik doğrulaması yapar.</p>
            <p>• Kullanıcı karantinaları hesap bazlı yalıtılır — <span className="mono">virtusers</span> haritası temel alınır.</p>
            <p>• TLS zorunluluğu Ayarlar sekmesinden açılabilir; dış SMTP bağlantıları <span className="mono">STARTTLS</span> gerektirir.</p>
            <p>• Root'suz erişim: <span className="mono">/etc/mailshield/reseller.conf</span> ile reseller yetkileri kısıtlanır.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-indigo-400" /> Sürüm & Uyumluluk</span>} />
          <CardBody className="text-xs text-slate-400 space-y-1">
            <div className="flex items-center justify-between"><span>GökyüzüWebSpam</span><span className="mono text-slate-200">1.0.0</span></div>
            <div className="flex items-center justify-between"><span>Hedef cPanel</span><span className="mono text-slate-200">136.0.32</span></div>
            <div className="flex items-center justify-between"><span>Min. cPanel</span><span className="mono text-slate-200">110.0</span></div>
            <div className="flex items-center justify-between"><span>Perl</span><span className="mono text-slate-200">5.32+</span></div>
            <div className="flex items-center justify-between"><span>Python</span><span className="mono text-slate-200">3.10+</span></div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
