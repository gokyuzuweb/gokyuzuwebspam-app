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
import HealthScore from "@/components/HealthScore";
import ComplianceSnapshot from "@/components/ComplianceSnapshot";
import OnboardingWizard from "@/components/OnboardingWizard";
import ControlBar from "@/components/ControlBar";
import AttackMap from "@/components/AttackMap";
import QueueModal from "@/components/QueueModal";
import IpDrilldownDrawer from "@/components/IpDrilldownDrawer";
import CountryBlockCard from "@/components/CountryBlockCard";

const LICKEY = () => (typeof window !== "undefined"
  ? (localStorage.getItem("gws.event_license") || "MS-C02AB012652A4FE692D69676")
  : "MS-C02AB012652A4FE692D69676");
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
          <ThreatDistribution stats={stats}/>
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
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4"><HealthScore/></div>
          <div className="col-span-12 md:col-span-8"><MultiServerRibbon licenseKey={LICKEY()}/></div>
          <div className="col-span-12"><ComplianceSnapshot licenseKey={LICKEY()}/></div>
        </div>
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
