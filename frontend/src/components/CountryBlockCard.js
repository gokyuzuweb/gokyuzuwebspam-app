import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { Globe2, X, Ban, ShieldCheck, Clock, Zap, Search } from "lucide-react";
import { useIsMaster } from "@/hooks/useIsMaster";
import { api, API } from "@/lib/api";

const LICKEY = () => (typeof window !== "undefined"
  ? (localStorage.getItem("gws.event_license") || "")
  : "");

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS  = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cts", "Paz"];

export default function CountryBlockCard() {
  const { isMaster } = useIsMaster();
  const qc = useQueryClient();
  const [tab, setTab] = useState("list"); // list | picker | brute | time
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [action, setAction] = useState("block");
  const [activeHours, setActiveHours] = useState(new Set());
  const [activeDays, setActiveDays] = useState(new Set());
  const [ttl, setTtl] = useState(0); // 0 = süresiz
  const [note, setNote] = useState("");

  // Brute-force form
  const [bfMinutes, setBfMinutes] = useState(60);
  const [bfThreshold, setBfThreshold] = useState(50);
  const [bfTtl, setBfTtl] = useState(180);

  const rules   = useQuery({ queryKey: ["country-rules"], queryFn: api.countryRules, refetchInterval: 20000 });
  const catalog = useQuery({
    queryKey: ["country-catalog"],
    queryFn: () => axios.get(`${API}/security/country-catalog`).then(r => r.data),
    staleTime: 3600 * 1000,
  });

  const bulkAdd = useMutation({
    mutationFn: (payload) => axios.post(`${API}/security/country-rules/bulk`, payload,
      { params: { license_key: LICKEY() }, withCredentials: true }).then(r => r.data),
    onSuccess: (d) => {
      toast.success(`${d.inserted} kural eklendi${d.expire_at ? " (TTL var)" : ""}`);
      qc.invalidateQueries({ queryKey: ["country-rules"] });
      setSelected(new Set());
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });
  const del = useMutation({
    mutationFn: (c) => api.countryRuleDel(LICKEY(), c),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["country-rules"] }); toast.success("Silindi"); },
  });
  const bruteScan = useMutation({
    mutationFn: () => axios.post(`${API}/security/country-brute-force/scan`, {
      license_key: LICKEY(),
      minutes: Number(bfMinutes), threshold: Number(bfThreshold), ttl_minutes: Number(bfTtl),
    }).then(r => r.data),
    onSuccess: (d) => {
      if (d.triggered.length) toast.success(`🚨 ${d.triggered.length} ülke bloklandı: ${d.triggered.join(", ")}`);
      else toast.info("Eşik aşan ülke yok");
      qc.invalidateQueries({ queryKey: ["country-rules"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || e.message),
  });

  const items = rules.data?.items || [];
  const blockList = items.filter(i => i.action === "block");
  const allowList = items.filter(i => i.action === "allow");
  const countries = catalog.data?.items || [];

  const filtered = useMemo(() => {
    if (!search) return countries;
    const q = search.toLowerCase();
    return countries.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [countries, search]);

  const toggleCode = (code) => {
    const n = new Set(selected);
    n.has(code) ? n.delete(code) : n.add(code);
    setSelected(n);
  };
  const toggleHour = (h) => {
    const n = new Set(activeHours);
    n.has(h) ? n.delete(h) : n.add(h);
    setActiveHours(n);
  };
  const toggleDay = (d) => {
    const n = new Set(activeDays);
    n.has(d) ? n.delete(d) : n.add(d);
    setActiveDays(n);
  };

  const submitBulk = () => {
    if (selected.size === 0) return toast.error("En az bir ülke seç");
    bulkAdd.mutate({
      codes: Array.from(selected),
      action, note,
      active_hours: activeHours.size ? Array.from(activeHours) : null,
      active_days:  activeDays.size  ? Array.from(activeDays)  : null,
      ttl_minutes: Number(ttl) > 0 ? Number(ttl) : null,
      reason: "manual",
    });
  };

  return (
    <Card data-testid="country-block-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><Globe2 className="w-4 h-4 text-indigo-400"/> Coğrafi Güvenlik / Ülke Bazlı Engelleme</span>}
        subtitle="ISO 3166-1 alpha-2 · block/allow · zaman-tabanlı · brute-force otomatik"
        right={<span className="text-[11px] mono text-slate-500">{items.length} kural</span>}
      />
      <CardBody>
        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 bg-slate-950 rounded-md p-1 w-fit">
          {[
            { k: "list",   l: "Aktif Kurallar",  Icon: Ban },
            ...(isMaster ? [
              { k: "picker", l: "Ülke Seç (Toplu)", Icon: Search },
              { k: "time",   l: "Zaman-Tabanlı",   Icon: Clock },
              { k: "brute",  l: "Brute-Force Otomatik", Icon: Zap },
            ] : []),
          ].map(({ k, l, Icon }) => (
            <button key={k} data-testid={`cbc-tab-${k}`} onClick={() => setTab(k)}
                    className={`text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1
                    ${tab === k ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400 hover:text-slate-100"}`}>
              <Icon className="w-3 h-3"/>{l}
            </button>
          ))}
        </div>

        {tab === "list" && (
          <div className="space-y-3">
            <ChipList label="Bloklu Ülkeler" icon={<Ban className="w-3.5 h-3.5 text-rose-400"/>} items={blockList} tone="rose" onDelete={isMaster ? (c) => del.mutate(c) : null}/>
            <ChipList label="İzinli Ülkeler" icon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-400"/>} items={allowList} tone="emerald" onDelete={isMaster ? (c) => del.mutate(c) : null}/>
            {items.length === 0 && (
              <div className="text-xs text-slate-500 text-center py-6">
                Henüz kural yok. {isMaster ? "'Ülke Seç' tabından ekle." : "Master erişimi gerekli."}
              </div>
            )}
          </div>
        )}

        {tab === "picker" && isMaster && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500"/>
                <input data-testid="country-search" value={search} onChange={e => setSearch(e.target.value)}
                       placeholder="Ülke ara: türkiye, tr, çin…"
                       className="w-full pl-8 pr-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100"/>
              </div>
              <select data-testid="cbc-action" value={action} onChange={e => setAction(e.target.value)}
                      className="px-2 py-2 bg-slate-800 border border-slate-700 rounded text-sm">
                <option value="block">🚫 Blokla</option>
                <option value="allow">✅ İzinli</option>
              </select>
              <input type="number" data-testid="cbc-ttl" value={ttl} min={0}
                     onChange={e => setTtl(e.target.value)}
                     placeholder="TTL dk (0 = süresiz)"
                     className="w-32 px-2 py-2 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
              <button data-testid="cbc-submit" onClick={submitBulk} disabled={selected.size === 0 || bulkAdd.isPending}
                      className="text-xs px-4 py-2 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40">
                {selected.size} Ülke Kaydet
              </button>
            </div>
            <input data-testid="cbc-note" value={note} onChange={e => setNote(e.target.value)}
                   placeholder="Not (opsiyonel)"
                   className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100"/>
            <div className="max-h-72 overflow-y-auto border border-slate-800 rounded-md bg-slate-950/50 p-2">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-1">
                {filtered.map(c => (
                  <button
                    key={c.code}
                    data-testid={`cbc-country-${c.code}`}
                    onClick={() => toggleCode(c.code)}
                    className={`text-left text-xs px-2 py-1.5 rounded border transition-colors
                      ${selected.has(c.code)
                        ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200"
                        : "bg-slate-800/40 border-slate-800 text-slate-300 hover:bg-slate-800"}`}
                  >
                    <span className="mono text-[10px] text-slate-500 mr-1.5">{c.code}</span>
                    <span className="truncate inline-block max-w-[100px] align-middle">{c.name}</span>
                  </button>
                ))}
                {filtered.length === 0 && <div className="col-span-6 text-center text-slate-500 py-4">Sonuç yok</div>}
              </div>
            </div>
            <div className="text-[11px] text-slate-500">
              💡 Seçili: <span className="mono text-slate-300">{selected.size}</span>.
              {ttl > 0 && <> Süre bitince otomatik silinir ({ttl} dakika)</>}
            </div>
          </div>
        )}

        {tab === "time" && isMaster && (
          <div className="space-y-4">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Aktif Saatler (boş = 7/24)</div>
              <div className="grid grid-cols-12 gap-1">
                {HOURS.map(h => (
                  <button key={h} data-testid={`cbc-hour-${h}`} onClick={() => toggleHour(h)}
                          className={`text-[10px] mono px-1 py-1 rounded border
                          ${activeHours.has(h)
                            ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200"
                            : "bg-slate-800/40 border-slate-800 text-slate-500 hover:text-slate-300"}`}>
                    {String(h).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Aktif Günler (boş = hafta boyu)</div>
              <div className="flex gap-1">
                {DAYS.map((d, i) => (
                  <button key={d} data-testid={`cbc-day-${i}`} onClick={() => toggleDay(i)}
                          className={`text-xs px-3 py-1.5 rounded border
                          ${activeDays.has(i)
                            ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200"
                            : "bg-slate-800/40 border-slate-800 text-slate-500 hover:text-slate-300"}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[11px] text-slate-500 bg-slate-950/60 border border-slate-800 rounded p-3">
              📅 Örnek: yalnızca <b>gece 00:00-06:00 arası</b> tüm gün <b>Rusya + Çin</b>'i blokla → Saatler: 0-5, Günler: hepsi, Ülkeler: RU, CN.
              → "Ülke Seç" tabına dön → seçimi yap → Kaydet.
            </div>
          </div>
        )}

        {tab === "brute" && isMaster && (
          <div className="space-y-3">
            <div className="text-xs text-slate-400 bg-slate-950/60 border border-slate-800 rounded p-3">
              🔍 Son <b>N dakika</b>daki spam kaynak ülkeleri sayar; eşik üstündeki ülkeleri otomatik <b>TTL süresince</b> bloklar.
              Panel şu an bunu manuel çalıştırıyor — üstteki kartlarda otomatik bulguları gör.
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-slate-400 block space-y-1">
                <div>Pencere (dk)</div>
                <input type="number" data-testid="bf-minutes" value={bfMinutes} onChange={e => setBfMinutes(e.target.value)}
                       className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
              </label>
              <label className="text-xs text-slate-400 block space-y-1">
                <div>Eşik (spam sayısı)</div>
                <input type="number" data-testid="bf-threshold" value={bfThreshold} onChange={e => setBfThreshold(e.target.value)}
                       className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
              </label>
              <label className="text-xs text-slate-400 block space-y-1">
                <div>Blok Süresi (dk)</div>
                <input type="number" data-testid="bf-ttl" value={bfTtl} onChange={e => setBfTtl(e.target.value)}
                       className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm mono"/>
              </label>
            </div>
            <button data-testid="bf-scan" onClick={() => bruteScan.mutate()} disabled={bruteScan.isPending}
                    className="text-xs px-4 py-2 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 disabled:opacity-40">
              <Zap className="w-3 h-3 inline mr-1"/>{bruteScan.isPending ? "Taranıyor…" : "Şimdi Tara ve Otomatik Blokla"}
            </button>
            {bruteScan.data && (
              <div className="text-[11px] mono bg-slate-950 border border-slate-800 rounded p-2 max-h-40 overflow-y-auto">
                {Object.entries(bruteScan.data.counter || {}).sort((a, b) => b[1] - a[1]).map(([cc, n]) => (
                  <div key={cc} className={`flex justify-between ${(bruteScan.data.triggered || []).includes(cc) ? "text-rose-300" : "text-slate-400"}`}>
                    <span>{cc}</span><span>{n} spam {(bruteScan.data.triggered || []).includes(cc) && "🚫 blok"}</span>
                  </div>
                ))}
                {Object.keys(bruteScan.data.counter || {}).length === 0 && <div className="text-slate-500">Kayıt yok</div>}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ChipList({ label, icon, items, tone, onDelete }) {
  const cls = tone === "rose"
    ? "bg-rose-500/10 text-rose-300 border-rose-500/40"
    : "bg-emerald-500/10 text-emerald-300 border-emerald-500/40";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-1.5 flex items-center gap-1.5">
        {icon}{label} · {items.length}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map(it => {
          const hasSchedule = (it.active_hours && it.active_hours.length) || (it.active_days && it.active_days.length);
          const isAutoTTL = !!it.auto_expire_at;
          const isBrute = it.reason === "brute_force";
          return (
            <span key={it.country_code} data-testid={`country-chip-${it.country_code}`}
                  title={[
                    it.note,
                    hasSchedule && `saatler: ${(it.active_hours || []).join(",")} · günler: ${(it.active_days || []).join(",")}`,
                    isAutoTTL && `bitiş: ${(it.auto_expire_at || "").slice(0, 16)}`,
                    isBrute && "otomatik: brute_force",
                  ].filter(Boolean).join("\n")}
                  className={`text-xs mono px-2 py-0.5 rounded border ${cls} flex items-center gap-1
                    ${it.currently_active === false ? "opacity-50" : ""}`}>
              {it.country_code}
              {hasSchedule && <Clock className="w-3 h-3 opacity-70"/>}
              {isBrute && <Zap className="w-3 h-3 opacity-70"/>}
              {isAutoTTL && <span className="text-[10px] opacity-70">TTL</span>}
              {onDelete && (
                <button onClick={() => onDelete(it.country_code)} className="hover:text-slate-100" data-testid={`country-del-${it.country_code}`}>
                  <X className="w-3 h-3"/>
                </button>
              )}
            </span>
          );
        })}
        {items.length === 0 && <span className="text-xs text-slate-600">boş</span>}
      </div>
    </div>
  );
}
