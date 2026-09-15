// v44.00.21 — Liste Merkezi (Unified Whitelist/Blacklist Manager)
// Tek sayfa: tüm whitelist/blacklist kaynaklarını birleştirir, ekle/sil/geçmiş.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Trash2, History, ShieldCheck, ShieldX, RefreshCw, Filter } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui-primitives";
import { client } from "@/lib/api";

const sourceLabel = {
  lists_ui: "UI · Kara/Beyaz",
  lists_maintenance: "Motor · IP",
  trusted_domains: "Legacy · Domain",
};

function KindBadge({ kind }) {
  const w = kind === "whitelist";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] mono uppercase font-bold"
      style={{
        background: w ? "#10b98122" : "#f4335522",
        color: w ? "#10b981" : "#f43f5e",
      }}
    >
      {w ? <ShieldCheck className="w-3 h-3" /> : <ShieldX className="w-3 h-3" />}
      {w ? "Beyaz" : "Kara"}
    </span>
  );
}

function TypeBadge({ t }) {
  const colors = { ip: "#6366f1", domain: "#22d3ee", email: "#f59e0b" };
  const labels = { ip: "IP", domain: "Domain", email: "E-posta" };
  const c = colors[t] || "#94a3b8";
  return (
    <span className="text-[9px] mono uppercase px-1.5 py-0.5 rounded" style={{ background: c + "22", color: c }}>
      {labels[t] || t}
    </span>
  );
}

function AddForm({ onAdded }) {
  const [kind, setKind] = useState("whitelist");
  const [entry_type, setEntryType] = useState("domain");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      const r = await client.post("/lists-manager/add", {
        kind, entry_type, value: value.trim(), note,
      });
      return r.data;
    },
    onSuccess: (d) => {
      toast.success(d.added ? `✓ ${d.value} eklendi` : `${d.value} zaten mevcut`);
      setValue(""); setNote("");
      onAdded?.();
    },
    onError: (e) => toast.error("Ekleme başarısız: " + e.message),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!value.trim()) return toast.error("Değer boş olamaz");
    add.mutate();
  };

  const placeholder = { ip: "203.0.113.44", domain: "example.com", email: "user@spammer.tk" }[entry_type];

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 p-4 border-b border-slate-800 bg-slate-900/30">
      <div>
        <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Liste</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="lm-kind"
          className="bg-slate-950 border border-slate-800 rounded-md px-2 py-2 text-sm">
          <option value="whitelist">Beyaz (Whitelist)</option>
          <option value="blacklist">Kara (Blacklist)</option>
        </select>
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Tip</label>
        <select value={entry_type} onChange={(e) => setEntryType(e.target.value)} data-testid="lm-entry-type"
          className="bg-slate-950 border border-slate-800 rounded-md px-2 py-2 text-sm">
          <option value="domain">Alan Adı</option>
          <option value="ip">IP Adresi</option>
          <option value="email">E-posta</option>
        </select>
      </div>
      <div className="flex-1 min-w-[220px]">
        <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Değer</label>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder}
          data-testid="lm-value"
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono placeholder:text-slate-600" />
      </div>
      <div className="flex-1 min-w-[180px]">
        <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Not (ops.)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="iş ortağı, yanlış pozitif, …"
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
      </div>
      <button type="submit" disabled={add.isPending} data-testid="lm-add-btn"
        className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center gap-1 disabled:opacity-60">
        <Plus className="w-4 h-4" /> {add.isPending ? "Ekleniyor…" : "Ekle"}
      </button>
    </form>
  );
}

