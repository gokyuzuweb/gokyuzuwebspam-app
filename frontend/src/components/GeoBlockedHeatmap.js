import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ComposableMap, Geographies, Geography, Marker, Line } from "react-simple-maps";
import { geoMercator } from "d3-geo";
import { Globe2, Shield, TrendingUp, X, Ban, ShieldCheck, Radio, ShieldAlert, Bug, Fish, Zap } from "lucide-react";
import { api } from "@/lib/api";

// TopoJSON world atlas
const GEO_URL = "/geo/countries-110m.json";

// Hedef marker konumu (İstanbul merkez). Master için hedef master sunucusu,
// bayi için kendi sunucusudur — jenerik "Sizin Sunucunuz" etiketi kullanılır.
const TARGET = { name: "Sunucunuz", lat: 41.0, lon: 29.0 };

// TopoJSON'daki numeric ISO code → 2-letter mapping (kritik ülkeler için)
const ISO_NUM_TO_ALPHA2 = {
  "004": "AF", "008": "AL", "012": "DZ", "032": "AR", "036": "AU", "040": "AT",
  "056": "BE", "076": "BR", "100": "BG", "124": "CA", "152": "CL", "156": "CN",
  "170": "CO", "191": "HR", "196": "CY", "203": "CZ", "208": "DK", "233": "EE",
  "246": "FI", "250": "FR", "268": "GE", "276": "DE", "300": "GR", "348": "HU",
  "352": "IS", "356": "IN", "360": "ID", "364": "IR", "368": "IQ", "372": "IE",
  "376": "IL", "380": "IT", "392": "JP", "398": "KZ", "400": "JO", "404": "KE",
  "410": "KR", "414": "KW", "428": "LV", "440": "LT", "442": "LU", "504": "MA",
  "528": "NL", "554": "NZ", "578": "NO", "586": "PK", "608": "PH", "616": "PL",
  "620": "PT", "630": "PR", "634": "QA", "642": "RO", "643": "RU", "682": "SA",
  "688": "RS", "702": "SG", "703": "SK", "705": "SI", "710": "ZA", "724": "ES",
  "752": "SE", "756": "CH", "760": "SY", "764": "TH", "784": "AE", "788": "TN",
  "792": "TR", "804": "UA", "818": "EG", "826": "GB", "834": "TZ", "840": "US",
  "854": "BF", "858": "UY", "860": "UZ", "862": "VE", "704": "VN",
};

const CC_FLAG = (cc) => cc && cc.length === 2
  ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "🌐";

