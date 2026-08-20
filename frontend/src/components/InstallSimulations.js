/**
 * InstallSimulations — Framer-motion tabanlı gerçekçi kurulum simülasyonları
 * 8 adım · Her biri terminal/WHM/cPanel mockup'u ile animasyonlu
 * v43.99.19
 */
import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail, Terminal, Server, Rocket, Globe, Users, Shield, Bell,
  Play, Pause, RotateCcw, CheckCircle2, Circle, Wifi, Lock,
  CircleDot, MousePointer2, Package, Cpu, HardDrive, Signal,
} from "lucide-react";

// ═════════════════════════════════════════════════════════════════
// Yardımcı: yazıyor efekti (typewriter) — fps: 30
// ═════════════════════════════════════════════════════════════════
function useTypewriter(text, { speed = 22, delay = 0, playing = true } = {}) {
  const [out, setOut] = useState("");
  useEffect(() => {
    if (!playing) return;
    let i = 0;
    let t1;
    const t0 = setTimeout(() => {
      t1 = setInterval(() => {
        i += 1;
        setOut(text.slice(0, i));
        if (i >= text.length) clearInterval(t1);
      }, speed);
    }, delay);
    return () => { clearTimeout(t0); clearInterval(t1); };
  }, [text, speed, delay, playing]);
  return out;
}

