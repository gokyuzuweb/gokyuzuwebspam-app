import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Bell, Send, MessageSquare, Zap, Mail, Server, ShieldAlert, Mails, Inbox, Skull, CheckCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api, client } from "@/lib/api";
import { useT } from "@/i18n";
import SmtpSettings from "@/components/SmtpSettings";

// v44.00.26 — Kritik Alarmlar Kutusu (DMARC saldırıları vb.)
function NotificationInboxPanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all"); // all | dmarc_attack | unread
  const list = useQuery({
    queryKey: ["notif-inbox", filter],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: "50" });
      if (filter === "unread") p.set("unread_only", "true");
      else if (filter !== "all") p.set("kind", filter);
      return (await client.get(`/notifications/inbox?${p.toString()}`)).data;
    },
    refetchInterval: 30000,
  });
  const markRead = useMutation({
    mutationFn: (id) => client.post(`/notifications/inbox/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notif-inbox"] }),
  });
  const markAll = useMutation({
    mutationFn: (kind) => client.post(`/notifications/inbox/read-all${kind ? `?kind=${kind}` : ""}`),
    onSuccess: (r) => {
      toast.success(`${r.data.marked} bildirim okundu`);
      qc.invalidateQueries({ queryKey: ["notif-inbox"] });
    },
  });
  const items = list.data?.items || [];
  const unread = list.data?.unread || 0;
  const kinds = list.data?.kinds || {};
  const dmarcCount = kinds.dmarc_attack || 0;

  const iconFor = (kind) => {
    if (kind === "dmarc_attack") return <Skull className="w-4 h-4 text-rose-400" />;
    if (kind === "attack") return <Zap className="w-4 h-4 text-amber-400" />;
    if (kind === "bounce_digest") return <Mail className="w-4 h-4 text-cyan-400" />;
    return <Bell className="w-4 h-4 text-slate-400" />;
  };
  const styleFor = (n) => {
    const kind = n.kind;
    if (kind === "dmarc_attack") {
      const highSev = n.severity === "high" || (n.meta?.fail_pct >= 90);
      return highSev
        ? "border-l-4 border-l-rose-500 bg-rose-500/10 border-rose-500/30"
        : "border-l-4 border-l-amber-500 bg-amber-500/10 border-amber-500/30";
    }
    return "border-slate-800 bg-slate-950/40";
  };

  return (
    <Card data-testid="notif-inbox-panel">
      <CardHeader
        title={<span className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-indigo-400" /> Kritik Alarm Kutusu
          {unread > 0 && <span className="mono text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40">{unread} okunmamış</span>}
        </span>}
        subtitle={dmarcCount > 0
          ? `⚠ ${dmarcCount} DMARC saldırı alarmı · genel ${items.length} bildirim`
          : `${items.length} bildirim`}
        right={unread > 0 && (
          <button onClick={() => markAll.mutate(null)} data-testid="notif-inbox-read-all"
                  className="text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1">
            <CheckCheck className="w-3 h-3" /> Tümünü okudum
          </button>
        )}
      />
      <CardBody>
        <div className="flex gap-1 mb-3 border-b border-slate-800 -mx-4 px-4 pb-2">
          {[
            { k: "all", lbl: `Tümü (${items.length})` },
            { k: "unread", lbl: `Okunmamış (${unread})` },
            { k: "dmarc_attack", lbl: `🎯 DMARC (${dmarcCount})` },
          ].map(t => (
            <button key={t.k} onClick={() => setFilter(t.k)}
                    data-testid={`notif-filter-${t.k}`}
                    className={`text-xs px-2.5 py-1 rounded ${
                      filter === t.k
                        ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                        : "text-slate-500 hover:text-slate-300"
                    }`}>{t.lbl}</button>
          ))}
        </div>
        {items.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            <Bell className="w-6 h-6 mx-auto mb-2 opacity-40" />
            {filter === "dmarc_attack"
              ? "Henüz DMARC saldırı alarmı yok — domain'leriniz güvenli görünüyor 🎉"
              : "Bildirim yok"}
          </div>
        ) : (
          <div className="space-y-2 max-h-[520px] overflow-y-auto">
            {items.map(n => (
              <div key={n.id} data-testid={`notif-item-${n.id}`}
                   className={`p-3 rounded-md border ${styleFor(n)} ${!n.read ? "" : "opacity-60"}`}>
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 shrink-0">{iconFor(n.kind)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="text-sm font-bold text-slate-100 flex-1">{n.subject}</div>
                      <div className="text-[10px] text-slate-500 shrink-0 mono">
                        {new Date(n.created_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
                      </div>
                    </div>
                    {/* DMARC özel meta gösterimi */}
                    {n.kind === "dmarc_attack" && n.meta && (
                      <div className="flex flex-wrap gap-1.5 mb-2 text-[11px] mono">
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200">
                          🌐 {n.meta.domain}
                        </span>
                        <span className={`px-2 py-0.5 rounded border ${
                          n.meta.fail_pct >= 90
                            ? "bg-rose-500/20 border-rose-500/50 text-rose-300"
                            : "bg-amber-500/20 border-amber-500/50 text-amber-300"}`}>
                          %{n.meta.fail_pct} FAIL
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-400">
                          {(n.meta.total_msgs || 0).toLocaleString()} mesaj / {n.meta.period_days || 7}g
                        </span>
                        <a href={`/panel/threat-intel`} target="_blank" rel="noreferrer"
                           className="ml-auto text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> DMARC Detayına Git
                        </a>
                      </div>
                    )}
                    <div className="text-[11px] text-slate-400 whitespace-pre-wrap line-clamp-6">{n.body}</div>
                    {!n.read && (
                      <button onClick={() => markRead.mutate(n.id)}
                              data-testid={`notif-read-${n.id}`}
                              className="mt-2 text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700">
                        ✓ Okundu işaretle
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Toggle({ checked, onChange, testid }) {
  return (
    <button
      data-testid={testid}
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-150 border ${
        checked ? "bg-indigo-500/30 border-indigo-500/50" : "bg-slate-800 border-slate-700"
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full transition-transform duration-150 ${
          checked ? "translate-x-5 bg-indigo-300" : "translate-x-0.5 bg-slate-500"
        }`}
      />
    </button>
  );
}

