import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ShieldCheck, ShieldX, Globe, User } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

function typeLabel(t) {
  return { ip: "IP", domain: "Alan Adı", email: "E-posta" }[t] || t;
}

function AddForm({ listType, onAdded }) {
  const [entry_type, setType] = useState("domain");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState("global");
  const [user, setUser] = useState("");
  const [note, setNote] = useState("");

  const add = useMutation({
    mutationFn: (p) => api.listAdd(p),
    onSuccess: () => {
      toast.success("Kayıt eklendi");
      setValue(""); setNote(""); setUser("");
      onAdded?.();
    },
    onError: () => toast.error("Ekleme başarısız"),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!value.trim()) return toast.error("Değer boş olamaz");
    add.mutate({
      list_type: listType, entry_type, value: value.trim(),
      scope, user: scope === "user" ? user.trim() : null, note,
    });
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-12 gap-2 items-end">
      <div className="col-span-12 md:col-span-2">
        <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Tip</label>
        <select value={entry_type} onChange={(e) => setType(e.target.value)}
          data-testid={`list-${listType}-type`}
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-2 text-sm">
          <option value="ip">IP</option>
          <option value="domain">Alan Adı</option>
          <option value="email">E-posta</option>
        </select>
      </div>
      <div className="col-span-12 md:col-span-4">
        <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Değer</label>
        <input value={value} onChange={(e) => setValue(e.target.value)}
          data-testid={`list-${listType}-value`}
          placeholder={entry_type === "ip" ? "185.220.101.42" : entry_type === "domain" ? "spammer.tk" : "user@spammer.tk"}
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono placeholder:text-slate-600" />
      </div>
      <div className="col-span-6 md:col-span-2">
        <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Kapsam</label>
        <select value={scope} onChange={(e) => setScope(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-2 text-sm">
          <option value="global">Global (Sunucu)</option>
          <option value="user">Kullanıcı</option>
        </select>
      </div>
      {scope === "user" ? (
        <div className="col-span-6 md:col-span-2">
          <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Kullanıcı</label>
          <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="cpanel-user"
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono" />
        </div>
      ) : (
        <div className="col-span-6 md:col-span-2">
          <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Not</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="opsiyonel"
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
        </div>
      )}
      <div className="col-span-12 md:col-span-2">
        <button
          data-testid={`list-${listType}-add`}
          type="submit"
          className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm border transition-colors ${
            listType === "white"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
          }`}
        >
          <Plus className="w-3.5 h-3.5" /> Ekle
        </button>
      </div>
    </form>
  );
}

function ListPanel({ listType }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(new Set());
  const q = useQuery({
    queryKey: ["lists", listType],
    queryFn: () => api.lists({ list_type: listType }),
  });
  const del = useMutation({
    mutationFn: (id) => api.listDel(id),
    onSuccess: () => { toast.success("Silindi"); qc.invalidateQueries({ queryKey: ["lists", listType] }); },
    onError: () => toast.error("Silme başarısız"),
  });
  const bulkDel = useMutation({
    mutationFn: (ids) => api.listBulkDelete(ids),
    onSuccess: (d) => {
      toast.success(`${d.deleted} kayıt silindi`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["lists", listType] });
    },
    onError: () => toast.error("Toplu silme başarısız"),
  });
  const purge = useMutation({
    mutationFn: () => api.listPurge(listType),
    onSuccess: (d) => {
      toast.success(`Liste tamamen temizlendi: ${d.deleted} kayıt silindi`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["lists", listType] });
    },
    onError: () => toast.error("Temizleme başarısız"),
  });

  const isWhite = listType === "white";
  const rows = q.data || [];
  const allChecked = rows.length > 0 && selected.size === rows.length;
  const someChecked = selected.size > 0 && selected.size < rows.length;
  const toggleAll = () => {
    if (allChecked) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };
  const toggleOne = (id) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSelected(n);
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {isWhite ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <ShieldX className="w-4 h-4 text-rose-400" />}
            {isWhite ? "Beyaz Liste (Whitelist)" : "Kara Liste (Blacklist)"}
          </span>
        }
        subtitle={isWhite ? "Puanlamayı atlayacak güvenilir kaynaklar" : "Doğrudan reddedilecek kaynaklar"}
        right={
          <div className="flex items-center gap-2">
            <Badge tone={isWhite ? "success" : "danger"}>{rows.length} kayıt</Badge>
            {selected.size > 0 && (
              <button
                data-testid={`list-${listType}-bulk-delete`}
                onClick={() => {
                  if (confirm(`${selected.size} seçili kaydı silmek istediğinizden emin misiniz?`)) {
                    bulkDel.mutate(Array.from(selected));
                  }
                }}
                disabled={bulkDel.isPending}
                className="text-xs px-2.5 py-1 rounded bg-amber-600/20 border border-amber-500/40 text-amber-300 hover:bg-amber-600/30 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3 inline mr-1" />
                Seçilenleri Sil ({selected.size})
              </button>
            )}
            <button
              data-testid={`list-${listType}-purge`}
              onClick={() => {
                if (rows.length === 0) return toast.info("Liste zaten boş");
                if (confirm(`TÜM listeyi (${rows.length} kayıt) silmek istediğinizden emin misiniz? Bu işlem geri alınamaz!`)) {
                  purge.mutate();
                }
              }}
              disabled={purge.isPending || rows.length === 0}
              className="text-xs px-2.5 py-1 rounded bg-rose-700/20 border border-rose-500/40 text-rose-300 hover:bg-rose-600/30 disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3 inline mr-1" />
              Komple Temizle
            </button>
          </div>
        }
      />
      <CardBody className="border-b border-slate-800 bg-slate-950/40">
        <AddForm listType={listType} onAdded={() => qc.invalidateQueries({ queryKey: ["lists", listType] })} />
      </CardBody>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-widest text-slate-500">
              <th className="text-left px-3 py-3 font-semibold w-10">
                <input
                  type="checkbox"
                  data-testid={`list-${listType}-check-all`}
                  checked={allChecked}
                  ref={(el) => el && (el.indeterminate = someChecked)}
                  onChange={toggleAll}
                  className="w-4 h-4 accent-indigo-500 cursor-pointer"
                />
              </th>
              <th className="text-left px-4 py-3 font-semibold">Tip</th>
              <th className="text-left px-4 py-3 font-semibold">Değer</th>
              <th className="text-left px-4 py-3 font-semibold">Kapsam</th>
              <th className="text-left px-4 py-3 font-semibold">Not</th>
              <th className="text-right px-4 py-3 font-semibold w-12"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-row data-testid={`list-${listType}-row-${r.id}`}
                  className={`border-t border-slate-800 ${selected.has(r.id) ? "bg-indigo-500/5" : ""}`}>
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    data-testid={`list-${listType}-check-${r.id}`}
                    checked={selected.has(r.id)}
                    onChange={() => toggleOne(r.id)}
                    className="w-4 h-4 accent-indigo-500 cursor-pointer"
                  />
                </td>
                <td className="px-4 py-2.5"><Badge tone="brand">{typeLabel(r.entry_type)}</Badge></td>
                <td className="px-4 py-2.5 mono text-slate-200">{r.value}</td>
                <td className="px-4 py-2.5 text-xs text-slate-400">
                  {r.scope === "global" ? (
                    <span className="inline-flex items-center gap-1"><Globe className="w-3 h-3" /> Global</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 mono"><User className="w-3 h-3" /> {r.user}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-400 truncate max-w-[280px]">{r.note || <span className="text-slate-600">—</span>}</td>
                <td className="px-4 py-2.5 text-right">
                  <button data-testid={`list-${listType}-del-${r.id}`} onClick={() => del.mutate(r.id)}
                    className="text-slate-500 hover:text-rose-400 transition-colors" title="Sil">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Kayıt yok</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function Lists() {
  const [tab, setTab] = useState("white");
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-1 border-b border-slate-800">
        {[
          { k: "white", label: "Beyaz Liste", icon: ShieldCheck, tone: "emerald" },
          { k: "black", label: "Kara Liste", icon: ShieldX, tone: "rose" },
        ].map((t) => (
          <button
            key={t.k}
            data-testid={`lists-tab-${t.k}`}
            onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors ${
              tab === t.k
                ? t.tone === "emerald" ? "border-emerald-400 text-emerald-300" : "border-rose-400 text-rose-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>
      <ListPanel listType={tab} />
    </div>
  );
}
