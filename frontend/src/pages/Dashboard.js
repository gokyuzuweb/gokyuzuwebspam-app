import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar,
} from "recharts";
import {
  ShieldAlert, Ban, Bug, MailWarning, MailCheck, Activity, LayoutDashboard,
  Globe2, Inbox, HeartPulse, Radio, Grid3x3,
} from "lucide-react";
import { Card, CardBody, CardHeader, StatCard, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import LiveMailEvents from "@/components/LiveMailEvents";
import ModuleFooter from "@/components/ModuleFooter";
import MultiServerRibbon from "@/components/MultiServerRibbon";
import { ResumeSessionCard } from "@/components/V4399Cards";
import HealthScore from "@/components/HealthScore";
import ComplianceSnapshot from "@/components/ComplianceSnapshot";
import OnboardingWizard from "@/components/OnboardingWizard";
import ControlBar from "@/components/ControlBar";
import AttackMap from "@/components/AttackMap";
import QueueModal from "@/components/QueueModal";
import IpDrilldownDrawer from "@/components/IpDrilldownDrawer";
import CountryBlockCard from "@/components/CountryBlockCard";
import ThreatIntelTodayWidget from "@/components/ThreatIntelTodayWidget";
import ResellerAnalyticsWidget from "@/components/ResellerAnalyticsWidget";
import MasterAlertCenter from "@/components/MasterAlertCenter";
import BounceDigestWidget from "@/components/BounceDigestWidget";
import MarketplaceLeaderboardBanner from "@/components/MarketplaceLeaderboardBanner";
import TrustedPublisherBadge from "@/components/TrustedPublisherBadge";
import PendingApprovalsWidget from "@/components/PendingApprovalsWidget";
import PushHealthWidget from "@/components/PushHealthWidget";

const LICKEY = () => (typeof window !== "undefined"
  ? (localStorage.getItem("gws.event_license") || "")
  : "");
const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

function verdictBadge(v, t) {
  const m = {
    spam:      { tone: "warning", label: t("dashboard.spam") },
    high_spam: { tone: "danger",  label: t("dashboard.high_spam") },
    virus:     { tone: "danger",  label: t("dashboard.virus") },
    phish:     { tone: "danger",  label: t("dashboard.phishing") },
  }[v] || { tone: "default", label: v };
  return <Badge tone={m.tone}>{String(m.label).toUpperCase()}</Badge>;
}

const TABS = [
  { key: "overview",  label: "Genel Bakış",   Icon: LayoutDashboard },
  { key: "geo",       label: "Coğrafi",       Icon: Globe2 },
  { key: "traffic",   label: "Trafik",        Icon: Activity },
  { key: "quarantine",label: "Karantina",     Icon: Inbox },
  { key: "health",    label: "Sağlık",        Icon: HeartPulse },
  { key: "live",      label: "Canlı",         Icon: Radio },
  { key: "all",       label: "Tümünü Göster", Icon: Grid3x3 },
];

export default function Dashboard() {
  const t = useT();
  const [tab, setTab] = useState("overview");
  const [queueOpen, setQueueOpen] = useState(false);
  const [drillIp, setDrillIp] = useState(null);

  const overview   = useQuery({ queryKey: ["overview"],   queryFn: api.overview, refetchInterval: 15000 });
  const traffic    = useQuery({ queryKey: ["traffic"],    queryFn: () => api.traffic(24), refetchInterval: 30000 });
  const top        = useQuery({ queryKey: ["top-senders"], queryFn: api.topSenders });
  const quarantine = useQuery({ queryKey: ["q-recent"],   queryFn: () => api.quarantine({ limit: 10 }) });
  const stats = overview.data || {};

  const show = (k) => tab === "all" || tab === k;

  return (
    <div className="p-6 space-y-5">
      <OnboardingWizard />

      {/* v44.00.04 — Kişisel Koruma Panosu (Bayi Analytics) */}
      <ResellerAnalyticsWidget />

      {/* Always-on Control Bar */}
      <ControlBar onQueueClick={() => setQueueOpen(true)} />

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 overflow-x-auto" data-testid="dashboard-tabs">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            data-testid={`dashtab-${key}`}
            onClick={() => setTab(key)}
            className={`shrink-0 flex items-center gap-1.5 text-xs px-3 py-2 rounded-md transition-all
              ${tab === key
                ? "bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40"
                : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"}`}
          >
            <Icon className="w-3.5 h-3.5"/>{label}
          </button>
        ))}
      </div>

      {/* Overview tab: 4 stat cards + threat dist */}
      {show("overview") && (
        <div className="space-y-5">
          {/* v43.76 — Master Onay Bekleyen İşlemler (havale + PayTR) — 0 pending ise gizlenir */}
          <PendingApprovalsWidget />
          {/* v43.73 — Marketplace Haftalık Lider (winner yoksa null) */}
          <MarketplaceLeaderboardBanner />
          {/* v43.74 — Bayı Trusted Publisher rozeti (progress banner) */}
          <TrustedPublisherBadge />
          {/* v43.38 — Master Alert Center (Threat Intel sync fails etc.) — null if 0 alerts */}
          <MasterAlertCenter />
          {/* v43.62 — Exim Push Sağlığı canlı göstergesi */}
          <PushHealthWidget />
          {/* v43.53 — Bounce Digest özet widget'ı (bounce yoksa null) */}
          <BounceDigestWidget />
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 md:col-span-3">
              <StatCard label={t("dashboard.scanned_today")} tone="info" icon={Activity} testid="stat-scanned"
                        value={nfmt(stats.scanned_today)} hint="son 24 saat"/>
            </div>
            <div className="col-span-12 md:col-span-3">
              <StatCard label={t("dashboard.caught_spam")} tone="warning" icon={MailWarning} testid="stat-caught"
                        value={nfmt(stats.caught_today)} hint={`% ${stats.spam_ratio ?? 0} oranı`}/>
            </div>
            <div className="col-span-12 md:col-span-3">
              <StatCard label={t("dashboard.in_quarantine")} tone="danger" icon={ShieldAlert} testid="stat-quarantine"
                        value={nfmt(stats.quarantine_total)}
                        hint={`${stats.phishing_count ?? 0} phishing · ${stats.virus_count ?? 0} virüs`}/>
            </div>
            <div className="col-span-12 md:col-span-3">
              <StatCard label={t("dashboard.clean_delivered")} tone="success" icon={MailCheck} testid="stat-ham"
                        value={nfmt(stats.ham_today)}
                        hint={`${stats.engines_active}/${stats.engines_total} motor aktif`}/>
            </div>
          </div>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-8"><ThreatDistribution stats={stats}/></div>
            <div className="col-span-12 lg:col-span-4"><ThreatIntelTodayWidget /></div>
          </div>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-8"><TopDomainsWidget /></div>
            <div className="col-span-12 lg:col-span-4"><MilterHealthWidget /></div>
          </div>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12"><PluginSignalLogWidget /></div>
          </div>
        </div>
      )}

      {/* Geo tab */}
      {show("geo") && (
        <div className="space-y-5">
          <AttackMap onIpClick={setDrillIp}/>
          <CountryBlockCard/>
        </div>
      )}

      {/* Traffic tab */}
      {show("traffic") && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-8">
            <TrafficChart data={traffic.data}/>
          </div>
          <div className="col-span-12 lg:col-span-4">
            <TopIpsChart data={top.data} onIpClick={setDrillIp}/>
          </div>
        </div>
      )}

      {/* Quarantine tab */}
      {show("quarantine") && (
        <Card>
          <CardHeader title="Son Karantina" subtitle="Otomatik olarak izole edilen son mesajlar" />
          <CardBody className="p-0">
            <div className="divide-y divide-slate-800">
              {(quarantine.data || []).slice(0, 10).map((q) => (
                <div key={q.id} data-testid={`recent-q-${q.id}`} className="px-5 py-3 hover:bg-slate-800/40 transition-colors">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-100 truncate">{q.subject}</div>
                      <div className="text-[11px] mono text-slate-500 truncate">{q.sender}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {verdictBadge(q.verdict, t)}
                      <span className="mono text-[11px] text-slate-500">{q.score?.toFixed(1)}</span>
                    </div>
                  </div>
                </div>
              ))}
              {(quarantine.data?.length ?? 0) === 0 && (
                <div className="p-6 text-center text-sm text-slate-500">Karantinada mesaj yok</div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Health tab */}
      {show("health") && (
        <>
          <ResumeSessionCard />
          <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4"><HealthScore/></div>
          <div className="col-span-12 md:col-span-8"><MultiServerRibbon licenseKey={LICKEY()}/></div>
          <div className="col-span-12"><ComplianceSnapshot licenseKey={LICKEY()}/></div>
        </div>
        </>
      )}

      {/* Live tab */}
      {show("live") && <LiveMailEvents/>}

      {/* Module footer — Nasıl Çalışır / Teknik / Öneriler */}
      <ModuleFooter
        title="Dashboard — Ana Kontrol Paneli"
        howItWorks="7 tab'lı modern dashboard: canlı metrik kartları + interaktif Attack Map + trafiği + top IP drilldown + karantina özeti + sağlık skoru + canlı mail akışı. Tüm bölümler otomatik yenilenir (10-15sn peryot)."
        technical={[
          "Advanced Control Bar: 6 metrik kartı (queue, spam1h, wpm, engines, resellers, geo)",
          "Attack Map: react-simple-maps + offline TopoJSON",
          "IP Drilldown: bar tıklama → drawer + son 50 mail",
          "Queue Modal: exim -bpc/-Mrm/-M sarmalayıcı",
          "AI Predict: her ingest sonrası predicted_score + auto-quarantine",
        ]}
        recommendations={[
          "İlk kurulumda Onboarding Wizard'ı bitir (SMTP + brand)",
          "Coğrafi tab'ta brute-force auto-block'u aç",
          "AI Auto-Quarantine eşiğini 7.0 ile başlat",
          "Kritik trafik saatlerinde 'Kuyrukta Bekleyen' kartını canlı takip et",
        ]}
      />

      {/* Modals & drawers */}
      <QueueModal open={queueOpen} onClose={() => setQueueOpen(false)}/>
      {drillIp && <IpDrilldownDrawer ip={drillIp} onClose={() => setDrillIp(null)}/>}
    </div>
  );
}

function TrafficChart({ data }) {
  return (
    <Card>
      <CardHeader
        title="E-posta Trafiği"
        subtitle="Son 24 saatteki saatlik gelen posta hareketi"
        right={<div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><i className="inline-block w-2 h-2 bg-emerald-400 rounded-sm"/>Temiz</span>
          <span className="flex items-center gap-1.5"><i className="inline-block w-2 h-2 bg-amber-400 rounded-sm"/>Spam</span>
          <span className="flex items-center gap-1.5"><i className="inline-block w-2 h-2 bg-rose-500 rounded-sm"/>Tehdit</span>
        </div>}
      />
      <CardBody className="pt-2">
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <AreaChart data={data || []} margin={{ left: -10, right: 6, top: 6, bottom: 0 }}>
              <defs>
                <linearGradient id="ham" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35}/>
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="spam" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35}/>
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="threat" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.4}/>
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="hour" stroke="#475569" tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false} interval={2} />
              <YAxis stroke="#475569" tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, fontSize: 12 }}
                       labelStyle={{ color: "#94a3b8", fontFamily: "JetBrains Mono" }}
                       itemStyle={{ color: "#e2e8f0", fontFamily: "JetBrains Mono" }}/>
              <Area type="monotone" dataKey="ham"   stroke="#10b981" fill="url(#ham)"    strokeWidth={1.75}/>
              <Area type="monotone" dataKey="spam"  stroke="#f59e0b" fill="url(#spam)"   strokeWidth={1.75}/>
              <Area type="monotone" dataKey="phish" stroke="#f43f5e" fill="url(#threat)" strokeWidth={1.75}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}

