/**
 * v43.77 — Slash Command Aliases Config Card
 *
 * Master kendi kısayollarını (macro) tanımlar.
 * Örnek:
 *   /allhealth → /run health-check @all
 *   /mystatus  → /run version-check @MS-C02AB...
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Terminal, Plus, Trash2, Save, Loader2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { client } from "@/lib/api";

export default function SlashAliasesConfigCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["slash-aliases-list"],
    queryFn: () => client.get("/slash-aliases").then(r => r.data),
    staleTime: 30_000,
  });
  const items = q.data?.items || [];
  const [newAlias, setNewAlias] = useState({ name: "", expansion: "", description: "" });

  const save = useMutation({
    mutationFn: (a) => client.post("/slash-aliases", a).then(r => r.data),
    onSuccess: () => {
      toast.success("Alias kaydedildi");
      setNewAlias({ name: "", expansion: "", description: "" });
      qc.invalidateQueries({ queryKey: ["slash-aliases-list"] });
      qc.invalidateQueries({ queryKey: ["slash-aliases"] });
    },
    onError: (e) => toast.error("Kaydedilemedi: " + (e?.response?.data?.detail || e.message)),
  });
  const del = useMutation({
    mutationFn: (name) => client.delete(`/slash-aliases/${name}`).then(r => r.data),
    onSuccess: () => {
      toast.success("Silindi");
      qc.invalidateQueries({ queryKey: ["slash-aliases-list"] });
      qc.invalidateQueries({ queryKey: ["slash-aliases"] });
    },
  });

  const isValid = /^[a-z0-9_-]{2,32}$/.test(newAlias.name) && (newAlias.expansion || "").trim().length >= 3;

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Terminal className="w-4 h-4 text-fuchsia-400"/> Slash Command Aliaslar (Macro)</span>}
        subtitle="Master kendi kısayollarını tanımlar. Örn: `/allhealth` → `/run health-check @all`"
      />
      <CardBody className="space-y-3">
        {/* Existing aliases */}
        {items.length > 0 && (
          <div className="space-y-1">
            {items.map((a) => (
              <div
                key={a.name}
                data-testid={`alias-row-${a.name}`}
                className="flex items-center gap-3 p-2 rounded border border-slate-800 bg-slate-900/40"
              >
                <span className="mono text-sm text-fuchsia-300 font-bold">/{a.name}</span>
                <span className="mono text-[11px] text-slate-500 flex-1 truncate">→ {a.expansion}</span>
                {a.description && <span className="text-[10px] text-slate-500 italic truncate max-w-[180px]">{a.description}</span>}
                <button
                  data-testid={`alias-delete-${a.name}`}
                  onClick={() => { if (window.confirm(`/${a.name} silinsin mi?`)) del.mutate(a.name); }}
                  className="text-slate-500 hover:text-rose-400"
                  title="Sil"
                >
                  <Trash2 className="w-3.5 h-3.5"/>
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Add form */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-start">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Kısayol Adı</label>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 mono">/</span>
              <input
                data-testid="alias-name"
                value={newAlias.name}
                onChange={(e) => setNewAlias((x) => ({ ...x, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") }))}
                placeholder="allhealth"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-sm mono text-slate-100"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Genişletme (Expansion)</label>
            <input
              data-testid="alias-expansion"
              value={newAlias.expansion}
              onChange={(e) => setNewAlias((x) => ({ ...x, expansion: e.target.value }))}
              placeholder="/run health-check @all"
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-sm mono text-slate-100"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Açıklama (ops)</label>
            <input
              data-testid="alias-desc"
              value={newAlias.description}
              onChange={(e) => setNewAlias((x) => ({ ...x, description: e.target.value }))}
              placeholder="Tüm bayı sağlık kontrolü"
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-sm text-slate-100"
            />
          </div>
        </div>
        <button
          data-testid="alias-save"
          onClick={() => save.mutate(newAlias)}
          disabled={!isValid || save.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-fuchsia-500 hover:bg-fuchsia-400 text-white text-xs font-semibold disabled:opacity-40"
        >
          {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Plus className="w-3.5 h-3.5"/>}
          Alias Ekle
        </button>
        <div className="text-[11px] text-slate-500">
          Kural: alias adı 2-32 karakter, sadece <code className="mono">a-z 0-9 _ -</code>. Slash panel'de <code className="mono">/aliasadı</code> yazınca genişler.
        </div>
      </CardBody>
    </Card>
  );
}
