import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { Bell, Plus, Trash2, Slack, MessageSquare, Zap, ExternalLink, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

const KIND_LABEL = {
  rate_from_sender: "Aynı gönderenden yoğun trafik",
  rate_high_spam:   "Toplam spam artışı",
  single_virus:     "Tek virüs olayı",
};
const KIND_HINT = {
  rate_from_sender: "Belirli bir gönderen X dakikada N mail geçerse tetiklenir",
  rate_high_spam:   "X dakikada toplam N spam yakalanırsa tetiklenir",
  single_virus:     "Bir virüs yakalanınca anında tetiklenir (threshold önemsiz)",
};
const KIND_COLOR = {
  slack:   { icon: Slack,         cls: "text-emerald-400" },
  discord: { icon: MessageSquare, cls: "text-indigo-400" },
  generic: { icon: Zap,           cls: "text-amber-400" },
};

function timeAgo(iso) {
  if (!iso) return "-";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}sn`;
  if (s < 3600) return `${Math.floor(s / 60)}dk`;
  if (s < 86400) return `${Math.floor(s / 3600)}sa`;
  return `${Math.floor(s / 86400)}g`;
}

function RuleForm({ licenseKey, initial, onDone }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => initial || {
    name: "",
    kind: "rate_from_sender",
    threshold: 10,
    window_min: 5,
    webhook_kind: "slack",
    webhook_url: "",
    enabled: true,
  });
  const save = useMutation({
    mutationFn: (p) => api.alertsRuleUpsert(licenseKey, p),
    onSuccess: () => { toast.success(initial ? "Kural güncellendi" : "Kural eklendi");
      qc.invalidateQueries({ queryKey: ["alerts-rules", licenseKey] }); onDone(); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kayıt hatası"),
  });
  return (
    <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 space-y-3">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 md:col-span-5">
          <label className="text-[11px] text-slate-500 mb-1 block">Kural Adı</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                 placeholder="Örn: Yoğun spam saldırısı"
                 className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100"
                 data-testid="alert-rule-name" />
        </div>
        <div className="col-span-12 md:col-span-4">
          <label className="text-[11px] text-slate-500 mb-1 block">Tetikleyici</label>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100"
                  data-testid="alert-rule-kind">
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="text-[10px] text-slate-500 mt-1">{KIND_HINT[form.kind]}</div>
        </div>
        <div className="col-span-6 md:col-span-1.5">
          <label className="text-[11px] text-slate-500 mb-1 block">Eşik</label>
          <input type="number" min="1" value={form.threshold}
                 onChange={(e) => setForm({ ...form, threshold: parseInt(e.target.value) || 1 })}
                 className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono text-right text-slate-100" />
        </div>
        <div className="col-span-6 md:col-span-1.5">
          <label className="text-[11px] text-slate-500 mb-1 block">Pencere (dk)</label>
          <input type="number" min="1" max="1440" value={form.window_min}
                 onChange={(e) => setForm({ ...form, window_min: parseInt(e.target.value) || 5 })}
                 className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono text-right text-slate-100" />
        </div>
      </div>
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 md:col-span-3">
          <label className="text-[11px] text-slate-500 mb-1 block">Webhook Tipi</label>
          <select value={form.webhook_kind} onChange={(e) => setForm({ ...form, webhook_kind: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100"
                  data-testid="alert-rule-webhook-kind">
            <option value="slack">Slack</option>
            <option value="discord">Discord</option>
            <option value="generic">Generic JSON</option>
          </select>
        </div>
        <div className="col-span-12 md:col-span-9">
          <label className="text-[11px] text-slate-500 mb-1 block">Webhook URL</label>
          <input value={form.webhook_url} onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
                 placeholder="https://hooks.slack.com/services/... veya https://discord.com/api/webhooks/..."
                 className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100 mono"
                 data-testid="alert-rule-webhook-url" />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
        <button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name || !form.webhook_url}
                className="px-4 py-1.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-50 text-sm inline-flex items-center gap-1.5"
                data-testid="alert-rule-save">
          <Plus className="w-3.5 h-3.5" /> {initial ? "Güncelle" : "Ekle"}
        </button>
        <button
          onClick={async () => {
            if (!form.webhook_url) return toast.error("Webhook URL girin");
            try {
              const r = await api.alertsTestWebhook(licenseKey, form.webhook_url, form.webhook_kind);
              toast.success(r.message || "Test webhook gönderildi");
            } catch (e) {
              toast.error(e?.response?.data?.detail || "Webhook başarısız");
            }
          }}
          disabled={!form.webhook_url}
          className="px-3 py-1.5 rounded bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 disabled:opacity-40 text-sm inline-flex items-center gap-1.5"
          data-testid="alert-rule-test-webhook"
          title="Kural kaydetmeden webhook'un çalıştığını doğrula"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Test Gönder
        </button>
        <button onClick={onDone} className="px-3 py-1.5 rounded text-slate-400 hover:text-slate-200 text-sm">İptal</button>
      </div>
    </div>
  );
}

export default function AlertsRules() {
  const [licenseKey, setLicenseKey] = useState(() =>
    localStorage.getItem("gws.event_license") || "MS-C02AB012652A4FE692D69676"
  );
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const rules  = useQuery({
    queryKey: ["alerts-rules", licenseKey],
    queryFn: () => api.alertsRules(licenseKey),
    refetchInterval: 30000, retry: false,
  });
  const recent = useQuery({
    queryKey: ["alerts-recent", licenseKey],
    queryFn: () => api.alertsRecent(licenseKey, 20),
    refetchInterval: 10000, retry: false,
  });

  const del = useMutation({
    mutationFn: (id) => api.alertsRuleDelete(licenseKey, id),
    onSuccess: () => { toast.success("Kural silindi");
      qc.invalidateQueries({ queryKey: ["alerts-rules", licenseKey] }); },
  });

  const timeline = useQuery({
    queryKey: ["alerts-timeline", licenseKey],
    queryFn: () => api.alertsTimeline(licenseKey),
    refetchInterval: 60000, retry: false,
  });

  // Transform timeline into chart-ready rows. Backfill 7 days with zero rows so bars
  // are always visible even when no alerts.
  const chartRows = (() => {
    const items = timeline.data?.items || [];
    const byDay = Object.fromEntries(items.map(i => [i.day, i]));
    const ruleSet = new Set();
    items.forEach(i => Object.keys(i.rules || {}).forEach(r => ruleSet.add(r)));
    const rules = Array.from(ruleSet);
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const row = { day: key.slice(5), total: byDay[key]?.total || 0 };
      rules.forEach(r => { row[r] = byDay[key]?.rules?.[r] || 0; });
      out.push(row);
    }
    return { rows: out, rules };
  })();
  const barColors = ["#6366f1", "#f59e0b", "#ef4444", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6"];

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Bell className="w-4 h-4 text-indigo-400" /> Alert Kuralları</span>}
          subtitle="Spam saldırılarını Slack/Discord'a anlık bildir · Rate-based + virüs tetikleyiciler"
          right={
            <button onClick={() => setCreating(v => !v)}
                    className="text-xs px-3 py-1.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 inline-flex items-center gap-1.5"
                    data-testid="alerts-new-rule-btn">
              <Plus className="w-3.5 h-3.5" /> Yeni Kural
            </button>
          }
        />
        <CardBody className="space-y-3">
          {creating && <RuleForm licenseKey={licenseKey} onDone={() => setCreating(false)} />}
          {(rules.data?.items || []).length === 0 && !creating && (
            <div className="text-center text-slate-500 text-sm py-6" data-testid="alerts-rules-empty">
              Henüz kural yok. <button onClick={() => setCreating(true)} className="text-indigo-400 underline">İlk kuralı oluştur</button>
            </div>
          )}
          {(rules.data?.items || []).map((r) => {
            const WH = KIND_COLOR[r.webhook_kind] || KIND_COLOR.generic;
            const WHIcon = WH.icon;
            return (
              <div key={r.id} className="p-3 rounded border border-slate-800 bg-slate-900/40 flex items-start justify-between gap-3"
                   data-testid={`alerts-rule-${r.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${r.enabled ? "bg-emerald-400" : "bg-slate-600"}`}></span>
                    <span className="text-slate-100 font-medium">{r.name}</span>
                    <Badge tone="info">{KIND_LABEL[r.kind]}</Badge>
                  </div>
                  <div className="text-xs text-slate-400">
                    Eşik: <span className="mono text-slate-200">{r.threshold}</span> · Pencere: <span className="mono text-slate-200">{r.window_min}dk</span>
                    <span className="mx-2">·</span>
                    <span className={`inline-flex items-center gap-1 ${WH.cls}`}>
                      <WHIcon className="w-3 h-3" /> {r.webhook_kind}
                    </span>
                  </div>
                  <div className="mono text-[10px] text-slate-600 truncate mt-1">{r.webhook_url}</div>
                </div>
                <button onClick={() => { if (confirm("Kuralı sil?")) del.mutate(r.id); }}
                        className="text-slate-500 hover:text-rose-400"
                        data-testid={`alerts-rule-delete-${r.id}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card data-testid="alerts-timeline-card">
        <CardHeader
          title={<span className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-indigo-400" /> Alarm Grafiği · Son 7 Gün</span>}
          subtitle={
            chartRows.rules.length
              ? `${chartRows.rules.length} farklı kural — kural bazında yığılmış`
              : "Kural bazında yığılmış — henüz veri yok"
          }
        />
        <CardBody>
          <div className="h-56 w-full">
            <ResponsiveContainer>
              <BarChart data={chartRows.rows} margin={{ top: 8, right: 16, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" fontSize={11} tick={{ fill: "#94a3b8" }} />
                <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} tick={{ fill: "#94a3b8" }} />
                <Tooltip
                  contentStyle={{ background: "#0f172a", border: "1px solid #334155",
                                  borderRadius: 6, fontSize: 12 }}
                  labelStyle={{ color: "#e2e8f0" }}
                />
                {chartRows.rules.length ? (
                  <>
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {chartRows.rules.map((r, i) => (
                      <Bar key={r} dataKey={r} stackId="alerts"
                           fill={barColors[i % barColors.length]}
                           radius={i === chartRows.rules.length - 1 ? [4, 4, 0, 0] : 0} />
                    ))}
                  </>
                ) : (
                  <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {chartRows.rows.every(r => r.total === 0) && (
            <div className="text-center text-xs text-slate-500 mt-2" data-testid="alerts-timeline-empty">
              Son 7 gün içinde tetiklenen alarm yok — kurallarınız sessiz çalışıyor ✓
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" /> Son Tetiklenen Alarmlar</span>}
          subtitle={`${recent.data?.count || 0} kayıt — her 10sn'de otomatik yenilenir`}
        />
        <CardBody>
          {(recent.data?.items || []).length === 0 ? (
            <div className="text-center text-slate-500 text-sm py-6" data-testid="alerts-recent-empty">
              Henüz tetiklenmiş alarm yok
            </div>
          ) : (
            <div className="space-y-2">
              {(recent.data?.items || []).map((a) => (
                <div key={a.id} className="p-3 rounded border border-slate-800 bg-slate-900/40" data-testid={`alert-${a.id}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-100 text-sm font-medium">{a.rule_name}</span>
                      <Badge tone={a.webhook_status === "ok" ? "success" : "warning"}>
                        {a.webhook_status || "pending"}
                      </Badge>
                    </div>
                    <span className="text-xs text-slate-500 mono">{timeAgo(a.fired_at)} önce</span>
                  </div>
                  <div className="text-xs text-slate-300">{a.reason}</div>
                  {a.sample_event && (
                    <div className="text-[10px] text-slate-500 mono mt-1">
                      {a.sample_event.from_addr} → {a.sample_event.to_addr} · {a.sample_event.verdict}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
