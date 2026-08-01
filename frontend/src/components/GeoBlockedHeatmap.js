import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ComposableMap, Geographies, Geography, Marker, Line } from "react-simple-maps";
import { Globe2, Shield, TrendingUp, X, Ban, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";

// TopoJSON world atlas
const GEO_URL = "/geo/countries-110m.json";

// Türkiye = hedef (89.19.15.58 sunucusu — İstanbul yaklaşık)
const TARGET = { name: "Türkiye · gokyuzuhosting.com", lat: 41.0, lon: 29.0 };

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
  const q = useQuery({
    queryKey: ["geo-blocked-heatmap"],
    queryFn: api.geoBlockedHeatmap,
    refetchInterval: 30000,
    staleTime: 20000,
  });
  const items = q.data?.items || [];
  const total = q.data?.total || 0;
  const maxCount = Math.max(1, ...items.map((i) => i.count));

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
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-3 tracking-tight">
            Bloklanan IP'lerin <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-400 to-orange-400">coğrafi dağılımı</span>
          </h2>
          <p className="text-slate-400">
            {total.toLocaleString("tr-TR")} kötü niyetli IP · {items.length} farklı ülke
            <span className="text-slate-500"> · Bir ülkeye tıklayın</span>
          </p>
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

                {/* Saldırı çizgileri — animasyonlu, top attackers → hedef */}
                {topAttackers.map((atk, idx) => (
                  <Line
                    key={atk.country}
                    from={[atk.lon, atk.lat]}
                    to={[TARGET.lon, TARGET.lat]}
                    stroke="url(#attackGradient)"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeDasharray="4 6"
                  >
                    <animate attributeName="stroke-dashoffset"
                             from="0" to="-20" dur={`${1.2 + idx * 0.2}s`}
                             repeatCount="indefinite"/>
                  </Line>
                ))}

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
            <div className="text-[10px] text-slate-500 flex items-center justify-between px-3 py-2 border-t border-slate-800">
              <span>Otomatik yenileme · 30sn</span>
              <span className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-rose-500 rounded-full inline-block"/> saldırgan</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full inline-block"/> hedef sunucu</span>
              </span>
            </div>
          </div>

          {/* Top countries side panel */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-sm font-semibold text-slate-100 mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-rose-400"/> Top Ülkeler
            </div>
            {items.length === 0 ? (
              <div className="text-center text-xs text-slate-500 py-8">
                <Globe2 className="w-10 h-10 text-slate-700 mx-auto mb-2"/>
                Henüz bloklanmış IP yok
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {items.slice(0, 20).map((it, idx) => (
                  <button key={it.country}
                          onClick={() => setSelectedCountry(it)}
                          data-testid={`geo-row-${it.country}`}
                          className="w-full flex items-center gap-2 text-xs hover:bg-slate-800/40 rounded px-1.5 py-1 transition-colors text-left">
                    <span className="text-slate-600 w-5 text-right">#{idx + 1}</span>
                    <span className="text-lg leading-none">{CC_FLAG(it.country)}</span>
                    <span className="text-slate-200 flex-1 min-w-0 truncate">{it.name}</span>
                    <div className="w-20 bg-slate-800 rounded overflow-hidden h-1.5">
                      <div className="bg-gradient-to-r from-rose-500 to-orange-500 h-full"
                           style={{ width: `${(it.count / maxCount) * 100}%` }}/>
                    </div>
                    <span className="mono text-slate-300 w-10 text-right">{it.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedCountry && (
        <CountryDetailModal country={selectedCountry} onClose={() => setSelectedCountry(null)}/>
      )}
    </section>
  );
}

function CountryDetailModal({ country, onClose }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["geo-country-detail", country.country],
    queryFn: () => api.geoCountryDetail(country.country, 100),
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
        <div className="flex-1 overflow-y-auto p-4">
          {detail.isLoading && <div className="text-center text-slate-500 py-8">Yükleniyor...</div>}
          {detail.data && (detail.data.items || []).length === 0 && (
            <div className="text-center text-slate-500 py-8">Detay bulunamadı</div>
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
      </div>
    </div>
  );
}
