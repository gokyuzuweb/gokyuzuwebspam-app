import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, FlaskConical, Play, ToggleLeft, ToggleRight, Sparkles, Wand2, Check, X, Languages } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n";

function AIRuleGenerator({ onAccept }) {
  const [prompt, setPrompt] = useState("");
  const [proposals, setProposals] = useState([]);
  const { effective } = useI18n();
  const [langOverride, setLangOverride] = useState("");
  const gen = useMutation({
    mutationFn: (p) => api.rulesGenerate(p, undefined, langOverride || effective),
    onSuccess: (data) => {
      setProposals(data.proposals);
      toast.success(`${data.count} kural önerisi (${data.model} · ${data.language.toUpperCase()})`);
    },
    onError: (e) => toast.error("Üretim başarısız: " + (e?.response?.data?.detail || e.message)),
  });
  const langLabel = (langOverride || effective || "tr").toUpperCase();
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-400" /> AI Kural Üretici</span>}
        subtitle="Yakalamak istediğiniz spam türünü anlatın, AI arayüz diline uygun kurallar üretir"
        right={
          <div className="flex items-center gap-1.5">
            <Languages className="w-3.5 h-3.5 text-slate-500" />
            <select
              data-testid="ai-rule-lang"
              value={langOverride}
              onChange={(e) => setLangOverride(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] mono text-slate-300"
              title="AI kural adlarının yazılacağı dil"
            >
              <option value="">Otomatik ({langLabel})</option>
              <option value="tr">Türkçe</option>
              <option value="en">English</option>
              <option value="de">Deutsch</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
              <option value="ar">العربية</option>
            </select>
          </div>
        }
      />
      <CardBody className="space-y-3">
        <div className="flex gap-2">
          <input
            data-testid="ai-rule-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='örn: "sahte kripto para yatırım daveti"  ya da  "Türkçe eczane spam"'
            className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60"
          />
          <button
            data-testid="ai-rule-generate"
            onClick={() => { if (prompt.trim()) gen.mutate(prompt); }}
            disabled={gen.isPending || !prompt.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-40"
          >
            <Wand2 className={`w-4 h-4 ${gen.isPending ? "animate-pulse" : ""}`} />
            {gen.isPending ? "Üretiliyor…" : "Üret"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {[
            "Türkçe eczane / viagra spam",
            "Sahte iş teklifi phishing",
            "Kripto para yatırım pump",
            "Banka doğrulama phishing",
            "Sahte piyango / ödül maili",
          ].map((s) => (
            <button key={s} onClick={() => setPrompt(s)}
              className="mono text-[11px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-slate-300 hover:border-indigo-500/40 hover:text-indigo-300">
              {s}
            </button>
          ))}
        </div>

        {proposals.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-[11px] uppercase tracking-widest text-slate-500">Önerilen kurallar</div>
            {proposals.map((p, i) => (
              <div key={i} data-testid={`ai-proposal-${i}`}
                   className="p-3 rounded border border-indigo-500/20 bg-indigo-500/5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-slate-100">{p.name}</span>
                    <Badge>{p.target}</Badge>
                    <span className="mono text-amber-300 text-xs">skor {p.score.toFixed(1)}</span>
                  </div>
                  <div className="mono text-[11px] text-slate-300 bg-slate-950 border border-slate-800 rounded px-2 py-1 truncate">
                    {p.pattern}
                  </div>
                  {p.description && (
                    <div className="text-[11px] text-slate-500 mt-1">{p.description}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    data-testid={`ai-accept-${i}`}
                    onClick={() => { onAccept(p); setProposals(proposals.filter((_, k) => k !== i)); }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    title="Kurallara ekle"
                  >
                    <Check className="w-3 h-3" /> Ekle
                  </button>
                  <button
                    onClick={() => setProposals(proposals.filter((_, k) => k !== i))}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700"
                    title="Reddet"
                  >
                    <X className="w-3 h-3" /> Yok
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function Rules() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["rules"], queryFn: api.rules });
  const [form, setForm] = useState({
    name: "", pattern: "", score: 5.0, target: "any", enabled: true, description: "",
  });
  const [testForm, setTestForm] = useState({
    subject: "TEBRIKLER 850000 EUR KAZANDINIZ",
    from_addr: "winner@lottery-eu.info",
    body: "Sayın müşterimiz, lütfen ödülünüzü almak için http://example.tk adresine tıklayın.",
  });
  const [result, setResult] = useState(null);

  const add = useMutation({
    mutationFn: (p) => api.ruleAdd(p),
    onSuccess: () => { toast.success("Kural eklendi"); qc.invalidateQueries({ queryKey: ["rules"] });
      setForm({ name: "", pattern: "", score: 5.0, target: "any", enabled: true, description: "" }); },
    onError: () => toast.error("Kural eklenemedi"),
  });
  const del = useMutation({
    mutationFn: (id) => api.ruleDel(id),
    onSuccess: () => { toast.success("Silindi"); qc.invalidateQueries({ queryKey: ["rules"] }); },
  });
  const toggle = useMutation({
    mutationFn: ({ id, rule }) => api.ruleUpdate(id, { ...rule, enabled: !rule.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  });
  const scan = useMutation({
    mutationFn: (p) => api.scanTest(p),
    onSuccess: (data) => setResult(data),
  });

  return (
    <div className="p-6 grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-7 space-y-4">
        <Card>
          <CardHeader
            title="Özel SpamAssassin Kuralları"
            subtitle="Regex tabanlı; skor toplamı politikadaki eşiği geçerse mesaj karantinaya alınır"
            right={<Badge tone="brand">{(rules.data || []).length} kural</Badge>}
          />
          <CardBody className="border-b border-slate-800 bg-slate-950/40">
            <form
              onSubmit={(e) => { e.preventDefault();
                if (!form.name || !form.pattern) return toast.error("Ad ve desen zorunlu");
                add.mutate(form);
              }}
              className="grid grid-cols-12 gap-3"
            >
              <input placeholder="Kural adı" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="rule-name"
                className="col-span-12 md:col-span-4 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
              <input placeholder="/desen/i" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })}
                data-testid="rule-pattern"
                className="col-span-12 md:col-span-5 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
              <input type="number" step="0.1" value={form.score} onChange={(e) => setForm({ ...form, score: parseFloat(e.target.value) })}
                data-testid="rule-score"
                className="col-span-4 md:col-span-1 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
              <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}
                data-testid="rule-target"
                className="col-span-8 md:col-span-2 bg-slate-950 border border-slate-800 rounded-md px-2 py-2 text-sm">
                <option value="any">Herhangi</option>
                <option value="subject">Konu</option>
                <option value="body">Gövde</option>
                <option value="from">Kimden</option>
                <option value="header">Başlık</option>
              </select>
              <input placeholder="Açıklama (opsiyonel)" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="col-span-12 md:col-span-10 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
              <button type="submit" data-testid="rule-add"
                className="col-span-12 md:col-span-2 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20">
                <Plus className="w-3.5 h-3.5" /> Ekle
              </button>
            </form>
          </CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                  <th className="text-left px-4 py-3 font-semibold w-10">Aktif</th>
                  <th className="text-left px-4 py-3 font-semibold">Ad</th>
                  <th className="text-left px-4 py-3 font-semibold">Desen</th>
                  <th className="text-left px-4 py-3 font-semibold">Hedef</th>
                  <th className="text-right px-4 py-3 font-semibold">Skor</th>
                  <th className="text-right px-4 py-3 font-semibold w-10"></th>
                </tr>
              </thead>
              <tbody>
                {(rules.data || []).map((r) => (
                  <tr key={r.id} data-row data-testid={`rule-row-${r.id}`} className="border-t border-slate-800">
                    <td className="px-4 py-2.5">
                      <button data-testid={`rule-toggle-${r.id}`} onClick={() => toggle.mutate({ id: r.id, rule: r })} className="text-slate-400 hover:text-indigo-300">
                        {r.enabled ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5" />}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-200">{r.name}</div>
                      <div className="text-[11px] text-slate-500">{r.description}</div>
                    </td>
                    <td className="px-4 py-2.5 mono text-slate-300 text-xs truncate max-w-[220px]">{r.pattern}</td>
                    <td className="px-4 py-2.5"><Badge>{r.target}</Badge></td>
                    <td className="px-4 py-2.5 text-right mono text-amber-300">{r.score.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button data-testid={`rule-del-${r.id}`} onClick={() => del.mutate(r.id)} className="text-slate-500 hover:text-rose-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {(rules.data || []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Kural yok</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="col-span-12 lg:col-span-5 space-y-4">
        <AIRuleGenerator onAccept={(p) => add.mutate({ ...p, enabled: true })} />

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><FlaskConical className="w-4 h-4 text-indigo-400" /> Kural Test Cihazı</span>}
            subtitle="Örnek mesajınızın karantinaya girip girmeyeceğini simüle edin"
          />
          <CardBody className="space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Kimden</label>
              <input value={testForm.from_addr} onChange={(e) => setTestForm({ ...testForm, from_addr: e.target.value })}
                data-testid="test-from"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Konu</label>
              <input value={testForm.subject} onChange={(e) => setTestForm({ ...testForm, subject: e.target.value })}
                data-testid="test-subject"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Gövde</label>
              <textarea rows={5} value={testForm.body} onChange={(e) => setTestForm({ ...testForm, body: e.target.value })}
                data-testid="test-body"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
            </div>
            <button data-testid="test-run" onClick={() => scan.mutate(testForm)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 text-sm">
              <Play className="w-3.5 h-3.5" /> Tara
            </button>

            {result && (
              <div className="mt-2 p-3 rounded border border-slate-800 bg-slate-950">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-300">Toplam Skor</div>
                  <div className="mono text-2xl font-semibold text-amber-300">{result.score}</div>
                </div>
                <div className="text-xs text-slate-500 mono mb-2">eşik: {result.threshold_low} / {result.threshold_high}</div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-slate-500">Karar:</span>
                  <Badge tone={result.verdict === "clean" ? "success" : result.verdict === "high_spam" ? "danger" : "warning"}>
                    {result.verdict === "clean" ? "TEMİZ" : result.verdict === "high_spam" ? "YÜKSEK SPAM" : "SPAM"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {result.hits.map((h, i) => (
                    <span key={i} className="mono text-[11px] px-2 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-slate-300">
                      {h.name} <span className="text-amber-400">+{h.score}</span>
                    </span>
                  ))}
                  {result.hits.length === 0 && <span className="text-xs text-slate-500">Kural eşleşmedi</span>}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="İpuçları" />
          <CardBody className="text-xs text-slate-400 space-y-2">
            <p>• <span className="mono text-slate-300">/desen/i</span> biçiminde regex yazın (i = büyük/küçük harf duyarsız).</p>
            <p>• Skor 5.0 üstü mesajlar karantinaya alınır (Ayarlar → Eşikler).</p>
            <p>• Test cihazı canlı SpamAssassin çalıştırmaz — kaydedilmiş kurallar + sabit skorlar üzerinden çalışır.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
