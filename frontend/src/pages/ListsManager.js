// v44.00.24 — Liste Merkezi (Modernize + Toplu İşlemler + Ülke Engelleme)
// Tek sayfa: whitelist/blacklist + ülke bazlı engel + geçmiş.
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Plus, Trash2, History, ShieldCheck, ShieldX, RefreshCw, Filter,
  Globe2, CheckSquare, Square, AlertTriangle, Sparkles,
} from "lucide-react";
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
  const colors = { ip: "#6366f1", domain: "#22d3ee", email: "#f59e0b", country: "#ec4899" };
  const labels = { ip: "IP", domain: "Domain", email: "E-posta", country: "Ülke" };
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
  // v44.00.44 — Ekle-de-Unut: hem whitelist hem blacklist otomatik
  // (whitelist -> Junk'tan INBOX'a tasi, blacklist -> INBOX'tan sil)
  // Kullaniciya cekbox gostermiyoruz; her zaman calisir.
  const purgeInbox = true;
  const purgeDays = 30;

  const add = useMutation({
    mutationFn: async () => {
      const r = await client.post("/lists-manager/add", {
        kind, entry_type, value: value.trim(), note,
        purge_from_inbox: purgeInbox,
        purge_days: purgeDays,
      });
      return r.data;
    },
    onSuccess: (d) => {
      const isWhite = d.kind === "whitelist";
      const emoji = isWhite ? "📥" : "🧹";
      const verb = isWhite ? "Junk'tan INBOX'a tasima" : "INBOX'tan temizleme";
      const suffix = d.purge_queued_licenses
        ? ` · ${emoji} ${d.purge_queued_licenses} sunucuda ${verb} kuyruklandi (2dk icinde)`
        : "";
      toast.success((d.added ? `✓ ${d.value} eklendi` : `${d.value} zaten mevcut`) + suffix);
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
      {/* v44.00.44 — Ekle-de-Unut bilgi banner'i */}
      <div className="w-full text-[11px] text-slate-400 border-t border-slate-800/40 mt-2 pt-2 flex items-start gap-2">
        <Sparkles className="w-3.5 h-3.5 text-amber-400 flex-none mt-0.5" />
        <div>
          <b className="text-amber-300">Ekle-de-Unut motoru aktif</b> — {kind === "whitelist"
            ? "Beyaz listeye eklediginiz domain'in son 30 gunluk mailleri Junk'tan INBOX'a otomatik geri gelir. SA seviyesinde -100 puan verilir (asla spam yapilmaz)."
            : "Kara listeye eklediginiz domain'in son 30 gunluk mailleri INBOX'tan otomatik silinir. SA seviyesinde +100 puan verilir (her zaman spam)."} 2 dakika icinde tum sunuculara yayilir.
        </div>
      </div>
      <button type="submit" disabled={add.isPending} data-testid="lm-add-btn"
        className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold flex items-center gap-1 disabled:opacity-60">
        <Plus className="w-4 h-4" /> {add.isPending ? "Ekleniyor…" : "Ekle"}
      </button>
    </form>
  );
}

function Row({ row, onDeleted, selected, onToggleSelect }) {
  const del = useMutation({
    mutationFn: async () => {
      if (row.entry_type === "country") {
        return (await client.delete(`/lists-manager/country-block/${row.value}`)).data;
      }
      return (await client.post("/lists-manager/delete", {
        kind: row.kind, entry_type: row.entry_type, value: row.value,
      })).data;
    },
    onSuccess: (d) => { toast.success(`${row.value} kaldırıldı (${d.removed || 1} kayıt)`); onDeleted?.(); },
    onError: (e) => toast.error("Silinemedi: " + (e.response?.data?.detail || e.message)),
  });

  const cc = row.entry_type === "country" ? (row.value || "").toUpperCase() : null;
  const flag = cc && cc.length === 2
    ? String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
    : null;

  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-900/40 text-sm" data-testid={`lm-row-${row.value}`}>
      <td className="px-2 py-2">
        <button onClick={() => onToggleSelect(row)} data-testid={`lm-check-${row.value}`}
                className="text-slate-500 hover:text-indigo-400" title="Seç">
          {selected ? <CheckSquare className="w-4 h-4 text-indigo-400" /> : <Square className="w-4 h-4" />}
        </button>
      </td>
      <td className="px-3 py-2"><KindBadge kind={row.kind} /></td>
      <td className="px-3 py-2"><TypeBadge t={row.entry_type} /></td>
      <td className="px-3 py-2 mono text-slate-100 break-all">
        {flag && <span className="mr-1.5 text-lg align-middle">{flag}</span>}
        {row.entry_type === "country" ? (row.country_name || row.value) : row.value}
      </td>
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
    queryFn: async () => (await client.get("/lists-manager/history?limit=200")).data,
  });
  if (q.isLoading) return <div className="p-4 text-slate-500 text-sm">Yükleniyor…</div>;
  const items = q.data?.items || [];
  if (!items.length) return <div className="p-6 text-slate-500 text-sm text-center">Geçmiş kayıt yok.</div>;
  const actionLabel = (a) => ({
    add: "+ ekle", delete: "− sil", bulk_delete: "⚡ toplu sil",
    country_block_add: "🌐 ülke engel", country_block_remove: "🌐 ülke kaldır",
  }[a] || a);
  const actionColor = (a) => a.startsWith("add") || a === "country_block_remove" ? "text-emerald-400" : "text-rose-400";
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
            <th className="px-3 py-2 text-left">Aksiyon</th>
            <th className="px-3 py-2 text-left">Liste</th>
            <th className="px-3 py-2 text-left">Tip</th>
            <th className="px-3 py-2 text-left">Değer</th>
            <th className="px-3 py-2 text-left">Not/Sayı</th>
            <th className="px-3 py-2 text-left">Zaman</th>
          </tr>
        </thead>
        <tbody>
          {items.map((h) => (
            <tr key={h.id} className="border-b border-slate-800/60 text-sm">
              <td className="px-3 py-2">
                <span className={`text-[10px] mono uppercase font-bold ${actionColor(h.action)}`}>
                  {actionLabel(h.action)}
                </span>
              </td>
              <td className="px-3 py-2">{h.kind && <KindBadge kind={h.kind} />}</td>
              <td className="px-3 py-2">{h.entry_type && <TypeBadge t={h.entry_type} />}</td>
              <td className="px-3 py-2 mono text-slate-100 break-all">{h.value || (h.q && `q=${h.q}`) || "—"}</td>
              <td className="px-3 py-2 text-slate-400 text-xs">
                {h.removed_count != null ? `${h.removed_count} kayıt silindi` : (h.note || "—")}
                {h.sample_values && h.sample_values.length > 0 && (
                  <div className="text-[10px] mono text-slate-600 mt-0.5 truncate max-w-[280px]">
                    {h.sample_values.slice(0, 3).join(", ")}{h.sample_values.length > 3 ? "…" : ""}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-[10px] text-slate-600 mono">{new Date(h.ts).toLocaleString("tr-TR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountryBlockPane({ onChange }) {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ["country-catalog"],
    queryFn: async () => (await client.get("/lists-manager/country-catalog")).data,
    staleTime: 3600000,
  });
  const list = useQuery({
    queryKey: ["country-blocks"],
    queryFn: async () => (await client.get("/lists-manager/country-blocks")).data,
    refetchInterval: 30000,
  });
  // v44.00.26 — GeoIP onboarding suggestions
  const suggestions = useQuery({
    queryKey: ["geoip-suggestions"],
    queryFn: async () => {
      const lk = localStorage.getItem("gws.event_license") || "";
      return (await client.get(`/mailscanner/geoip/suggestions?license_key=${lk}&days=30&limit=5`)).data;
    },
    staleTime: 60000,
  });
  const [cc, setCC] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");

  const add = useMutation({
    mutationFn: async (code = cc, extraNote = note) =>
      (await client.post("/lists-manager/country-block", {
        country_code: code, note: extraNote,
      })).data,
    onSuccess: (d) => {
      toast.success(d.added ? `🌐 ${d.country_name} engellendi` : `${d.country_code} zaten engelli`);
      setCC(""); setNote("");
      qc.invalidateQueries({ queryKey: ["country-blocks"] });
      qc.invalidateQueries({ queryKey: ["geoip-suggestions"] });
      qc.invalidateQueries({ queryKey: ["lists-manager-unified"] });
      onChange?.();
    },
    onError: (e) => toast.error(e.response?.data?.detail || e.message),
  });
  const bulkAdd = useMutation({
    mutationFn: async (codes) => {
      const results = [];
      for (const code of codes) {
        try {
          const r = await client.post("/lists-manager/country-block",
            { country_code: code, note: "GeoIP önerisi ile toplu eklendi" });
          results.push(r.data);
        } catch (_) { /* skip */ }
      }
      return results;
    },
    onSuccess: (res) => {
      toast.success(`🌐 ${res.filter(r => r?.added).length} ülke engellendi`);
      qc.invalidateQueries({ queryKey: ["country-blocks"] });
      qc.invalidateQueries({ queryKey: ["geoip-suggestions"] });
      qc.invalidateQueries({ queryKey: ["lists-manager-unified"] });
    },
  });
  const del = useMutation({
    mutationFn: async (code) => (await client.delete(`/lists-manager/country-block/${code}`)).data,
    onSuccess: (_, code) => {
      toast.success(`${code} engeli kaldırıldı`);
      qc.invalidateQueries({ queryKey: ["country-blocks"] });
      qc.invalidateQueries({ queryKey: ["geoip-suggestions"] });
      qc.invalidateQueries({ queryKey: ["lists-manager-unified"] });
      onChange?.();
    },
  });

  const items = list.data?.items || [];
  const sugItems = suggestions.data?.suggestions || [];
  const blockedSet = new Set(items.map(i => i.value));

  return (
    <div className="space-y-4 p-4">
      <div className="bg-rose-500/5 border border-rose-500/20 rounded-md p-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-300">
          <div className="font-semibold text-rose-300 mb-0.5">Ülke Bazlı Engelleme (GeoIP)</div>
          <div className="text-slate-400">
            Seçilen ülkelerden gelen mail'lerin IP'si GeoIP ile tespit edilip <b>otomatik reddedilir</b>.
            MailScanner motoru her gelen mailin <code>sender_ip</code>'sini kontrol eder — engelli ülkeden geliyorsa verdict=<code>country_blocked</code> olur.
          </div>
        </div>
      </div>

      {/* v44.00.26 — GeoIP Onboarding Önerileri */}
      {sugItems.length > 0 && (
        <div className="bg-indigo-500/5 border border-indigo-500/30 rounded-md p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Akıllı Öneri: En Çok Spam Aldığın Ülkeler
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Son 30 gün mail_events'in GeoIP analizinden — {suggestions.data?.note}
              </div>
            </div>
            <button data-testid="cb-suggest-bulk"
                    onClick={() => window.confirm(`${sugItems.length} önerilen ülke TOPLU engellensin mi?`) && bulkAdd.mutate(sugItems.map(s => s.code))}
                    disabled={bulkAdd.isPending}
                    className="text-xs px-3 py-1.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 whitespace-nowrap disabled:opacity-40">
              ⚡ {bulkAdd.isPending ? "Ekleniyor…" : `Hepsini Engelle (${sugItems.length})`}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
            {sugItems.map(s => (
              <div key={s.code} data-testid={`cb-suggestion-${s.code}`}
                   className="bg-slate-950 border border-indigo-500/20 rounded p-2.5 flex items-center gap-2">
                <div className="text-3xl shrink-0">{s.flag}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-100 truncate">{s.name}</div>
                  <div className="text-[10px] mono text-slate-500">{s.spam_count} spam · {s.unique_ips} IP</div>
                </div>
                <button onClick={() => add.mutate(s.code, `GeoIP önerisi: ${s.spam_count} spam`)}
                        disabled={add.isPending}
                        className="text-[10px] px-2 py-1 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 shrink-0"
                        title="Bu ülkeyi engelle">
                  Engelle
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add form */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 p-3 bg-slate-900/30 rounded-md border border-slate-800">
        <select value={cc} onChange={(e) => setCC(e.target.value)} data-testid="cb-select"
                className="bg-slate-950 border border-slate-800 rounded-md px-2 py-2 text-sm">
          <option value="">— Ülke seç —</option>
          {(catalog.data?.items || []).map(c => (
            <option key={c.code} value={c.code} disabled={blockedSet.has(c.code)}>
              {c.flag} {c.name} ({c.code}){blockedSet.has(c.code) ? " · zaten engelli" : ""}
            </option>
          ))}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Not (opsiyonel)"
               className="bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
        <button onClick={() => add.mutate()} disabled={!cc || add.isPending} data-testid="cb-add-btn"
                className="bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold rounded-md px-4 py-2 flex items-center justify-center gap-1 disabled:opacity-50">
          <Globe2 className="w-4 h-4" /> {add.isPending ? "Ekleniyor…" : "Ülkeyi Engelle"}
        </button>
      </div>

      {/* Quick pick popular */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">🌐 Sık Engellenen Ülkeler</div>
        <div className="flex flex-wrap gap-1.5">
          {["RU", "CN", "KP", "IR", "SY", "NG", "IN", "PK", "VN", "ID", "BD", "AF"].map(code => {
            const c = (catalog.data?.items || []).find(x => x.code === code);
            if (!c) return null;
            const blocked = blockedSet.has(code);
            return (
              <button key={code}
                      onClick={() => {
                        if (blocked) return;
                        add.mutate(code);
                      }}
                      disabled={blocked || add.isPending}
                      data-testid={`cb-quick-${code}`}
                      className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                        blocked
                          ? "bg-rose-500/10 text-rose-400 border-rose-500/30 cursor-not-allowed"
                          : "bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800"
                      }`}>
                {c.flag} {c.name} {blocked && "✕"}
              </button>
            );
          })}
        </div>
      </div>

      {/* Current blocks */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-slate-100 font-semibold">
            🚫 Engelli Ülkeler <span className="text-slate-500 text-xs">({items.length})</span>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Katalog ara…"
                 className="text-xs bg-slate-950 border border-slate-800 rounded px-2 py-1 w-40" />
        </div>
        {items.length === 0 ? (
          <div className="text-slate-500 text-sm text-center py-6">Henüz engelli ülke yok</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {items.map(it => (
              <div key={it.value} className="flex items-center justify-between p-2 bg-slate-900/40 border border-rose-500/20 rounded"
                   data-testid={`cb-row-${it.value}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-2xl">{it.flag}</span>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-100 truncate">{it.country_name}</div>
                    <div className="text-[10px] mono text-slate-500">{it.value}</div>
                  </div>
                </div>
                <button onClick={() => window.confirm(`${it.country_name} engeli kaldırılsın mı?`) && del.mutate(it.value)}
                        data-testid={`cb-remove-${it.value}`}
                        className="p-1.5 rounded hover:bg-rose-500/20 text-rose-400"
                        title="Engeli kaldır">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ListsManager() {
  // v44.00.24 — Modernize + Toplu İşlemler + Ülke Engelleme
  const [tab, setTab] = useState("all");    // all | whitelist | blacklist | country | history
  const [entry_type, setEntryType] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(() => new Map()); // key -> row
  const qc = useQueryClient();

  const kind = tab === "whitelist" ? "whitelist" : tab === "blacklist" ? "blacklist" : "";

  const list = useQuery({
    queryKey: ["lists-manager-unified", kind, entry_type, q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (kind) p.set("kind", kind);
      if (entry_type) p.set("entry_type", entry_type);
      if (q) p.set("q", q);
      p.set("limit", "1000");
      return (await client.get(`/lists-manager/unified?${p.toString()}`)).data;
    },
    refetchInterval: 30000,
    enabled: tab !== "history" && tab !== "country",
  });

  const bulkDel = useMutation({
    mutationFn: async (body) => (await client.post("/lists-manager/bulk-delete", body)).data,
    onSuccess: (d) => {
      toast.success(`⚡ ${d.removed} kayıt silindi`);
      setSelected(new Map());
      qc.invalidateQueries({ queryKey: ["lists-manager-unified"] });
      qc.invalidateQueries({ queryKey: ["lists-manager-history"] });
    },
    onError: (e) => toast.error(e.response?.data?.detail || e.message),
  });

  const items = list.data?.items || [];
  const sources = list.data?.sources || {};

  const rowKey = (r) => `${r.kind}-${r.entry_type}-${r.value}`;
  const toggleSelect = (row) => {
    const k = rowKey(row);
    const next = new Map(selected);
    if (next.has(k)) next.delete(k); else next.set(k, row);
    setSelected(next);
  };
  const toggleSelectAll = () => {
    if (selected.size === items.length && items.length > 0) {
      setSelected(new Map());
    } else {
      const m = new Map();
      items.forEach(r => m.set(rowKey(r), r));
      setSelected(m);
    }
  };

  const doBulkDeleteSelected = () => {
    if (selected.size === 0) return;
    if (!window.confirm(`Seçili ${selected.size} kayıt silinsin mi? Bu işlem geri alınamaz.`)) return;
    const ids = [...selected.values()].map(r => r.id).filter(Boolean);
    bulkDel.mutate({ ids });
  };
  const doBulkDeleteFiltered = () => {
    if (items.length === 0) return;
    if (!window.confirm(`Şu an filtrelenmiş ${items.length} kayıt TOPLU silinsin mi?\nFiltre: kind=${kind || "hepsi"}, tip=${entry_type || "hepsi"}, arama="${q || "-"}"`)) return;
    bulkDel.mutate({ kind: kind || null, entry_type: entry_type || null, q: q || null });
  };
  const doCleanAll = () => {
    if (!window.confirm(`⚠️ TÜM whitelist/blacklist kayıtları silinsin mi?\n(Toplam ${items.length}+ kayıt. Ülke engelleri korunur.)`)) return;
    if (!window.confirm("Emin misin? Tüm listeler temizlenecek. Onaylıyor musun?")) return;
    bulkDel.mutate({});
  };

  return (
    <div className="space-y-4 p-4 max-w-[1400px] mx-auto" data-testid="lists-manager-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-400" /> Liste Merkezi
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Tüm whitelist / blacklist kaynakları tek yerde — ekle, sil, ülke engelle, geçmişi gör.
            {tab !== "history" && tab !== "country" && (
              <span className="text-slate-600 ml-2">
                (UI: {sources.lists_ui || 0} · Motor: {sources.lists_maintenance || 0} · Legacy: {sources.trusted_domains || 0})
              </span>
            )}
          </p>
        </div>
        <button onClick={() => qc.invalidateQueries()}
          className="p-2 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300" title="Yenile"
          data-testid="lm-refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800 overflow-x-auto">
        {[
          { k: "all",       lbl: "Tümü",         Icon: ShieldCheck, color: "text-slate-300" },
          { k: "whitelist", lbl: "Beyaz Liste",  Icon: ShieldCheck, color: "text-emerald-400" },
          { k: "blacklist", lbl: "Kara Liste",   Icon: ShieldX,     color: "text-rose-400" },
          { k: "country",   lbl: "🌐 Ülke Engelle", Icon: Globe2,   color: "text-pink-400" },
          { k: "history",   lbl: "Geçmiş",       Icon: History,     color: "text-indigo-400" },
        ].map((t) => (
          <button key={t.k} onClick={() => { setTab(t.k); setSelected(new Map()); }} data-testid={`lm-tab-${t.k}`}
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
        ) : tab === "country" ? (
          <CountryBlockPane onChange={() => qc.invalidateQueries({ queryKey: ["lists-manager-unified"] })} />
        ) : (
          <>
            <AddForm onAdded={() => qc.invalidateQueries({ queryKey: ["lists-manager-unified"] })} />
            {/* Filtre bar */}
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-800 bg-slate-950/40">
              <Filter className="w-4 h-4 text-slate-500" />
              <select value={entry_type} onChange={(e) => setEntryType(e.target.value)} data-testid="lm-filter-type"
                className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-xs">
                <option value="">Tüm Tipler</option>
                <option value="domain">Domain</option>
                <option value="ip">IP</option>
                <option value="email">E-posta</option>
                <option value="country">Ülke</option>
              </select>
              <div className="flex-1 relative min-w-[220px]">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Değere veya nota göre ara…"
                  data-testid="lm-search"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md pl-8 pr-3 py-1.5 text-xs mono" />
              </div>
              <span className="text-[10px] text-slate-500 mono">{items.length} kayıt</span>
            </div>

            {/* Toplu işlem toolbar */}
            {items.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 p-2 border-b border-slate-800 bg-indigo-500/5">
                <button onClick={toggleSelectAll} data-testid="lm-select-all"
                        className="text-xs text-indigo-300 hover:text-indigo-200 flex items-center gap-1 px-2 py-1 rounded hover:bg-indigo-500/10">
                  {selected.size === items.length && items.length > 0
                    ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  {selected.size === items.length ? "Seçimi Kaldır" : "Tümünü Seç"}
                </button>
                <span className="text-[11px] mono text-slate-500">
                  {selected.size > 0 && <span className="text-indigo-300">✓ {selected.size} seçili</span>}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <button onClick={doBulkDeleteSelected} disabled={selected.size === 0 || bulkDel.isPending}
                          data-testid="lm-bulk-delete-selected"
                          className="text-xs px-2.5 py-1 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 disabled:opacity-40 whitespace-nowrap">
                    <Trash2 className="w-3 h-3 inline mr-1" />Seçilenleri Sil ({selected.size})
                  </button>
                  <button onClick={doBulkDeleteFiltered} disabled={items.length === 0 || bulkDel.isPending}
                          data-testid="lm-bulk-delete-filtered"
                          className="text-xs px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-40 whitespace-nowrap"
                          title="Şu an filtreye uyan tüm kayıtları sil">
                    Filtreyi Sil ({items.length})
                  </button>
                  <button onClick={doCleanAll} disabled={bulkDel.isPending}
                          data-testid="lm-clean-all"
                          className="text-xs px-2.5 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-40 whitespace-nowrap"
                          title="TÜM listeyi temizle (Ülke engelleri korunur)">
                    🧹 Hepsini Temizle
                  </button>
                </div>
              </div>
            )}

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
                      <th className="px-2 py-2 text-left w-10">✓</th>
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
                      <Row key={rowKey(r)} row={r}
                        selected={selected.has(rowKey(r))}
                        onToggleSelect={toggleSelect}
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