// Genel çerçeve
function WindowFrame({ title, kind = "terminal", children, className = "" }) {
  const colors = {
    terminal:  ["#ef4444", "#eab308", "#22c55e"],
    browser:   ["#ef4444", "#eab308", "#22c55e"],
    whm:       ["#ef4444", "#eab308", "#22c55e"],
  };
  const dots = colors[kind] || colors.terminal;
  const bg = kind === "terminal" ? "bg-[#0d1117]" : "bg-slate-100";
  const titleColor = kind === "terminal" ? "text-slate-300" : "text-slate-700";
  const titleBar = kind === "terminal" ? "bg-[#161b22] border-b border-black/40" : "bg-slate-200 border-b border-slate-300";
  return (
    <div className={`rounded-lg overflow-hidden shadow-2xl border border-black/40 ${className}`}>
      <div className={`${titleBar} px-3 py-2 flex items-center gap-2`}>
        <div className="flex items-center gap-1.5">
          {dots.map((c, i) => <span key={i} style={{ backgroundColor: c }} className="w-2.5 h-2.5 rounded-full" />)}
        </div>
        <div className={`text-[11px] font-semibold mx-auto ${titleColor} mono`}>{title}</div>
        <div className="w-10" />
      </div>
      <div className={`${bg} ${kind === "terminal" ? "text-emerald-300" : "text-slate-700"}`}>
        {children}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ADIM 1: E-posta gelir (Gmail mockup)
// ═════════════════════════════════════════════════════════════════
function Step1_Email({ playing }) {
  return (
    <WindowFrame title="mail.google.com — gelen kutusu" kind="browser">
      <div className="min-h-[280px] p-4 space-y-2 bg-white">
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={playing ? { y: 0, opacity: 1 } : {}}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="flex items-center gap-2 border border-emerald-300 bg-emerald-50 rounded p-3 shadow-sm"
        >
          <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold text-sm shrink-0">GH</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[12px] font-bold text-slate-900">GökyüzüHosting Lisans Servisi</div>
              <div className="text-[10px] text-slate-500">14:23</div>
            </div>
            <div className="text-[11px] text-slate-800 font-semibold">🔑 GökyüzüWebSpam · Lisans Bilgileriniz</div>
            <div className="text-[10px] text-slate-500 truncate">
              Sayın müşterimiz, satın alma işleminiz tamamlandı. Kurulum için aşağıdaki bilgileri kullanın...
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={playing ? { opacity: 1 } : {}}
          transition={{ delay: 1.4, duration: 0.5 }}
          className="mt-3 border-l-4 border-emerald-500 pl-3 bg-slate-50 rounded"
        >
          <div className="mono text-[11px] text-slate-800 leading-relaxed p-3 space-y-0.5">
            <div><span className="text-slate-500">Lisans Anahtarı:</span> <span className="text-emerald-700 font-bold">MS-C02AB012652A4FE692D69676</span></div>
            <div><span className="text-slate-500">Plan:</span> Enterprise (30 gün)</div>
            <div><span className="text-slate-500">Sunucu IP:</span> 123.45.67.89</div>
            <div><span className="text-slate-500">Panel Domain:</span> panel.firmaniz.com</div>
          </div>
        </motion.div>
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={playing ? { scale: 1, opacity: 1 } : {}}
          transition={{ delay: 2.5, type: "spring", stiffness: 220 }}
          className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold"
        >
          <CheckCircle2 className="w-3 h-3" /> Kopyalandı: Lisans Anahtarı
        </motion.div>
      </div>
    </WindowFrame>
  );
}

// ═════════════════════════════════════════════════════════════════
// ADIM 2: SSH terminal
// ═════════════════════════════════════════════════════════════════
function Step2_SSH({ playing }) {
  const cmd = useTypewriter("ssh root@123.45.67.89", { speed: 55, delay: 500, playing });
  const showAuth = cmd.length >= 21;
  return (
    <WindowFrame title="user@localhost — bash — 80×24" kind="terminal">
      <div className="p-4 mono text-[12.5px] min-h-[280px] leading-relaxed">
        <div className="text-slate-500">Last login: Tue Feb 11 14:23:11 2026 from 82.222.11.4</div>
        <div className="mt-2">
          <span className="text-cyan-300">user@localhost</span>
          <span className="text-slate-500">:</span>
          <span className="text-indigo-300">~</span>
          <span className="text-slate-500">$ </span>
          <span className="text-emerald-300">{cmd}</span>
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            className="inline-block w-2 h-3.5 bg-emerald-400 ml-0.5 align-middle"
          />
        </div>
        <AnimatePresence>
          {showAuth && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="mt-2 space-y-1"
            >
              <div className="text-slate-400">The authenticity of host '123.45.67.89' can't be established.</div>
              <div className="text-slate-400">ED25519 key fingerprint is SHA256:xB7dnH9WkP...</div>
              <div className="text-slate-400">Are you sure you want to continue connecting (yes/no)? <span className="text-amber-300">yes</span></div>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
                className="text-slate-400"
              >
                root@123.45.67.89's password: <span className="text-slate-600 italic">••••••••</span>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.6, duration: 0.4 }}
                className="mt-2 text-slate-300"
              >
                <div>Welcome to CentOS 8.5 (WHM/cPanel 118.0)</div>
                <div className="text-slate-500 text-[11px]">Server load: 0.24 · Memory: 4.1G / 32G · Uptime: 62 days</div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 2.4 }}
                className="flex items-center gap-1 mt-2"
              >
                <span className="text-rose-300 font-bold">root@sunucu</span>
                <span className="text-slate-500">:</span>
                <span className="text-indigo-300">~</span>
                <span className="text-slate-500">#</span>
                <motion.span
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="inline-block w-2 h-3.5 bg-emerald-400 ml-1"
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </WindowFrame>
  );
}

// ═════════════════════════════════════════════════════════════════
// ADIM 3: Docker kurulum
// ═════════════════════════════════════════════════════════════════
function Step3_Docker({ playing }) {
  const cmd = useTypewriter("curl -fsSL https://get.docker.com | bash", { speed: 25, delay: 300, playing });
  const done = cmd.length >= 40;
  const logs = [
    { t: 1600, text: "+ sh -c apt-get update -qq >/dev/null" },
    { t: 2400, text: "+ sh -c DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce" },
    { t: 3600, text: "  Fetching https://download.docker.com/linux/... [====> ] 42%" },
    { t: 4400, text: "  Fetching https://download.docker.com/linux/... [========>] 100%" },
    { t: 5200, text: "+ sh -c systemctl enable --now docker" },
    { t: 6000, text: "  Created symlink /etc/systemd/system/multi-user.target.wants/docker.service", ok: true },
    { t: 6800, text: "Docker version 25.0.3, build 4debf41 · installed successfully ✓", ok: true },
  ];
  return (
    <WindowFrame title="root@sunucu — bash" kind="terminal">
      <div className="p-4 mono text-[12px] min-h-[280px] leading-relaxed">
        <div>
          <span className="text-rose-300">root@sunucu</span>
          <span className="text-slate-500">:~# </span>
          <span className="text-emerald-300">{cmd}</span>
          {!done && (
            <motion.span
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
              className="inline-block w-2 h-3.5 bg-emerald-400 ml-0.5 align-middle"
            />
          )}
        </div>
        {logs.map((l, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={playing ? { opacity: 1, x: 0 } : {}}
            transition={{ delay: l.t / 1000, duration: 0.25 }}
            className={l.ok ? "text-emerald-300" : "text-slate-400"}
          >
            {l.text}
          </motion.div>
        ))}
      </div>
    </WindowFrame>
  );
}

// ═════════════════════════════════════════════════════════════════
// ADIM 4: install.sh çalışması (progress + log stream)
// ═════════════════════════════════════════════════════════════════
function Step4_Install({ playing }) {
  const cmd = useTypewriter("bash /root/install.sh", { speed: 45, delay: 200, playing });
  const started = cmd.length >= 20;
  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (!started || !playing) return;
    let p = 0;
    const it = setInterval(() => {
      p += Math.random() * 5 + 2;
      if (p >= 100) { p = 100; clearInterval(it); }
      setPct(p);
    }, 250);
    return () => clearInterval(it);
  }, [started, playing]);
  const steps = [
    { at: 6,  label: "MongoDB Docker container'ı indiriliyor" },
    { at: 22, label: "Backend imajı build ediliyor (Python 3.11)" },
    { at: 40, label: "Frontend imajı build ediliyor (Node 20 + Yarn)" },
    { at: 58, label: "Nginx reverse proxy yapılandırılıyor" },
    { at: 72, label: "Let's Encrypt SSL sertifikası alınıyor" },
    { at: 86, label: "WHM plugin dosyaları yerleştiriliyor" },
    { at: 96, label: "Exim milter entegrasyonu aktif" },
    { at: 100, label: "🎉 Kurulum başarılı! WHM → MailShield ikonuna tıklayın", ok: true },
  ];
  return (
    <WindowFrame title="GökyüzüWebSpam install.sh" kind="terminal">
      <div className="p-4 mono text-[12px] min-h-[300px] leading-relaxed">
        <div>
          <span className="text-rose-300">root@sunucu</span>
          <span className="text-slate-500">:~# </span>
          <span className="text-emerald-300">{cmd}</span>
        </div>
        {started && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
              className="mt-2 text-slate-400"
            >
              <div>GökyüzüWebSpam Installer v43.99 · Lisans doğrulanıyor...</div>
              <div className="text-emerald-300">✓ Lisans geçerli · Plan: Enterprise · IP eşleşti</div>
            </motion.div>
            <div className="mt-3 border border-slate-700 rounded p-2 bg-slate-950/80">
              <div className="flex items-baseline justify-between text-[11px] mb-1">
                <span className="text-cyan-300">İlerleme</span>
                <span className="text-emerald-300 font-bold">%{Math.floor(pct)}</span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all"
                     style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="mt-2 space-y-0.5 max-h-[140px] overflow-hidden">
              {steps.filter(s => pct >= s.at).map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={s.ok ? "text-emerald-300 font-bold" : "text-slate-300"}
                >
                  {s.ok ? "" : "[✓] "}{s.label}
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>
    </WindowFrame>
  );
}

// ═════════════════════════════════════════════════════════════════
// ADIM 5: WHM Panel mockup + cursor tıklaması
// ═════════════════════════════════════════════════════════════════
function Step5_WHM({ playing }) {
  return (
    <WindowFrame title="https://123.45.67.89:2087 — WHM / Plugins" kind="whm">
      <div className="bg-white min-h-[300px] flex">
        {/* Sol menü */}
        <div className="w-40 bg-[#1e3a5f] text-white text-[10px] p-2 space-y-1">
          <div className="font-bold text-[11px] mb-2 text-cyan-200">WHM MENU</div>
          {["Home", "Server Status", "Account Functions", "Server Config", "Software", "Security Center"].map((m, i) => (
            <div key={i} className="px-1.5 py-1 rounded hover:bg-white/10 opacity-70">{m}</div>
          ))}
          <div className="border-t border-cyan-500/30 mt-2 pt-2">
            <div className="text-cyan-300 font-bold text-[10px] mb-1">PLUGINS</div>
            <motion.div
              animate={{ backgroundColor: ["rgba(255,255,255,0)", "rgba(52,211,153,0.3)", "rgba(255,255,255,0)"] }}
              transition={{ duration: 2, repeat: Infinity, delay: 1 }}
              className="px-1.5 py-1 rounded font-bold text-emerald-300"
            >
              MailShield
            </motion.div>
            <div className="px-1.5 py-1 opacity-60">Softaculous</div>
          </div>
        </div>
        {/* İçerik */}
        <div className="flex-1 p-4">
          <div className="text-[13px] font-bold text-slate-800 mb-3 border-b border-slate-200 pb-1">Plugins</div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { name: "Softaculous", color: "bg-orange-500" },
              { name: "ConfigServer", color: "bg-blue-500" },
              { name: "MailShield", color: "bg-emerald-500", highlight: true },
              { name: "Imunify360", color: "bg-red-500" },
              { name: "JetBackup", color: "bg-purple-500" },
              { name: "LiteSpeed", color: "bg-teal-500" },
            ].map((p, i) => (
              <motion.div
                key={i}
                animate={p.highlight ? {
                  scale: [1, 1.06, 1],
                  boxShadow: ["0 0 0 rgba(52,211,153,0)", "0 0 20px rgba(52,211,153,0.7)", "0 0 0 rgba(52,211,153,0)"],
                } : {}}
                transition={p.highlight ? { duration: 1.8, repeat: Infinity, delay: 1.5 } : {}}
                className="border border-slate-200 rounded-lg p-3 flex flex-col items-center bg-white shadow-sm hover:shadow-md"
              >
                <div className={`w-10 h-10 rounded ${p.color} flex items-center justify-center text-white mb-1`}>
                  <Shield className="w-5 h-5" />
                </div>
                <div className="text-[10px] font-semibold text-slate-700 text-center">{p.name}</div>
              </motion.div>
            ))}
          </div>
          {/* Animated cursor click on MailShield */}
          {playing && (
            <motion.div
              initial={{ x: 20, y: 20, opacity: 0 }}
              animate={{
                x: [20, 180, 180, 180],
                y: [20, 60, 60, 60],
                opacity: [0, 1, 1, 0.7],
                scale: [1, 1, 0.85, 1],
              }}
              transition={{ duration: 3, times: [0, 0.5, 0.7, 1], delay: 0.8, repeat: Infinity, repeatDelay: 2 }}
              className="absolute pointer-events-none"
              style={{ position: "absolute" }}
            >
              <MousePointer2 className="w-5 h-5 text-slate-800 drop-shadow-lg" fill="white" />
            </motion.div>
          )}
        </div>
      </div>
      {/* Panel bar */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={playing ? { y: 0, opacity: 1 } : {}}
        transition={{ delay: 3.5, duration: 0.5 }}
        className="bg-slate-900 text-white text-[11px] px-3 py-2 flex items-center justify-between border-t border-emerald-500/40"
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold">GökyüzüWebSpam Panel Açıldı</span>
        </div>
        <div className="mono text-emerald-300">MASTER · 123.45.67.89 · Enterprise</div>
      </motion.div>
    </WindowFrame>
  );
}

