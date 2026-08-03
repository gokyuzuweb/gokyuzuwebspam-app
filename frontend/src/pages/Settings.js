import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Sliders, Clock, Bell, ArrowUpRight, Sparkles, Lock, Cpu, Languages, Server, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import StripeConfigCard from "@/components/StripeConfigCard";
import { api } from "@/lib/api";
import { useI18n, useT } from "@/i18n";

function Row({ title, hint, children, testid }) {
  return (
    <div data-testid={testid} className="flex items-start justify-between gap-6 py-4 border-b border-slate-800 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-200">{title}</div>
        {hint ? <div className="text-xs text-slate-500 mt-1">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
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

function LogSourceCard() {
  const qc = useQueryClient();
  const licenseKey = typeof window !== "undefined"
    ? (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license") || "")
    : "";
  const q = useQuery({ queryKey: ["log-source"], queryFn: api.logSourceGet });
  const save = useMutation({
    mutationFn: (mode) => api.logSourceSet(mode, licenseKey),
    onSuccess: (d) => {
      toast.success(`Log kaynağı '${d.mode}' olarak kaydedildi`, {
        description: "Sunucuda 'systemctl restart mailshield-logtail' çalıştırın",
        duration: 6000,
      });
      qc.invalidateQueries({ queryKey: ["log-source"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kayıt başarısız"),
  });
  const current = q.data?.mode || "auto";
  const options = [
    { mode: "auto",        Icon: Zap,         label: "Otomatik (önerilir)",
      desc: "MailScanner varsa onu, yoksa Exim'i kullan. En esnek." },
    { mode: "exim",        Icon: Server,      label: "Sadece Exim mainlog",
      desc: "Yerel WHM sunucusu — MailScanner kurulu değilse veya bağımsız çalışmak istersen." },
    { mode: "mailscanner", Icon: ShieldCheck, label: "Sadece MailScanner",
      desc: "ConfigServer MSFE ile birebir parite. MailScanner header'ları kullanılır." },
  ];
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Server className="w-4 h-4 text-indigo-400"/> Log Kaynağı · Mail Trafik Toplama</span>}
        subtitle="GökyüzüWebSpam'in mail olaylarını hangi log/spool'dan okuyacağını seçin. MailScanner opsiyoneldir."
      />
      <CardBody className="space-y-3" data-testid="log-source-card">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {options.map(({ mode, Icon, label, desc }) => (
            <button
              key={mode}
              data-testid={`log-source-${mode}`}
              onClick={() => save.mutate(mode)}
              disabled={save.isPending}
              className={`text-left p-3 rounded-lg border transition-colors ${
                current === mode
                  ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-100"
                  : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-4 h-4 ${current === mode ? "text-indigo-300" : "text-slate-500"}`}/>
                <span className="text-sm font-semibold">{label}</span>
                {current === mode && (
                  <span className="ml-auto text-[10px] mono px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300">AKTİF</span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 leading-relaxed">{desc}</div>
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-500 bg-slate-900/60 rounded p-2 border border-slate-800">
          <b className="text-amber-300">Not:</b> Değişiklik sunucudaki Perl daemon'un yeniden başlatılmasıyla aktif olur.
          Ayar kaydedildikten sonra sunucunuzda şu komutu çalıştırın: <br/>
          <code className="mono text-emerald-300">systemctl restart mailshield-logtail</code>
        </div>
      </CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const t = useT();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const langs = useQuery({ queryKey: ["i18n-langs"], queryFn: api.i18nLanguages });
  const { lang: uiLang, setLang: setUiLang } = useI18n();
  const [state, setState] = useState(null);

  useEffect(() => { if (settings.data && !state) setState(settings.data); }, [settings.data]); // eslint-disable-line

  const save = useMutation({
    mutationFn: (p) => api.settingsPut(p),
    onSuccess: () => {
      toast.success(t("settings.saved"));
      qc.invalidateQueries({ queryKey: ["settings"] });
      if (state?.ui_language) setUiLang(state.ui_language);
    },
    onError: () => toast.error(t("settings.save_fail")),
  });

  if (!state) return <div className="p-6 text-slate-500">{t("common.loading")}</div>;

  const patch = (k, v) => setState((s) => ({ ...s, [k]: v }));

  return (
    <div className="p-6 grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-8 space-y-4">
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Languages className="w-4 h-4 text-indigo-400" /> {t("settings.ui_language_title")} · Interface Language</span>}
            subtitle={t("settings.ui_language_sub")}
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(langs.data || []).map((L) => (
                <button
                  key={L.code}
                  data-testid={`lang-${L.code}`}
                  onClick={() => {
                    setUiLang(L.code);
                    patch("ui_language", L.code);
                    save.mutate({ ...state, ui_language: L.code });
                  }}
                  className={`px-3 py-2 rounded-md text-sm border transition-colors ${
                    uiLang === L.code
                      ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200"
                      : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  <div className="text-sm">{L.name_native}</div>
                  <div className="mono text-[10px] text-slate-500 uppercase tracking-widest">{L.code}</div>
                </button>
              ))}
            </div>
            <div className="text-[11px] text-slate-500">
              {t("settings.ui_lang_hint")}
            </div>
          </CardBody>
        </Card>

        <LogSourceCard />

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Sliders className="w-4 h-4 text-indigo-400" /> {t("settings.thresholds_title")}</span>}
            subtitle={t("settings.thresholds_sub")}
          />
          <CardBody className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300">{t("settings.threshold_low")}</span>
                <span className="mono text-amber-300">{state.spam_threshold_low.toFixed(1)}</span>
              </div>
              <input type="range" min="1" max="15" step="0.1"
                data-testid="threshold-low"
                value={state.spam_threshold_low}
                onChange={(e) => patch("spam_threshold_low", parseFloat(e.target.value))}
                className="w-full accent-amber-400" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300">{t("settings.threshold_high")}</span>
                <span className="mono text-rose-400">{state.spam_threshold_high.toFixed(1)}</span>
              </div>
              <input type="range" min="1" max="20" step="0.1"
                data-testid="threshold-high"
                value={state.spam_threshold_high}
                onChange={(e) => patch("spam_threshold_high", parseFloat(e.target.value))}
                className="w-full accent-rose-500" />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Cpu className="w-4 h-4 text-indigo-400" /> {t("settings.engines_title")}</span>}
            subtitle={t("settings.engines_sub")}
          />
          <CardBody className="space-y-1">
            <Row title={t("settings.active_engine")} hint={t("settings.active_engine_hint")}
                 testid="row-active-engine">
              <select value={state.active_engine} onChange={(e) => patch("active_engine", e.target.value)}
                data-testid="active-engine"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm">
                <option value="spamassassin">Apache SpamAssassin</option>
                <option value="rspamd">Rspamd</option>
              </select>
            </Row>
            <Row title={t("settings.bayes")} hint={t("settings.bayes_hint")}
                 testid="row-bayes">
              <Toggle checked={state.bayes_learning} onChange={(v) => patch("bayes_learning", v)} testid="toggle-bayes" />
            </Row>
            <Row title={<span className="flex items-center gap-2">{t("settings.ai_row")} <Badge tone="brand">{t("settings.new")}</Badge></span>}
                 hint={t("settings.ai_hint")}
                 testid="row-ai">
              <Toggle checked={state.ai_classification} onChange={(v) => patch("ai_classification", v)} testid="toggle-ai" />
            </Row>
            {state.ai_classification && (
              <Row title={t("settings.ai_model_row")}
                   hint={t("settings.ai_model_hint")}
                   testid="row-ai-model">
                <select
                  data-testid="ai-model"
                  value={state.ai_model}
                  onChange={(e) => patch("ai_model", e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm"
                >
                  <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
                  <option value="gpt-5.2">GPT-5.2</option>
                  <option value="gemini-3-flash">Gemini 3 Flash</option>
                </select>
              </Row>
            )}
            <Row title={t("settings.tls")} hint={t("settings.tls_hint")}
                 testid="row-tls">
              <Toggle checked={state.tls_enforce} onChange={(v) => patch("tls_enforce", v)} testid="toggle-tls" />
            </Row>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><ArrowUpRight className="w-4 h-4 text-indigo-400" /> {t("settings.outbound_title")}</span>}
            subtitle={t("settings.outbound_sub")}
          />
          <CardBody className="space-y-1">
            <Row title={t("settings.outbound_block")}
                 hint={t("settings.outbound_block_hint")}
                 testid="row-outbound-block">
              <Toggle checked={state.outbound_block_enabled} onChange={(v) => patch("outbound_block_enabled", v)}
                      testid="toggle-outbound" />
            </Row>
            <Row title={t("settings.outbound_limit")}
                 hint={t("settings.outbound_limit_hint")}
                 testid="row-outbound-limit">
              <input type="number" min="10" max="10000"
                data-testid="outbound-limit"
                value={state.outbound_limit_per_hour}
                onChange={(e) => patch("outbound_limit_per_hour", parseInt(e.target.value || "0", 10))}
                className="w-28 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right" />
            </Row>
          </CardBody>
        </Card>

        {/* Stripe API Key - master only */}
        <StripeConfigCard />
      </div>

      <div className="col-span-12 lg:col-span-4 space-y-4">
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-400" /> {t("settings.quarantine_title")}</span>}
          />
          <CardBody className="space-y-1">
            <Row title={t("settings.retention")}
                 hint={t("settings.retention_hint")}
                 testid="row-retention">
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="90"
                  data-testid="quarantine-days"
                  value={state.quarantine_days}
                  onChange={(e) => patch("quarantine_days", parseInt(e.target.value || "0", 10))}
                  className="w-20 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right" />
                <span className="text-xs text-slate-500">{t("settings.days")}</span>
              </div>
            </Row>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Bell className="w-4 h-4 text-indigo-400" /> {t("settings.notif_title")}</span>}
          />
          <CardBody className="space-y-1">
            <Row title={t("settings.report_freq")}
                 hint={t("settings.report_freq_hint")}
                 testid="row-report-freq">
              <select value={state.report_frequency} onChange={(e) => patch("report_frequency", e.target.value)}
                data-testid="report-frequency"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm">
                <option value="off">{t("settings.off")}</option>
                <option value="daily">{t("settings.daily")}</option>
                <option value="weekly">{t("settings.weekly")}</option>
              </select>
            </Row>
          </CardBody>
        </Card>

        <button
          data-testid="settings-save"
          onClick={() => save.mutate(state)}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
        >
          <Save className="w-4 h-4" /> {t("settings.save_btn")}
        </button>

        <Card>
          <CardBody className="text-xs text-slate-500 space-y-2">
            <div className="flex items-center gap-2 text-slate-400">
              <Lock className="w-3.5 h-3.5" /> {t("settings.lock_hint")}
            </div>
            <div className="mono text-[11px] text-slate-600">/etc/mailshield/policy.conf</div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
