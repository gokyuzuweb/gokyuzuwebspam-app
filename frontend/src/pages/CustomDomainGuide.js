import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardHeader, Badge } from "@/components/ui-primitives";
import { Globe, Copy, ExternalLink, Check, Server, Shield, ArrowRight } from "lucide-react";

const currentHost = typeof window !== "undefined" ? window.location.hostname : "panel.example.com";
const previewUrl = process.env.REACT_APP_BACKEND_URL || `https://${currentHost}`;

const NGINX_CONFIG = "# /etc/nginx/sites-available/panel.gokyuzuhosting.com\n"
  + "server {\n"
  + "    listen 80;\n"
  + "    listen [::]:80;\n"
  + "    server_name panel.example.com;\n"
  + "    # Let's Encrypt sertifikası otomatik → HTTPS'e yönlendir\n"
  + "    return 301 https://$host$request_uri;\n"
  + "}\n\n"
  + "server {\n"
  + "    listen 443 ssl http2;\n"
  + "    listen [::]:443 ssl http2;\n"
  + "    server_name panel.example.com;\n\n"
  + "    ssl_certificate     /etc/letsencrypt/live/panel.example.com/fullchain.pem;\n"
  + "    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;\n"
  + "    ssl_protocols       TLSv1.2 TLSv1.3;\n\n"
  + "    # WebSocket + uzun-poll için 24 saatlik zaman aşımı\n"
  + "    proxy_read_timeout  86400;\n"
  + "    proxy_send_timeout  86400;\n"
  + "    client_max_body_size 100m;\n\n"
  + "    # Frontend static (React build)\n"
  + "    location / {\n"
  + "        proxy_pass          __PREVIEW_URL__;\n"
  + "        proxy_http_version  1.1;\n"
  + "        proxy_set_header    Host $host;\n"
  + "        proxy_set_header    X-Real-IP $remote_addr;\n"
  + "        proxy_set_header    X-Forwarded-For $proxy_add_x_forwarded_for;\n"
  + "        proxy_set_header    X-Forwarded-Proto $scheme;\n"
  + "        proxy_set_header    X-Forwarded-Host $host;\n\n"
  + "        # WebSocket\n"
  + "        proxy_set_header    Upgrade $http_upgrade;\n"
  + "        proxy_set_header    Connection \"upgrade\";\n"
  + "    }\n"
  + "}\n";

const APACHE_CONFIG = "# /etc/httpd/conf.d/panel.example.com.conf\n"
  + "<VirtualHost *:80>\n"
  + "    ServerName panel.example.com\n"
  + "    Redirect permanent / https://panel.example.com/\n"
  + "</VirtualHost>\n\n"
  + "<VirtualHost *:443>\n"
  + "    ServerName panel.example.com\n\n"
  + "    SSLEngine on\n"
  + "    SSLCertificateFile      /etc/letsencrypt/live/panel.example.com/fullchain.pem\n"
  + "    SSLCertificateKeyFile   /etc/letsencrypt/live/panel.example.com/privkey.pem\n"
  + "    SSLProxyEngine          on\n\n"
  + "    ProxyPreserveHost       On\n"
  + "    ProxyRequests           Off\n"
  + "    RequestHeader           set X-Forwarded-Proto \"https\"\n"
  + "    RequestHeader           set X-Forwarded-Host \"%{HTTP_HOST}s\"\n\n"
  + "    # WebSocket upgrade\n"
  + "    RewriteEngine on\n"
  + "    RewriteCond %{HTTP:Upgrade} websocket [NC]\n"
  + "    RewriteCond %{HTTP:Connection} upgrade [NC]\n"
  + "    RewriteRule ^/?(.*) \"wss://__PREVIEW_HOST__/$1\" [P,L]\n\n"
  + "    # HTTP\n"
  + "    ProxyPass       /  __PREVIEW_URL__/\n"
  + "    ProxyPassReverse /  __PREVIEW_URL__/\n"
  + "</VirtualHost>\n";

function CodeBlock({ code, name }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success(`${name} kopyalandı`);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="relative group">
      <pre className="bg-slate-950 border border-slate-800 rounded p-3 text-[11px] mono text-slate-300 overflow-x-auto whitespace-pre max-h-[420px]">
        {code}
      </pre>
      <button
        onClick={doCopy}
        data-testid={`cd-copy-${name.toLowerCase().replace(/\s+/g, "-")}`}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded text-[10px] bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30 flex items-center gap-1"
      >
        {copied ? <Check className="w-3 h-3"/> : <Copy className="w-3 h-3"/>}
        {copied ? "kopyalandı" : "Kopyala"}
      </button>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300 mono text-sm font-bold">{n}</div>
      <div className="flex-1 pb-4 border-b border-slate-800 last:border-b-0">
        <div className="text-sm text-slate-100 font-semibold mb-1">{title}</div>
        <div className="text-sm text-slate-400 leading-relaxed space-y-2">{children}</div>
      </div>
    </div>
  );
}