// ═════════════════════════════════════════════════════════════════
// ADIM 6: cPanel Hesapları tablosu — satır satır dolar
// ═════════════════════════════════════════════════════════════════
function Step6_Accounts({ playing }) {
  const rows = [
    { user: "abc_firma",    domain: "abcfirma.com",    sent: 1240, spam: 34, quar: 8,  score: 92 },
    { user: "xyz_shop",     domain: "xyzshop.net",     sent: 890,  spam: 21, quar: 3,  score: 96 },
    { user: "hello_com",    domain: "hello.com.tr",    sent: 2410, spam: 78, quar: 22, score: 88 },
    { user: "mega_holding", domain: "megaholding.com", sent: 5620, spam: 143, quar: 41, score: 94 },
    { user: "test_dev",     domain: "test-dev.io",     sent: 45,   spam: 2,  quar: 0,  score: 98 },
  ];
  return (
    <WindowFrame title="panel.firmaniz.com/panel/users — Kullanıcılar" kind="browser">
      <div className="bg-slate-50 min-h-[300px] p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[13px] font-bold text-slate-800">📊 cPanel Hesapları · <span className="text-emerald-600">{rows.length}</span> aktif</div>
          <div className="text-[10px] text-slate-500 mono">otomatik-senkronize · her 5 dk</div>
        </div>
        <div className="bg-white rounded border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-100 border-b border-slate-200">
              <tr className="text-slate-600">
                {["Kullanıcı", "Domain", "Gönderilen", "Spam", "Karantina", "Hijyen Skoru"].map((h, i) => (
                  <th key={i} className="text-left px-2.5 py-1.5 font-semibold text-[10px] uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <motion.tr
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  animate={playing ? { opacity: 1, x: 0 } : {}}
                  transition={{ delay: 0.6 + i * 0.35, duration: 0.35 }}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                >
                  <td className="px-2.5 py-1.5 mono font-semibold text-slate-800">{r.user}</td>
                  <td className="px-2.5 py-1.5 text-slate-600">{r.domain}</td>
                  <td className="px-2.5 py-1.5 text-slate-700">{r.sent.toLocaleString()}</td>
                  <td className="px-2.5 py-1.5 text-rose-600 font-semibold">{r.spam}</td>
                  <td className="px-2.5 py-1.5 text-amber-600 font-semibold">{r.quar}</td>
                  <td className="px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1 bg-slate-200 rounded overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={playing ? { width: `${r.score}%` } : {}}
                          transition={{ delay: 0.6 + i * 0.35 + 0.3, duration: 0.6 }}
                          className={r.score >= 95 ? "h-full bg-emerald-500" : r.score >= 90 ? "h-full bg-cyan-500" : "h-full bg-amber-500"}
                        />
                      </div>
                      <span className="mono text-[10px] font-bold text-slate-700">{r.score}</span>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </WindowFrame>
  );
}

// ═════════════════════════════════════════════════════════════════
// ADIM 7: Motorlar sekmesi — durum ışıkları
// ═════════════════════════════════════════════════════════════════
function Step7_Engines({ playing }) {
  const engines = [
    { name: "SpamAssassin",       desc: "İçerik skorlaması",         delay: 0.3, active: true },
    { name: "ClamAV",             desc: "Virüs / malware taraması",  delay: 0.7, active: true },
    { name: "DCC + Razor + Pyzor",desc: "Bulk mail parmak izi",      delay: 1.1, active: true },
    { name: "RBL / DNSBL",        desc: "IP kara listesi",           delay: 1.5, active: true },
    { name: "SPF / DKIM / DMARC", desc: "Kimlik doğrulama",          delay: 1.9, active: true },
    { name: "LLM AI Classifier",  desc: "Claude · %98.7 doğruluk",   delay: 2.3, active: false },
  ];
  return (
    <WindowFrame title="panel.firmaniz.com/panel/security — Motorlar" kind="browser">
      <div className="bg-slate-950 min-h-[300px] p-4">
        <div className="text-[13px] font-bold text-slate-100 mb-3 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" /> Motor Durumu · Canlı
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {engines.map((e, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={playing ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: e.delay, duration: 0.4 }}
              className="border border-slate-800 bg-slate-900/60 rounded p-2.5 flex items-center gap-2"
            >
              <motion.div
                animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: e.delay }}
                className={`w-2.5 h-2.5 rounded-full ${e.active ? "bg-emerald-400" : "bg-amber-400"} shrink-0`}
                style={{ boxShadow: e.active ? "0 0 8px #34d399" : "0 0 8px #fbbf24" }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-slate-100">{e.name}</div>
                <div className="text-[10px] text-slate-400 truncate">{e.desc}</div>
              </div>
              <span className={`text-[10px] font-bold ${e.active ? "text-emerald-400" : "text-amber-400"}`}>
                {e.active ? "AKTİF" : "OPSİYONEL"}
              </span>
            </motion.div>
          ))}
        </div>
        {/* Simülatör */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={playing ? { opacity: 1, scale: 1 } : {}}
          transition={{ delay: 3.2, duration: 0.5 }}
          className="mt-3 border border-rose-500/40 bg-rose-500/10 rounded p-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold text-rose-200 uppercase tracking-wider">Canlı Simülatör Sonucu</div>
              <div className="text-[13px] font-mono text-rose-100 mt-1">Test.eml → PHISHING · Score 8.4</div>
            </div>
            <div className="text-2xl">🎯</div>
          </div>
        </motion.div>
      </div>
    </WindowFrame>
  );
}

// ═════════════════════════════════════════════════════════════════
// ADIM 8: Bildirim kanalları — toggle animasyonu
// ═════════════════════════════════════════════════════════════════
function Step8_Notifications({ playing }) {
  const channels = [
    { name: "E-posta",         icon: "📧", desc: "SMTP · SendGrid/SES",       enabled: true,  delay: 0.4 },
    { name: "Slack",           icon: "💬", desc: "Incoming Webhook",           enabled: true,  delay: 0.9 },
    { name: "Discord",         icon: "🎮", desc: "Channel Webhook",            enabled: true,  delay: 1.4 },
    { name: "Telegram",        icon: "✈",  desc: "@BotFather · chat_id",       enabled: true,  delay: 1.9 },
    { name: "Tarayıcı Push",   icon: "🔔", desc: "Panel açık kaldığında",     enabled: false, delay: 2.4 },
    { name: "SMS (Twilio)",    icon: "📱", desc: "Ücretli · API key",          enabled: false, delay: 2.7 },
  ];
  return (
    <WindowFrame title="panel.firmaniz.com/settings/notifications — Bildirimler" kind="browser">
      <div className="bg-white min-h-[300px] p-4">
        <div className="text-[13px] font-bold text-slate-800 mb-3 flex items-center gap-2">
          <Bell className="w-4 h-4 text-amber-500" /> Bildirim Kanalları
        </div>
        <div className="space-y-2">
          {channels.map((c, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              animate={playing ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: c.delay, duration: 0.35 }}
              className="flex items-center gap-3 border border-slate-200 rounded p-2.5 bg-slate-50"
            >
              <div className="text-xl">{c.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-slate-800">{c.name}</div>
                <div className="text-[10px] text-slate-500">{c.desc}</div>
              </div>
              <motion.div
                initial={{ scale: 0 }}
                animate={playing ? { scale: 1 } : {}}
                transition={{ delay: c.delay + 0.3, type: "spring", stiffness: 260 }}
                className={`relative w-10 h-5 rounded-full ${c.enabled ? "bg-emerald-500" : "bg-slate-300"} transition-colors`}
              >
                <motion.div
                  animate={{ x: c.enabled ? 20 : 2 }}
                  transition={{ delay: c.delay + 0.4, type: "spring", stiffness: 300 }}
                  className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow"
                />
              </motion.div>
            </motion.div>
          ))}
        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={playing ? { opacity: 1 } : {}}
          transition={{ delay: 3.5 }}
          className="mt-3 border border-emerald-300 bg-emerald-50 rounded p-2.5 text-center"
        >
          <div className="text-[12px] font-bold text-emerald-800">🎉 Kurulum Tamamlandı!</div>
          <div className="text-[10px] text-emerald-700 mt-0.5">Karantina/incident olduğunda anında haberdar olacaksınız.</div>
        </motion.div>
      </div>
    </WindowFrame>
  );
}

// ═════════════════════════════════════════════════════════════════
// Dispatcher + Controls
// ═════════════════════════════════════════════════════════════════
const STEP_COMPONENTS = {
  1: Step1_Email, 2: Step2_SSH, 3: Step3_Docker, 4: Step4_Install,
  5: Step5_WHM, 6: Step6_Accounts, 7: Step7_Engines, 8: Step8_Notifications,
};

const STEP_META = {
  1: { title: "Lisans e-postanız gelir",       icon: Mail,     duration: 3500 },
  2: { title: "SSH ile sunucuya bağlanma",     icon: Terminal, duration: 5500 },
  3: { title: "Docker kurulumu",               icon: Server,   duration: 7500 },
  4: { title: "install.sh çalışıyor",          icon: Rocket,   duration: 8500 },
  5: { title: "WHM'de MailShield'a tıklama",   icon: Globe,    duration: 5000 },
  6: { title: "cPanel hesapları listelenir",   icon: Users,    duration: 4500 },
  7: { title: "Motorlar aktif olur",           icon: Shield,   duration: 4500 },
  8: { title: "Bildirim kanalları bağlanır",   icon: Bell,     duration: 4500 },
};

/**
 * Ana kompozit bileşen — belirli bir stepId için simülasyon çalar.
 * Otomatik oynatma + manuel yeniden başlatma.
 */
export default function InstallStepSimulator({ stepId = 1 }) {
  const meta = STEP_META[stepId] || STEP_META[1];
  const Comp = STEP_COMPONENTS[stepId];
  const [playing, setPlaying] = useState(true);
  const [runKey, setRunKey] = useState(0); // remount trigger for replay

  const restart = () => {
    setRunKey(k => k + 1);
    setPlaying(true);
  };

  if (!Comp) return null;
  const Icon = meta.icon;

  return (
    <div
      data-testid={`install-simulator-${stepId}`}
      className="rounded-lg border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden"
    >
      <div className="px-3 py-2 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center">
            <Icon className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-200 tracking-wide uppercase">Adım {stepId} · Canlı Simülasyon</div>
            <div className="text-[10px] text-slate-500">{meta.title}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPlaying(p => !p)}
            data-testid={`sim-playpause-${stepId}`}
            className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center transition"
            title={playing ? "Duraklat" : "Devam Et"}
          >
            {playing ? <Pause className="w-3.5 h-3.5 text-slate-200" /> : <Play className="w-3.5 h-3.5 text-slate-200 ml-0.5" />}
          </button>
          <button
            onClick={restart}
            data-testid={`sim-restart-${stepId}`}
            className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center transition"
            title="Baştan Başlat"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-200" />
          </button>
        </div>
      </div>
      <div className="p-3 sm:p-4 relative overflow-hidden">
        <div key={runKey}>
          <Comp playing={playing} />
        </div>
        <div className="mt-2 text-[10px] text-slate-500 italic text-center">
          Bu bir gerçek video değil — panelinizde kurulumu birebir gösteren canlı animasyon simülasyonudur.
        </div>
      </div>
    </div>
  );
}
