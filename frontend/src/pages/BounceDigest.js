import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, Send, Clock, AlertTriangle, Save, Eye, Zap, Webhook, Radio, History, Download, FileSpreadsheet } from "lucide-react";
import { Card, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

export default function BounceDigest() {
  const [hours, setHours] = useState(24);
  const [tab, setTab] = useState(() => localStorage.getItem("gws.bd.tab") || "channel");
  const chooseTab = (id) => { setTab(id); try { localStorage.setItem("gws.bd.tab", id); } catch {} };
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ["bd-config"], queryFn: api.bounceDigestConfig });
  const preview = useQuery({
    queryKey: ["bd-preview", hours], queryFn: () => api.bounceDigestPreview(hours),
    staleTime: 15_000,
  });
  const history = useQuery({ queryKey: ["bd-history"], queryFn: api.bounceDigestHistory });
  const [form, setForm] = useState({
    enabled: true, recipient_email: "", send_hour_utc: 9,
    delivery_method: "panel", webhook_url: "",
    slack_webhook_url: "", slack_channel: "",
    discord_webhook_url: "",
  });
  // Sync form once config loads (proper useEffect — render sırasında setState olmamalı)
  useEffect(() => {
    const c = cfg.data;
    if (c && (c.recipient_email || c.enabled != null)) {
      setForm({
        enabled: c.enabled ?? true,
        recipient_email: c.recipient_email || "",
        send_hour_utc: c.send_hour_utc ?? 9,
        delivery_method: c.delivery_method || "panel",
        webhook_url: c.webhook_url || "",
        slack_webhook_url: c.slack_webhook_url || "",
        slack_channel: c.slack_channel || "",
        discord_webhook_url: c.discord_webhook_url || "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.data]);

  const save = useMutation({
    mutationFn: () => api.bounceDigestSetConfig(form),
    onSuccess: () => { toast.success("Ayarlar kaydedildi"); qc.invalidateQueries({ queryKey: ["bd-config"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });
  const runNow = useMutation({
    mutationFn: () => api.bounceDigestRunNow(),
    onSuccess: (d) => {
      const gen = d.generated || 0;
      const scanned = d.total_scanned || 0;
      const zero = d.zero_bounce_licenses || 0;
      if (gen > 0) {
        toast.success(`✓ ${gen} lisans için digest üretildi`, {
          description: `${scanned} lisans tarandı, ${zero} temiz (bounce yok).`,
          duration: 8000,
        });
      } else {
        toast.info(`Son 24 saatte bounce bulunmadı`, {
          description: `${scanned} lisans tarandı, hepsi temiz — digest üretilecek veri yok.`,
          duration: 8000,
        });
      }
      qc.invalidateQueries({ queryKey: ["bd-history"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });

  const testSlack = useMutation({
    mutationFn: () => api.bounceDigestTestSlack(),
    onSuccess: (d) => {
      if (d.ok) toast.success(`Slack'e test mesajı gönderildi (bounce: ${d.test_digest?.total_bounces ?? 0})`);
      else toast.error(d.error || "Slack teslimi başarısız");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Slack test başarısız"),
  });
  const testDiscord = useMutation({
    mutationFn: () => api.bounceDigestTestDiscord(),
    onSuccess: (d) => {
      if (d.ok) toast.success(`Discord'a test embed gönderildi (bounce: ${d.test_digest?.total_bounces ?? 0})`);
      else toast.error(d.error || "Discord teslimi başarısız");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Discord test başarısız"),
  });

  const p = preview.data;

  return (
    <div className="p-6 space-y-4" data-testid="bounce-digest-page">
      <div className="rounded-xl border border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-slate-900/60 to-amber-500/5 p-5">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-rose-300"/>
          </div>
          <div className="flex-1">
            <div className="text-slate-100 text-lg font-bold">Bounce Digest — Günlük Rapor</div>
            <div className="text-xs text-slate-400 mt-0.5 max-w-2xl leading-relaxed">
              Her sabah 09:00 UTC (varsayılan), son 24 saatteki bounce/defer/reject olan outbound maillerin özeti üretilir. Panel + Webhook + Slack teslim yöntemleri desteklenir.
            </div>
          </div>
          <div className="flex gap-2">
            {form.delivery_method === "slack" && (
              <button
                onClick={() => testSlack.mutate()}
                disabled={testSlack.isPending || !form.slack_webhook_url}
                data-testid="bd-test-slack"
                className="text-xs px-3 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-white disabled:opacity-40 inline-flex items-center gap-1.5"
              >🧪 {testSlack.isPending ? "Gönderiliyor…" : "Slack Test"}</button>
            )}
            {form.delivery_method === "discord" && (
              <button
                onClick={() => testDiscord.mutate()}
                disabled={testDiscord.isPending || !form.discord_webhook_url}
                data-testid="bd-test-discord"
                className="text-xs px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 inline-flex items-center gap-1.5"
              >🧪 {testDiscord.isPending ? "Gönderiliyor…" : "Discord Test"}</button>
            )}
            <button
              onClick={() => runNow.mutate()}
              disabled={runNow.isPending}
              data-testid="bd-run-now"
              className="text-xs px-3 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40 inline-flex items-center gap-1.5"
            ><Zap className="w-3.5 h-3.5"/> {runNow.isPending ? "Üretiliyor…" : "Şimdi Üret"}</button>
          </div>
        </div>
      </div>

      {/* v43.94 — Tab Bar (Kanal / Zamanlama / Geçmiş) */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3 sticky top-14 bg-slate-950/80 backdrop-blur z-10" data-testid="bd-tabs">
        {[
          { k: "channel",  l: "Kanal & Ayarlar", Icon: Radio,   tone: "fuchsia" },
          { k: "schedule", l: "Zamanlama",       Icon: Clock,   tone: "indigo"  },
          { k: "history",  l: "Geçmiş",          Icon: History, tone: "rose"    },
        ].map(({ k, l, Icon, tone }) => {
          const tones = {
            fuchsia: "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200",
            indigo:  "border-indigo-500/50 bg-indigo-500/15 text-indigo-200",
            rose:    "border-rose-500/50 bg-rose-500/15 text-rose-200",
          };
          const active = tab === k;
          return (
            <button key={k} type="button" onClick={() => chooseTab(k)}
              data-testid={`bd-tab-${k}`}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-all ${
                active ? tones[tone] + " shadow-md" : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}>
              <Icon className="w-4 h-4" />
              {l}
            </button>
          );
        })}
      </div>

      {/* Config */}
      {tab === "channel" && (
      <Card>
        <CardHeader title="Digest Yapılandırması" subtitle="Kime, ne zaman, hangi yolla gönderilecek"/>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[11px] uppercase text-slate-500 mb-1 block">Alıcı e-posta (bilgi amaçlı)</span>
            <input
              type="email"
              value={form.recipient_email}
              onChange={(e) => setForm({ ...form, recipient_email: e.target.value })}
              data-testid="bd-recipient"
              placeholder="ops@sirketiniz.com"
              className="w-full text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 focus:border-indigo-500/50 outline-none text-slate-200"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase text-slate-500 mb-1 block">Gönderim Saati (UTC)</span>
            <select
              value={form.send_hour_utc}
              onChange={(e) => setForm({ ...form, send_hour_utc: parseInt(e.target.value) })}
              data-testid="bd-hour"
              className="w-full text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-200"
            >
              {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00 UTC (TR: {String((h + 3) % 24).padStart(2, "0")}:00)</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase text-slate-500 mb-1 block">Teslim Yöntemi</span>
            <select
              value={form.delivery_method}
              onChange={(e) => setForm({ ...form, delivery_method: e.target.value })}
              data-testid="bd-method"
              className="w-full text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-200"
            >
              <option value="panel">Sadece Panelde Arşivle</option>
              <option value="webhook">Webhook (Genel HTTP JSON)</option>
              <option value="slack">Slack (formatlanmış mesaj) ✨</option>
              <option value="discord">Discord (embed kart) 💙</option>
            </select>
          </label>
          {form.delivery_method === "discord" && (
            <>
              <label className="block md:col-span-2">
                <span className="text-[11px] uppercase text-slate-500 mb-1 block flex items-center gap-1"><Webhook className="w-3 h-3"/> Discord Webhook URL</span>
                <input
                  type="url"
                  value={form.discord_webhook_url}
                  onChange={(e) => setForm({ ...form, discord_webhook_url: e.target.value })}
                  data-testid="bd-discord-webhook"
                  placeholder="https://discord.com/api/webhooks/…/…"
                  className="w-full text-sm mono bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-200"
                />
              </label>
              <div className="md:col-span-2 rounded border border-indigo-500/25 bg-indigo-500/5 p-3 text-xs space-y-2" data-testid="bd-discord-guide">
                <div className="font-semibold text-indigo-300 flex items-center gap-1.5">💙 Discord Embed Şablonu (v43.82)</div>
                <ol className="text-slate-400 space-y-1 list-decimal pl-5">
                  <li>Discord sunucusu → Kanal Ayarları → <b>Integrations</b> → <span className="mono text-emerald-300">Webhooks</span> → <b>New Webhook</b>.</li>
                  <li>Webhook için ad + kanal seçin → <b>Copy Webhook URL</b> → yukarıya yapıştırın.</li>
                  <li>Sağdaki <b>🧪 Discord Test</b> butonuna bas — renkli embed kart Discord kanalına düşer (0 bounce → yeşil, &lt;20 → turuncu, &gt;=20 → kırmızı).</li>
                </ol>
              </div>
            </>
          )}
          {form.delivery_method === "slack" && (
            <>
              <label className="block">
                <span className="text-[11px] uppercase text-slate-500 mb-1 block flex items-center gap-1"><Webhook className="w-3 h-3"/> Slack Incoming Webhook URL</span>
                <input
                  type="url"
                  value={form.slack_webhook_url}
                  onChange={(e) => setForm({ ...form, slack_webhook_url: e.target.value })}
                  data-testid="bd-slack-webhook"
                  placeholder="https://hooks.slack.com/services/T00/B00/xxxx"
                  className="w-full text-sm mono bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-200"
                />
              </label>
              <label className="block">
                <span className="text-[11px] uppercase text-slate-500 mb-1 block">Slack Kanalı (opsiyonel)</span>
                <input
                  type="text"
                  value={form.slack_channel}
                  onChange={(e) => setForm({ ...form, slack_channel: e.target.value })}
                  data-testid="bd-slack-channel"
                  placeholder="#mail-alerts"
                  className="w-full text-sm mono bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-200"
                />
              </label>
              <div className="md:col-span-2 rounded border border-fuchsia-500/25 bg-fuchsia-500/5 p-3 text-xs space-y-2" data-testid="bd-slack-guide">
                <div className="font-semibold text-fuchsia-300 flex items-center gap-1.5">💜 Slack Şablonu (v43.81 · MRKDWN)</div>
                <ol className="text-slate-400 space-y-1 list-decimal pl-5">
                  <li>Slack → <b>Apps</b> → <span className="mono text-emerald-300">Incoming Webhooks</span> → <b>Add to Slack</b>.</li>
                  <li>Yayınlanacak kanalı seç (ör. <span className="mono">#mail-alerts</span>) → webhook URL'yi kopyala → yukarıya yapıştır.</li>
                  <li>Test için sağdaki <b>🧪 Slack Test</b> butonuna bas — formatlanmış özet Slack'e düşer.</li>
                </ol>
                <details className="mt-2">
                  <summary className="cursor-pointer text-slate-300 hover:text-slate-100 text-[11px]">📋 Slack'e giden mesaj örneği</summary>
                  <pre className="mt-1 text-[10px] mono bg-slate-950 border border-slate-800 rounded p-2 text-slate-300 whitespace-pre-wrap">{`:envelope_with_arrow: *GökyüzüWebSpam Bounce Özeti* · Son 24s · \`MS-C02AB012…\`
> Toplam Bounce/Defer/Reject: *42*

*En Çok Etkilenen Kullanıcılar*
• \`destek@ornek.com\` — *12*
• \`admin@ornek.com\` — *8*

*En Çok Bounce Yiyen Alıcı Domainler*
• \`gmail.com\` — *18*
• \`outlook.com\` — *9*`}</pre>
                </details>
              </div>
            </>
          )}
          {form.delivery_method === "webhook" && (
            <>
              <label className="block">
                <span className="text-[11px] uppercase text-slate-500 mb-1 block flex items-center gap-1"><Webhook className="w-3 h-3"/> Webhook URL</span>
                <input
                  type="url"
                  value={form.webhook_url}
                  onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
                  data-testid="bd-webhook"
                  placeholder="https://hooks.slack.com/…"
                  className="w-full text-sm mono bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-200"
                />
              </label>
              <div className="md:col-span-2 rounded border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs space-y-2" data-testid="bd-slack-template">
                <div className="font-semibold text-emerald-300 flex items-center gap-1.5">💡 Slack/Discord Webhook Kurulumu</div>
                <ol className="text-slate-400 space-y-1 list-decimal pl-5">
                  <li><b>Slack:</b> Kanal → ⚙️ Ayarlar → Integrations → <span className="mono text-emerald-300">Incoming Webhooks</span> → yeni webhook oluşturun, URL'i yukarı yapıştırın.</li>
                  <li><b>Discord:</b> Sunucu → Kanal Ayarları → Integrations → <span className="mono text-emerald-300">Webhooks</span> → Yeni Webhook → URL kopyala.</li>
                  <li><b>Test:</b> "Şimdi Üret" butonuna basın — kanala mesaj gelecek.</li>
                </ol>
                <details className="mt-2">
                  <summary className="cursor-pointer text-slate-300 hover:text-slate-100 text-[11px]">📋 Gönderilen JSON payload örneği</summary>
                  <pre className="mt-1 text-[10px] mono bg-slate-950 border border-slate-800 rounded p-2 text-slate-300 whitespace-pre-wrap">{`{
  "kind": "bounce_digest",
  "license_key": "MS-...",
  "total_bounces": 42,
  "top_users": [["destek", 12], ["admin", 8]],
  "generated_at": "2026-08-15T09:00:00Z"
}`}</pre>
                </details>
                <details>
                  <summary className="cursor-pointer text-slate-300 hover:text-slate-100 text-[11px]">🎨 Slack için zenginleştirilmiş Block Kit örneği</summary>
                  <div className="mt-1 text-[10px] text-slate-400 space-y-1">
                    <div>Slack'in <span className="mono text-emerald-300">text</span> field'ı desteklediği ekstra formatı kullanabilirsiniz. Webhook proxy (Zapier/n8n) ile aşağıdaki Block Kit'e dönüştürün:</div>
                    <pre className="mono bg-slate-950 border border-slate-800 rounded p-2 text-slate-300 whitespace-pre-wrap">{`{
  "text": "📉 Bounce Digest — 42 bounce",
  "blocks": [
    { "type": "header", "text": {"type":"plain_text","text":"📉 Günlük Bounce Özeti"} },
    { "type": "section", "text": {"type":"mrkdwn","text":"*Toplam:* 42 bounce\\n*En çok:* destek (12)"} },
    { "type": "actions", "elements": [
      { "type": "button", "text": {"type":"plain_text","text":"Panelde Aç"}, "url": "https://panel.gokyuzuhosting.com/panel/bounce-digest" }
    ]}
  ]
}`}</pre>
                  </div>
                </details>
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              data-testid="bd-enabled"
              className="accent-rose-500"
            /> Bu digest'i etkinleştir
          </label>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              data-testid="bd-save"
              className="text-sm px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 inline-flex items-center gap-1.5"
            ><Save className="w-3.5 h-3.5"/> Kaydet</button>
          </div>
        </div>
      </Card>
      )}

      {/* Preview */}
      {tab === "schedule" && (
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Eye className="w-4 h-4 text-sky-400"/> Canlı Önizleme</span>}
          subtitle={`Son ${hours} saatteki bounce'lar — gönderilseydi bu görünecekti`}
          right={
            <div className="flex items-center gap-1">
              {[6, 24, 72, 168].map((h) => (
                <button key={h} onClick={() => setHours(h)}
                  data-testid={`bd-range-${h}`}
                  className={`text-[11px] px-2 py-1 rounded border ${hours === h ? "bg-rose-500/15 border-rose-500/40 text-rose-300" : "border-slate-800 text-slate-500 hover:text-slate-300"}`}>
                  {h < 24 ? `${h}s` : h === 24 ? "24s" : h === 72 ? "3g" : "7g"}
                </button>
              ))}
            </div>
          }
        />
        {preview.isLoading && <div className="p-8 text-center text-slate-500 text-sm">Yükleniyor…</div>}
        {p && p.total_bounces === 0 && <div className="p-8 text-center text-emerald-400 text-sm">✓ Son {hours} saatte bounce yok — dizin temiz.</div>}
        {p && p.total_bounces > 0 && (
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <div className="rounded border border-rose-500/30 bg-rose-500/10 p-4 text-center">
                <div className="text-[10px] uppercase text-slate-400">Toplam Bounce</div>
                <div className="text-4xl font-bold text-rose-300 mt-1" data-testid="bd-total">{p.total_bounces}</div>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase text-slate-500 mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> Etkilenen Kullanıcılar</div>
              <ul className="space-y-1">
                {p.top_users.map(([u, n]) => (
                  <li key={u} className="text-xs flex justify-between border-b border-slate-800/60 pb-1">
                    <span className="text-slate-300">{u}</span>
                    <span className="text-rose-400 mono">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[11px] uppercase text-slate-500 mb-1">Alıcı Domain'leri</div>
              <ul className="space-y-1">
                {p.top_domains.map(([d, n]) => (
                  <li key={d} className="text-xs flex justify-between border-b border-slate-800/60 pb-1">
                    <span className="text-slate-300 mono truncate max-w-[140px]">{d}</span>
                    <span className="text-rose-400 mono">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
            {p.samples.length > 0 && (
              <div className="md:col-span-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] uppercase text-slate-500">Son 10 Bounce Örneği</div>
                  {/* v44.00.03 — Excel / CSV Export */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        const url = api.bounceDigestExportUrl({ hours, fmt: "csv", limit: 500 });
                        window.open(url, "_blank");
                      }}
                      data-testid="bd-export-csv"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border border-slate-700 bg-slate-900/60 hover:bg-slate-800 hover:border-slate-600 text-slate-300 transition"
                      title="Son 500 kaydı CSV indir (Türkçe karakterlerle)"
                    >
                      <Download className="w-3 h-3" />
                      CSV
                    </button>
                    <button
                      onClick={() => {
                        const url = api.bounceDigestExportUrl({ hours, fmt: "xlsx", limit: 500 });
                        window.open(url, "_blank");
                      }}
                      data-testid="bd-export-xlsx"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 transition"
                      title="Son 500 kaydı Excel (.xlsx) indir"
                    >
                      <FileSpreadsheet className="w-3 h-3" />
                      Excel
                    </button>
                  </div>
                </div>
                <div className="border border-slate-800 rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase text-slate-500 bg-slate-900/40">
                        <th className="text-left px-2 py-1.5">Zaman</th>
                        <th className="text-left px-2 py-1.5">Kullanıcı</th>
                        <th className="text-left px-2 py-1.5">Alıcı</th>
                        <th className="text-left px-2 py-1.5">Konu</th>
                        <th className="text-right px-2 py-1.5">Aksiyon</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.samples.map((s, i) => (
                        <tr key={i} className="border-t border-slate-800/60">
                          <td className="px-2 py-1.5 text-slate-500 mono">{s.ts ? new Date(s.ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                          <td className="px-2 py-1.5">
                            <div className="text-slate-300">{s.user}</div>
                            {s.from_addr && s.from_addr !== s.user && (
                              <div className="text-[10px] mono text-slate-500 truncate max-w-[220px]" title={s.from_addr}>{s.from_addr}</div>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-slate-400 mono truncate max-w-[180px]">{s.to}</td>
                          <td className="px-2 py-1.5 text-slate-400 truncate max-w-[240px]">{s.subject}</td>
                          <td className="px-2 py-1.5 text-right"><Badge tone="danger">{s.action}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
      )}

      {/* History */}
      {tab === "history" && (
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Clock className="w-4 h-4 text-slate-400"/> Digest Geçmişi</span>}
          subtitle="Otomatik veya manuel üretilmiş digest arşivi"
        />
        {(history.data?.items || []).length === 0 && (
          <div className="p-8 text-center text-slate-500 text-sm">Henüz digest üretilmedi. "Şimdi Üret" ile başlatın.</div>
        )}
        <div className="divide-y divide-slate-800">
          {(history.data?.items || []).map((h) => (
            <div key={h.id} className="px-4 py-2.5 flex items-center gap-3" data-testid={`bd-history-${h.id}`}>
              <Send className="w-4 h-4 text-rose-400"/>
              <div className="flex-1">
                <div className="text-sm text-slate-200">
                  Digest · {h.total_bounces} bounce
                </div>
                <div className="text-[10px] text-slate-500 mono">
                  {h.generated_at ? new Date(h.generated_at).toLocaleString("tr-TR") : ""}
                </div>
              </div>
              <span className="text-[10px] text-slate-400 mono">{h.hours}s</span>
            </div>
          ))}
        </div>
      </Card>
      )}
    </div>
  );
}
