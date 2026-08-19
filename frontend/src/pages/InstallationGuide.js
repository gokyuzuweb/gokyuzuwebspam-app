/**
 * Kurulum Rehberi — 8 adım interaktif · v43.99.13
 * · Video embed (YouTube + MP4) per step — Master panelden URL'leri düzenler
 * · Multi-language PDF (TR/EN/AR)
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";
import {
  Rocket, CheckCircle2, Circle, Copy, Download, Mail, Terminal,
  Server, Globe, Users, Shield, Bell, AlertTriangle, ExternalLink,
  Clock, ChevronRight, HelpCircle, FileText, Video, Play, Settings2, Save, X,
} from "lucide-react";
import { toast } from "sonner";

// v43.99.13 — Video URL'leri DB'den çekilir. Master panelde `install-videos`
// endpoint üzerinden düzenler. Şablon: { "1": {youtube: "", mp4: ""}, ... }

const STEPS = [
  {
    id: 1, icon: Mail, title: "Satın Alma E-postanızı Kontrol Edin", duration: "2 dk", color: "rose",
    intro: "Ürünü satın aldıktan hemen sonra size 2 e-posta gelir. Kritik olan 'Lisans Bilgileri' e-postasını açın.",
    content: (
      <div className="space-y-3">
        <div className="text-[13px] text-slate-300">E-postada şu bilgiler bulunur:</div>
        <div className="bg-slate-950/60 border border-slate-800 rounded p-3 mono text-[12px] text-slate-200 space-y-0.5">
          <div><span className="text-slate-500">Lisans Anahtarınız:</span>  <span className="text-emerald-300">MS-XXXXXXXXXXXXXXXXXXXXXX</span></div>
          <div><span className="text-slate-500">Plan:</span>                 Enterprise (30 gün)</div>
          <div><span className="text-slate-500">IP Adresi:</span>            123.45.67.89</div>
          <div><span className="text-slate-500">Panel Domain:</span>         panel.firmaniz.com</div>
          <div><span className="text-slate-500">Kurulum URL:</span>          https://gokyuzuhosting.com/install.sh</div>
        </div>
        <WarnBox>Lisans anahtarınızı <b>ASLA</b> kimseyle paylaşmayın. Bu anahtar sunucunuzun kilididir.</WarnBox>
      </div>
    ),
  },
  {
    id: 2, icon: Terminal, title: "SSH ile Sunucuya Bağlanın", duration: "1 dk", color: "indigo",
    intro: "Windows'ta PowerShell veya PuTTY, Mac/Linux'ta Terminal açın. Kendi sunucu IP'nizi girin:",
    content: (
      <div className="space-y-3">
        <CodeBlock label="Terminal komutu" code="ssh root@123.45.67.89" />
        <div className="text-[13px] text-slate-300">
          İlk defa bağlanıyorsanız <span className="mono bg-slate-800 px-1.5 py-0.5 rounded">yes</span> yazın, sonra root şifresini girin.
          Girerken şifre görünmez — bu normal.
        </div>
        <OkBox>Şu satırı görmelisiniz: <span className="mono">[root@sunucu ~]#</span></OkBox>
      </div>
    ),
  },
  {
    id: 3, icon: Server, title: "Docker Kurun", duration: "3-5 dk", color: "cyan",
    intro: "Docker yoksa tek komutla kur. Zaten kuruluysa atlayın.",
    content: (
      <div className="space-y-3">
        <div className="text-[13px] text-slate-300">Kontrol edin:</div>
        <CodeBlock code="docker --version" />
        <div className="text-[13px] text-slate-400">
          Bir sürüm gelirse (örn. <span className="mono">Docker version 24.0.7</span>) → <b>Adım 4'e geçin</b>.
          <br />"command not found" derse aşağıdakini çalıştırın:
        </div>
        <CodeBlock label="Docker kurulumu (universal)" code={`curl -fsSL https://get.docker.com | bash
systemctl enable --now docker
docker ps`} />
        <OkBox>Boş bir tablo görmelisiniz — kurulum tamam.</OkBox>
      </div>
    ),
  },
  {
    id: 4, icon: Rocket, title: "GökyüzüWebSpam'i Kurun", duration: "8-12 dk", color: "emerald",
    intro: "Tek komutla tüm servisler kurulur: MongoDB + Backend + Frontend + Nginx + SSL + WHM plugin.",
    content: (
      <div className="space-y-3">
        <CodeBlock label="Kurulum başlat" code={`curl -fsSL https://gokyuzuhosting.com/install.sh -o /root/install.sh
chmod +x /root/install.sh
bash /root/install.sh`} />
        <div className="text-[13px] text-slate-300">Script size sırayla soracak:</div>
        <div className="bg-slate-950/60 border border-slate-800 rounded p-3 mono text-[12px] text-slate-200 space-y-0.5">
          <div>{">>>"} Lisans anahtarınızı girin: <span className="text-emerald-300">MS-...</span></div>
          <div>{">>>"} Panel domain'i:            <span className="text-cyan-300">panel.firmaniz.com</span></div>
          <div>{">>>"} Admin e-posta:             <span className="text-cyan-300">siz@firmaniz.com</span></div>
          <div>{">>>"} SSL sertifikası (E/H):     <span className="text-emerald-300">E</span></div>
        </div>
        <div className="text-[13px] text-slate-300">Script otomatik yapacak:</div>
        <ul className="space-y-1 text-[12px] text-slate-400">
          {[
            "MongoDB Docker container'ı",
            "Backend + Frontend build",
            "Nginx reverse proxy (port 80/443)",
            "Let's Encrypt SSL sertifikası",
            "WHM plugin dosyaları /usr/local/cpanel/whostmgr/docroot/cgi/mailshield/",
            "Exim milter entegrasyonu",
            "Otomatik güncelleme cron'u (6 saatte bir)",
          ].map((l, i) => (
            <li key={i} className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-400 shrink-0" />
              <span>{l}</span>
            </li>
          ))}
        </ul>
        <OkBox>Bittiğinde ekranda: <span className="mono text-emerald-300">🎉 Kurulum başarılı! WHM → MailShield ikonu.</span></OkBox>
      </div>
    ),
  },
  {
    id: 5, icon: Globe, title: "WHM Panel'de MailShield'a Tıklayın", duration: "1 dk", color: "sky",
    intro: "Tarayıcınızda WHM'e girin ve MailShield ikonuna tıklayın.",
    content: (
      <div className="space-y-3">
        <CodeBlock label="Tarayıcınıza yazın" code="https://123.45.67.89:2087" />
        <div className="text-[13px] text-slate-300">
          Sertifika uyarısı gelirse: <b>Gelişmiş → Yine de git</b> (WHM default self-signed).
          <br />WHM'e <b>root + şifre</b> ile giriş yapın.
        </div>
        <div className="border border-indigo-500/30 bg-indigo-500/5 rounded p-3">
          <div className="text-[11px] text-indigo-300 font-bold uppercase tracking-wider mb-1">Ne yapacaksınız</div>
          <div className="text-[13px] text-slate-200">
            Sol menüde aşağı inin → <b>Plugins</b> bölümü → <b>MailShield</b> ikonuna tıklayın.
          </div>
        </div>
        <OkBox>Panel açılır ve sağ üstte <b>MASTER · 123.45.67.89</b> rozeti gelir. Sol menüde tüm özellikler açık.</OkBox>
        <WarnBox>
          Rozet gelmezse: Lisans anahtarınız veya IP'niz eşleşmemiş. Destek'e yazın, IP'nizi Trusted IP listesine ekleriz.
        </WarnBox>
      </div>
    ),
  },
  {
    id: 6, icon: Users, title: "cPanel Hesaplarınızı Görün", duration: "3 dk", color: "amber",
    intro: "Kurulum bitince cPanel hesaplarınız otomatik listelenir. Panelinizde Kullanıcılar sayfasına gidin.",
    content: (
      <div className="space-y-3">
        <div className="text-[13px] text-slate-300">Her hesap için otomatik gelecek bilgi:</div>
        <ul className="space-y-1 text-[13px] text-slate-300">
          <li>📊 Bugünkü gönderilen/alınan mail sayısı</li>
          <li>🎯 Spam yakalama oranı</li>
          <li>📥 Karantinadaki mail sayısı</li>
          <li>🧼 IP hijyeni skoru</li>
        </ul>
        <div className="text-[13px] text-slate-400">
          Her hesap için ayrı hız limiti, whitelist, bildirim kanalı tanımlayabilirsiniz. Toplu ban/unban de destekli.
        </div>
      </div>
    ),
  },
  {
    id: 7, icon: Shield, title: "Motorları Test Edin", duration: "5 dk", color: "violet",
    intro: "Panelde Motorlar sayfasına gidin. Şu motorların yeşil olduğunu doğrulayın.",
    content: (
      <div className="space-y-3">
        <div className="border border-slate-800 rounded overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-900/60 border-b border-slate-800">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400">Motor</th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400">Amaç</th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400">Durum</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["SpamAssassin", "İçerik bazlı spam skorlaması", "🟢 Aktif"],
                ["ClamAV", "Virüs/malware taraması", "🟢 Aktif"],
                ["DCC + Razor + Pyzor", "Bulk mail parmak izi", "🟢 Aktif"],
                ["RBL/DNSBL", "IP kara listesi", "🟢 Aktif"],
                ["SPF/DKIM/DMARC", "Kimlik doğrulama", "🟢 Aktif"],
                ["LLM AI Classifier", "Yapay zeka (opsiyonel)", "🟡 Opsiyonel"],
              ].map(([n, p, s], i) => (
                <tr key={i} className="border-b border-slate-800/60">
                  <td className="px-3 py-2 mono text-slate-200 font-semibold">{n}</td>
                  <td className="px-3 py-2 text-slate-300">{p}</td>
                  <td className="px-3 py-2">{s}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border border-indigo-500/30 bg-indigo-500/5 rounded p-3">
          <div className="text-[11px] text-indigo-300 font-bold uppercase tracking-wider mb-1">Canlı Test</div>
          <div className="text-[13px] text-slate-200">
            <b>Threat Defense → Mail Simulator</b>'a gidin. Hazır phishing .eml örneğini yapıştırıp
            <b> Simüle Et</b> butonuna basın.
          </div>
        </div>
        <OkBox>Sonuç <b>QUARANTINE</b> + skor 70+ ise koruma çalışıyor demektir.</OkBox>
      </div>
    ),
  },
  {
    id: 8, icon: Bell, title: "Bildirim Kanallarını Bağlayın", duration: "5 dk", color: "orange",
    intro: "Karantinada mail biriktiğinde veya kritik incident oluştuğunda size nasıl haber verilmesini istiyorsunuz?",
    content: (
      <div className="space-y-3">
        <div className="text-[13px] text-slate-300">
          <b>Sistem → Ayarlar → Bildirimler</b> sekmesine gidin ve aşağıdakilerden birini/birkaçını yapılandırın:
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            ["📧 E-posta", "SMTP ayarları (SendGrid/SES/Postfix)", "Ücretsiz"],
            ["💬 Slack", "Slack Incoming Webhook URL", "Ücretsiz"],
            ["🎮 Discord", "Discord Channel Webhook", "Ücretsiz"],
            ["✈ Telegram", "@BotFather + chat_id", "Ücretsiz"],
            ["🔔 Tarayıcı Push", "Panel açık kaldığında otomatik", "Ücretsiz"],
            ["📱 SMS (Twilio)", "Ücretli — API key gerekir", "Ücretli"],
          ].map(([n, h, u], i) => (
            <div key={i} className="border border-slate-800 rounded p-2.5 bg-slate-900/40">
              <div className="text-[13px] font-semibold text-slate-200">{n}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{h}</div>
              <div className={`text-[10px] mt-1 font-bold ${u === "Ücretsiz" ? "text-emerald-400" : "text-amber-400"}`}>{u}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

function CodeBlock({ code, label }) {
  const copy = () => {
    navigator.clipboard.writeText(code);
    toast.success("Kopyalandı");
  };
  return (
    <div className="rounded overflow-hidden border border-slate-800">
      {label && (
        <div className="px-3 py-1.5 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{label}</span>
          <button onClick={copy} className="text-[10px] text-indigo-300 hover:text-indigo-200 flex items-center gap-1">
            <Copy className="w-3 h-3" /> Kopyala
          </button>
        </div>
      )}
      <div className="relative group">
        <pre className="p-3 mono text-[12px] text-emerald-300 bg-slate-950/80 whitespace-pre overflow-auto">{code}</pre>
        {!label && (
          <button onClick={copy}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1.5 rounded bg-slate-800 hover:bg-slate-700 transition-opacity">
            <Copy className="w-3.5 h-3.5 text-slate-300" />
          </button>
        )}
      </div>
    </div>
  );
}

// v43.99.13 — Adım videosu: YouTube embed, MP4 veya placeholder. URL'ler prop olarak gelir.
function VideoEmbed({ stepId, videos }) {
  const v = videos?.[String(stepId)] || {};
  const hasYT = !!v.youtube;
  const hasMP4 = !!v.mp4;
  const has = hasYT || hasMP4;
  return (
    <div
      data-testid={`step-video-${stepId}`}
      className="rounded-lg border border-slate-800 bg-slate-950/60 overflow-hidden"
    >
      <div className="px-3 py-2 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 uppercase tracking-wider">
          <Video className="w-3.5 h-3.5 text-rose-400" />
          Adım {stepId} · Video Rehber (30 sn)
        </div>
        {has && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
            {hasYT ? "YouTube" : "MP4"}
          </span>
        )}
      </div>
      <div className="aspect-video bg-slate-950 flex items-center justify-center">
        {hasYT ? (
          <iframe
            src={v.youtube}
            title={`Adım ${stepId} Video Rehber`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full border-0"
          />
        ) : hasMP4 ? (
          <video
            controls preload="metadata"
            className="w-full h-full"
            src={v.mp4}
          >
            Tarayıcınız video etiketini desteklemiyor.
          </video>
        ) : (
          <div className="text-center px-4 py-8 max-w-md">
            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-slate-900 border-2 border-dashed border-slate-700 flex items-center justify-center">
              <Play className="w-6 h-6 text-slate-600" />
            </div>
            <div className="text-[13px] font-semibold text-slate-300">Video eklenecek</div>
            <div className="text-[11px] text-slate-500 mt-1">
              Bu adım için 30 saniyelik screen recording burada gösterilecek.
              <br />
              <span className="text-slate-600 italic">
                Master: sayfa başındaki <b>Video URL'lerini Yönet</b> butonu ile ekleyebilirsiniz.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WarnBox({ children }) {
  return (
    <div className="border border-amber-500/40 bg-amber-500/10 rounded p-3 flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
      <div className="text-[12px] text-amber-200 leading-relaxed">{children}</div>
    </div>
  );
}

function OkBox({ children }) {
  return (
    <div className="border border-emerald-500/40 bg-emerald-500/10 rounded p-3 flex items-start gap-2">
      <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" />
      <div className="text-[12px] text-emerald-200 leading-relaxed">{children}</div>
    </div>
  );
}

const COLOR = {
  rose: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  indigo: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300",
  cyan: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  sky: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  violet: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  orange: "border-orange-500/40 bg-orange-500/10 text-orange-300",
};

export default function InstallationGuide() {
  const { isMaster } = useIsMaster();
  const qc = useQueryClient();
  const [completed, setCompleted] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("gws.install_done") || "[]")); }
    catch { return new Set(); }
  });
  const [active, setActive] = useState(1);
  const [videoEditor, setVideoEditor] = useState(false);

  // v43.99.13 — Video URL'lerini DB'den çek (herkes okuyabilir)
  const videosQ = useQuery({
    queryKey: ["install-videos"],
    queryFn: () => client.get("/install-videos").then(r => r.data),
    staleTime: 60_000,
  });
  const videos = videosQ.data?.videos || {};

  const toggle = (id) => {
    setCompleted(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem("gws.install_done", JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const pct = Math.round((completed.size / STEPS.length) * 100);

  return (
    <div className="p-6 space-y-6" data-testid="installation-guide">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <Rocket className="w-6 h-6 text-emerald-400" />
            Kurulum Rehberi
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            8 adımda cPanel/WHM sunucunuza GökyüzüWebSpam kurulumu · Aptala anlatır gibi
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isMaster && (
            <button
              onClick={() => setVideoEditor(true)}
              data-testid="video-editor-open"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 text-fuchsia-200 text-xs font-semibold transition-colors"
            >
              <Video className="w-3.5 h-3.5" />
              Video URL'lerini Yönet
            </button>
          )}
          <div className="inline-flex rounded border border-slate-700 overflow-hidden" data-testid="pdf-lang-selector">
            <span className="px-2 py-2 text-[10px] uppercase font-bold tracking-wider text-slate-500 bg-slate-900/60 border-r border-slate-700 self-center">PDF</span>
            {[
              { lang: "tr", label: "Türkçe",   flag: "🇹🇷" },
              { lang: "en", label: "English",  flag: "🇬🇧" },
              { lang: "ar", label: "العربية", flag: "🇸🇦" },
            ].map(o => (
              <a
                key={o.lang}
                href={`/api/tools/install-guide.pdf?lang=${o.lang}`}
                target="_blank" rel="noreferrer"
                data-testid={`download-install-pdf-${o.lang}`}
                className="px-3 py-2 text-xs font-semibold text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/25 border-r border-slate-700 last:border-r-0 transition-colors inline-flex items-center gap-1.5"
                title={`PDF · ${o.label}`}
              >
                <span>{o.flag}</span>
                <span className="hidden sm:inline">{o.label}</span>
                <Download className="w-3.5 h-3.5" />
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="border border-slate-800 bg-slate-900/40 rounded-lg p-4">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-sm text-slate-300">
            <b>{completed.size}</b> / {STEPS.length} adım tamamlandı
          </div>
          <div className={`text-2xl font-black mono ${pct === 100 ? "text-emerald-300" : "text-slate-100"}`}>%{pct}</div>
        </div>
        <div className="h-2 bg-slate-800 rounded overflow-hidden">
          <div className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all"
               style={{ width: `${pct}%` }} />
        </div>
        {pct === 100 && (
          <div className="mt-3 text-[13px] text-emerald-300 font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Tebrikler! Kurulum tamamlandı — sunucunuz artık korunuyor 🎉
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Sidebar */}
        <div className="space-y-2">
          {STEPS.map((s) => {
            const done = completed.has(s.id);
            const isActive = active === s.id;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                data-testid={`step-nav-${s.id}`}
                className={`w-full text-left p-3 rounded-lg border transition-all flex items-start gap-3
                  ${isActive ? `${COLOR[s.color]} shadow-lg` : "border-slate-800 bg-slate-900/40 hover:bg-slate-900/70"}`}
              >
                <div className="shrink-0 mt-0.5">
                  {done
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    : <div className="w-5 h-5 rounded-full border-2 border-slate-600 flex items-center justify-center">
                        <span className="text-[10px] mono text-slate-400">{s.id}</span>
                      </div>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[13px] font-semibold ${done ? "text-slate-400 line-through" : "text-slate-100"}`}>
                    {s.title}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" /> {s.duration}
                  </div>
                </div>
                {isActive && <ChevronRight className="w-4 h-4 text-slate-500 mt-1" />}
              </button>
            );
          })}
        </div>

        {/* Detail */}
        <div className="border border-slate-800 bg-slate-900/30 rounded-lg overflow-hidden">
          {(() => {
            const s = STEPS.find(x => x.id === active);
            if (!s) return null;
            const Icon = s.icon;
            return (
              <>
                <div className={`px-5 py-4 border-b border-slate-800 ${COLOR[s.color].split(" ")[1]}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${COLOR[s.color]}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                          ADIM {s.id} / {STEPS.length}
                        </div>
                        <div className="text-lg font-bold text-slate-100">{s.title}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" /> Tahmini süre: {s.duration}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => toggle(s.id)}
                      data-testid={`step-complete-${s.id}`}
                      className={`text-[12px] px-3 py-1.5 rounded border font-semibold transition-colors
                        ${completed.has(s.id)
                          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-200"
                          : "bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800"}`}
                    >
                      {completed.has(s.id) ? "✓ Tamamlandı" : "Tamamlandı olarak işaretle"}
                    </button>
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  <div className="text-[14px] text-slate-300 leading-relaxed">{s.intro}</div>
                  {/* v43.99.13 — Video kurulum rehberi (30 sn ekran kaydı) */}
                  <VideoEmbed stepId={s.id} videos={videos} />
                  {s.content}
                  {/* Navigation */}
                  <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                    <button
                      onClick={() => setActive(Math.max(1, s.id - 1))}
                      disabled={s.id === 1}
                      className="text-[13px] px-3 py-1.5 rounded bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ← Önceki
                    </button>
                    <button
                      onClick={() => {
                        if (!completed.has(s.id)) toggle(s.id);
                        if (s.id < STEPS.length) setActive(s.id + 1);
                      }}
                      className="text-[13px] px-4 py-1.5 rounded bg-indigo-500/15 border border-indigo-500/40 text-indigo-200 font-semibold hover:bg-indigo-500/25"
                    >
                      {s.id === STEPS.length ? "Bitir 🎉" : "Sonraki →"}
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Help */}
      <div className="border border-slate-800 bg-slate-900/30 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <HelpCircle className="w-5 h-5 text-cyan-400 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-100">Yardıma mı ihtiyacınız var?</div>
            <div className="text-[12px] text-slate-400 mt-1">
              Kurulum sırasında takıldığınızda <b>destek@gokyuzuhosting.com</b> adresine yazın. Ekran görüntüsü + hata log'u ile birlikte gönderin, 24 saat içinde geri döneriz.
            </div>
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            {["tr", "en", "ar"].map(lang => (
              <a
                key={lang}
                href={`/api/tools/install-guide.pdf?lang=${lang}`}
                target="_blank" rel="noreferrer"
                className="text-[11px] uppercase font-bold text-indigo-300 hover:text-indigo-200 flex items-center gap-1 px-2 py-1 rounded border border-indigo-500/30 hover:bg-indigo-500/10"
              >
                <FileText className="w-3 h-3" /> {lang.toUpperCase()}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* v43.99.13 — Master için Video URL Editor Modal */}
      {videoEditor && isMaster && (
        <VideoEditorModal videos={videos} onClose={() => setVideoEditor(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["install-videos"] })} />
      )}
    </div>
  );
}


// v43.99.13 — 8 kurulum adımı için YouTube + MP4 URL'lerini düzenleyen modal
function VideoEditorModal({ videos, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => {
    const d = {};
    for (let i = 1; i <= 8; i++) {
      const v = videos?.[String(i)] || {};
      d[i] = { youtube: v.youtube || "", mp4: v.mp4 || "" };
    }
    return d;
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const videos_out = {};
      for (let i = 1; i <= 8; i++) {
        videos_out[String(i)] = {
          youtube: draft[i].youtube.trim(),
          mp4: draft[i].mp4.trim(),
        };
      }
      return client.put("/install-videos", { videos: videos_out }).then(r => r.data);
    },
    onSuccess: () => {
      toast.success("✓ Video URL'leri kaydedildi. Herkes anında yeni videoları görecek.");
      onSaved && onSaved();
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kaydedilemedi"),
  });

  const STEP_LABELS = {
    1: "Satın Alma E-postasını Kontrol Et",
    2: "SSH ile Sunucuya Bağlan",
    3: "Docker Kur",
    4: "GökyüzüWebSpam Kur",
    5: "WHM'de MailShield'a Tıkla",
    6: "cPanel Hesaplarını Gör",
    7: "Motorları Test Et",
    8: "Bildirim Kanallarını Bağla",
  };

  return (
    <div
      data-testid="video-editor-modal"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg my-6 max-w-3xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-slate-100 font-bold text-lg flex items-center gap-2">
              <Video className="w-5 h-5 text-fuchsia-400" /> Video URL'lerini Yönet
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Her adım için YouTube veya MP4 URL girin. YouTube: <code className="mono text-slate-400">youtube.com/watch?v=…</code> otomatik <code className="mono text-slate-400">/embed/…</code> formatına çevrilir. Her ikisi de dolu ise YouTube öncelik alır.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} data-testid={`video-editor-step-${i}`} className="border border-slate-800 rounded-lg p-3 bg-slate-950/40">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-2">
                Adım {i} · {STEP_LABELS[i]}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1 font-semibold">
                    YouTube URL (watch veya embed link)
                  </label>
                  <input
                    data-testid={`video-editor-youtube-${i}`}
                    value={draft[i].youtube}
                    onChange={(e) => setDraft(p => ({ ...p, [i]: { ...p[i], youtube: e.target.value } }))}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs mono text-slate-200 focus:border-rose-500/40 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1 font-semibold">
                    MP4 URL (direkt dosya linki)
                  </label>
                  <input
                    data-testid={`video-editor-mp4-${i}`}
                    value={draft[i].mp4}
                    onChange={(e) => setDraft(p => ({ ...p, [i]: { ...p[i], mp4: e.target.value } }))}
                    placeholder="https://cdn.example.com/step1.mp4"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs mono text-slate-200 focus:border-emerald-500/40 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-800">
          <button
            onClick={onClose}
            data-testid="video-editor-cancel"
            className="px-4 py-2 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-semibold"
          >
            İptal
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            data-testid="video-editor-save"
            className="px-4 py-2 rounded bg-fuchsia-500/15 border border-fuchsia-500/40 text-fuchsia-200 hover:bg-fuchsia-500/25 text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saveMut.isPending ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </div>
      </div>
    </div>
  );
}