export default function CustomDomainGuide() {
  const nginxRendered = NGINX_CONFIG.replaceAll("__PREVIEW_URL__", previewUrl);
  const apacheRendered = APACHE_CONFIG
    .replaceAll("__PREVIEW_URL__", previewUrl)
    .replaceAll("__PREVIEW_HOST__", currentHost);

  return (
    <div className="p-6 space-y-4 max-w-4xl" data-testid="custom-domain-guide">
      {/* Hero */}
      <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-slate-900/60 to-indigo-500/5 p-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
            <Globe className="w-5 h-5 text-emerald-300"/>
          </div>
          <div>
            <div className="text-slate-100 text-lg font-bold">Kendi Alan Adınıza Bağlayın</div>
            <div className="text-xs text-slate-400 mt-0.5 max-w-2xl leading-relaxed">
              Preview URL yerine kendi domain'inizi (örn. <span className="mono text-indigo-300">panel.gokyuzuhosting.com</span>) kullanmak için CNAME kaydı + reverse proxy yapılandırması. 3 adımda ~15 dakika.
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-500">
          Mevcut Preview URL: <code className="mono bg-slate-950 px-2 py-0.5 rounded text-slate-300" data-testid="cd-current-preview">{previewUrl}</code>
        </div>
      </div>

      {/* Steps */}
      <Card>
        <CardHeader title="1. Yol: DNS + Reverse Proxy (Önerilen)" subtitle="Kendi VPS/dedicated sunucunuza CNAME + Nginx/Apache kurulumu"/>
        <div className="p-5 space-y-5">
          <Step n="1" title="DNS'e A veya CNAME kaydı ekleyin">
            <p>Domain kayıt panelinizde (Cloudflare, GoDaddy, Namecheap vb.) şu kaydı oluşturun:</p>
            <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-1 mono text-xs">
              <div><span className="text-slate-500">Tür:</span> <span className="text-indigo-300">A</span> · <span className="text-slate-500">Ad:</span> <span className="text-emerald-300">panel</span> · <span className="text-slate-500">Değer:</span> <span className="text-amber-300">1.2.3.4</span> <span className="text-slate-500">(VPS IP'niz)</span></div>
              <div className="text-slate-600">— veya —</div>
              <div><span className="text-slate-500">Tür:</span> <span className="text-indigo-300">CNAME</span> · <span className="text-slate-500">Ad:</span> <span className="text-emerald-300">panel</span> · <span className="text-slate-500">Değer:</span> <span className="text-amber-300">{currentHost}</span></div>
            </div>
            <p className="text-[11px] text-slate-500">DNS propagasyonu için 5-30 dk bekleyin. <code className="mono text-indigo-300">dig panel.example.com</code> ile test edin.</p>
          </Step>

          <Step n="2" title="Let's Encrypt SSL sertifikası alın">
            <p>Sunucunuzda root olarak:</p>
            <CodeBlock name="Certbot" code={`# Ubuntu/Debian
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d panel.example.com --non-interactive --agree-tos -m ops@example.com

# CentOS/RHEL/AlmaLinux
yum install -y certbot python3-certbot-nginx
certbot --nginx -d panel.example.com`} />
            <p className="text-[11px] text-slate-500">Sertifika 90 gün geçerli — certbot otomatik yenileme cron'u kurar.</p>
          </Step>

          <Step n="3" title="Reverse proxy yapılandırması">
            <p>Nginx VEYA Apache'den birini seçin (aynı sunucuda ikisi çakışmasın):</p>
            <div className="space-y-3">
              <div>
                <div className="text-[11px] uppercase text-emerald-400 mb-1 flex items-center gap-1"><Server className="w-3 h-3"/> Nginx (önerilen)</div>
                <CodeBlock name="Nginx" code={nginxRendered}/>
                <p className="text-[11px] text-slate-500 mt-1">Aktifleştir: <code className="mono text-indigo-300">ln -s /etc/nginx/sites-available/panel.gokyuzuhosting.com /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx</code></p>
              </div>
              <div>
                <div className="text-[11px] uppercase text-amber-400 mb-1 flex items-center gap-1"><Server className="w-3 h-3"/> Apache</div>
                <CodeBlock name="Apache" code={apacheRendered}/>
                <p className="text-[11px] text-slate-500 mt-1">Aktifleştir: <code className="mono text-indigo-300">a2enmod proxy proxy_http proxy_wstunnel rewrite ssl && systemctl reload apache2</code></p>
              </div>
            </div>
          </Step>

          <Step n="4" title="Test + Master lisansı ile giriş">
            <p><code className="mono text-indigo-300">https://panel.example.com</code> adresini ziyaret edin. Bir kez master anahtarınızı girin:</p>
            <ul className="list-disc pl-5 text-[13px] space-y-0.5">
              <li>URL'ye <code className="mono text-indigo-300">?master_key=MS-...</code> ekleyin — 1x aktive olur.</li>
              <li>Veya <b>Ayarlar → Bayi/Master Anahtarı</b> menüsünden manuel girin.</li>
              <li>Master mod otomatik <code className="mono text-emerald-300">localStorage</code>'a kaydedilir, gelecek ziyaretlerde tekrar sormaz.</li>
            </ul>
          </Step>
        </div>
      </Card>

      {/* Alternative — WHM/cPanel proxy */}
      <Card>
        <CardHeader title="2. Yol: WHM/cPanel üzerinden Alt Alan" subtitle="Zaten WHM sunucunuz varsa cPanel'in kendi proxy'sini kullanın"/>
        <div className="p-5 text-sm text-slate-300 space-y-3 leading-relaxed">
          <p>WHM → <b>Apache Configuration → Include Editor → Pre VirtualHost Include</b> sekmesinde şu bloğu ekleyin:</p>
          <CodeBlock name="cPanel Pre VirtualHost" code={`<VirtualHost *:443>
    ServerName panel.gokyuzuhosting.com
    SSLEngine on
    SSLProxyEngine on
    ProxyPreserveHost On
    ProxyPass       /  ${previewUrl}/
    ProxyPassReverse /  ${previewUrl}/
    RewriteEngine on
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteRule ^/?(.*) "wss://${currentHost}/$1" [P,L]
</VirtualHost>`}/>
          <p className="text-xs text-slate-400">Save → Rebuild HTTP Configuration → Restart Apache. AutoSSL veya Let's Encrypt sertifikayı otomatik alır.</p>
        </div>
      </Card>

      {/* Troubleshoot */}
      <Card>
        <CardHeader title="Sık Görülen Sorunlar" subtitle="Custom Domain kurulumunda karşılaşabileceğiniz durumlar"/>
        <div className="p-5 text-sm text-slate-300 space-y-3">
          <TroubleRow
            q="Panel açıldı ama API çağrıları CORS hatası veriyor"
            a="Reverse proxy header'larında X-Forwarded-Host ve X-Forwarded-Proto eksik. Yukarıdaki Nginx örneği bunları set eder — kopyalayıp yapıştırın. Ayrıca `withCredentials: true` gerektirdiğimiz için domain'in tam aynı olması şart (www ve www.suz aynı domain kabul edilmez)."
          />
          <TroubleRow
            q="'Master mode' otomatik açılmıyor"
            a="Yalnızca preview domain'inde otomatik aktivasyon var. Custom domain'de bir kez URL'ye ?master_key=MS-... ekleyin — localStorage'a düşer, sonraki ziyaretlerde tekrar sormaz."
          />
          <TroubleRow
            q="WebSocket bağlantısı 'connecting…' durumunda kalıyor"
            a="Nginx örneğinde 'proxy_read_timeout 86400' ve 'Upgrade' header'ları var — bunları atlarsanız websocket 60 saniyede kapanır. Apache için proxy_wstunnel modülünü yükleyin."
          />
          <TroubleRow
            q="Let's Encrypt sertifikası alınmıyor"
            a="Port 80 açık ve DNS'de A kaydı hedefi bu sunucuya bakıyor olmalı. `certbot certonly --standalone -d panel.example.com` ile önce alıp sonra Nginx'te 'listen 443 ssl' bloğunu ekleyin."
          />
        </div>
      </Card>

      {/* Footer */}
      <div className="text-center text-[11px] text-slate-600 pt-3">
        Sorularınız için <a href="mailto:destek@gokyuzuhosting.com" className="text-indigo-400 hover:underline">destek@gokyuzuhosting.com</a> —
        yardım için bu sayfanın URL'ini paylaşın.
      </div>
    </div>
  );
}

function TroubleRow({ q, a }) {
  return (
    <div className="border-l-2 border-slate-700 pl-3">
      <div className="text-slate-200 text-sm font-medium flex items-start gap-1"><ArrowRight className="w-3.5 h-3.5 shrink-0 mt-1 text-amber-400"/> {q}</div>
      <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{a}</div>
    </div>
  );
}