export default function GeoBlockedHeatmap({ compact = false }) {
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [hoverCC, setHoverCC] = useState(null);
  const [bayiFilter, setBayiFilter] = useState(""); // "" = tüm bayiler
  const [flashCC, setFlashCC] = useState(null); // WS event geldiğinde patlama tetikleyicisi
  const isMaster = typeof window !== "undefined" && !!localStorage.getItem("gws.master_license");

  // Master ise bayi listesi çek (dropdown için)
  const bayisQuery = useQuery({
    queryKey: ["licenses-for-geo-filter"],
    queryFn: () => api.licenses().catch(() => []),
    enabled: isMaster,
    staleTime: 60000,
  });
  const bayis = (bayisQuery.data || []).filter((l) =>
    l.license_key !== (typeof window !== "undefined" ? localStorage.getItem("gws.master_license") : "")
  );

  const q = useQuery({
    queryKey: ["geo-blocked-heatmap", bayiFilter],
    queryFn: () => api.geoBlockedHeatmap(bayiFilter || undefined),
    refetchInterval: 30000,
    staleTime: 20000,
  });
  const items = q.data?.items || [];
  const total = q.data?.total || 0;
  const maxCount = Math.max(1, ...items.map((i) => i.count));

  // WebSocket — canlı saldırı akışı (Landing anlık patlama animasyonu)
  useEffect(() => {
    const url = (process.env.REACT_APP_BACKEND_URL || window.location.origin)
      .replace(/^http/, "ws") + "/api/maintenance/ws/attacks";
    let ws;
    let closed = false;
    try {
      ws = new WebSocket(url);
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === "attack" && data.country) {
            setFlashCC({ cc: data.country, id: Date.now() + Math.random() });
            setTimeout(() => setFlashCC(null), 2000);
          }
        } catch (_) {}
      };
      ws.onerror = () => {};
      ws.onclose = () => { closed = true; };
    } catch (_) {}
    return () => {
      try { if (!closed && ws) ws.close(); } catch (_) {}
    };
  }, []);

  // CC → count/name/coord lookup
  const byCC = useMemo(() => {
    const m = {};
    for (const it of items) m[it.country] = it;
    return m;
  }, [items]);

  // Top 8 saldırı hattı — hedefimize doğru animasyonlu çizgi
  const topAttackers = items.filter((i) => i.lat != null && i.lon != null && i.country !== "TR").slice(0, 8);

  return (
    <section id="geo-heatmap" className={`${compact ? "" : "py-24"} relative overflow-hidden`}
             data-testid="landing-geo-heatmap">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(244,63,94,0.06),transparent_60%)]"/>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="text-center max-w-2xl mx-auto mb-8">
          <div className="text-xs uppercase tracking-widest text-rose-400 mono mb-2 flex items-center justify-center gap-2">
            <Shield className="w-3.5 h-3.5"/> Canlı Tehdit Haritası
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
              </span>
              CANLI
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-3 tracking-tight">
            Bloklanan IP'lerin <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-400 to-orange-400">coğrafi dağılımı</span>
          </h2>
          <p className="text-slate-400">
            <span className="text-rose-300 font-semibold tabular-nums">{total.toLocaleString("tr-TR")}</span> kötü niyetli IP · <span className="text-orange-300 font-semibold">{items.length}</span> farklı ülke
            <span className="text-slate-500"> · Bir ülkeye tıklayın</span>
          </p>
          {/* Master için bayi filtresi */}
          {isMaster && (
            <div className="mt-4 inline-flex items-center gap-2 text-xs bg-slate-900/70 border border-slate-800 rounded-lg px-3 py-2" data-testid="geo-bayi-filter">
              <span className="text-slate-500 uppercase tracking-widest text-[10px]">Bayi:</span>
              <select
                value={bayiFilter}
                onChange={(e) => setBayiFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 min-w-[220px] focus:border-emerald-500/60 outline-none"
                data-testid="geo-bayi-filter-select"
              >
                <option value="">— Tüm bayiler (birleşik) —</option>
                {bayis.map((l) => (
                  <option key={l.license_key} value={l.license_key}>
                    {(l.customer_name || l.customer_email || l.license_key.slice(0, 12))} · {l.plan}
                  </option>
                ))}
              </select>
              {bayiFilter && (
                <button
                  onClick={() => setBayiFilter("")}
                  className="text-slate-500 hover:text-slate-100 text-xs"
                  data-testid="geo-bayi-filter-clear"
                >
                  Temizle ✕
                </button>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* MAP */}
          <div className="lg:col-span-2 rounded-xl border border-slate-800 bg-gradient-to-br from-slate-950 to-slate-900 p-1 overflow-hidden">
            <div className="relative">
              <ComposableMap
                projection="geoMercator"
                projectionConfig={{ scale: 130, center: [15, 30] }}
                width={900} height={500}
                style={{ width: "100%", height: "auto" }}
                data-testid="geo-heatmap-svg"
              >
                <defs>
                  <linearGradient id="attackGradient" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity="0"/>
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.9"/>
                  </linearGradient>
                  <radialGradient id="targetPulse">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.9"/>
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0"/>
                  </radialGradient>
                  <radialGradient id="impactFlash">
                    <stop offset="0%" stopColor="#fef3c7" stopOpacity="1"/>
                    <stop offset="30%" stopColor="#f97316" stopOpacity="0.8"/>
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity="0"/>
                  </radialGradient>
                </defs>

                {/* Ülkeler */}
                <Geographies geography={GEO_URL}>
                  {({ geographies }) =>
                    geographies.map((geo) => {
                      const cc = ISO_NUM_TO_ALPHA2[geo.id] || null;
                      const data = cc ? byCC[cc] : null;
                      const isTarget = cc === "TR";
                      const intensity = data ? Math.min(1, data.count / maxCount) : 0;
                      const fillColor = isTarget
                        ? "#10b981"
                        : data
                        ? `rgba(244, 63, 94, ${0.2 + intensity * 0.7})`
                        : "#1e293b";
                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          fill={fillColor}
                          stroke="#334155"
                          strokeWidth={0.4}
                          onClick={() => data && setSelectedCountry(data)}
                          onMouseEnter={() => setHoverCC(cc)}
                          onMouseLeave={() => setHoverCC(null)}
                          style={{
                            default: { outline: "none", cursor: data ? "pointer" : "default",
                                       transition: "fill 0.2s" },
                            hover:   { outline: "none", fill: isTarget ? "#059669"
                                                             : data ? "#fb7185" : "#334155" },
                            pressed: { outline: "none" },
                          }}
                        />
                      );
                    })
                  }
                </Geographies>

                {/* Saldırı çizgileri — kavisli yay şeklinde animasyonlu */}
                <AttackArcs attackers={topAttackers} target={TARGET} />

                {/* Saldıran ülke bubble'ları */}
                {topAttackers.map((atk) => {
                  const r = 3 + Math.sqrt(atk.count / maxCount) * 10;
                  return (
                    <Marker key={atk.country} coordinates={[atk.lon, atk.lat]}
                            onClick={() => setSelectedCountry(atk)}
                            style={{ default: { cursor: "pointer" } }}>
                      <circle r={r + 3} fill="#f43f5e" opacity="0.2">
                        <animate attributeName="r" values={`${r};${r + 5};${r}`}
                                 dur="1.8s" repeatCount="indefinite"/>
                        <animate attributeName="opacity" values="0.3;0;0.3"
                                 dur="1.8s" repeatCount="indefinite"/>
                      </circle>
                      <circle r={r} fill="#f43f5e" stroke="#fff" strokeWidth="0.5" opacity="0.9"/>
                      <text textAnchor="middle" y={r + 8} fill="#fecdd3" fontSize="7"
                            fontWeight="bold" style={{ pointerEvents: "none" }}>
                        {atk.count}
                      </text>
                    </Marker>
                  );
                })}

                {/* Hedef (Türkiye) — büyük yeşil pulse */}
                <Marker coordinates={[TARGET.lon, TARGET.lat]}>
                  <circle r="18" fill="url(#targetPulse)">
                    <animate attributeName="r" values="16;24;16" dur="2s" repeatCount="indefinite"/>
                  </circle>
                  <circle r="5" fill="#10b981" stroke="#fff" strokeWidth="1"/>
                  <text textAnchor="middle" y={-10} fill="#a7f3d0" fontSize="8"
                        fontWeight="bold" style={{ pointerEvents: "none" }}>
                    HEDEF
                  </text>
                </Marker>
                {/* Realtime flash — WebSocket event geldiğinde saldıran ülkede patlama */}
                {flashCC && byCC[flashCC.cc] && byCC[flashCC.cc].lat != null && (
                  <Marker key={flashCC.id} coordinates={[byCC[flashCC.cc].lon, byCC[flashCC.cc].lat]}>
                    <circle r="4" fill="#fef3c7" opacity="0.9">
                      <animate attributeName="r" values="4;28;4" dur="1.6s" repeatCount="1" />
                      <animate attributeName="opacity" values="1;0.9;0" dur="1.6s" repeatCount="1" />
                    </circle>
                    <circle r="2" fill="#f43f5e">
                      <animate attributeName="r" values="2;18;2" dur="1.6s" repeatCount="1" />
                      <animate attributeName="opacity" values="1;0.5;0" dur="1.6s" repeatCount="1" />
                    </circle>
                  </Marker>
                )}
              </ComposableMap>

              {/* Hover tooltip */}
              {hoverCC && byCC[hoverCC] && (
                <div className="absolute top-3 right-3 bg-slate-950/90 border border-slate-700 rounded-md px-3 py-2 text-xs pointer-events-none">
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg leading-none">{CC_FLAG(hoverCC)}</span>
                    <span className="text-slate-100 font-semibold">{byCC[hoverCC].name}</span>
                  </div>
                  <div className="text-rose-300 mono mt-0.5">{byCC[hoverCC].count} IP bloklu</div>
                </div>
              )}
            </div>
            <div className="border-t border-slate-800 px-3 py-2">
              <MapFooterLiveTicker events={q.data?.recent_attacks || []} />
            </div>
          </div>

          {/* Top countries + Live feed side panel */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-rose-400"/> Top Ülkeler
                <span className="ml-auto text-[10px] text-slate-500 mono">{items.length} ülke</span>
              </div>
              {items.length === 0 ? (
                <div className="text-center text-xs text-slate-500 py-8">
                  <Globe2 className="w-10 h-10 text-slate-700 mx-auto mb-2"/>
                  Henüz bloklanmış IP yok
                </div>
              ) : (
                <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
                  {items.slice(0, 15).map((it, idx) => {
                    const v = it.verdicts || {};
                    const spam = (v.spam || 0) + (v.high_spam || 0);
                    const virus = v.virus || 0;
                    const phish = (v.phish || 0) + (v.phishing || 0);
                    return (
                      <button
                        key={it.country}
                        onClick={() => setSelectedCountry(it)}
                        data-testid={`geo-row-${it.country}`}
                        className="w-full flex items-center gap-2 text-xs hover:bg-slate-800/40 rounded px-1.5 py-1.5 transition-colors text-left group"
                      >
                        <span className="text-slate-600 w-5 text-right mono">#{idx + 1}</span>
                        <span className="text-lg leading-none">{CC_FLAG(it.country)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-slate-200 truncate">{it.name}</div>
                          <div className="flex items-center gap-1 mt-0.5">
                            {spam > 0 && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-rose-500/15 text-rose-300 mono" title="Spam">
                                <ShieldAlert className="w-2 h-2 inline"/> {spam}
                              </span>
                            )}
                            {virus > 0 && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/15 text-orange-300 mono" title="Virüs">
                                <Bug className="w-2 h-2 inline"/> {virus}
                              </span>
                            )}
                            {phish > 0 && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 mono" title="Phishing">
                                <Fish className="w-2 h-2 inline"/> {phish}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="w-16 bg-slate-800 rounded overflow-hidden h-1">
                          <div className="bg-gradient-to-r from-rose-500 to-orange-500 h-full"
                               style={{ width: `${(it.count / maxCount) * 100}%` }}/>
                        </div>
                        <span className="mono text-slate-100 text-xs font-semibold w-10 text-right">{it.count.toLocaleString("tr-TR")}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Canlı Saldırı Akışı — son 20 saldırı animasyonlu */}
            <LiveAttackFeed events={q.data?.recent_attacks || []} />
          </div>
        </div>
      </div>

      {selectedCountry && (
        <CountryDetailModal country={selectedCountry} licenseFilter={bayiFilter} onClose={() => setSelectedCountry(null)}/>
      )}
    </section>
  );
}

function CountryDetailModal({ country, onClose, licenseFilter }) {
  const qc = useQueryClient();
  const isMaster = typeof window !== "undefined" && !!localStorage.getItem("gws.master_license");
  const masterKey = typeof window !== "undefined" ? localStorage.getItem("gws.master_license") : "";
  const detail = useQuery({
    queryKey: ["geo-country-detail", country.country],
    queryFn: () => api.geoCountryDetail(country.country, 100),
  });
  // Yeni endpoint: mail_events kaynaklı IP'ler + bayi filtresi destekli
  const attackers = useQuery({
    queryKey: ["geo-country-ips", country.country, licenseFilter || ""],
    queryFn: () => api.geoCountryIps(country.country, licenseFilter || undefined, 100),
  });
  const [whitelisted, setWhitelisted] = useState(new Set());
  const whitelist = useMutation({
    mutationFn: (ip) => api.ipWhitelist({ ip, reason: "Yanlış pozitif — Harita modaldan" }),
    onSuccess: (_, ip) => {
      toast.success(`✓ ${ip} kalıcı whitelist'e eklendi`);
      setWhitelisted((s) => new Set([...s, ip]));
      qc.invalidateQueries({ queryKey: ["geo-blocked-heatmap"] });
      qc.invalidateQueries({ queryKey: ["landing-blocked-stats"] });
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Whitelist başarısız"),
  });
  const bulkBlock = useMutation({
    mutationFn: () => api.adminGeoBulkBlockCountry(country.country, masterKey, {
      limit: 200,
      note: `Toplu ülke bloklama · ${country.name} · Master`,
    }),
    onSuccess: (d) => {
      toast.success(`🛡️ ${country.name}: ${d.added} yeni IP blacklist'e eklendi`, {
        description: `${d.skipped_already_blocked} IP zaten bloktaydı`,
      });
      qc.invalidateQueries({ queryKey: ["geo-blocked-heatmap"] });
      qc.invalidateQueries({ queryKey: ["geo-country-detail", country.country] });
    },
    onError: (err) => toast.error(err?.response?.data?.detail || "Toplu bloklama başarısız"),
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
         onClick={onClose} data-testid="country-detail-modal">
      <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-2xl w-full max-h-[85vh] flex flex-col"
           onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-3xl leading-none">{CC_FLAG(country.country)}</span>
            <div>
              <div className="text-lg font-semibold text-slate-100">{country.name}</div>
              <div className="text-xs text-slate-400">
                {country.count} IP bloklu · Detaylı liste · Yanlış blok mu? "Whitelist" tuşuna basın
              </div>
            </div>
          </div>
          <button onClick={onClose} data-testid="country-modal-close"
                  className="text-slate-400 hover:text-slate-100">
            <X className="w-5 h-5"/>
          </button>
        </div>
        {/* Saldırı özet kartları — verdict kırılımı + son saldırı zamanı */}
        <CountryAttackSummary country={country} />
        {/* Master için toplu bloklama butonu */}
        {isMaster && (
          <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap bg-rose-500/5">
            <div className="text-[11px] text-slate-400 leading-relaxed">
              <b className="text-rose-300">Master işlemi:</b> {country.name}'a ait en aktif saldırgan 200 IP'yi tek tıkla blacklist'e ekle
              <span className="block text-[10px] text-slate-500 mt-0.5">Zaten blokta olanlar atlanır · geri alınabilir (Whitelist/Blacklist sayfasından)</span>
            </div>
            <button
              onClick={() => {
                if (confirm(`${country.name}'a ait 200 saldırgan IP'yi blacklist'e eklemek istediğinize emin misiniz?`)) {
                  bulkBlock.mutate();
                }
              }}
              disabled={bulkBlock.isPending}
              data-testid="country-bulk-block-btn"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold bg-gradient-to-r from-rose-500 to-orange-500 text-white shadow-lg shadow-rose-500/20 border border-rose-400/40 hover:brightness-110 disabled:opacity-60"
            >
              {bulkBlock.isPending ? <Radio className="w-3.5 h-3.5 animate-spin"/> : <Ban className="w-3.5 h-3.5"/>}
              🛡️ Ülkeyi Toplu Blokla
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Kalıcı blacklist kayıtları */}
          <div>
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
              <Ban className="w-3 h-3 text-rose-400"/> Blacklist Kayıtları
              <span className="ml-1 text-slate-600">({detail.data?.items?.length || 0})</span>
            </div>
            {detail.isLoading && <div className="text-center text-slate-500 py-4 text-xs">Yükleniyor...</div>}
            {detail.data && (detail.data.items || []).length === 0 && (
              <div className="text-center text-slate-500 py-4 text-xs">Kalıcı blacklist kaydı yok</div>
            )}
          {detail.data && (
            <div className="space-y-1.5">
              {(detail.data.items || []).map((it) => {
                const wl = whitelisted.has(it.ip);
                return (
                  <div key={it.ip} className={`flex items-center justify-between gap-2 text-xs rounded px-3 py-2 border ${
                    wl ? "bg-emerald-500/10 border-emerald-500/30 opacity-70" : "bg-slate-950 border-slate-800"
                  }`}>
                    <div className="min-w-0 flex-1">
                      <div className={`mono flex items-center gap-1.5 ${wl ? "text-emerald-200" : "text-rose-200"}`}>
                        {wl ? <ShieldCheck className="w-3 h-3"/> : <Ban className="w-3 h-3"/>} {it.ip}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">{it.reason || "Blok gerekçesi yok"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] mono text-slate-400">
                        {(it.created_at || "").slice(0, 19).replace("T", " ")}
                      </div>
                      <div className="text-[9px] text-slate-600 uppercase">
                        {it.source || "-"}
                        {it.confidence != null && ` · ${it.confidence}%`}
                      </div>
                    </div>
                    {!wl ? (
                      <button
                        onClick={() => whitelist.mutate(it.ip)}
                        disabled={whitelist.isPending}
                        data-testid={`whitelist-btn-${it.ip}`}
                        className="text-[10px] px-2 py-1 rounded bg-emerald-500/15 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-40 inline-flex items-center gap-1 shrink-0"
                      >
                        <ShieldCheck className="w-3 h-3"/> Whitelist
                      </button>
                    ) : (
                      <span className="text-[10px] text-emerald-300 font-semibold shrink-0">✓ eklendi</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </div>
          {/* Son saldırgan IP'ler (mail_events) */}
          <div>
            <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-orange-400"/> Son Saldıran IP'ler (30 gün)
              <span className="ml-1 text-slate-600">({attackers.data?.total || 0})</span>
            </div>
            {attackers.isLoading && <div className="text-center text-slate-500 py-4 text-xs">Yükleniyor...</div>}
            {attackers.data && (attackers.data.items || []).length === 0 && (
              <div className="text-center text-slate-500 py-4 text-xs">Bu ülkeden 30 gün içinde saldırı yok</div>
            )}
            {attackers.data && (attackers.data.items || []).length > 0 && (
              <div className="space-y-1" data-testid="country-attackers-list">
                {attackers.data.items.slice(0, 30).map((it) => {
                  const wl = whitelisted.has(it.ip);
                  const style = VERDICT_STYLE[it.verdict] || VERDICT_STYLE.blocked;
                  return (
                    <div key={it.ip} className={`flex items-center gap-2 text-xs rounded px-3 py-1.5 border ${
                      wl ? "bg-emerald-500/10 border-emerald-500/30 opacity-70" : "bg-slate-950 border-slate-800"
                    }`}>
                      <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold ${style.color} shrink-0`}>{style.label}</span>
                      <span className={`mono flex-1 min-w-0 truncate ${wl ? "text-emerald-200" : "text-orange-200"}`}>{it.ip}</span>
                      <span className="text-[10px] text-slate-500 mono shrink-0">×{it.count}</span>
                      <span className="text-[10px] text-slate-500 shrink-0 hidden sm:inline">
                        {(it.last_seen || "").slice(0, 16).replace("T", " ")}
                      </span>
                      {!wl && (
                        <button
                          onClick={() => whitelist.mutate(it.ip)}
                          disabled={whitelist.isPending}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-40 shrink-0"
                        >
                          WL
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


/**
 * LiveAttackFeed — son 20 saldırı olayını canlı akış olarak gösterir.
 * Her yeni event üstten girer, eski olanlar soluklaşır. Verdict'e göre
 * renk kodlanır. Landing sayfasında görsel canlılık için.
 */
const VERDICT_STYLE = {
  spam:      { icon: ShieldAlert, color: "text-rose-300",   bg: "bg-rose-500/10 border-rose-500/30",   label: "SPAM"   },
  high_spam: { icon: ShieldAlert, color: "text-rose-200",   bg: "bg-rose-500/15 border-rose-500/40",   label: "SPAM+"  },
  virus:     { icon: Bug,         color: "text-orange-300", bg: "bg-orange-500/10 border-orange-500/30", label: "VİRÜS" },
  phishing:  { icon: Fish,        color: "text-amber-300",  bg: "bg-amber-500/10 border-amber-500/30", label: "PHISH" },
  phish:     { icon: Fish,        color: "text-amber-300",  bg: "bg-amber-500/10 border-amber-500/30", label: "PHISH" },
  blocked:   { icon: Ban,         color: "text-slate-300",  bg: "bg-slate-800 border-slate-700",       label: "BLOK"  },
  block:     { icon: Ban,         color: "text-slate-300",  bg: "bg-slate-800 border-slate-700",       label: "BLOK"  },
};

/**
 * CountryAttackSummary — modalın üst kısmında ülke için verdict kırılımı
 * (spam/virüs/phish/blok sayaçları) ve son saldırı zamanını gösterir.
 */
function CountryAttackSummary({ country }) {
  const v = country.verdicts || {};
  const spam = (v.spam || 0) + (v.high_spam || 0);
  const virus = v.virus || 0;
  const phish = (v.phish || 0) + (v.phishing || 0);
  const blocked = (v.block || 0) + (v.blocked || 0);
  const fmtRel = (iso) => {
    if (!iso) return "—";
    const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (sec < 60) return `${sec} saniye önce`;
    if (sec < 3600) return `${Math.floor(sec / 60)} dakika önce`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} saat önce`;
    return `${Math.floor(sec / 86400)} gün önce`;
  };
  const cards = [
    { label: "Spam", value: spam, color: "text-rose-300", bg: "bg-rose-500/10 border-rose-500/30", Icon: ShieldAlert },
    { label: "Virüs", value: virus, color: "text-orange-300", bg: "bg-orange-500/10 border-orange-500/30", Icon: Bug },
    { label: "Phishing", value: phish, color: "text-amber-300", bg: "bg-amber-500/10 border-amber-500/30", Icon: Fish },
    { label: "Blok", value: blocked, color: "text-slate-300", bg: "bg-slate-800 border-slate-700", Icon: Ban },
  ];
  return (
    <div className="px-5 py-3 border-b border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="country-attack-summary">
      {cards.map((c) => (
        <div key={c.label} className={`rounded-md border p-2 ${c.bg}`}>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest">
            <c.Icon className={`w-3 h-3 ${c.color}`}/>
            <span className="text-slate-400">{c.label}</span>
          </div>
          <div className={`text-lg font-bold tabular-nums mt-0.5 ${c.color}`}>
            {c.value.toLocaleString("tr-TR")}
          </div>
        </div>
      ))}
      <div className="col-span-2 md:col-span-4 text-[11px] text-slate-400 pt-1 flex items-center justify-between flex-wrap gap-2">
        <span className="inline-flex items-center gap-1">
          <span className="text-slate-500">Son saldırı:</span>
          <span className="text-slate-200 font-medium">{fmtRel(country.last_attack_at)}</span>
          {country.last_attack_at && (
            <span className="text-slate-600 mono ml-1">· {new Date(country.last_attack_at).toLocaleString("tr-TR")}</span>
          )}
        </span>
        <span className="text-slate-500">
          Toplam olay: <span className="text-rose-300 font-bold tabular-nums">{country.count.toLocaleString("tr-TR")}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * MapFooterLiveTicker — harita altında yatay olarak kayan canlı saldırı
 * bandı. Yeni event'ler soldan girip sağa kayar; kayıt canlı görünsün diye
 * son 6 olay her zaman görünür.
 */
function MapFooterLiveTicker({ events = [] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const fmtRel = (iso) => {
    if (!iso) return "";
    const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (sec < 5) return "az önce";
    if (sec < 60) return `${sec}sn`;
    if (sec < 3600) return `${Math.floor(sec / 60)}dk`;
    return `${Math.floor(sec / 3600)}sa`;
  };
  const list = events.slice(0, 6);
  return (
    <div className="flex items-center gap-2 flex-wrap justify-center text-[10px]" data-testid="geo-footer-ticker">
      <span className="inline-flex items-center gap-1 text-emerald-300 mono shrink-0">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400"></span>
        </span>
        CANLI
      </span>
      {list.length === 0 ? (
        <span className="text-slate-500">Şu an aktif saldırı yok</span>
      ) : list.map((e, i) => {
        const s = VERDICT_STYLE[e.verdict] || VERDICT_STYLE.blocked;
        return (
          <span
            key={`${e.ts}-${i}`}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border ${s.bg} ${i === 0 ? "animate-in slide-in-from-left-2 fade-in duration-400" : ""}`}
            title={new Date(e.ts).toLocaleString("tr-TR")}
          >
            <span className="text-sm leading-none">{CC_FLAG(e.country)}</span>
            <span className={`${s.color} font-semibold`}>{s.label}</span>
            <span className="text-slate-400">{e.name || e.country}</span>
            <span className="text-slate-500 mono">· {fmtRel(e.ts)}</span>
          </span>
        );
      })}
      <span className="ml-auto flex items-center gap-3 text-slate-500 shrink-0">
        <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 bg-rose-500 rounded-full"/> saldırgan</span>
        <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"/> hedef</span>
      </span>
    </div>
  );
}



function AttackArcs({ attackers = [], target }) {
  // Kavisli path + hareketli mermi. ComposableMap default (scale:130, center:[15,30]).
  const projection = useMemo(
    () => geoMercator().scale(130).translate([400, 250]).center([15, 30]),
    []
  );
  const tp = projection([target.lon, target.lat]);
  if (!tp) return null;
  return (
    <g style={{ pointerEvents: "none" }}>
      {attackers.map((atk, i) => {
        const sp = projection([atk.lon, atk.lat]);
        if (!sp) return null;
        const [x1, y1] = sp;
        const [x2, y2] = tp;
        // Kontrol noktası — yayın tepe noktası, mesafeyle orantılı
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.hypot(dx, dy);
        const cx = (x1 + x2) / 2 + dy * 0.15;
        const cy = (y1 + y2) / 2 - dx * 0.15 - dist * 0.15;
        const d = `M ${x1},${y1} Q ${cx},${cy} ${x2},${y2}`;
        const dur = 1.4 + i * 0.25;
        const delay = -i * 0.35;
        return (
          <g key={atk.country}>
            {/* Statik yay — soluk arka plan */}
            <path
              d={d}
              fill="none"
              stroke="url(#attackGradient)"
              strokeWidth={1.2}
              strokeLinecap="round"
              opacity={0.35}
            />
            {/* Hareketli mermi — path boyunca ilerler */}
            <circle r="2.2" fill="#fecdd3" stroke="#f43f5e" strokeWidth="0.5">
              <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${delay}s`} path={d} rotate="auto" />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur={`${dur}s`} repeatCount="indefinite" begin={`${delay}s`} />
            </circle>
            {/* İkinci daha küçük mermi ofset ile */}
            <circle r="1.4" fill="#f97316" opacity="0.7">
              <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${delay - dur * 0.4}s`} path={d} />
              <animate attributeName="opacity" values="0;0.7;0.7;0" keyTimes="0;0.1;0.85;1" dur={`${dur}s`} repeatCount="indefinite" begin={`${delay - dur * 0.4}s`} />
            </circle>
          </g>
        );
      })}
      {/* Hedefte sürekli impact flash — merminin varışını taklit eder */}
      <circle cx={tp[0]} cy={tp[1]} r="6" fill="url(#impactFlash)">
        <animate attributeName="r" values="4;22;4" dur="1.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.9;0" dur="1.6s" repeatCount="indefinite" />
      </circle>
    </g>
  );
}


function LiveAttackFeed({ events = [] }) {
  const [tick, setTick] = useState(0);
  // 1sn'de bir "az önce" göstergesi yenilensin
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const fmtRel = (iso) => {
    if (!iso) return "";
    const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (sec < 5) return "az önce";
    if (sec < 60) return `${sec}sn`;
    if (sec < 3600) return `${Math.floor(sec / 60)}dk`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}sa`;
    return `${Math.floor(sec / 86400)}g`;
  };
  return (
    <div className="rounded-xl border border-rose-500/20 bg-gradient-to-b from-rose-500/5 to-slate-900/40 p-4" data-testid="geo-live-feed">
      <div className="text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2">
        <Radio className="w-4 h-4 text-rose-400 animate-pulse"/>
        Canlı Saldırı Akışı
        <span className="ml-auto text-[10px] text-slate-500 mono">{events.length} olay</span>
      </div>
      {events.length === 0 ? (
        <div className="text-center text-xs text-slate-500 py-6">
          <Zap className="w-8 h-8 text-slate-700 mx-auto mb-2"/>
          Şu an aktif saldırı yok
        </div>
      ) : (
        <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
          {events.slice(0, 20).map((e, idx) => {
            const style = VERDICT_STYLE[e.verdict] || VERDICT_STYLE.blocked;
            const Icon = style.icon;
            return (
              <div
                key={`${e.ts}-${e.country}-${idx}`}
                className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 border ${style.bg} ${idx === 0 ? "animate-in slide-in-from-top-2 fade-in duration-300" : ""}`}
                style={{ opacity: 1 - idx * 0.03 }}
                data-testid={`geo-live-event-${idx}`}
              >
                <Icon className={`w-3 h-3 ${style.color} shrink-0`}/>
                <span className="text-base leading-none shrink-0">{CC_FLAG(e.country)}</span>
                <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold ${style.color} shrink-0`}>
                  {style.label}
                </span>
                <span className="text-slate-300 truncate flex-1 min-w-0">{e.name || e.country}</span>
                <span className="text-[10px] text-slate-500 mono shrink-0">{fmtRel(e.ts)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
