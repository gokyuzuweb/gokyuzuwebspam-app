import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, Shield, Bug, Radar, Network, Sparkles, Power, PowerOff, AlertTriangle, X, Users } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";

const ICONS = {
  spamassassin: Shield,
  clamav: Bug,
  dcc: Radar,
  razor: Network,
  rspamd: Cpu,
  ai: Sparkles,
};

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

export default function Engines() {
  const qc = useQueryClient();
  const { isMaster } = useIsMaster();
  const engines = useQuery({ queryKey: ["engines"], queryFn: api.engines, refetchInterval: 30000 });
  const [confirmEngine, setConfirmEngine] = useState(null); // v44.00.04 — cascade onay modalı
  const toggle = useMutation({
    mutationFn: (name) => api.engineToggle(name),
    onSuccess: (data) => {
      const cascade = data.master_cascaded_to || 0;
      const base = `${data.name} ${data.enabled ? "etkinleştirildi" : "durduruldu"}`;
      toast.success(cascade > 0 ? `${base} · ${cascade} bayiye yansıtıldı` : base);
      qc.invalidateQueries({ queryKey: ["engines"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["overview-header"] });
      setConfirmEngine(null);
    },
    onError: (e) => {
      toast.error(e?.response?.data?.detail || "Toggle başarısız");
      setConfirmEngine(null);
    },
  });

  const handleClick = (engineName) => {
    // v44.00.04 — Master için cascade onay modalı; bayi için direkt toggle
    if (isMaster) {
      setConfirmEngine(engineName);
    } else {
      toggle.mutate(engineName);
    }
  };

  return (
    <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {(engines.data || []).map((e) => {
        const Icon = ICONS[e.name] || Cpu;
        const catchRate = e.scanned_today ? Math.round((e.caught_today / e.scanned_today) * 100) : 0;
        return (
          <Card key={e.name} data-testid={`engine-card-${e.name}`}>
            <CardBody>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-md flex items-center justify-center ${
                    e.enabled ? "bg-indigo-500/10 border border-indigo-500/30 text-indigo-300"
                              : "bg-slate-800 border border-slate-700 text-slate-500"
                  }`}>
                    <Icon className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <div className="text-slate-100 font-medium tracking-tight">{e.label}</div>
                    <div className="mono text-[11px] text-slate-500">v{e.version}</div>
                  </div>
                </div>
                <Badge tone={e.enabled ? "success" : "default"}>{e.enabled ? "AÇIK" : "KAPALI"}</Badge>
              </div>
              <p className="text-xs text-slate-400 mb-4 min-h-[36px]">{e.description}</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Taranan</div>
                  <div className="mono text-lg text-slate-200">{nfmt(e.scanned_today)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">Yakalanan</div>
                  <div className="mono text-lg text-amber-300">{nfmt(e.caught_today)}</div>
                </div>
              </div>
              <div className="h-1.5 rounded bg-slate-800 overflow-hidden mb-4">
                <div className={`h-full ${e.enabled ? "bg-gradient-to-r from-indigo-500 to-rose-500" : "bg-slate-700"}`}
                     style={{ width: `${Math.min(catchRate, 100)}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-slate-500 mono">yakalama % {catchRate}</div>
                <button
                  data-testid={`engine-toggle-${e.name}`}
                  onClick={() => handleClick(e.name)}
                  disabled={toggle.isPending}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors disabled:opacity-40 ${
                    e.enabled
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                  }`}
                >
                  {e.enabled ? <><PowerOff className="w-3.5 h-3.5" /> Durdur</> : <><Power className="w-3.5 h-3.5" /> Başlat</>}
                </button>
              </div>
            </CardBody>
          </Card>
        );
      })}
      {/* v44.00.04 — Master motor cascade onay modalı */}
      {confirmEngine && (
        <CascadeConfirmModal
          engineName={confirmEngine}
          onCancel={() => setConfirmEngine(null)}
          onConfirm={() => toggle.mutate(confirmEngine)}
          pending={toggle.isPending}
        />
      )}
    </div>
  );
}

// v44.00.04 — Cascade önizleme + onay modalı
function CascadeConfirmModal({ engineName, onCancel, onConfirm, pending }) {
  const preview = useQuery({
    queryKey: ["engine-cascade-preview", engineName],
    queryFn: () => api.engineCascadePreview(engineName),
    staleTime: 0,
  });
  const d = preview.data;
  const isOff = d?.target_state === false; // kapatma mı, açma mı
  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4" data-testid="cascade-confirm-modal">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        <div className={`px-6 py-4 border-b border-slate-800 flex items-center gap-3 ${
          isOff ? "bg-gradient-to-r from-rose-950/60 to-slate-900" : "bg-gradient-to-r from-emerald-950/60 to-slate-900"
        }`}>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            isOff ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
          }`}>
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-100">
              Master {isOff ? "kapatma" : "açma"} onayı
            </div>
            <div className="text-xs text-slate-400">
              {d ? <><b className="text-slate-200">{d.label}</b> motoru <span className={isOff ? "text-rose-300" : "text-emerald-300"}>{isOff ? "KAPATILACAK" : "AÇILACAK"}</span></> : "Bilgi yükleniyor..."}
            </div>
          </div>
          <button onClick={onCancel} data-testid="cascade-cancel-x" className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {preview.isLoading && <div className="text-center text-sm text-slate-500 py-6">Cascade önizleme yükleniyor...</div>}
          {d && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <StatBox label="Toplam Bayi" value={d.affected_total} tone="slate" />
                <StatBox label="Değişecek" value={d.will_change} tone={isOff ? "rose" : "emerald"} highlight />
                <StatBox label="Zaten Aynı" value={d.already_same} tone="slate" />
              </div>
              {d.samples?.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Örnek Bayiler ({d.samples.length}{d.affected_total > d.samples.length ? `/${d.affected_total}` : ""})</div>
                  <div className="max-h-40 overflow-y-auto rounded border border-slate-800 bg-slate-950/50 divide-y divide-slate-800">
                    {d.samples.map((s, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <div className="flex items-center gap-2">
                          <Users className="w-3 h-3 text-slate-500" />
                          <span className="text-slate-200 font-medium">{s.customer_name}</span>
                          <span className="text-slate-600 mono text-[10px]">{s.license_key_short}</span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.current_state ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
                          {s.current_state ? "AÇIK" : "KAPALI"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className={`text-xs px-3 py-2 rounded border ${
                isOff ? "border-rose-500/30 bg-rose-500/5 text-rose-200" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
              }`}>
                {isOff
                  ? `⚠️ Bu motor kapatıldığında ${d.will_change} bayinin sunucusunda da devre dışı bırakılacak. Devam etmek istiyor musunuz?`
                  : `✓ Bu motor açıldığında ${d.will_change} bayinin sunucusunda da etkinleştirilecek.`
                }
              </div>
            </>
          )}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              onClick={onCancel}
              disabled={pending}
              data-testid="cascade-cancel"
              className="px-4 py-2 rounded-md text-sm font-semibold border border-slate-700 bg-slate-900 hover:border-slate-600 text-slate-300 disabled:opacity-40"
            >
              Vazgeç
            </button>
            <button
              onClick={onConfirm}
              disabled={pending || preview.isLoading}
              data-testid="cascade-confirm"
              className={`px-4 py-2 rounded-md text-sm font-bold text-white disabled:opacity-40 ${
                isOff
                  ? "bg-gradient-to-br from-rose-500 to-rose-600 hover:shadow-lg hover:shadow-rose-500/40"
                  : "bg-gradient-to-br from-emerald-500 to-emerald-600 hover:shadow-lg hover:shadow-emerald-500/40"
              }`}
            >
              {pending ? "Uygulanıyor..." : (isOff ? `Evet, kapat (${d?.will_change || 0} bayi)` : `Evet, aç (${d?.will_change || 0} bayi)`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, tone = "slate", highlight = false }) {
  const toneMap = {
    rose: "border-rose-500/40 bg-rose-500/10 text-rose-200",
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    slate: "border-slate-800 bg-slate-950/50 text-slate-300",
  };
  return (
    <div className={`rounded-lg border p-3 text-center ${toneMap[tone]}`}>
      <div className={`text-2xl font-bold mono ${highlight ? "text-3xl" : ""}`}>{value ?? "-"}</div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}
