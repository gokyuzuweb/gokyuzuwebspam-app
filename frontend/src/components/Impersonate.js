import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserCog, X, ChevronDown, LogOut, Loader2, Users2, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const LICKEY = () =>
  (typeof window !== "undefined" &&
    (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license"))) ||
  "";

/**
 * ImpersonationBar — Header'a bağlanır.
 * • İmpersonation AKTİFSE üstte kırmızı-mor banner + "Çık" butonu göster.
 * • Master için "Bayi Görüntüle" dropdown açar; bayi seçilince impersonation başlar.
 */
export function ImpersonationBar() {
  const { isMaster } = useIsMaster();
  const qc = useQueryClient();

  const st = useQuery({
    queryKey: ["impersonate-status"],
    queryFn: api.adminImpersonateStatus,
    refetchInterval: 30000,
    retry: false,
  });

  const stop = useMutation({
    mutationFn: api.adminImpersonateStop,
    onSuccess: () => {
      toast.success("Master görünümüne dönüldü");
      qc.invalidateQueries();
    },
  });

  if (!st.data?.active) return null;

  return (
    <div
      data-testid="impersonate-bar"
      className="border-b border-rose-500/40 bg-gradient-to-r from-rose-500/20 via-fuchsia-500/15 to-rose-500/20 px-6 py-2 flex items-center justify-between gap-3 flex-wrap"
    >
      <div className="flex items-center gap-2 text-xs text-rose-100">
        <UserCog className="w-4 h-4 text-rose-300" />
        <b>Bayi Görüntüleme Modu</b>
        <span className="text-rose-200/90">
          · <b>{st.data.customer_name || "?"}</b> ({st.data.plan?.toUpperCase()}) olarak görüyorsunuz
        </span>
        <span className="hidden md:inline text-rose-200/60 mono text-[10px]">
          · {(st.data.target_license_key || "").slice(0, 20)}…
        </span>
      </div>
      <button
        data-testid="impersonate-stop"
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-slate-950/60 border border-rose-400/40 text-rose-100 hover:bg-slate-950 disabled:opacity-50"
      >
        {stop.isPending ? <Loader2 className="w-3 h-3 animate-spin"/> : <LogOut className="w-3 h-3"/>}
        Master'a Dön
      </button>
    </div>
  );
}

/**
 * ImpersonatePicker — Master için header dropdown.
 * "Bayi Görüntüle ▾" → arama + liste + tek tık impersonate.
 */
export function ImpersonatePicker() {
  const { isMaster } = useIsMaster();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["licenses-brief"],
    queryFn: () => api.licenses(),
    enabled: !!isMaster && open,
    retry: false,
  });

  const st = useQuery({
    queryKey: ["impersonate-status"],
    queryFn: api.adminImpersonateStatus,
    enabled: !!isMaster,
    retry: false,
  });

  const start = useMutation({
    mutationFn: (target) => api.adminImpersonateStart(target, LICKEY()),
    onSuccess: (d) => {
      toast.success(`${d.customer_name} olarak görüntüleme başladı`);
      setOpen(false);
      // Force reload so all pages re-fetch with impersonation cookie
      setTimeout(() => window.location.reload(), 300);
    },
    onError: (e) => toast.error("Görüntüleme başarısız: " + (e?.response?.data?.detail || e.message)),
  });

  if (!isMaster || st.data?.active) return null;

  const items = (q.data || []).filter((l) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (l.customer_name || "").toLowerCase().includes(s)
        || (l.customer_email || "").toLowerCase().includes(s)
        || (l.license_key || "").toLowerCase().includes(s);
  }).slice(0, 30);

  return (
    <div className="relative">
      <button
        data-testid="impersonate-picker-btn"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-slate-700 bg-slate-800/60 text-slate-300 hover:bg-slate-700"
        title="Bir bayi olarak görüntüle"
      >
        <UserCog className="w-3.5 h-3.5" />
        Bayi Görüntüle
        <ChevronDown className="w-3 h-3 opacity-70" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            data-testid="impersonate-picker-panel"
            className="absolute right-0 top-full mt-1 w-80 rounded-lg border border-slate-800 bg-slate-950 shadow-2xl z-50 flex flex-col max-h-[500px]"
          >
            <div className="p-3 border-b border-slate-800">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  data-testid="impersonate-picker-search"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Bayi ara — isim, e-posta, lisans…"
                  className="w-full bg-slate-900 border border-slate-800 rounded-md pl-8 pr-2 py-1.5 text-xs"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {q.isLoading ? (
                <div className="p-4 text-center text-slate-500 text-xs"><Loader2 className="w-3 h-3 animate-spin inline mr-1"/> Yükleniyor…</div>
              ) : items.length === 0 ? (
                <div className="p-4 text-center text-slate-500 text-xs">Bayi bulunamadı</div>
              ) : (
                <ul className="divide-y divide-slate-800/40">
                  {items.map((l) => (
                    <li key={l.id}>
                      <button
                        data-testid={`impersonate-pick-${l.id}`}
                        onClick={() => start.mutate(l.license_key)}
                        disabled={start.isPending}
                        className="w-full text-left px-3 py-2 hover:bg-slate-900/60 disabled:opacity-50 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs text-slate-200 truncate">{l.customer_name || l.customer_email || "?"}</div>
                          <div className="text-[10px] text-slate-500 mono truncate">{l.license_key?.slice(0, 24)}…</div>
                        </div>
                        <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded shrink-0 ${
                          l.plan === "enterprise" ? "bg-fuchsia-500/15 text-fuchsia-200" :
                          l.plan === "pro"        ? "bg-emerald-500/15 text-emerald-300" :
                                                    "bg-slate-800 text-slate-300"
                        }`}>{l.plan || "starter"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
