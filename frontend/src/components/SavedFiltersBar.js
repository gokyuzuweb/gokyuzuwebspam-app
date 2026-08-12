import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkPlus, X, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

const LICKEY = () => (typeof window !== "undefined"
  ? (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license") || "")
  : "");

/**
 * SavedFiltersBar — Kayıtlı filtre setleri paneli.
 *
 * Props:
 *  - module: "quarantine" | "live_events"
 *  - currentFilters: object (filtre state snapshot'ı)
 *  - onLoad: (filters) => void — seçilen filtre uygulanır
 *  - disabled?: bool
 *  - className?: string
 */
export default function SavedFiltersBar({ module, currentFilters, onLoad, disabled, className = "" }) {
  const qc = useQueryClient();
  const [saveMode, setSaveMode] = useState(false);
  const [name, setName] = useState("");

  const licKey = LICKEY();
  const q = useQuery({
    queryKey: ["saved-filters", module, licKey],
    queryFn: () => api.savedFilters({ module, ...(licKey ? { license_key: licKey } : {}) }),
    refetchInterval: 60000,
  });
  const items = q.data?.items || [];

  const createMut = useMutation({
    mutationFn: (payload) =>
      api.savedFilterCreate({ name: payload.name, module, filters: currentFilters },
                            licKey ? { license_key: licKey } : {}),
    onSuccess: () => {
      toast.success("Filtre kaydedildi");
      qc.invalidateQueries({ queryKey: ["saved-filters", module, licKey] });
      setSaveMode(false); setName("");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kaydedilemedi"),
  });

  const delMut = useMutation({
    mutationFn: (sid) => api.savedFilterDelete(sid, licKey ? { license_key: licKey } : {}),
    onSuccess: () => {
      toast.success("Silindi");
      qc.invalidateQueries({ queryKey: ["saved-filters", module, licKey] });
    },
  });

  const applyFilter = (item) => {
    try { onLoad?.(item.filters || {}); toast.success(`"${item.name}" uygulandı`); }
    catch (e) { toast.error("Filtre uygulanamadı"); }
  };

  const submitSave = () => {
    const nm = name.trim();
    if (!nm) return toast.error("Ad girin");
    createMut.mutate({ name: nm });
  };

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`} data-testid={`saved-filters-${module}`}>
      <div className="flex items-center gap-1 text-slate-400 text-xs">
        <Bookmark className="w-3.5 h-3.5 text-indigo-400" />
        <span>Kayıtlı:</span>
      </div>

      {items.length > 0 ? (
        <div className="flex items-center gap-1 flex-wrap">
          {items.map((it) => (
            <div key={it.id} className="inline-flex items-center rounded-md border border-slate-700 bg-slate-900/60 overflow-hidden">
              <button
                data-testid={`saved-filter-load-${it.id}`}
                onClick={() => applyFilter(it)}
                disabled={disabled}
                className="px-2 py-1 text-xs text-indigo-300 hover:bg-indigo-500/10 hover:text-indigo-200 transition disabled:opacity-40"
                title="Bu filtreyi uygula"
              >
                {it.name}
              </button>
              <button
                data-testid={`saved-filter-del-${it.id}`}
                onClick={() => { if (confirm(`"${it.name}" silinsin mi?`)) delMut.mutate(it.id); }}
                className="px-1.5 py-1 border-l border-slate-700 text-slate-500 hover:bg-rose-500/10 hover:text-rose-300 transition"
                title="Sil"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-[11px] text-slate-500 italic">— henüz kaydedilmiş filtre yok</span>
      )}

      {saveMode ? (
        <div className="inline-flex items-center gap-1">
          <input
            data-testid={`saved-filter-name-input-${module}`}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitSave(); if (e.key === "Escape") { setSaveMode(false); setName(""); } }}
            placeholder="Filtre adı (örn: Bugün ≥8)"
            className="bg-slate-950 border border-indigo-500/40 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 w-44"
          />
          <button
            data-testid={`saved-filter-save-confirm-${module}`}
            onClick={submitSave}
            disabled={createMut.isPending}
            className="p-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
            title="Kaydet"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setSaveMode(false); setName(""); }}
            className="p-1 rounded text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            title="İptal"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          data-testid={`saved-filter-new-${module}`}
          onClick={() => setSaveMode(true)}
          disabled={disabled}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-indigo-500/30 bg-indigo-500/5 text-indigo-300 hover:bg-indigo-500/10 text-xs disabled:opacity-40"
          title="Mevcut filtre durumunu kaydet"
        >
          <BookmarkPlus className="w-3 h-3" /> Yeni Kaydet
        </button>
      )}
    </div>
  );
}