function TopIpsChart({ data, onIpClick }) {
  return (
    <Card className="h-full">
      <CardHeader title="En Çok Şüpheli Gönderici IP'leri" subtitle="Tıkla → IP detay drawer"/>
      <CardBody>
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <BarChart
              data={data || []} layout="vertical" margin={{ left: 6, right: 20 }}
              onClick={(ev) => {
                const ip = ev?.activePayload?.[0]?.payload?.ip;
                if (ip) onIpClick?.(ip);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false}/>
              <XAxis type="number" stroke="#475569" tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false}/>
              <YAxis dataKey="ip" type="category" width={130} stroke="#475569" tick={{ fontSize: 11, fontFamily: "JetBrains Mono", cursor: "pointer" }} tickLine={false} axisLine={false}/>
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, fontSize: 12 }}
                       cursor={{ fill: "rgba(99,102,241,0.08)" }}
                       formatter={(val) => [`${val} mail`, "adet"]}
                       labelFormatter={(ip) => `IP: ${ip} · tıkla → detay drawer`}/>
              <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} cursor="pointer"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}

function ThreatDistribution({ stats }) {
  return (
    <Card>
      <CardHeader title="Tehdit Dağılımı" subtitle="Karantina verdict dökümü"/>
      <CardBody>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Yüksek Spam", key: "high_spam_count", tone: "danger", icon: Ban },
            { label: "Phishing", key: "phishing_count", tone: "warning", icon: MailWarning },
            { label: "Virüs", key: "virus_count", tone: "danger", icon: Bug },
          ].map((row) => {
            const v = stats[row.key] ?? 0;
            const total = Math.max(1, stats.quarantine_total || 1);
            const pct = Math.round((v / total) * 100);
            return (
              <div key={row.key}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <row.icon className="w-3.5 h-3.5 text-slate-500"/> {row.label}
                  </div>
                  <div className="mono text-xs text-slate-400">
                    {nfmt(v)} <span className="text-slate-600">/ %{pct}</span>
                  </div>
                </div>
                <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
                  <div className={`h-full ${row.tone === "danger" ? "bg-rose-500" : "bg-amber-400"}`}
                       style={{ width: `${pct}%` }}/>
                </div>
              </div>
            );
          })}
        </div>
        <div className="pt-3 mt-3 border-t border-slate-800 text-xs text-slate-500">
          Otomatik yenileme: <span className="mono text-slate-400">15s</span> ·
          Toplam taranan: <span className="mono text-slate-300">{nfmt(stats.scanned_today)}</span>
        </div>
      </CardBody>
    </Card>
  );
}


