import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Sliders, Clock, Bell, ArrowUpRight, Sparkles, Lock, Cpu } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

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

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [state, setState] = useState(null);

  useEffect(() => { if (settings.data && !state) setState(settings.data); }, [settings.data]); // eslint-disable-line

  const save = useMutation({
    mutationFn: (p) => api.settingsPut(p),
    onSuccess: () => {
      toast.success("Politika kaydedildi");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: () => toast.error("Kaydedilemedi"),
  });

  if (!state) return <div className="p-6 text-slate-500">Yükleniyor…</div>;

  const patch = (k, v) => setState((s) => ({ ...s, [k]: v }));

  return (
    <div className="p-6 grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-8 space-y-4">
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Sliders className="w-4 h-4 text-indigo-400" /> Spam Eşikleri</span>}
            subtitle="Puanlama: 0 (temiz) → 15+ (kesin spam)"
          />
          <CardBody className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300">Düşük eşik (spam olarak işaretle)</span>
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
                <span className="text-sm text-slate-300">Yüksek eşik (karantina + red)</span>
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
            title={<span className="flex items-center gap-2"><Cpu className="w-4 h-4 text-indigo-400" /> Motor Seçimi</span>}
            subtitle="Etkin motor değiştiğinde daemon yeniden başlatılır"
          />
          <CardBody className="space-y-1">
            <Row title="Aktif spam motoru" hint="SpamAssassin klasik ve stabil; Rspamd daha hızlı ve modern"
                 testid="row-active-engine">
              <select value={state.active_engine} onChange={(e) => patch("active_engine", e.target.value)}
                data-testid="active-engine"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm">
                <option value="spamassassin">Apache SpamAssassin</option>
                <option value="rspamd">Rspamd</option>
              </select>
            </Row>
            <Row title="Bayes öğrenmesi" hint="Kullanıcı 'spam' işareti verdikçe sa-learn ile öğret"
                 testid="row-bayes">
              <Toggle checked={state.bayes_learning} onChange={(v) => patch("bayes_learning", v)} testid="toggle-bayes" />
            </Row>
            <Row title={<span className="flex items-center gap-2">AI Sınıflandırma <Badge tone="brand">Yeni</Badge></span>}
                 hint="LLM ile içerik / phishing kontrolü (Emergent LLM anahtarı gerekli)"
                 testid="row-ai">
              <Toggle checked={state.ai_classification} onChange={(v) => patch("ai_classification", v)} testid="toggle-ai" />
            </Row>
            <Row title="TLS zorunluluğu" hint="Kimlik doğrulamalı SMTP için TLS'i zorunlu tut"
                 testid="row-tls">
              <Toggle checked={state.tls_enforce} onChange={(v) => patch("tls_enforce", v)} testid="toggle-tls" />
            </Row>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><ArrowUpRight className="w-4 h-4 text-indigo-400" /> Giden Posta Kontrolü</span>}
            subtitle="Sunucudan çıkan spam'ı sınırla"
          />
          <CardBody className="space-y-1">
            <Row title="Giden e-posta engelleme"
                 hint="Kural ihlali durumunda gönderimi kes ve admin'e bildir"
                 testid="row-outbound-block">
              <Toggle checked={state.outbound_block_enabled} onChange={(v) => patch("outbound_block_enabled", v)}
                      testid="toggle-outbound" />
            </Row>
            <Row title="Kullanıcı başına saatlik limit"
                 hint="cPanel hesabı başına saatte gönderilebilecek e-posta sayısı"
                 testid="row-outbound-limit">
              <input type="number" min="10" max="10000"
                data-testid="outbound-limit"
                value={state.outbound_limit_per_hour}
                onChange={(e) => patch("outbound_limit_per_hour", parseInt(e.target.value || "0", 10))}
                className="w-28 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right" />
            </Row>
          </CardBody>
        </Card>
      </div>

      <div className="col-span-12 lg:col-span-4 space-y-4">
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-400" /> Karantina</span>}
          />
          <CardBody className="space-y-1">
            <Row title="Bekletme süresi"
                 hint="Bu süreden eski karantina kayıtları silinir"
                 testid="row-retention">
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="90"
                  data-testid="quarantine-days"
                  value={state.quarantine_days}
                  onChange={(e) => patch("quarantine_days", parseInt(e.target.value || "0", 10))}
                  className="w-20 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right" />
                <span className="text-xs text-slate-500">gün</span>
              </div>
            </Row>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Bell className="w-4 h-4 text-indigo-400" /> Bildirimler</span>}
          />
          <CardBody className="space-y-1">
            <Row title="Karantina raporu sıklığı"
                 hint="Kullanıcılara özet e-posta gönderme sıklığı"
                 testid="row-report-freq">
              <select value={state.report_frequency} onChange={(e) => patch("report_frequency", e.target.value)}
                data-testid="report-frequency"
                className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm">
                <option value="off">Kapalı</option>
                <option value="daily">Günlük</option>
                <option value="weekly">Haftalık</option>
              </select>
            </Row>
          </CardBody>
        </Card>

        <button
          data-testid="settings-save"
          onClick={() => save.mutate(state)}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
        >
          <Save className="w-4 h-4" /> Değişiklikleri Kaydet
        </button>

        <Card>
          <CardBody className="text-xs text-slate-500 space-y-2">
            <div className="flex items-center gap-2 text-slate-400">
              <Lock className="w-3.5 h-3.5" /> Değişiklikler yalnızca root yetkili WHM kullanıcıları tarafından yapılabilir.
            </div>
            <div className="mono text-[11px] text-slate-600">/etc/mailshield/policy.conf</div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
