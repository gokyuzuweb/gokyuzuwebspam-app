import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, FlaskConical, Play, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

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
