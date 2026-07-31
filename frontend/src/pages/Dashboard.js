import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar,
} from "recharts";
import { ShieldAlert, Ban, Bug, MailWarning, MailCheck, Activity } from "lucide-react";
import { Card, CardBody, CardHeader, StatCard, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useT } from "@/i18n";
import LiveMailEvents from "@/components/LiveMailEvents";

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

function verdictBadge(v, t) {
  const m = {
    spam: { tone: "warning", label: t("dashboard.spam") },
    high_spam: { tone: "danger", label: t("dashboard.high_spam") },
    virus: { tone: "danger", label: t("dashboard.virus") },
    phish: { tone: "danger", label: t("dashboard.phishing") },
  }[v] || { tone: "default", label: v };
  return <Badge tone={m.tone}>{String(m.label).toUpperCase()}</Badge>;
}

export default function Dashboard() {
  const t = useT();
  const overview = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 15000 });
  const traffic = useQuery({ queryKey: ["traffic"], queryFn: () => api.traffic(24), refetchInterval: 30000 });
  const top = useQuery({ queryKey: ["top-senders"], queryFn: api.topSenders });
  const quarantine = useQuery({ queryKey: ["q-recent"], queryFn: () => api.quarantine({ limit: 6 }) });

  const stats = overview.data || {};

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 md:col-span-3">
          <StatCard label={t("dashboard.scanned_today")} tone="info" icon={Activity} testid="stat-scanned"
                    value={nfmt(stats.scanned_today)}
                    hint="son 24 saat" />
        </div>
        <div className="col-span-12 md:col-span-3">
          <StatCard label={t("dashboard.caught_spam")} tone="warning" icon={MailWarning} testid="stat-caught"
                    value={nfmt(stats.caught_today)}
                    hint={`% ${stats.spam_ratio ?? 0} oranı`} />
        </div>
        <div className="col-span-12 md:col-span-3">
          <StatCard label={t("dashboard.in_quarantine")} tone="danger" icon={ShieldAlert} testid="stat-quarantine"
                    value={nfmt(stats.quarantine_total)}
                    hint={`${stats.phishing_count ?? 0} phishing · ${stats.virus_count ?? 0} virüs`} />
        </div>
        <div className="col-span-12 md:col-span-3">
          <StatCard label={t("dashboard.clean_delivered")} tone="success" icon={MailCheck} testid="stat-ham"
                    value={nfmt(stats.ham_today)}
                    hint={`${stats.engines_active}/${stats.engines_total} motor aktif`} />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8">
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
                  <AreaChart data={traffic.data || []} margin={{ left: -10, right: 6, top: 6, bottom: 0 }}>
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
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, fontSize: 12 }}
                      labelStyle={{ color: "#94a3b8", fontFamily: "JetBrains Mono" }}
                      itemStyle={{ color: "#e2e8f0", fontFamily: "JetBrains Mono" }}
                    />
                    <Area type="monotone" dataKey="ham" stroke="#10b981" fill="url(#ham)" strokeWidth={1.75} />
                    <Area type="monotone" dataKey="spam" stroke="#f59e0b" fill="url(#spam)" strokeWidth={1.75} />
                    <Area type="monotone" dataKey="phish" stroke="#f43f5e" fill="url(#threat)" strokeWidth={1.75} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="col-span-12 lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="Son Karantina" subtitle="Otomatik olarak izole edilen son mesajlar" />
            <CardBody className="p-0">
              <div className="divide-y divide-slate-800">
                {(quarantine.data || []).slice(0, 6).map((q) => (
                  <div key={q.id} data-testid={`recent-q-${q.id}`} className="px-5 py-3 hover:bg-slate-800/40 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-slate-100 truncate">{q.subject}</div>
                        <div className="text-[11px] mono text-slate-500 truncate">{q.sender}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {verdictBadge(q.verdict, t)}
                        <span className="mono text-[11px] text-slate-500">{q.score.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {quarantine.data?.length === 0 && (
                  <div className="p-6 text-center text-sm text-slate-500">Karantinada mesaj yok</div>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7">
          <Card>
            <CardHeader title="En Çok Şüpheli Gönderici IP'leri" subtitle="Karantinada en sık görülen kaynaklar" />
            <CardBody>
              <div className="h-64 w-full">
                <ResponsiveContainer>
                  <BarChart data={top.data || []} layout="vertical" margin={{ left: 6, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                    <XAxis type="number" stroke="#475569" tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false} />
                    <YAxis dataKey="ip" type="category" width={130} stroke="#475569" tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, fontSize: 12 }}
                      cursor={{ fill: "rgba(99,102,241,0.08)" }}
                    />
                    <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>
        </div>
        <div className="col-span-12 lg:col-span-5">
          <Card className="h-full">
            <CardHeader title="Tehdit Dağılımı" subtitle="Karantina verdict dökümü" />
            <CardBody>
              <div className="space-y-3">
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
                          <row.icon className="w-3.5 h-3.5 text-slate-500" /> {row.label}
                        </div>
                        <div className="mono text-xs text-slate-400">
                          {nfmt(v)} <span className="text-slate-600">/ %{pct}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full ${row.tone === "danger" ? "bg-rose-500" : "bg-amber-400"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                <div className="pt-3 mt-3 border-t border-slate-800 text-xs text-slate-500">
                  Otomatik yenileme: <span className="mono text-slate-400">15s</span> · Toplam
                  taranan: <span className="mono text-slate-300">{nfmt(stats.scanned_today)}</span>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* --- SaaS Canli Mail Trafigi (milter -> POST /api/events/ingest) --- */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12">
          <LiveMailEvents />
        </div>
      </div>
    </div>
  );
}
