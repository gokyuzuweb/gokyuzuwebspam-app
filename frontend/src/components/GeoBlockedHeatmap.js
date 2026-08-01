import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe2, Shield, TrendingUp, X, Ban, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";

/**
 * GeoBlockedHeatmap — Landing için mini dünya haritası.
 * Ülkelere göre bloklanan IP sayısı; TopoJSON offline harita üstüne bubble marker.
 */
export default function GeoBlockedHeatmap({ compact = false }) {
  const [selectedCountry, setSelectedCountry] = useState(null);
  const q = useQuery({
    queryKey: ["geo-blocked-heatmap"],
    queryFn: api.geoBlockedHeatmap,
    refetchInterval: 30000,
    staleTime: 20000,
  });
  const items = q.data?.items || [];
  const total = q.data?.total || 0;
  const maxCount = Math.max(1, ...items.map((i) => i.count));

  // Basit equirectangular projeksiyon: lat/lon → SVG x/y
  const proj = (lat, lon) => ({
    x: ((lon + 180) / 360) * 1000,
    y: ((90 - lat) / 180) * 500,
  });

  return (
    <section id="geo-heatmap" className={`${compact ? "" : "py-24"} relative overflow-hidden`}
             data-testid="landing-geo-heatmap">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(244,63,94,0.08),transparent_60%)]"/>
      <div className="max-w-7xl mx-auto px-6 relative">
        <div className="text-center max-w-2xl mx-auto mb-8">
          <div className="text-xs uppercase tracking-widest text-rose-400 mono mb-2 flex items-center justify-center gap-2">
            <Shield className="w-3.5 h-3.5"/> Canlı Tehdit Haritası
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-3 tracking-tight">
            Bloklanan IP'lerin <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-400 to-orange-400">coğrafi dağılımı</span>
          </h2>
          <p className="text-slate-400">
            Şu ana kadar {total.toLocaleString("tr-TR")} kötü niyetli IP {items.length} farklı ülkeden bloklandı.
            <span className="text-slate-500"> · Ülkeye tıklayın, detayları görün.</span>
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Map */}
          <div className="lg:col-span-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <svg viewBox="0 0 1000 500" className="w-full h-auto" data-testid="geo-heatmap-svg">
              {/* Ocean */}
              <rect width="1000" height="500" fill="#0f172a"/>
              {/* Very simple continent outline (5 latitude bands) */}
              <g fill="#1e293b" stroke="#334155" strokeWidth="0.5" opacity="0.6">
                <path d="M 150 100 L 350 100 L 400 200 L 350 280 L 200 300 L 150 250 Z"/>
                <path d="M 450 80 L 700 80 L 750 200 L 700 240 L 500 250 L 450 200 Z"/>
                <path d="M 750 180 L 900 180 L 920 300 L 850 350 L 750 340 Z"/>
                <path d="M 250 320 L 350 320 L 330 420 L 260 420 Z"/>
                <path d="M 500 300 L 620 300 L 640 420 L 520 420 Z"/>
                <path d="M 800 380 L 900 380 L 920 460 L 810 460 Z"/>
              </g>
              {/* Grid */}
              <g stroke="#1e293b" strokeWidth="0.3" opacity="0.4">
                {[0, 100, 200, 300, 400, 500].map((y) => (
                  <line key={y} x1="0" x2="1000" y1={y} y2={y}/>
                ))}
                {[0, 200, 400, 600, 800, 1000].map((x) => (
                  <line key={x} x1={x} x2={x} y1="0" y2="500"/>
                ))}
              </g>
              {/* Bubbles */}
              {items.filter((i) => i.lat != null && i.lon != null).map((it) => {
                const p = proj(it.lat, it.lon);
                const r = 4 + Math.sqrt(it.count / maxCount) * 22;
                return (
                  <g key={it.country} style={{ cursor: "pointer" }}
                     onClick={() => setSelectedCountry(it)}
                     data-testid={`geo-bubble-${it.country}`}>
                    <circle cx={p.x} cy={p.y} r={r + 4} fill="#f43f5e" opacity="0.15">
                      <animate attributeName="r" values={`${r};${r + 6};${r}`} dur="2s" repeatCount="indefinite"/>
                    </circle>
                    <circle cx={p.x} cy={p.y} r={r} fill="#f43f5e" opacity="0.8"
                            className="hover:opacity-100 transition-opacity">
                      <title>{it.name}: {it.count} IP bloklu · tıklayın</title>
                    </circle>
                    <text x={p.x} y={p.y + 3} textAnchor="middle" fill="white" fontSize="10" fontWeight="bold"
                          pointerEvents="none">
                      {it.count}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="text-[10px] text-slate-500 mt-2 flex items-center justify-between">
              <span>Otomatik yenileme: 30sn</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-rose-500 rounded-full inline-block"/> bloklanan IP · tıklanabilir</span>
            </div>
          </div>

          {/* Top countries */}
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
              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {items.slice(0, 15).map((it, idx) => (
                  <button key={it.country}
                          onClick={() => setSelectedCountry(it)}
                          data-testid={`geo-row-${it.country}`}
                          className="w-full flex items-center gap-2 text-xs hover:bg-slate-800/40 rounded px-1 py-0.5 transition-colors text-left">
                    <span className="text-slate-600 w-5 text-right">#{idx + 1}</span>
                    <span className="text-lg leading-none">{flag(it.country)}</span>
                    <span className="text-slate-200 flex-1 min-w-0 truncate">{it.name}</span>
                    <div className="w-24 bg-slate-800 rounded overflow-hidden h-1.5">
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
    mutationFn: (ip) => api.ipWhitelist({ ip, reason: "Yanlış pozitif — Landing modaldan" }),
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
            <span className="text-3xl leading-none">{flag(country.country)}</span>
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
                        title="Yanlış pozitifse buradan kalıcı whitelist'e ekle"
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

function flag(cc) {
  if (!cc || cc.length !== 2) return "🌐";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}
