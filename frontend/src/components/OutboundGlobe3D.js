/**
 * v43.54 — Outbound 3D World Globe (react-globe.gl)
 * Outbound trafik dünya haritası — countries spam oranına göre renklendirilir.
 * Arcs: kaynak sunucu → hedef ülke akışı. Rings: spam kaynaklı sıcak noktalar.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe as GlobeIcon, AlertTriangle, Play, Pause, Info } from "lucide-react";
import { Card, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import Globe from "react-globe.gl";

// Ülke adı → yaklaşık lat/lon (top 40 ülke — panel çoğu vakayı kapsar)
const COUNTRY_COORDS = {
  Türkiye: [39.0, 35.0], "Amerika Birleşik Devletleri": [39.8, -98.6],
  ABD: [39.8, -98.6], Almanya: [51.2, 10.5], Fransa: [46.2, 2.2],
  İngiltere: [55.4, -3.4], Rusya: [61.5, 105.3], Çin: [35.9, 104.2],
  Japonya: [36.2, 138.3], Hindistan: [20.6, 78.9], Brezilya: [-14.2, -51.9],
  Kanada: [56.1, -106.3], Avustralya: [-25.3, 133.8], İtalya: [41.9, 12.6],
  İspanya: [40.5, -3.7], Hollanda: [52.1, 5.3], Belçika: [50.5, 4.5],
  İsviçre: [46.8, 8.2], İsveç: [60.1, 18.6], Norveç: [60.5, 8.5],
  Danimarka: [56.3, 9.5], Finlandiya: [61.9, 25.7], Polonya: [51.9, 19.1],
  Ukrayna: [48.4, 31.2], Yunanistan: [39.1, 21.8], Bulgaristan: [42.7, 25.5],
  Romanya: [45.9, 24.9], Macaristan: [47.2, 19.5], Avusturya: [47.5, 14.5],
  Portekiz: [39.4, -8.2], İrlanda: [53.4, -8.2], Meksika: [23.6, -102.5],
  Arjantin: [-38.4, -63.6], Şili: [-35.6, -71.5], "Güney Afrika": [-30.5, 22.9],
  Mısır: [26.8, 30.8], "Suudi Arabistan": [23.8, 45.0], "Birleşik Arap Emirlikleri": [23.4, 53.8],
  İsrail: [31.0, 34.8], İran: [32.4, 53.6], Pakistan: [30.3, 69.3],
  Endonezya: [-0.8, 113.9], Malezya: [4.2, 101.9], Singapur: [1.3, 103.8],
  Filipinler: [12.8, 121.7], Vietnam: [14.0, 108.2], Tayland: [15.8, 100.9],
  "Güney Kore": [35.9, 127.7], "Yeni Zelanda": [-40.9, 174.8], Bilinmeyen: [0, 0],
};

// TR kaynak sunucu koordinatı (bayilerin çoğu Türkiye — panel de öyle)
const SOURCE_LAT = 39.0;
const SOURCE_LON = 35.0;

// Spam skoru → renk (yeşil/sarı/turuncu/kırmızı)
function riskColor(spamPct) {
  if (spamPct >= 40) return "#f43f5e";         // rose-500
  if (spamPct >= 20) return "#f97316";         // orange-500
  if (spamPct >= 8) return "#eab308";          // yellow-500
  if (spamPct >= 1) return "#22c55e";          // green-500 (some spam)
  return "#38bdf8";                            // sky-400 (temiz)
}

export default function OutboundGlobe3D() {
  const globeRef = useRef();
  const [hours, setHours] = useState(24);
  const [autoRotate, setAutoRotate] = useState(true);
  const [selected, setSelected] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["outbound-globe", hours],
    queryFn: () => api.outboundGeoStats(hours),
    refetchInterval: 30_000,
  });

  const arcs = useMemo(() => {
    if (!data?.countries) return [];
    return data.countries
      .map((c) => {
        const coord = COUNTRY_COORDS[c.country] || COUNTRY_COORDS.Bilinmeyen;
        if (!coord || (coord[0] === 0 && coord[1] === 0 && c.country !== "Bilinmeyen")) return null;
        const spamPct = c.mail_count > 0 ? (c.spam_count / c.mail_count) * 100 : 0;
        return {
          startLat: SOURCE_LAT, startLng: SOURCE_LON,
          endLat: coord[0], endLng: coord[1],
          color: [riskColor(spamPct), riskColor(spamPct)],
          mail_count: c.mail_count, spam_count: c.spam_count,
          country: c.country, spamPct: spamPct.toFixed(1),
        };
      })
      .filter(Boolean);
  }, [data]);

  const rings = useMemo(() => {
    if (!data?.countries) return [];
    return data.countries
      .filter((c) => c.spam_count >= 3 || c.risky)
      .map((c) => {
        const coord = COUNTRY_COORDS[c.country] || COUNTRY_COORDS.Bilinmeyen;
        if (!coord) return null;
        const spamPct = c.mail_count > 0 ? (c.spam_count / c.mail_count) * 100 : 0;
        return {
          lat: coord[0], lng: coord[1],
          maxR: Math.min(8, Math.max(2, c.spam_count / 2)),
          propagationSpeed: 2 + spamPct / 20,
          repeatPeriod: 1500,
          color: riskColor(spamPct),
          country: c.country,
        };
      })
      .filter(Boolean);
  }, [data]);

  const points = useMemo(() => {
    if (!data?.countries) return [];
    return data.countries
      .map((c) => {
        const coord = COUNTRY_COORDS[c.country] || COUNTRY_COORDS.Bilinmeyen;
        if (!coord || (coord[0] === 0 && coord[1] === 0)) return null;
        const spamPct = c.mail_count > 0 ? (c.spam_count / c.mail_count) * 100 : 0;
        return {
          lat: coord[0], lng: coord[1],
          size: Math.min(3, Math.log10(c.mail_count + 1) * 0.9 + 0.3),
          color: riskColor(spamPct),
          country: c.country, mail_count: c.mail_count, spam_count: c.spam_count,
          spamPct: spamPct.toFixed(1),
        };
      })
      .filter(Boolean);
  }, [data]);

  useEffect(() => {
    if (!globeRef.current) return;
    const controls = globeRef.current.controls();
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.5;
    controls.enableZoom = true;
  }, [autoRotate]);

  const totalMail = data?.total_mail || 0;
  const totalDomains = data?.total_domains || 0;
  const riskyCount = (data?.countries || []).filter((c) => c.risky || (c.spam_count / Math.max(1, c.mail_count)) > 0.2).length;

  return (
    <Card data-testid="outbound-globe-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><GlobeIcon className="w-4 h-4 text-sky-400" /> Dünya Üzerinde Outbound Trafik</span>}
        subtitle={`Son ${hours} saat — ${totalMail} mail · ${totalDomains} domain · ${riskyCount} riskli ülke`}
        right={
          <div className="flex items-center gap-1.5">
            {[6, 24, 72, 168].map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                data-testid={`globe-range-${h}`}
                className={`text-[11px] px-2 py-1 rounded border ${
                  hours === h
                    ? "bg-sky-500/20 border-sky-500/50 text-sky-200"
                    : "border-slate-800 text-slate-500 hover:text-slate-300"
                }`}
              >
                {h < 24 ? `${h}s` : h === 24 ? "24s" : h === 72 ? "3g" : "7g"}
              </button>
            ))}
            <button
              onClick={() => setAutoRotate((v) => !v)}
              data-testid="globe-rotate-toggle"
              title={autoRotate ? "Rotasyonu durdur" : "Rotasyonu başlat"}
              className="text-[11px] px-2 py-1 rounded border border-slate-800 text-slate-300 hover:bg-slate-800/50 inline-flex items-center gap-1"
            >
              {autoRotate ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </button>
          </div>
        }
      />
      <div className="relative bg-gradient-to-b from-slate-950 via-slate-950 to-black overflow-hidden" style={{ height: 560 }}>
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm z-10">
            Globe yükleniyor…
          </div>
        )}
        <Globe
          ref={globeRef}
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
          backgroundColor="rgba(0,0,0,0)"
          atmosphereColor="#1e3a8a"
          atmosphereAltitude={0.18}
          arcsData={arcs}
          arcColor="color"
          arcDashLength={0.5}
          arcDashGap={0.25}
          arcDashAnimateTime={2200}
          arcStroke={0.4}
          arcAltitudeAutoScale={0.4}
          arcLabel={(d) => `<div style="background:rgba(15,23,42,0.95);padding:6px 10px;border-radius:6px;border:1px solid #334155;font-family:monospace;color:#e2e8f0;font-size:11px"><b>${d.country}</b><br/>${d.mail_count} mail · ${d.spam_count} spam (%${d.spamPct})</div>`}
          ringsData={rings}
          ringColor={(d) => d.color}
          ringMaxRadius="maxR"
          ringPropagationSpeed="propagationSpeed"
          ringRepeatPeriod="repeatPeriod"
          pointsData={points}
          pointLat="lat"
          pointLng="lng"
          pointColor="color"
          pointRadius="size"
          pointAltitude={0.02}
          pointLabel={(d) => `<div style="background:rgba(15,23,42,0.95);padding:6px 10px;border-radius:6px;border:1px solid #334155;font-family:monospace;color:#e2e8f0;font-size:11px"><b>${d.country}</b><br/>${d.mail_count} mail · %${d.spamPct} spam</div>`}
          onPointClick={setSelected}
          width={undefined}
          height={560}
        />
        {/* Legend */}
        <div className="absolute bottom-3 left-3 rounded border border-slate-700 bg-slate-900/85 backdrop-blur px-3 py-2 text-[10px] font-mono space-y-1 z-10" data-testid="globe-legend">
          <div className="text-slate-400 uppercase tracking-widest text-[9px] mb-1">Renk Skalası (Spam %)</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#38bdf8]" /> Temiz (0%)</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#22c55e]" /> Az (1-8%)</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#eab308]" /> Orta (8-20%)</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#f97316]" /> Yüksek (20-40%)</div>
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#f43f5e]" /> Kritik (40%+)</div>
        </div>
        {/* Selected country panel */}
        {selected && (
          <div className="absolute top-3 right-3 rounded-lg border border-sky-500/40 bg-slate-900/90 backdrop-blur p-3 min-w-[220px] z-10" data-testid="globe-selected-country">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-bold text-sky-300">{selected.country}</span>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-300 text-xs">✕</button>
            </div>
            <div className="text-[11px] space-y-1 font-mono">
              <div className="flex justify-between"><span className="text-slate-500">Mail:</span> <span className="text-slate-200">{selected.mail_count}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Spam:</span> <span className="text-rose-300">{selected.spam_count}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Oran:</span> <span className="text-amber-300">%{selected.spamPct}</span></div>
            </div>
          </div>
        )}
      </div>
      <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-500 flex items-center gap-1.5" data-testid="globe-help">
        <Info className="w-3 h-3" /> Fare ile döndürün · Tekerlekle yakınlaştırın · Nokta üstüne tıklayın detaylar için · Ring'ler risk seviyesi yüksek ülkelerde otomatik pulsar
      </div>
    </Card>
  );
}