export default function Notifications() {
  const qc = useQueryClient();
  const t = useT();
  const q = useQuery({ queryKey: ["notifications"], queryFn: api.notifications });
  const [state, setState] = useState(null);

  useEffect(() => { if (q.data && !state) setState(q.data); }, [q.data]); // eslint-disable-line

  const save = useMutation({
    mutationFn: (p) => api.notificationsPut(p),
    onSuccess: () => { toast.success(t("notifications.saved_ok")); qc.invalidateQueries({ queryKey: ["notifications"] }); },
    onError: () => toast.error(t("common.error_save")),
  });
  const test = useMutation({
    mutationFn: (channel) => api.notificationsTest(channel),
    onSuccess: (data) => {
      const msgs = [];
      if (data.email) msgs.push(`E-mail → ${data.email.to} · ${data.email.via}`);
      if (data.slack !== null) msgs.push(`Slack: ${data.slack ? "✓" : "×"}`);
      if (msgs.length === 0) toast.error(t("notifications.no_channel"));
      else toast.success(msgs.join(" · "));
    },
    onError: () => toast.error(t("notifications.test_fail")),
  });
  const simulate = useMutation({
    mutationFn: () => api.notificationsSimulate(),
    onSuccess: (data) => {
      if (data.fired) {
        const via = data.email ? `e-mail: ${data.email.via}` : "e-mail: —";
        toast.success(`${data.sample.verdict.toUpperCase()} · ${data.sample.score.toFixed(1)} · ${via}`);
      }
      else toast.info(t("notifications.no_channel"));
    },
  });
  const sim = useMutation({
    mutationFn: (kind) => api.simulateAlarm(kind),
    onSuccess: (data) => {
      toast.success(`${data.message} · ${data.hint || ""}`, { duration: 6000 });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Simülasyon başarısız"),
  });

  if (!state) return <div className="p-6 text-slate-500">{t("common.loading")}</div>;
  const patch = (k, v) => setState((s) => ({ ...s, [k]: v }));

  return (
    <div className="p-6 grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-8 space-y-4">
        <NotificationInboxPanel />
        <SmtpSettings />
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Mail className="w-4 h-4 text-emerald-400" /> {t("notifications.admin_email_title")}</span>}
            subtitle={t("notifications.admin_email_sub")}
            right={<Toggle checked={state.email_enabled} onChange={(v) => patch("email_enabled", v)} testid="email-toggle" />}
          />
          <CardBody className="space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">{t("notifications.admin_addr")}</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  data-testid="admin-email"
                  value={state.admin_email}
                  onChange={(e) => patch("admin_email", e.target.value)}
                  placeholder="admin@sunucunuz.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-3 py-2 text-sm mono placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">{t("notifications.from_addr")}</label>
              <div className="relative">
                <Server className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  data-testid="email-from"
                  value={state.email_from}
                  onChange={(e) => patch("email_from", e.target.value)}
                  placeholder="gokyuzuwebspam@sunucunuz.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-3 py-2 text-sm mono"
                />
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {t("notifications.spf_hint")}
              </div>
            </div>
            <button
              data-testid="email-test"
              onClick={() => test.mutate("email")}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
            >
              <Send className="w-3.5 h-3.5" /> {t("notifications.email_test")}
            </button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-indigo-400" /> {t("notifications.slack_title")}</span>}
            subtitle={t("notifications.slack_sub")}
            right={<Toggle checked={state.slack_enabled} onChange={(v) => patch("slack_enabled", v)} testid="slack-toggle" />}
          />
          <CardBody className="space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">{t("notifications.slack_webhook")}</label>
              <input
                data-testid="slack-webhook"
                value={state.slack_webhook_url}
                onChange={(e) => patch("slack_webhook_url", e.target.value)}
                placeholder="https://hooks.slack.com/services/T00000/B00000/XXXXXXXX"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono placeholder:text-slate-600"
              />
              <div className="mt-2 text-xs text-slate-500">
                <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">
                  {t("notifications.slack_guide")}
                </a>
              </div>
            </div>
            <button
              data-testid="slack-test"
              onClick={() => test.mutate("slack")}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
            >
              <Send className="w-3.5 h-3.5" /> {t("notifications.slack_test")}
            </button>
          </CardBody>
        </Card>
      </div>

      <div className="col-span-12 lg:col-span-4 space-y-4">
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" /> {t("notifications.trigger_title")}</span>}
          />
          <CardBody className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300">{t("notifications.min_score")}</span>
                <span className="mono text-amber-300">{state.alert_min_score.toFixed(1)}</span>
              </div>
              <input type="range" min="3" max="15" step="0.5"
                data-testid="alert-min-score"
                value={state.alert_min_score}
                onChange={(e) => patch("alert_min_score", parseFloat(e.target.value))}
                className="w-full accent-amber-400" />
            </div>
            <div className="flex items-center justify-between py-2 border-t border-slate-800">
              <div>
                <div className="text-sm text-slate-200">{t("notifications.virus_row")}</div>
                <div className="text-xs text-slate-500">{t("notifications.virus_hint")}</div>
              </div>
              <Toggle checked={state.alert_on_virus} onChange={(v) => patch("alert_on_virus", v)} testid="alert-virus" />
            </div>
            <div className="flex items-center justify-between py-2 border-t border-slate-800">
              <div>
                <div className="text-sm text-slate-200">{t("notifications.phish_row")}</div>
                <div className="text-xs text-slate-500">{t("notifications.phish_hint")}</div>
              </div>
              <Toggle checked={state.alert_on_phish} onChange={(v) => patch("alert_on_phish", v)} testid="alert-phish" />
            </div>
            <div className="flex items-center justify-between py-2 border-t border-slate-800">
              <div>
                <div className="text-sm text-slate-200">{t("notifications.lic_row")}</div>
                <div className="text-xs text-slate-500">{t("notifications.lic_hint")}</div>
              </div>
              <Toggle checked={state.alert_on_license_violation} onChange={(v) => patch("alert_on_license_violation", v)} testid="alert-license" />
            </div>

            {/* Saldırı Alarmı */}
            <div className="flex items-center justify-between py-2 border-t border-slate-800">
              <div>
                <div className="text-sm text-slate-200 inline-flex items-center gap-1.5">
                  <span>🛡️</span> Saldırı Uyarısı
                  <span className="text-[10px] text-rose-300 mono px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/30">DDoS · Brute-force</span>
                </div>
                <div className="text-xs text-slate-500">5 dakikada eşik değeri aşan şüpheli olayda alarm gönderir</div>
              </div>
              <Toggle checked={state.alert_on_attack ?? true} onChange={(v) => patch("alert_on_attack", v)} testid="alert-attack" />
            </div>
            {(state.alert_on_attack ?? true) && (
              <div className="pl-4 -mt-1 flex items-center gap-2 text-xs text-slate-400">
                <span>Eşik (5dk):</span>
                <input type="number" min="10" max="10000" step="10"
                       value={state.attack_threshold_5min ?? 100}
                       onChange={(e) => patch("attack_threshold_5min", parseInt(e.target.value) || 100)}
                       className="w-24 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs mono focus:outline-none focus:border-rose-500/40"
                       data-testid="attack-threshold"/>
                <span className="text-[10px] text-slate-500">olay</span>
              </div>
            )}

            {/* Toplu Mail Alarmı */}
            <div className="flex items-center justify-between py-2 border-t border-slate-800">
              <div>
                <div className="text-sm text-slate-200 inline-flex items-center gap-1.5">
                  <span>📤</span> Toplu Mail Uyarısı
                  <span className="text-[10px] text-amber-300 mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">Anormal outbound</span>
                </div>
                <div className="text-xs text-slate-500">Bir hesaptan 1 saatte eşiği aşan giden mail sayısında alarm</div>
              </div>
              <Toggle checked={state.alert_on_bulk_mail ?? true} onChange={(v) => patch("alert_on_bulk_mail", v)} testid="alert-bulk-mail" />
            </div>
            {(state.alert_on_bulk_mail ?? true) && (
              <div className="pl-4 -mt-1 flex items-center gap-2 text-xs text-slate-400">
                <span>Eşik (1sa):</span>
                <input type="number" min="50" max="100000" step="50"
                       value={state.bulk_mail_threshold_1h ?? 500}
                       onChange={(e) => patch("bulk_mail_threshold_1h", parseInt(e.target.value) || 500)}
                       className="w-24 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs mono focus:outline-none focus:border-amber-500/40"
                       data-testid="bulk-mail-threshold"/>
                <span className="text-[10px] text-slate-500">mail</span>
              </div>
            )}
          </CardBody>
        </Card>

        <button
          data-testid="notif-save"
          onClick={() => save.mutate(state)}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
        >
          <Save className="w-4 h-4" /> {t("common.save")}
        </button>

        <Card>
          <CardHeader title={t("notifications.sim_title")} />
          <CardBody className="space-y-2">
            <p className="text-xs text-slate-400">
              {t("notifications.sim_desc")}
            </p>
            <button
              data-testid="notif-simulate"
              onClick={() => simulate.mutate()}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
            >
              <Bell className="w-3.5 h-3.5" /> {t("notifications.sim_btn")}
            </button>
          </CardBody>
        </Card>

        {/* Yeni: Saldırı + Toplu Mail alarm simülasyonu */}
        <Card data-testid="alarm-sim-card">
          <CardHeader title={<span className="flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400"/> Saldırı & Toplu Mail Alarm Testi</span>}
                      subtitle="Alarm zincirini uçtan uca doğrulayın · Bildirim kutusu + e-posta + Slack" />
          <CardBody className="space-y-2">
            <p className="text-[11px] text-slate-500">
              Test sırasında sistem gerçek bir alarm gibi davranır; yüzlerce sahte event ekler, eşik değeri aşar ve bildirimleri gönderir.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                data-testid="sim-attack-btn"
                onClick={() => sim.mutate("attack")}
                disabled={sim.isPending}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
              >
                <ShieldAlert className="w-3.5 h-3.5"/> Saldırı Simüle
              </button>
              <button
                data-testid="sim-bulk-btn"
                onClick={() => sim.mutate("bulk_mail")}
                disabled={sim.isPending}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 disabled:opacity-40"
              >
                <Mails className="w-3.5 h-3.5"/> Toplu Mail Simüle
              </button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
