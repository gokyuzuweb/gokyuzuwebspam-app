/**
 * VerdictStatsWidget — v44.00.16
 * Master paneline "Son N saat CLEAN/SPAM/HIGH oranı" pie chart +
 * Whitelist/Blacklist yönetim formu + Ham patterns listesi.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Shield, Ban, CheckCircle2, Trash2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const COLORS = { clean: "#10b981", spam: "#f59e0b", high_spam: "#ef4444" };
const RANGES = [6, 24, 72, 168, 720];

export default function VerdictStatsWidget() {
  const [hours, setHours] = useState(24);
  const [tab, setTab] = useState("chart"); // chart | whitelist | ham
  const qc = useQueryClient();

  const stats = useQuery({
    queryKey: ["verdict-stats", hours],
    queryFn: () => api.verdictStats(hours),
    refetchInterval: 30_000,
  });
  const domains = useQuery({
    queryKey: ["trusted-domains"],
    queryFn: () => api.trustedDomainsList(),
    enabled: tab === "whitelist",
  });
  const hams = useQuery({
    queryKey: ["ham-patterns"],
    queryFn: () => api.hamPatternsList(),
    enabled: tab === "ham",
  });

  const d = stats.data;
  const chartData = d ? [
    { name: "CLEAN",     value: d.clean.count,     key: "clean" },
    { name: "SPAM",      value: d.spam.count,      key: "spam" },
    { name: "HIGH SPAM", value: d.high_spam.count, key: "high_spam" },
  ].filter(x => x.value > 0) : [];

  return (
    <Card data-testid="verdict-stats-widget">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-indigo-300" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">Panel Verdict</div>
            <div className="text-[11px] text-slate-500">Motor kararları + whitelist yönetimi</div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          {["chart", "whitelist", "ham"].map(t => (
            <button key={t} onClick={() => setTab(t)} data-testid={`verdict-tab-${t}`}
              className={`px-2 py-1 rounded font-mono border ${tab === t
                ? "border-indigo-500/50 bg-indigo-500/20 text-indigo-200"
                : "border-slate-700 bg-slate-800/50 text-slate-500 hover:text-slate-300"}`}>
              {t === "chart" ? "Grafik" : t === "whitelist" ? "Liste" : "Öğren"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {tab === "chart" && (
          <>
            <div className="flex items-center gap-1 text-[10px] mb-3">
              {RANGES.map(h => (
                <button key={h} onClick={() => setHours(h)} data-testid={`vs-range-${h}`}
                  className={`px-2 py-1 rounded font-mono ${hours === h
                    ? "bg-indigo-500/25 text-indigo-100" : "text-slate-500 hover:text-slate-300"}`}>
                  {h < 24 ? `${h}sa` : h === 720 ? "30g" : `${h/24}g`}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3 text-center">
              <StatBox label="CLEAN"     value={d?.clean?.count ?? 0}     pct={d?.clean_pct ?? 0}     color="emerald" />
              <StatBox label="SPAM"      value={d?.spam?.count ?? 0}      pct={d?.spam_pct ?? 0}      color="amber" />
              <StatBox label="HIGH SPAM" value={d?.high_spam?.count ?? 0} pct={d?.high_spam_pct ?? 0} color="rose" />
            </div>
            <div className="h-48">
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  Bu aralıkta veri yok
                </div>
              ) : (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={chartData} innerRadius={40} outerRadius={70} dataKey="value" stroke="none">
                      {chartData.map((e, i) => <Cell key={i} fill={COLORS[e.key]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 11 }} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </>
        )}

        {tab === "whitelist" && (
          <TrustedDomainsPanel data={domains.data} onChanged={() => qc.invalidateQueries(["trusted-domains"])} />
        )}

        {tab === "ham" && (
          <HamPatternsPanel data={hams.data} onChanged={() => qc.invalidateQueries(["ham-patterns"])} />
        )}
      </div>
    </Card>
  );
}

function StatBox({ label, value, pct, color }) {
  const map = {
    emerald: "border-emerald-500/25 bg-emerald-500/5 text-emerald-300",
    amber:   "border-amber-500/25 bg-amber-500/5 text-amber-300",
    rose:    "border-rose-500/25 bg-rose-500/5 text-rose-300",
  };
  return (
    <div className={`rounded-lg border p-2 ${map[color]}`}>
      <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="text-lg font-bold mono">{value}</div>
      <div className="text-[10px] opacity-60">{pct}%</div>
    </div>
  );
}

function TrustedDomainsPanel({ data, onChanged }) {
  const [domain, setDomain] = useState("");
  const [kind, setKind] = useState("whitelist");
  const add = useMutation({
    mutationFn: () => api.trustedDomainAdd({ domain, kind }),
    onSuccess: () => { toast.success(`${kind === "whitelist" ? "Whitelist" : "Blacklist"}'e eklendi: ${domain}`); setDomain(""); onChanged(); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Eklenemedi"),
  });
  const del = useMutation({
    mutationFn: (d) => api.trustedDomainDelete(d),
    onSuccess: () => { toast.success("Silindi"); onChanged(); },
  });
  const items = data?.items || [];
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={domain} onChange={(e) => setDomain(e.target.value)}
          placeholder="ornek.com" data-testid="wl-domain-input"
          className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs mono focus:border-indigo-500 focus:outline-none" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="wl-kind-select"
          className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs">
          <option value="whitelist">Whitelist</option>
          <option value="blacklist">Blacklist</option>
        </select>
        <button onClick={() => domain && add.mutate()} disabled={!domain || add.isPending}
          data-testid="wl-add-btn"
          className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" /> Ekle
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto space-y-1">
        {items.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-4">Henüz kayıt yok</div>
        ) : items.map((r) => (
          <div key={r.domain} data-testid={`wl-row-${r.domain}`}
            className={`flex items-center gap-2 rounded-md border p-2 text-xs ${
              r.kind === "whitelist" ? "border-emerald-500/25 bg-emerald-500/5" : "border-rose-500/25 bg-rose-500/5"}`}>
            {r.kind === "whitelist"
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              : <Ban className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
            <span className="flex-1 mono">{r.domain}</span>
            <span className="text-[10px] text-slate-500">{r.note || r.kind}</span>
            <button onClick={() => del.mutate(r.domain)} className="text-slate-500 hover:text-rose-400"
              data-testid={`wl-del-${r.domain}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function HamPatternsPanel({ data, onChanged }) {
  const del = useMutation({
    mutationFn: (p) => api.hamPatternDelete(p),
    onSuccess: () => { toast.success("Silindi"); onChanged(); },
  });
  const items = data?.items || [];
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-slate-500 mb-2">
        <Shield className="w-3.5 h-3.5 inline mr-1" />
        Bayes öğrenmesi: kullanıcı Junk'tan Inbox'a taşıdığı mail'lerin konu pattern'leri buraya kaydedilir.
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {items.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-4">Henüz öğrenilmiş pattern yok</div>
        ) : items.map((p) => (
          <div key={p.pattern} data-testid={`ham-row-${p.pattern}`}
            className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/40 p-2 text-xs">
            <span className="flex-1 mono truncate">{p.pattern}</span>
            <span className="text-[10px] text-slate-500 mono">×{p.hit_count || 1}</span>
            <span className="text-[10px] text-slate-600">{p.source}</span>
            <button onClick={() => del.mutate(p.pattern)} className="text-slate-500 hover:text-rose-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
