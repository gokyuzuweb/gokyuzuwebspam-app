import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { Globe2, Activity, MapPin } from "lucide-react";

const LICKEY = () => (typeof window !== "undefined"
  ? (localStorage.getItem("gws.event_license") || "MS-C02AB012652A4FE692D69676")
  : "MS-C02AB012652A4FE692D69676");

// Bundled locally (see /public/geo/countries-110m.json). No CDN dependency.
const GEO_URL = "/geo/countries-110m.json";

// ISO country name lookup (short names for tooltip)
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
};

export default function AttackMap({ onIpClick }) {
  const [hover, setHover] = useState(null); // {country, x, y}
  const q = useQuery({
    queryKey: ["attack-map"],
    queryFn: () => api.attackMap(LICKEY(), 6),
    refetchInterval: 10000,
  });
  const drill = useQuery({
    queryKey: ["attack-map-drill", hover?.item?.sample_ips?.[0]],
    queryFn: () => api.ipDrilldown(LICKEY(), hover.item.sample_ips[0]),
    enabled: !!hover?.item?.sample_ips?.length,
    staleTime: 30000,
  });

  const items = q.data?.items || [];
  const total = items.reduce((s, it) => s + (it.count || 0), 0);
  const maxCount = Math.max(1, ...items.map(i => i.count || 0));

  return (
    <Card data-testid="attack-map-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><Globe2 className="w-4 h-4 text-indigo-400"/> Canlı Saldırı Haritası</span>}
        subtitle={`Son 6 saatte ${items.length} ülkeden ${total} olay · noktaların üstüne gelin (kimden/kime/IP/ülke)`}
        right={<Badge tone="info"><Activity className="w-3 h-3 mr-1 inline"/>{q.data?.events_total ?? 0} olay</Badge>}
      />
      <CardBody className="pt-0">
        <div className="relative w-full aspect-[2/1] bg-slate-950 rounded-lg overflow-hidden border border-slate-800">
          <ComposableMap projection="geoEqualEarth" width={980} height={480} style={{ width: "100%", height: "100%" }}>
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
            {items.map((it) => {
              const isHigh = (it.high_spam || 0) > (it.spam || 0);
              const rad = 4 + Math.round((it.count / maxCount) * 14);
              const stroke = isHigh ? "#f43f5e" : "#f59e0b";
              const fill = isHigh ? "#fb7185" : "#fbbf24";
              return (
                <Marker
                  key={it.country}
                  coordinates={[it.lon, it.lat]}
                  onMouseEnter={(e) => setHover({ item: it, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setHover((h) => h ? { ...h, x: e.clientX, y: e.clientY } : null)}
                  onMouseLeave={() => setHover(null)}
                  data-testid={`attack-country-${it.country}`}
                  onClick={() => it.sample_ips?.[0] && onIpClick?.(it.sample_ips[0])}
                  style={{ cursor: it.sample_ips?.[0] ? "pointer" : "default" }}
                >
                  <circle r={rad + 6} fill={fill} opacity={0.15}>
                    <animate attributeName="r" values={`${rad+6};${rad+14};${rad+6}`} dur="2.4s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" values="0.35;0.05;0.35" dur="2.4s" repeatCount="indefinite"/>
                  </circle>
                  <circle r={rad} fill={fill} fillOpacity={0.7} stroke={stroke} strokeWidth={1.2}/>
                  <text x={rad + 4} y={4} fill="#e2e8f0" fontSize="9" fontFamily="JetBrains Mono">
                    {it.country}·{it.count}
                  </text>
                </Marker>
              );
            })}
          </ComposableMap>

          {/* Top-right list */}
          <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur border border-slate-800 rounded-md p-2 text-[11px] mono text-slate-300 max-w-[200px]">
            <div className="text-slate-400 mb-1 flex items-center gap-1"><MapPin className="w-3 h-3"/> En çok · son 6s</div>
            {items.slice(0, 6).map((it) => (
              <div key={it.country} className="flex justify-between gap-2">
                <span title={COUNTRY_NAMES[it.country] || it.country}>{it.country}</span>
                <span className={it.high_spam > it.spam ? "text-rose-400" : "text-amber-300"}>{it.count}</span>
              </div>
            ))}
            {items.length === 0 && <div className="text-slate-500">Veri bekliyor…</div>}
          </div>

          {/* Legend */}
          <div className="absolute bottom-2 left-2 flex items-center gap-3 text-[10px] mono text-slate-400 bg-slate-900/70 rounded px-2 py-1">
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-amber-400 inline-block"/>spam</span>
            <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-rose-400 inline-block"/>high_spam</span>
            <span className="text-slate-500">tıkla → IP detay drawer · yenileme 10s</span>
          </div>

          {/* Hover tooltip */}
          {hover?.item && (
            <div
              className="fixed z-50 pointer-events-none bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-3 text-xs mono text-slate-200 max-w-[320px]"
              style={{ left: Math.min(hover.x + 18, (typeof window !== "undefined" ? window.innerWidth : 1200) - 340),
                       top: Math.max(10, hover.y - 20) }}
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-sm font-semibold text-indigo-300 flex items-center gap-1">
                  <Globe2 className="w-3.5 h-3.5"/>{COUNTRY_NAMES[hover.item.country] || hover.item.country}
                  <span className="text-slate-500 text-[10px]">· {hover.item.country}</span>
                </div>
                <div className={`text-[10px] px-1.5 py-0.5 rounded ${hover.item.high_spam > hover.item.spam ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/20 text-amber-300"}`}>
                  {hover.item.count} olay
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <StatMini l="spam" v={hover.item.spam} c="text-amber-300"/>
                <StatMini l="high" v={hover.item.high_spam} c="text-rose-300"/>
                <StatMini l="virus" v={hover.item.virus} c="text-fuchsia-300"/>
              </div>
              <div className="text-[10px] text-slate-500 mb-1">Örnek Kaynak IP'ler</div>
              <div className="space-y-0.5 max-h-40 overflow-auto">
                {(hover.item.sample_ips || []).map((ip) => (
                  <div key={ip} className="text-slate-300 truncate">{ip}</div>
                ))}
              </div>
              {drill.data?.sample?.length > 0 && (
                <>
                  <div className="text-[10px] text-slate-500 mt-2 mb-1 border-t border-slate-800 pt-2">Son Trafik ({drill.data.sample.length})</div>
                  <div className="space-y-1 max-h-40 overflow-auto">
                    {drill.data.sample.slice(0, 5).map((r) => (
                      <div key={r.id} className="border border-slate-800 rounded p-1.5">
                        <div className="text-slate-100 text-[11px] truncate">{r.subject || "(konu yok)"}</div>
                        <div className="text-[10px] text-slate-500">
                          <span className="text-slate-400">{r.from_addr}</span>
                          <span className="mx-1">→</span>
                          <span className="text-slate-400">{r.to_addr}</span>
                        </div>
                        <div className="text-[10px] flex gap-2 mt-0.5">
                          <span className={`px-1 rounded ${r.verdict === "high_spam" ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/20 text-amber-300"}`}>{r.verdict}</span>
                          <span className="text-slate-500">skor {(r.score || 0).toFixed(1)}</span>
                          <span className="text-slate-600">{(r.ingested_at || "").slice(11, 19)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="text-[10px] text-indigo-400 mt-2 pt-2 border-t border-slate-800">Tıklayınca → tam IP drilldown drawer</div>
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