function Row({ row, onDeleted }) {
  const del = useMutation({
    mutationFn: async () => {
      const r = await client.post("/lists-manager/delete", {
        kind: row.kind, entry_type: row.entry_type, value: row.value,
      });
      return r.data;
    },
    onSuccess: (d) => { toast.success(`${row.value} kaldırıldı (${d.removed} kayıt)`); onDeleted?.(); },
    onError: (e) => toast.error("Silinemedi: " + (e.response?.data?.detail || e.message)),
  });

  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-900/40 text-sm" data-testid={`lm-row-${row.value}`}>
      <td className="px-3 py-2"><KindBadge kind={row.kind} /></td>
      <td className="px-3 py-2"><TypeBadge t={row.entry_type} /></td>
      <td className="px-3 py-2 mono text-slate-100 break-all">{row.value}</td>
      <td className="px-3 py-2 text-slate-400 text-xs max-w-[280px] truncate" title={row.note}>{row.note || "—"}</td>
      <td className="px-3 py-2 text-[10px] text-slate-500 mono">{sourceLabel[row.source] || row.source}</td>
      <td className="px-3 py-2 text-[10px] text-slate-600 mono whitespace-nowrap">
        {row.created_at ? new Date(row.created_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "-"}
      </td>
      <td className="px-3 py-2 text-right">
        <button type="button" onClick={() => window.confirm(`${row.value} kaldırılsın mı?`) && del.mutate()}
          disabled={del.isPending} data-testid={`lm-delete-${row.value}`}
          className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400 disabled:opacity-40">
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

function HistoryPane() {
  const q = useQuery({
    queryKey: ["lists-manager-history"],
    queryFn: async () => (await client.get("/lists-manager/history?limit=100")).data,
  });
  if (q.isLoading) return <div className="p-4 text-slate-500 text-sm">Yükleniyor…</div>;
  const items = q.data?.items || [];
  if (!items.length) return <div className="p-6 text-slate-500 text-sm text-center">Geçmiş kayıt yok.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
            <th className="px-3 py-2 text-left">Aksiyon</th>
            <th className="px-3 py-2 text-left">Liste</th>
            <th className="px-3 py-2 text-left">Tip</th>
            <th className="px-3 py-2 text-left">Değer</th>
            <th className="px-3 py-2 text-left">Not</th>
            <th className="px-3 py-2 text-left">Zaman</th>
          </tr>
        </thead>
        <tbody>
          {items.map((h) => (
            <tr key={h.id} className="border-b border-slate-800/60 text-sm">
              <td className="px-3 py-2">
                <span className={`text-[10px] mono uppercase font-bold ${h.action === "add" ? "text-emerald-400" : "text-rose-400"}`}>
                  {h.action === "add" ? "+ ekle" : "− sil"}
                </span>
              </td>
              <td className="px-3 py-2"><KindBadge kind={h.kind} /></td>
              <td className="px-3 py-2"><TypeBadge t={h.entry_type} /></td>
              <td className="px-3 py-2 mono text-slate-100 break-all">{h.value}</td>
              <td className="px-3 py-2 text-slate-400 text-xs">{h.note || "—"}</td>
              <td className="px-3 py-2 text-[10px] text-slate-600 mono">{new Date(h.ts).toLocaleString("tr-TR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ListsManager() {
  // v44.00.22 — cache-buster bump (force frontend rebuild)
  const [tab, setTab] = useState("all");    // all | whitelist | blacklist | history
  const [entry_type, setEntryType] = useState("");
  const [q, setQ] = useState("");
  const qc = useQueryClient();

  // Tab kind filter (sekme direkt kind belirler; ek filtre bar kaldırıldı)
  const kind = tab === "whitelist" ? "whitelist" : tab === "blacklist" ? "blacklist" : "";

  const list = useQuery({
    queryKey: ["lists-manager-unified", kind, entry_type, q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (kind) p.set("kind", kind);
      if (entry_type) p.set("entry_type", entry_type);
      if (q) p.set("q", q);
      p.set("limit", "500");
      return (await client.get(`/lists-manager/unified?${p.toString()}`)).data;
    },
    refetchInterval: 30000,
    enabled: tab !== "history",
  });

  const items = list.data?.items || [];
  const sources = list.data?.sources || {};

  return (
    <div className="space-y-4 p-4 max-w-[1400px] mx-auto" data-testid="lists-manager-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-400" /> Liste Merkezi
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Tüm whitelist / blacklist kaynakları tek yerde — ekle, sil, geçmişi gör.
            {tab !== "history" && (
              <span className="text-slate-600 ml-2">
                (UI: {sources.lists_ui || 0} · Motor: {sources.lists_maintenance || 0} · Legacy: {sources.trusted_domains || 0})
              </span>
            )}
          </p>
        </div>
        <button onClick={() => qc.invalidateQueries()}
          className="p-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300" title="Yenile">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs — 4 sekme yan yana */}
      <div className="flex gap-1 border-b border-slate-800 overflow-x-auto">
        {[
          { k: "all",       lbl: "Tümü",         Icon: ShieldCheck, color: "text-slate-300" },
          { k: "whitelist", lbl: "Beyaz Liste",  Icon: ShieldCheck, color: "text-emerald-400" },
          { k: "blacklist", lbl: "Kara Liste",   Icon: ShieldX,     color: "text-rose-400" },
          { k: "history",   lbl: "Geçmiş",       Icon: History,     color: "text-indigo-400" },
        ].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} data-testid={`lm-tab-${t.k}`}
            className={`px-4 py-2 text-sm font-semibold flex items-center gap-2 border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.k ? `${t.color} border-current` : "text-slate-500 border-transparent hover:text-slate-300"
            }`}>
            <t.Icon className="w-4 h-4" /> {t.lbl}
          </button>
        ))}
      </div>

      <Card>
        {tab === "history" ? (
          <HistoryPane />
        ) : (
          <>
            <AddForm onAdded={() => qc.invalidateQueries({ queryKey: ["lists-manager-unified"] })} />
            {/* Filtre bar (kind sekme tarafından belirleniyor) */}
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-800 bg-slate-950/40">
              <Filter className="w-4 h-4 text-slate-500" />
              <select value={entry_type} onChange={(e) => setEntryType(e.target.value)} data-testid="lm-filter-type"
                className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-xs">
                <option value="">Tüm Tipler</option>
                <option value="domain">Domain</option>
                <option value="ip">IP</option>
                <option value="email">E-posta</option>
              </select>
              <div className="flex-1 relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Değere veya nota göre ara…"
                  data-testid="lm-search"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md pl-8 pr-3 py-1.5 text-xs mono" />
              </div>
              <span className="text-[10px] text-slate-500 mono">{items.length} kayıt</span>
            </div>
            {list.isLoading ? (
              <div className="p-6 text-slate-500 text-sm">Yükleniyor…</div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                {entry_type || q ? "Filtreye uyan kayıt yok." : "Henüz kayıt yok. Yukarıdan ekleyin."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800 bg-slate-950/60">
                      <th className="px-3 py-2 text-left">Liste</th>
                      <th className="px-3 py-2 text-left">Tip</th>
                      <th className="px-3 py-2 text-left">Değer</th>
                      <th className="px-3 py-2 text-left">Not</th>
                      <th className="px-3 py-2 text-left">Kaynak</th>
                      <th className="px-3 py-2 text-left">Tarih</th>
                      <th className="px-3 py-2 text-right">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <Row key={`${r.source}-${r.entry_type}-${r.value}`} row={r}
                        onDeleted={() => qc.invalidateQueries({ queryKey: ["lists-manager-unified"] })} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