// v43.30 — Dashboard Top Domains Widget
function TopDomainsWidget() {
  const q = useQuery({
    queryKey: ["dashboard-top-domains"],
    queryFn: () => api.dashboardTopDomains(5),
    refetchInterval: 30000,
  });
  const items = q.data?.items || [];
  return (
    <Card data-testid="top-domains-widget">
      <CardHeader
        title="🌐 En Aktif Alan Adları"
        subtitle="Son 24 saatte en çok mail trafiği + spam oranı"
        right={<Badge tone="info">Top 5</Badge>}
      />
      <CardBody>
        {q.isLoading && <div className="py-8 text-center text-slate-500 text-sm">Yükleniyor…</div>}
        {!q.isLoading && items.length === 0 && (
          <div className="py-8 text-center text-slate-500 text-sm">Son 24 saatte trafik yok</div>
        )}
        {items.length > 0 && (
          <div className="space-y-2">
            {(() => {
              const max = Math.max(...items.map(i => i.total), 1);
              return items.map((d, i) => {
                const pct = (d.total / max) * 100;
                const spamPct = d.total ? (d.spam / d.total) * 100 : 0;
                const tone = spamPct > 30 ? "bg-rose-500" : spamPct > 15 ? "bg-amber-500" : "bg-emerald-500";
                return (
                  <div key={d.domain} data-testid={`top-domain-${i}`} className="group">
                    <div className="flex items-center justify-between mb-1 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="mono text-[10px] text-slate-600 w-4">{i + 1}.</span>
                        <span className="mono text-slate-200 font-semibold">{d.domain}</span>
                        {d.outbound > 0 && (
                          <span className="text-[9px] uppercase tracking-widest text-cyan-400 mono px-1 rounded bg-cyan-500/10">
                            ↗ {d.outbound} giden
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mono">
                        <span className="text-slate-300">{d.total}</span>
                        <span className={spamPct > 30 ? "text-rose-400" : spamPct > 15 ? "text-amber-400" : "text-emerald-400"}>
                          %{d.spam_rate} spam
                        </span>
                      </div>
                    </div>
                    <div className="relative h-2 bg-slate-800/60 rounded-full overflow-hidden">
                      <div className={`absolute inset-y-0 left-0 ${tone} rounded-full transition-all duration-500 group-hover:brightness-125`}
                           style={{ width: `${pct}%` }}
                      />
                      {/* Spam kırmızı katman (üstte) */}
                      {d.spam > 0 && (
                        <div className="absolute inset-y-0 left-0 bg-rose-500/70"
                             style={{ width: `${(d.spam / max) * 100}%` }}
                        />
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// v43.32 — Milter Health Widget
function MilterHealthWidget() {
  const q = useQuery({
    queryKey: ["milter-health"],
    queryFn: api.pluginMilterHealth,
    refetchInterval: 30000,
  });
  const [resetting, setResetting] = useState(false);
  const d = q.data || {};
  const status = d.status || "unknown";
  const meta = {
    healthy:  { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-300", label: "AKTİF", icon: "✅" },
    warning:  { bg: "bg-amber-500/10",   border: "border-amber-500/40",   text: "text-amber-300",   label: "GECİKMELİ", icon: "⚠" },
    down:     { bg: "bg-rose-500/10",    border: "border-rose-500/40",    text: "text-rose-300",    label: "DURUYOR", icon: "✕" },
    no_data:  { bg: "bg-slate-800",      border: "border-slate-700",     text: "text-slate-400",   label: "VERİ YOK", icon: "?" },
    unknown:  { bg: "bg-slate-800",      border: "border-slate-700",     text: "text-slate-400",   label: "?", icon: "?" },
  }[status];
  const doReset = async () => {
    if (!window.confirm("Bayi WHM sunucularında 'systemctl restart gws-milter' çalıştırılsın mı?")) return;
    setResetting(true);
    try {
      const r = await import("sonner").then(m => m.toast);
      const d = await api.pluginMilterReset();
      r.success(`${d.signaled} bayi milter'ına restart sinyali gönderildi`);
      setTimeout(() => q.refetch(), 3000);
    } catch (e) {
      const t = await import("sonner").then(m => m.toast);
      t.error(e?.response?.data?.detail || e.message);
    } finally { setResetting(false); }
  };
  return (
    <Card data-testid="milter-health-widget">
      <CardHeader title="🛡️ Milter Sağlığı" subtitle="Logtail/Milter ingest izleme" right={
        <span className={`text-[10px] mono uppercase tracking-widest px-2 py-1 rounded ${meta.bg} ${meta.border} ${meta.text} border`}>
          {meta.icon} {meta.label}
        </span>
      }/>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded bg-slate-950/60 border border-slate-800">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Son 1 saat</div>
            <div className="text-xl font-bold mono text-indigo-300">{d.ingest_last_1h ?? "—"}</div>
          </div>
          <div className="p-2 rounded bg-slate-950/60 border border-slate-800">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Son 24 saat</div>
            <div className="text-xl font-bold mono text-cyan-300">{d.ingest_last_24h ?? "—"}</div>
          </div>
        </div>
        <div className="text-xs text-slate-400">
          Son ingest: <span className={`mono font-semibold ${meta.text}`}>
            {d.minutes_since_last_ingest != null
              ? (d.minutes_since_last_ingest < 60
                  ? `${d.minutes_since_last_ingest} dk önce`
                  : `${Math.floor(d.minutes_since_last_ingest / 60)} sa ${d.minutes_since_last_ingest % 60} dk önce`)
              : "yok"}
          </span>
        </div>
        {(status === "down" || status === "no_data" || status === "warning") && (
          <button
            onClick={doReset}
            disabled={resetting}
            data-testid="milter-reset-btn"
            className="w-full text-xs px-3 py-2 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
          >
            {resetting ? "Sinyal gönderiliyor…" : "🔄 Milter'ı Yeniden Başlat"}
          </button>
        )}
      </CardBody>
    </Card>
  );
}


// v43.33 — Plugin Signal Log Widget
function PluginSignalLogWidget() {
  const q = useQuery({
    queryKey: ["plugin-signal-log"],
    queryFn: () => api.pluginSignalLog(20),
    refetchInterval: 20000,
  });
  const items = q.data?.items || [];
  const typeIcons = {
    sync: "🔄", update: "⬇", milter_restart: "🛡", bayes_train: "🧠", unknown: "❓"
  };
  const typeLabels = {
    sync: "cPanel Sync", update: "gws-update", milter_restart: "Milter Restart", bayes_train: "Bayes Train"
  };
  return (
    <Card data-testid="signal-log-widget">
      <CardHeader
        title="📡 Plugin Sinyal Kayıtları"
        subtitle="Son 20 plugin sinyali — master'dan bayilere gönderilen komutlar ve durumları"
        right={<Badge tone="info">{items.length}</Badge>}
      />
      <CardBody>
        {q.isLoading && <div className="py-6 text-center text-slate-500 text-sm">Yükleniyor…</div>}
        {items.length === 0 && !q.isLoading && (
          <div className="py-6 text-center text-slate-500 text-sm">Henüz sinyal gönderilmedi</div>
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                <tr>
                  <th className="text-left px-3 py-2">Tür</th>
                  <th className="text-left px-3 py-2">Bayi</th>
                  <th className="text-left px-3 py-2">İstek Zamanı</th>
                  <th className="text-left px-3 py-2">Kaynak</th>
                  <th className="text-right px-3 py-2">Durum</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s, i) => (
                  <tr key={i} data-testid={`signal-row-${i}`} className="border-b border-slate-800 hover:bg-slate-800/30">
                    <td className="px-3 py-2">
                      <span className="mr-1">{typeIcons[s.signal_type] || typeIcons.unknown}</span>
                      <span className="text-slate-300">{typeLabels[s.signal_type] || s.signal_type}</span>
                    </td>
                    <td className="px-3 py-2 mono text-slate-400 text-[11px]">
                      {s.hostname || s.license_key?.slice(0, 12) + "…"}
                    </td>
                    <td className="px-3 py-2 mono text-slate-500 text-[11px]">
                      {s.requested_at ? new Date(s.requested_at).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded ${
                        s.requested_by === "master_ui" ? "bg-indigo-500/15 text-indigo-300"
                        : s.requested_by === "auto_reset_watcher" ? "bg-rose-500/15 text-rose-300"
                        : "bg-slate-800 text-slate-500"
                      }`}>{s.requested_by || "system"}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.handled ? (
                        <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" title={s.handled_at}>
                          ✓ İşlendi
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse">
                          ⏳ Bekliyor
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

