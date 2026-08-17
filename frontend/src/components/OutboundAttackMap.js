/**
 * v43.63 — Outbound Attack Map
 *
 * Kontrol Paneli'ndeki AttackMap ile IDENTIK görsel/davranış.
 * Farkı: veri kaynağı outbound (Türkiye → hedef ülkeler), yön ters.
 * Renk paleti cyan/emerald (giden = güvenli, spam turuncu, blocked kırmızı).
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { geoEqualEarth } from "d3-geo";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { Globe2, Activity, MapPin } from "lucide-react";

const GEO_URL = "/geo/countries-110m.json";

const COUNTRY_NAMES = {
  US: "Amerika", CN: "Çin", RU: "Rusya", DE: "Almanya", TR: "Türkiye",
  GB: "Birleşik Krallık", IN: "Hindistan", BR: "Brezilya", JP: "Japonya",
  KR: "Güney Kore", NL: "Hollanda", FR: "Fransa", IT: "İtalya", ES: "İspanya",
  CA: "Kanada", AU: "Avustralya", MX: "Meksika", ID: "Endonezya",
  AR: "Arjantin", UA: "Ukrayna", PL: "Polonya", SE: "İsveç",
  SA: "S. Arabistan", AE: "BAE", EG: "Mısır", ZA: "G. Afrika", NG: "Nijerya",
  VN: "Vietnam", TH: "Tayland", SG: "Singapur", MY: "Malezya", PH: "Filipinler",
  IR: "İran", PK: "Pakistan", BD: "Bangladeş", IL: "İsrail", GR: "Yunanistan",
  PT: "Portekiz", BE: "Belçika", AT: "Avusturya", CH: "İsviçre",
  NZ: "Yeni Zelanda", NO: "Norveç", DK: "Danimarka", FI: "Finlandiya",
  IE: "İrlanda", KE: "Kenya", RO: "Romanya", HU: "Macaristan",
  CZ: "Çekya", SK: "Slovakya", BG: "Bulgaristan",
};

export default function OutboundAttackMap({ hours = 6, onCountryClick }) {
  const [hover, setHover] = useState(null);
  const q = useQuery({
    queryKey: ["outbound-attack-map", hours],
    queryFn: () => api.outboundAttackMap(hours),
    refetchInterval: 10000,
    staleTime: 0,
  });

  const items = q.data?.items || [];
  const total = items.reduce((s, it) => s + (it.count || 0), 0);
  const maxCount = Math.max(1, ...items.map((i) => i.count || 0));

  // Origin: Turkey WHM sunucusu (backend'den de gelir ama sabit koy)
  const ORIGIN = q.data?.origin || { lat: 38.96, lon: 35.24, country: "TR", label: "WHM Sunucusu · Türkiye" };

  const projection = useMemo(
    () => geoEqualEarth().scale(180).translate([490, 240]),
    []
  );
  const topDest = items.slice(0, 8);

  return (
    <Card data-testid="outbound-attack-map-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><Globe2 className="w-4 h-4 text-cyan-400"/> Canlı Giden Mail Haritası</span>}
        subtitle={`Son ${hours} saatte ${items.length} ülkeye ${total} mail · Türkiye → dünya kavis akışı`}
        right={<Badge tone="info"><Activity className="w-3 h-3 mr-1 inline"/>{q.data?.events_total ?? 0} olay</Badge>}
      />
      <CardBody className="pt-0">
        <div className="relative w-full aspect-[2/1] bg-slate-950 rounded-lg overflow-hidden border border-slate-800">
          <ComposableMap projection="geoEqualEarth" width={980} height={480}
                          style={{ width: "100%", height: "100%" }}>
            <Geographies geography={GEO_URL}>
              {({ geographies }) => geographies.map((g) => (
                <Geography
                  key={g.rsmKey}
                  geography={g}
                  fill="#0f172a"
                  stroke="#1e293b"
                  strokeWidth={0.5}
                  style={{
                    default: { outline: "none" },
                    hover:   { fill: "#1e293b", outline: "none" },
                    pressed: { outline: "none" },
                  }}
                />
              ))}
            </Geographies>
            {/* Türkiye → hedef kavisli yaylar + hareketli meteor mermileri */}
            <defs>
              <linearGradient id="ob-out-gradient" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0"/>
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.85"/>
              </linearGradient>
              <linearGradient id="ob-out-spam" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#f97316" stopOpacity="0"/>
                <stop offset="100%" stopColor="#f97316" stopOpacity="0.85"/>
              </linearGradient>
              <radialGradient id="ob-origin-flash">
                <stop offset="0%" stopColor="#f0f9ff" stopOpacity="1"/>
                <stop offset="40%" stopColor="#22d3ee" stopOpacity="0.8"/>
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0"/>
              </radialGradient>
            </defs>
            {(() => {
              const op = projection([ORIGIN.lon, ORIGIN.lat]);
              if (!op) return null;
              return (
                <g style={{ pointerEvents: "none" }}>
                  {topDest.map((dst, i) => {
                    const dp = projection([dst.lon, dst.lat]);
                    if (!dp) return null;
                    const [x1, y1] = op;
                    const [x2, y2] = dp;
                    const dx = x2 - x1;
                    const dy = y2 - y1;
                    const dist = Math.hypot(dx, dy);
                    const cx = (x1 + x2) / 2 + dy * 0.15;
                    const cy = (y1 + y2) / 2 - dx * 0.15 - dist * 0.15;
                    const d = `M ${x1},${y1} Q ${cx},${cy} ${x2},${y2}`;
                    const dur = 1.6 + i * 0.2;
                    const delay = -i * 0.3;
                    const spamPct = (dst.spam + dst.high_spam) / Math.max(dst.count, 1);
                    const gradId = spamPct >= 0.25 ? "ob-out-spam" : "ob-out-gradient";
                    const bulletColor = spamPct >= 0.25 ? "#fed7aa" : "#a5f3fc";
                    const strokeColor = spamPct >= 0.25 ? "#f97316" : "#22d3ee";
                    return (
                      <g key={dst.country}>
                        <path d={d} fill="none" stroke={`url(#${gradId})`} strokeWidth={1.2}
                              strokeLinecap="round" opacity={0.4}/>
                        <circle r="2" fill={bulletColor} stroke={strokeColor} strokeWidth="0.5">
                          <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${delay}s`} path={d}/>
                          <animate attributeName="opacity" values="0;1;1;0"
                                   keyTimes="0;0.1;0.85;1" dur={`${dur}s`}
                                   repeatCount="indefinite" begin={`${delay}s`}/>
                        </circle>
                      </g>
                    );
                  })}
                  {/* Türkiye origin: parlak beacon */}
                  <circle cx={op[0]} cy={op[1]} r="6" fill="url(#ob-origin-flash)">
                    <animate attributeName="r" values="4;20;4" dur="1.6s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0;0.9;0" dur="1.6s" repeatCount="indefinite"/>
                  </circle>
                  <circle cx={op[0]} cy={op[1]} r="3" fill="#22d3ee"/>
                </g>
              );
            })()}
            {items.map((it) => {
              const spamPct = (it.spam + it.high_spam) / Math.max(it.count, 1);
              const isSpammy = spamPct >= 0.25;
              const rad = 4 + Math.round((it.count / maxCount) * 14);
              const stroke = it.blocked > 0 ? "#f43f5e" : isSpammy ? "#f97316" : "#10b981";
              const fill   = it.blocked > 0 ? "#fb7185" : isSpammy ? "#fdba74" : "#6ee7b7";
              return (
                <Marker
                  key={it.country}
                  coordinates={[it.lon, it.lat]}
                  onMouseEnter={(e) => setHover({ item: it, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setHover((h) => h ? { ...h, x: e.clientX, y: e.clientY } : null)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onCountryClick?.(it)}
                  style={{ cursor: onCountryClick ? "pointer" : "default" }}
                  data-testid={`ob-attack-country-${it.country}`}
                >
                  <circle r={rad + 6} fill={fill} opacity={0.15}>
                    <animate attributeName="r" values={`${rad+6};${rad+14};${rad+6}`}
                             dur="2.4s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.35;0.05;0.35"
                             dur="2.4s" repeatCount="indefinite"/>
                  </circle>
                  <circle r={rad} fill={fill} fillOpacity={0.7} stroke={stroke} strokeWidth={1.2}/>
                  <text x={rad + 4} y={4} fill="#e2e8f0" fontSize="9" fontFamily="JetBrains Mono">
                    {it.country}·{it.count}
                  </text>
                </Marker>
              );
            })}
          </ComposableMap>

          {/* Top-right leaderboard */}
          <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur border border-slate-800 rounded-md p-2 text-[11px] mono text-slate-300 max-w-[200px]">
            <div className="text-cyan-400 mb-1 flex items-center gap-1"><MapPin className="w-3 h-3"/> Hedef · son {hours}s</div>
            {items.slice(0, 6).map((it) => {
              const spamPct = (it.spam + it.high_spam) / Math.max(it.count, 1);
              const tone = it.blocked > 0 ? "text-rose-400" : spamPct >= 0.25 ? "text-orange-300" : "text-emerald-300";
              return (
                <div key={it.country}
                     onClick={() => onCountryClick?.(it)}
                     className={`flex justify-between gap-2 ${onCountryClick ? "cursor-pointer hover:bg-slate-800/50 rounded px-1" : ""}`}
                     data-testid={`ob-attack-lb-${it.country}`}
                     title={onCountryClick ? "Tıkla → bu ülkeye giden mailleri filtrele" : ""}>
                  <span title={COUNTRY_NAMES[it.country] || it.country}>{it.country}</span>
                  <span className={tone}>{it.count}</span>
                </div>
              );
            })}
            {items.length === 0 && <div className="text-slate-500">Veri bekliyor…</div>}
            {onCountryClick && items.length > 0 && (
              <div className="text-[9px] text-slate-600 mt-1 pt-1 border-t border-slate-800">tıkla → filtrele</div>
            )}
          </div>

          {/* Legend */}
          <div className="absolute bottom-2 left-2 flex items-center gap-3 text-[10px] mono text-slate-400 bg-slate-900/70 rounded px-2 py-1">
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-cyan-400 inline-block"/>server TR</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-emerald-400 inline-block"/>temiz</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-orange-400 inline-block"/>spam ≥%25</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-rose-400 inline-block"/>bloklu</span>
            <span className="text-slate-500">yenileme 10s</span>
          </div>

          {/* Hover tooltip */}
          {hover?.item && (
            <div
              className="fixed z-50 pointer-events-none bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-3 text-xs mono text-slate-200 max-w-[320px]"
              style={{
                left: Math.min(hover.x + 18, (typeof window !== "undefined" ? window.innerWidth : 1200) - 340),
                top: Math.max(10, hover.y - 20),
              }}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-sm font-semibold text-cyan-300 flex items-center gap-1">
                  <Globe2 className="w-3.5 h-3.5"/>{COUNTRY_NAMES[hover.item.country] || hover.item.country}
                  <span className="text-slate-500 text-[10px]">· {hover.item.country}</span>
                </div>
                <div className={`text-[10px] px-1.5 py-0.5 rounded ${
                  hover.item.blocked > 0 ? "bg-rose-500/20 text-rose-300"
                  : (hover.item.spam + hover.item.high_spam) / Math.max(hover.item.count, 1) >= 0.25 ? "bg-orange-500/20 text-orange-300"
                  : "bg-emerald-500/20 text-emerald-300"
                }`}>
                  {hover.item.count} mail
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-2">
                <StatMini l="temiz" v={hover.item.count - hover.item.spam - hover.item.high_spam - hover.item.blocked} c="text-emerald-300"/>
                <StatMini l="spam" v={hover.item.spam} c="text-amber-300"/>
                <StatMini l="high" v={hover.item.high_spam} c="text-orange-300"/>
                <StatMini l="blocked" v={hover.item.blocked} c="text-rose-300"/>
              </div>
              {(hover.item.sample_recipients || []).length > 0 && (
                <>
                  <div className="text-[10px] text-slate-500 mb-1">Örnek Alıcılar</div>
                  <div className="space-y-0.5 max-h-40 overflow-auto">
                    {(hover.item.sample_recipients || []).map((r) => (
                      <div key={r} className="text-slate-300 truncate">{r}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function StatMini({ l, v, c }) {
  return (
    <div className="bg-slate-950 rounded px-1.5 py-1 text-center border border-slate-800">
      <div className="text-[9px] uppercase text-slate-500">{l}</div>
      <div className={`mono text-sm ${c}`}>{v ?? 0}</div>
    </div>
  );
}
