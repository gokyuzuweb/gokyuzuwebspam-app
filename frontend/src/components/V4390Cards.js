/**
 * v43.90 — UI Theme (Accent Color) Picker + Bayi IP Whitelist Enforce + PIN Approval.
 * These small master/bayi cards are mounted from Settings.js.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Palette, ShieldCheck, KeyRound, Check, X, Clock, Send, Trash2, Plus, ShieldAlert, Star, Sparkles, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

// v43.94 — Country code (ISO 3166-1 alpha-2) → emoji flag
function ccToFlag(cc) {
  if (!cc || cc.length !== 2) return "🌐";
  const base = 0x1F1E6;
  const A = "A".charCodeAt(0);
  try {
    return String.fromCodePoint(base + (cc.charCodeAt(0) - A), base + (cc.charCodeAt(1) - A));
  } catch {
    return "🌐";
  }
}

const ACCENT_COLORS = [
  { key: "indigo",   label: "İndigo",  bg: "bg-indigo-500",  ring: "ring-indigo-400",  glow: "shadow-indigo-500/50" },
  { key: "fuchsia",  label: "Fuşya",   bg: "bg-fuchsia-500", ring: "ring-fuchsia-400", glow: "shadow-fuchsia-500/50" },
  { key: "emerald",  label: "Zümrüt",  bg: "bg-emerald-500", ring: "ring-emerald-400", glow: "shadow-emerald-500/50" },
  { key: "cyan",     label: "Camgöbeği", bg: "bg-cyan-500",  ring: "ring-cyan-400",    glow: "shadow-cyan-500/50" },
  { key: "rose",     label: "Gül",     bg: "bg-rose-500",    ring: "ring-rose-400",    glow: "shadow-rose-500/50" },
];

// Apply accent color as CSS variable + localStorage cache (instant on next mount)
export function applyAccentColor(color) {
  try {
    const map = {
      indigo:  "99 102 241",
      fuchsia: "217 70 239",
      emerald: "16 185 129",
      cyan:    "6 182 212",
      rose:    "244 63 94",
    };
    const rgb = map[color] || map.indigo;
    document.documentElement.style.setProperty("--gws-accent-rgb", rgb);
    document.documentElement.setAttribute("data-accent", color);
    localStorage.setItem("gws.ui.accent", color);
  } catch {}
}

// v43.90/91 — Görünüm ayarı kartı (her kullanıcı için) + Live Preview
export function UIThemeCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ui-theme-me"], queryFn: () => api.uiThemeGet(), staleTime: 60_000 });
  const [selected, setSelected] = useState(() => localStorage.getItem("gws.ui.accent") || "indigo");
  const [preview, setPreview] = useState(null);   // hover preview

  useEffect(() => {
    if (q.data?.accent_color) {
      setSelected(q.data.accent_color);
      applyAccentColor(q.data.accent_color);
    }
  }, [q.data]);

  const saveMut = useMutation({
    mutationFn: (c) => api.uiThemePut(c),
    onSuccess: (d) => {
      applyAccentColor(d.accent_color);
      qc.invalidateQueries({ queryKey: ["ui-theme-me"] });
      // v43.93 — İlk seçimde sync bilgi toast'ı göster
      const shown = localStorage.getItem("gws.ui.accent.toast_shown");
      if (!shown) {
        toast.success("Tema kaydedildi ✓", {
          description: "Bu tercih sunucuda saklandı. Başka bir tarayıcı veya cihazda giriş yaptığınızda da aynı renk otomatik uygulanacak.",
          duration: 6000,
        });
        try { localStorage.setItem("gws.ui.accent.toast_shown", "1"); } catch {}
      } else {
        toast.success(`Tema: ${d.accent_color}`);
      }
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Tema kaydedilemedi"),
  });

  const active = preview || selected;
  const previewStyles = {
    indigo:  { bg: "bg-indigo-500",  bg15: "bg-indigo-500/15",  bd: "border-indigo-500/50",  txt: "text-indigo-200",  glow: "shadow-indigo-500/40" },
    fuchsia: { bg: "bg-fuchsia-500", bg15: "bg-fuchsia-500/15", bd: "border-fuchsia-500/50", txt: "text-fuchsia-200", glow: "shadow-fuchsia-500/40" },
    emerald: { bg: "bg-emerald-500", bg15: "bg-emerald-500/15", bd: "border-emerald-500/50", txt: "text-emerald-200", glow: "shadow-emerald-500/40" },
    cyan:    { bg: "bg-cyan-500",    bg15: "bg-cyan-500/15",    bd: "border-cyan-500/50",    txt: "text-cyan-200",    glow: "shadow-cyan-500/40" },
    rose:    { bg: "bg-rose-500",    bg15: "bg-rose-500/15",    bd: "border-rose-500/50",    txt: "text-rose-200",    glow: "shadow-rose-500/40" },
  };
  const s = previewStyles[active] || previewStyles.indigo;

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Palette className="w-4 h-4 text-fuchsia-400" /> Görünüm · Vurgu Rengi</span>}
        subtitle="Panelinizin butonlar ve vurgu öğelerinde kullanılan ana rengi kişiselleştirin. Renk üstüne gelin — canlı önizleme aşağıda."
        right={<Badge tone="fuchsia">v43.91</Badge>}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-3" data-testid="ui-theme-picker">
          {ACCENT_COLORS.map(c => {
            const isSel = selected === c.key;
            return (
              <button
                key={c.key}
                data-testid={`accent-color-${c.key}`}
                type="button"
                onMouseEnter={() => setPreview(c.key)}
                onMouseLeave={() => setPreview(null)}
                onClick={() => { setSelected(c.key); applyAccentColor(c.key); saveMut.mutate(c.key); setPreview(null); }}
                className={`group relative flex flex-col items-center gap-2 px-4 py-3 rounded-lg border transition-all ${
                  isSel
                    ? `border-slate-600 bg-slate-800/60 shadow-lg ${c.glow}`
                    : "border-slate-800 bg-slate-950 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <span className={`w-8 h-8 rounded-full ${c.bg} ${isSel ? `ring-2 ${c.ring} ring-offset-2 ring-offset-slate-950` : ""}`}></span>
                <span className={`text-xs font-semibold ${isSel ? "text-slate-100" : "text-slate-400"}`}>{c.label}</span>
                {isSel && <Check className="w-3 h-3 text-emerald-400 absolute top-1 right-1" />}
              </button>
            );
          })}
        </div>

        {/* v43.91 — Live Preview Panel */}
        <div data-testid="theme-preview-panel"
             className={`rounded-lg border ${s.bd} bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 space-y-3 shadow-lg ${s.glow}`}>
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold text-slate-400 tracking-wider uppercase">
              Canlı Önizleme {preview && preview !== selected ? "· (henüz kaydedilmedi)" : ""}
            </div>
            <span className={`text-[10px] mono font-bold px-2 py-0.5 rounded ${s.bg15} ${s.txt} border ${s.bd}`}>
              {active.toUpperCase()}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Primary button */}
            <button type="button" tabIndex={-1}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-white ${s.bg} hover:opacity-90 shadow-md ${s.glow}`}>
              <Sparkles className="w-4 h-4" /> Kaydet
            </button>
            {/* Secondary button */}
            <button type="button" tabIndex={-1}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold border ${s.bd} ${s.bg15} ${s.txt} hover:opacity-90`}>
              <Star className="w-4 h-4" /> İkincil
            </button>
            {/* Badge */}
            <span className={`inline-flex items-center gap-1 text-[11px] mono font-bold px-2 py-1 rounded border ${s.bd} ${s.bg15} ${s.txt}`}>
              <Check className="w-3 h-3" /> Rozet
            </span>
            {/* Chip / tab active */}
            <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-semibold ${s.bd} ${s.bg15} ${s.txt} shadow-md`}>
              Aktif Sekme
            </span>
          </div>
          {/* Text link + progress */}
          <div className="flex items-center gap-4 text-xs">
            <a className={`${s.txt} hover:underline font-semibold cursor-default`}>Bağlantı örneği</a>
            <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
              <div className={`h-full ${s.bg}`} style={{ width: "64%" }}></div>
            </div>
            <span className={`mono text-[10px] ${s.txt}`}>64%</span>
          </div>
        </div>

        <p className="text-[11px] text-slate-500">
          Renk üzerine gelince canlı önizleme değişir. Tıklayarak kalıcı seçim yapın; sunucuya kaydedilir ve panel her yenilendiğinde bu renk hatırlanır.
        </p>
      </CardBody>
    </Card>
  );
}

// v43.91/93 — Trusted IPs (foreign-IP alarm muafiyeti) + Bulk Import
export function TrustedIPsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["trusted-ips"], queryFn: () => api.trustedIpsList(), staleTime: 30_000 });
  const items = q.data?.items || [];
  const [ip, setIp] = useState("");
  const [label, setLabel] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkLabel, setBulkLabel] = useState("");

  const addMut = useMutation({
    mutationFn: () => api.trustedIpsAdd(ip.trim(), label.trim()),
    onSuccess: () => {
      setIp(""); setLabel("");
      qc.invalidateQueries({ queryKey: ["trusted-ips"] });
      toast.success("Güvenilir IP eklendi");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Eklenemedi"),
  });
  const bulkMut = useMutation({
    mutationFn: () => api.trustedIpsBulkAdd(bulkText.trim(), bulkLabel.trim()),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["trusted-ips"] });
      const { added = 0, skipped = 0, errors = 0 } = d.counts || {};
      if (added > 0) {
        toast.success(`Toplu ekleme: ${added} eklendi, ${skipped} atlandı, ${errors} hata`);
        setBulkOpen(false);
        setBulkText(""); setBulkLabel("");
      } else if (skipped > 0 && errors === 0) {
        toast.info(`Tümü zaten kayıtlı (${skipped} atlandı)`);
      } else {
        toast.error(`Hiç IP eklenmedi — ${errors} geçersiz format`);
      }
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Toplu ekleme başarısız"),
  });
  const delMut = useMutation({
    mutationFn: (i) => api.trustedIpsRemove(i),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["trusted-ips"] }); toast.success("IP kaldırıldı"); },
  });

  const validIp = ip.trim().length >= 3;
  const bulkCanSubmit = bulkText.trim().length >= 3 && !bulkMut.isPending;

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-cyan-400" /> Güvenilir IP'ler (Foreign-IP Muafiyet)</span>}
        subtitle="Buradaki IP'ler master key farklı IP'den kullanılsa bile alarm tetiklemez ve session kill'e düşmez."
        right={<Badge tone="cyan">{items.length} IP</Badge>}
      />
      <CardBody className="space-y-3">
        <div className="flex flex-col md:flex-row gap-2">
          <input
            data-testid="trusted-ip-input"
            placeholder="Örn: 89.19.15.58"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono focus:border-cyan-500/50 focus:outline-none"
          />
          <input
            data-testid="trusted-ip-label"
            placeholder="Etiket (Ofis, VPN, Ev...)"
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 100))}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm focus:border-cyan-500/50 focus:outline-none"
          />
          <button
            data-testid="trusted-ip-add"
            type="button"
            onClick={() => addMut.mutate()}
            disabled={!validIp || addMut.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 text-sm font-semibold disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Ekle
          </button>
          <button
            data-testid="trusted-ip-bulk-open"
            type="button"
            onClick={() => setBulkOpen(!bulkOpen)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-semibold transition-colors ${
              bulkOpen
                ? "border-fuchsia-500/50 bg-fuchsia-500/20 text-fuchsia-200"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-fuchsia-500/40 hover:text-fuchsia-200"
            }`}
          >
            <Sparkles className="w-4 h-4" /> Toplu İçe Aktar
          </button>
          <button
            data-testid="trusted-ip-export"
            type="button"
            onClick={async () => {
              try {
                const res = await api.trustedIpsExportCsv();
                const blob = new Blob([res.data], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `trusted-ips-${new Date().toISOString().slice(0,10)}.csv`;
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
                toast.success("CSV indirildi");
              } catch (e) {
                toast.error(e?.response?.data?.detail || "İndirme başarısız");
              }
            }}
            disabled={items.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 text-sm font-semibold disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Excel/CSV
          </button>
          {/* v43.96 — CSV Import Wizard */}
          <label
            data-testid="trusted-ip-import-label"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 text-sm font-semibold cursor-pointer"
          >
            <Upload className="w-4 h-4" /> CSV Yükle
            <input
              data-testid="trusted-ip-import-input"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  // CSV parse — split lines, skip header if it starts with "ip,"
                  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                  const rows = lines[0]?.toLowerCase().startsWith("ip,") ? lines.slice(1) : lines;
                  // Extract ip + label from CSV (assume export format: ip,country_code,label,...)
                  // Build bulk-format text: "ip=label" per line
                  const bulkLines = rows.map(row => {
                    const cols = row.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
                    const ip = cols[0] || "";
                    const label = cols[2] || "";
                    return label ? `${ip}=${label}` : ip;
                  }).filter(l => l.length >= 3);
                  if (bulkLines.length === 0) {
                    toast.error("CSV boş veya geçerli IP yok");
                    e.target.value = "";
                    return;
                  }
                  const conf = window.confirm(`${bulkLines.length} IP kaydı içe aktarılacak. Devam edilsin mi?`);
                  if (!conf) { e.target.value = ""; return; }
                  const res = await api.trustedIpsBulkAdd(bulkLines.join("\n"), "import");
                  const { added = 0, skipped = 0, errors = 0 } = res.counts || {};
                  qc.invalidateQueries({ queryKey: ["trusted-ips"] });
                  toast.success(`CSV içe aktarıldı: ${added} eklendi · ${skipped} zaten mevcut · ${errors} hata`);
                } catch (err) {
                  toast.error(err?.message || err?.response?.data?.detail || "İçe aktarma başarısız");
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {/* v43.93 — Toplu içe aktarma paneli */}
        {bulkOpen && (
          <div data-testid="trusted-ip-bulk-panel" className="border border-fuchsia-500/30 bg-fuchsia-500/5 rounded-md p-3 space-y-2">
            <div className="text-[11px] text-slate-400">
              Satır başına bir IP yapıştırın. Etiket için <span className="mono text-fuchsia-300">ip=Etiket</span> veya <span className="mono text-fuchsia-300">ip|Etiket</span> yazabilirsiniz. CSV/space ile de çalışır.
            </div>
            <textarea
              data-testid="trusted-ip-bulk-text"
              rows={7}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={`89.19.15.58=Ofis Sabit\n10.0.0.5|VPN Docker\n85.14.22.9 85.14.22.10 85.14.22.11\n2a01:4f8:c17:b8f::1`}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-xs mono focus:border-fuchsia-500/50 focus:outline-none resize-y"
            />
            <div className="flex flex-col md:flex-row gap-2 items-stretch md:items-center">
              <input
                data-testid="trusted-ip-bulk-label"
                placeholder="Varsayılan etiket (etiketsizler için)"
                value={bulkLabel}
                onChange={(e) => setBulkLabel(e.target.value.slice(0, 100))}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm focus:border-fuchsia-500/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                className="px-3 py-2 rounded border border-slate-700 text-slate-400 hover:text-slate-200 text-sm"
              >
                Vazgeç
              </button>
              <button
                data-testid="trusted-ip-bulk-submit"
                type="button"
                onClick={() => bulkMut.mutate()}
                disabled={!bulkCanSubmit}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-fuchsia-500/50 bg-fuchsia-500/20 text-fuchsia-100 hover:bg-fuchsia-500/30 text-sm font-semibold disabled:opacity-50 shadow-md shadow-fuchsia-500/20"
              >
                <Plus className="w-4 h-4" /> {bulkMut.isPending ? "Ekleniyor..." : "Hepsini Ekle"}
              </button>
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-3 text-center">Henüz güvenilir IP yok.</div>
        ) : (
          <div className="space-y-1.5">
            {items.map(i => (
              <div key={i.ip} data-testid={`trusted-ip-row-${i.ip}`}
                className="flex items-center justify-between border border-slate-800 bg-slate-950 rounded-md px-3 py-2 hover:border-cyan-500/30">
                <div className="min-w-0 flex items-center gap-3">
                  <span
                    className="text-2xl leading-none shrink-0"
                    title={i.country_code ? `Ülke: ${i.country_code}` : "Bilinmiyor"}
                    data-testid={`trusted-ip-flag-${i.ip}`}
                  >
                    {ccToFlag(i.country_code || "")}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-bold mono text-slate-100 flex items-center gap-2">
                      {i.ip}
                      {i.country_code && (
                        <span className="text-[9px] mono font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                          {i.country_code}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {i.label && <>{i.label} · </>}
                      {i.added_via === "bulk" && <span className="text-fuchsia-400">toplu · </span>}
                      Eklenme: {(i.added_at || "").slice(0, 19)}
                    </div>
                  </div>
                </div>
                <button
                  data-testid={`trusted-ip-del-${i.ip}`}
                  type="button"
                  onClick={() => { if (window.confirm(`${i.ip} güvenilir listeden kaldırılsın mı?`)) delMut.mutate(i.ip); }}
                  className="p-1.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// v43.90 — Bayi IP Whitelist Enforce (master-only)
export function BayiIPEnforceCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["bayi-ip-enforce"], queryFn: () => api.bayiIpEnforceGet(), staleTime: 30_000 });
  const saveMut = useMutation({
    mutationFn: (enabled) => api.bayiIpEnforcePut(enabled),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["bayi-ip-enforce"] });
      toast.success(`Bayi IP koruma: ${d.enabled ? "AÇIK" : "KAPALI"}`);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kaydedilemedi"),
  });
  const enabled = !!q.data?.enabled;

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Bayi IP Whitelist Enforce</span>}
        subtitle="Etkinleştirildiğinde tüm bayi API çağrıları sadece lisansın yetkili IP listesinden yapılabilir."
        right={<Badge tone={enabled ? "emerald" : "slate"}>{enabled ? "AKTİF" : "PASİF"}</Badge>}
      />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            data-testid="bayi-ip-enforce-toggle"
            type="button"
            onClick={() => saveMut.mutate(!enabled)}
            disabled={saveMut.isPending}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
              enabled ? "bg-emerald-500" : "bg-slate-700"
            } disabled:opacity-50`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <div className="text-sm text-slate-300">
            {enabled
              ? "Yetkili olmayan IP'lerden gelen bayi istekleri 403 ile reddedilecek."
              : "IP kısıtlaması yok — bayiler herhangi bir IP'den bağlanabilir."}
          </div>
        </div>
        <div className="text-[11px] text-slate-500 border-l-2 border-slate-700 pl-3 py-1">
          Bloke edilen tüm denemeler <code className="mono text-amber-300">audit_logs</code> tablosuna
          <code className="mono text-amber-300"> bayi_ip_whitelist_blocked</code> action'ı ile düşer.
        </div>
      </CardBody>
    </Card>
  );
}

// v43.90 — Bayi PIN change request form + status
export function PinChangeRequestCard() {
  const qc = useQueryClient();
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [reason, setReason] = useState("");
  const my = useQuery({ queryKey: ["pin-approvals-my"], queryFn: () => api.pinApprovalMyList(), refetchInterval: 20_000 });
  const items = my.data?.items || [];
  const pending = items.find(i => i.status === "pending");

  const reqMut = useMutation({
    mutationFn: () => api.pinApprovalRequest(pin, reason),
    onSuccess: () => {
      setPin(""); setPin2(""); setReason("");
      qc.invalidateQueries({ queryKey: ["pin-approvals-my"] });
      toast.success("PIN değişiklik talebi master onayına gönderildi");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Talep gönderilemedi"),
  });

  const canSubmit = pin.length >= 4 && pin.length <= 8 && pin === pin2 && /^\d+$/.test(pin) && !pending;

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-400" /> PIN Değişiklik Talebi</span>}
        subtitle="Yeni PIN'iniz master onayından geçtiğinde uygulanır (güvenlik protokolü)."
        right={pending
          ? <Badge tone="amber">ONAY BEKLİYOR</Badge>
          : <Badge tone="slate">HAZIR</Badge>}
      />
      <CardBody className="space-y-3">
        {pending && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span className="font-bold">Talebiniz onay bekliyor</span>
            </div>
            <div className="mt-1 text-amber-300/80">
              Talep tarihi: <span className="mono">{(pending.requested_at || "").slice(0, 19)}</span> UTC
              {pending.reason && <> · Sebep: <em>{pending.reason}</em></>}
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Yeni PIN (4-8 rakam)</label>
            <input
              data-testid="pin-request-new"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              disabled={!!pending}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono focus:border-amber-500/50 focus:outline-none disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Tekrar</label>
            <input
              data-testid="pin-request-confirm"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
              disabled={!!pending}
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono focus:border-amber-500/50 focus:outline-none disabled:opacity-50"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Sebep (opsiyonel, master görecek)</label>
          <input
            data-testid="pin-request-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 200))}
            placeholder="Örn: Ofis değişikliği, cihaz yenileme..."
            disabled={!!pending}
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm focus:border-amber-500/50 focus:outline-none disabled:opacity-50"
          />
        </div>
        <div className="flex justify-end">
          <button
            data-testid="pin-request-submit"
            type="button"
            onClick={() => reqMut.mutate()}
            disabled={!canSubmit || reqMut.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 text-sm font-semibold disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {reqMut.isPending ? "Gönderiliyor..." : "Talebi Gönder"}
          </button>
        </div>

        {items.length > 0 && (
          <div className="border-t border-slate-800 pt-3 mt-2">
            <div className="text-[11px] font-bold text-slate-400 mb-2">Geçmiş Talepler</div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {items.slice(0, 8).map(i => (
                <div key={i.id} className="flex items-center justify-between text-[11px] mono text-slate-400 border border-slate-800 rounded px-2 py-1.5">
                  <span>{(i.requested_at || "").slice(0, 19)}</span>
                  <span className={`px-1.5 py-0.5 rounded font-bold ${
                    i.status === "approved" ? "bg-emerald-500/15 text-emerald-300"
                      : i.status === "rejected" ? "bg-rose-500/15 text-rose-300"
                      : "bg-amber-500/15 text-amber-300"
                  }`}>{i.status.toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// v43.90 — Master PIN approval queue widget
export function PinApprovalMasterQueue() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pin-approvals-pending"], queryFn: () => api.pinApprovalPending(), refetchInterval: 15_000 });
  const items = q.data?.items || [];
  const [note, setNote] = useState({});
  const decideMut = useMutation({
    mutationFn: ({ id, decision, n }) => api.pinApprovalDecide(id, decision, n || ""),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["pin-approvals-pending"] });
      toast.success(`PIN talebi ${d.status === "approved" ? "onaylandı" : "reddedildi"}`);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "İşlem başarısız"),
  });

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-amber-400" /> PIN Onay Kuyruğu</span>}
        subtitle="Bayilerin PIN değişiklik taleplerini onaylayın veya reddedin."
        right={<Badge tone={items.length > 0 ? "amber" : "slate"} data-testid="pin-pending-badge">{items.length} bekleyen</Badge>}
      />
      <CardBody className="space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-slate-500 italic py-6 text-center">Bekleyen talep yok.</div>
        )}
        {items.map(i => (
          <div key={i.id} data-testid={`pin-request-${i.id}`} className="border border-amber-500/20 bg-amber-500/5 rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-100 truncate">
                  {i.customer_name || i.customer_email || i.bayi_license_key.slice(0, 20)}
                </div>
                <div className="text-[10px] mono text-slate-500 truncate">
                  {i.bayi_license_key} · IP: {i.requested_ip}
                </div>
              </div>
              <div className="text-[10px] mono text-slate-400 shrink-0">{(i.requested_at || "").slice(0, 19)}</div>
            </div>
            {i.reason && (
              <div className="text-xs text-slate-300 italic border-l-2 border-slate-700 pl-2">"{i.reason}"</div>
            )}
            <div className="flex items-center gap-2">
              <input
                data-testid={`pin-decide-note-${i.id}`}
                value={note[i.id] || ""}
                onChange={(e) => setNote({ ...note, [i.id]: e.target.value.slice(0, 200) })}
                placeholder="Not (opsiyonel)"
                className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs focus:border-amber-500/40 focus:outline-none"
              />
              <button
                data-testid={`pin-approve-${i.id}`}
                type="button"
                onClick={() => decideMut.mutate({ id: i.id, decision: "approve", n: note[i.id] })}
                disabled={decideMut.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 text-xs font-semibold disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" /> Onayla
              </button>
              <button
                data-testid={`pin-reject-${i.id}`}
                type="button"
                onClick={() => decideMut.mutate({ id: i.id, decision: "reject", n: note[i.id] })}
                disabled={decideMut.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 text-xs font-semibold disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" /> Reddet
              </button>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}


// v43.99.10 — Master için: Aktif Kullanıcı/Bayi PIN Yönetim Paneli
// PIN'ler PBKDF2-SHA256 ile hash'lenmiş şekilde saklanır — hiçbir zaman plaintext döndürülemez.
// Master burada sadece PIN durumunu görür, sıfırlar veya yeni PIN belirler.
export function AdminUserPinManager() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | with_pin | no_pin | locked
  const [selected, setSelected] = useState(null);   // owner
  const [modalMode, setModalMode] = useState(null); // "reset" | "set"
  const [newPin, setNewPin] = useState("");
  const [note, setNote] = useState("");

  const q = useQuery({
    queryKey: ["admin-user-pins"],
    queryFn: () => api.adminUserPinsList(),
    refetchInterval: 30_000,
  });

  const resetMut = useMutation({
    mutationFn: ({ owner, note }) => api.adminUserPinReset(owner, note),
    onSuccess: (_d, v) => {
      toast.success(`✓ ${v.owner.slice(0, 20)}… PIN'i sıfırlandı`);
      qc.invalidateQueries({ queryKey: ["admin-user-pins"] });
      closeModal();
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Sıfırlanamadı"),
  });

  const setMut = useMutation({
    mutationFn: ({ owner, new_pin, note }) => api.adminUserPinSet(owner, new_pin, note),
    onSuccess: (_d, v) => {
      toast.success(`✓ ${v.owner.slice(0, 20)}… yeni PIN atandı — bayiye kanal dışı iletin`);
      qc.invalidateQueries({ queryKey: ["admin-user-pins"] });
      closeModal();
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Atanamadı"),
  });

  const unlockMut = useMutation({
    mutationFn: (owner) => api.adminUserPinUnlock(owner),
    onSuccess: () => {
      toast.success("✓ Kullanıcı kilidi açıldı");
      qc.invalidateQueries({ queryKey: ["admin-user-pins"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Açılamadı"),
  });

  const closeModal = () => {
    setSelected(null); setModalMode(null); setNewPin(""); setNote("");
  };

  const items = (q.data?.items || []).filter(i => {
    if (statusFilter === "with_pin" && !i.has_pin) return false;
    if (statusFilter === "no_pin" && i.has_pin) return false;
    if (statusFilter === "locked" && !i.is_locked) return false;
    if (!filter) return true;
    const s = filter.toLowerCase();
    return (
      (i.owner || "").toLowerCase().includes(s) ||
      (i.customer_name || "").toLowerCase().includes(s) ||
      (i.customer_email || "").toLowerCase().includes(s)
    );
  });

  const stats = {
    total: q.data?.items?.length || 0,
    with_pin: (q.data?.items || []).filter(i => i.has_pin).length,
    locked: (q.data?.items || []).filter(i => i.is_locked).length,
  };

  return (
    <Card data-testid="admin-user-pin-manager">
      <CardHeader
        title={<span className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-fuchsia-400" /> Kullanıcı PIN Yönetimi</span>}
        subtitle={<span>Aktif bayi/kullanıcılarınızın PIN durumunu görün, sıfırlayın veya yeni PIN atayın.
          <span className="ml-1 text-amber-400/80">PIN'ler PBKDF2-SHA256 ile hash'li saklanır — plaintext görülemez.</span>
        </span>}
        right={
          <div className="flex items-center gap-1.5">
            <Badge tone="slate" data-testid="pin-stats-total">Toplam: {stats.total}</Badge>
            <Badge tone="emerald" data-testid="pin-stats-with">PIN: {stats.with_pin}</Badge>
            {stats.locked > 0 && <Badge tone="rose" data-testid="pin-stats-locked">Kilit: {stats.locked}</Badge>}
          </div>
        }
      />
      <CardBody className="space-y-3">
        {/* Filtre / Arama */}
        <div className="flex flex-wrap gap-2 items-center">
          <input
            data-testid="pin-mgr-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="İsim, e-posta veya lisans anahtarı ara..."
            className="flex-1 min-w-[200px] bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs focus:border-fuchsia-500/40 focus:outline-none"
          />
          <select
            data-testid="pin-mgr-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs focus:border-fuchsia-500/40 focus:outline-none"
          >
            <option value="all">Tümü</option>
            <option value="with_pin">PIN'i olanlar</option>
            <option value="no_pin">PIN'i olmayanlar</option>
            <option value="locked">Kilitlenmiş</option>
          </select>
        </div>

        {q.isLoading && <div className="text-xs text-slate-500 py-6 text-center italic">Yükleniyor...</div>}
        {!q.isLoading && items.length === 0 && (
          <div className="text-xs text-slate-500 py-6 text-center italic">Kayıt yok.</div>
        )}

        {/* Kullanıcı Listesi */}
        {items.length > 0 && (
          <div className="border border-slate-800 rounded-md overflow-hidden max-h-[420px] overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-900/60 border-b border-slate-800 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400 font-bold">Kullanıcı / Bayi</th>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400 font-bold">Plan / IP</th>
                  <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400 font-bold">Durum</th>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400 font-bold">Son Değişim</th>
                  <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-slate-400 font-bold">Eylem</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.owner} data-testid={`pin-user-row-${i.owner}`} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                    <td className="px-3 py-2">
                      <div className="text-slate-200 font-semibold truncate max-w-[220px] flex items-center gap-1.5">
                        {i.is_master_row && <Star className="w-3 h-3 text-amber-400 shrink-0" />}
                        {i.customer_name || (i.owner === "__master__" ? "MASTER" : i.owner.slice(0, 24))}
                      </div>
                      <div className="text-[10px] mono text-slate-500 truncate max-w-[220px]">
                        {i.customer_email || i.owner.slice(0, 30)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-[11px] text-slate-300">
                        {i.plan?.toUpperCase() || "-"}
                      </div>
                      <div className="text-[10px] mono text-slate-500 truncate max-w-[140px]">
                        {(i.ip_addresses || []).slice(0, 2).join(", ") || "-"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {i.has_pin ? (
                        i.is_locked ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 text-[10px] font-bold border border-rose-500/40">
                            <ShieldAlert className="w-3 h-3" /> KİLİTLİ
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                            <ShieldCheck className="w-3 h-3" /> PIN Aktif
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/60 text-slate-400 text-[10px] font-semibold border border-slate-700">
                          PIN Yok
                        </span>
                      )}
                      {i.failed_attempts > 0 && (
                        <div className="text-[9px] text-amber-400 mt-0.5">
                          {i.failed_attempts} hatalı deneme
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[10px] mono text-slate-500 whitespace-nowrap">
                      {i.updated_at ? i.updated_at.slice(0, 16).replace("T", " ") : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {i.is_locked && (
                          <button
                            data-testid={`pin-unlock-${i.owner}`}
                            title="Kilidi Aç"
                            onClick={() => {
                              if (window.confirm(`${i.customer_name || i.owner.slice(0,20)} kullanıcısının kilidini açmak istediğinize emin misiniz?`))
                                unlockMut.mutate(i.owner);
                            }}
                            className="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 text-[10px] font-bold"
                          >
                            AÇ
                          </button>
                        )}
                        <button
                          data-testid={`pin-set-${i.owner}`}
                          title="Yeni PIN Belirle"
                          onClick={() => {
                            setSelected(i);
                            setModalMode("set");
                          }}
                          className="px-2 py-1 rounded bg-indigo-500/15 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/25 text-[10px] font-bold inline-flex items-center gap-1"
                        >
                          <KeyRound className="w-2.5 h-2.5" /> AYARLA
                        </button>
                        {i.has_pin && (
                          <button
                            data-testid={`pin-reset-${i.owner}`}
                            title="PIN'i Sıfırla"
                            onClick={() => {
                              setSelected(i);
                              setModalMode("reset");
                            }}
                            className="px-2 py-1 rounded bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25 text-[10px] font-bold inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-2.5 h-2.5" /> SIFIRLA
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>

      {/* Modal: Reset veya Set */}
      {modalMode && selected && (
        <div
          data-testid="pin-mgr-modal"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-lg p-5 max-w-md w-full space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">
                {modalMode === "reset" ? "PIN SIFIRLAMA" : "YENİ PIN ATA"}
              </div>
              <div className="text-sm font-bold text-slate-100">
                {selected.customer_name || selected.owner.slice(0, 24)}
              </div>
              <div className="text-[11px] mono text-slate-500 truncate">
                {selected.owner}
              </div>
            </div>

            {modalMode === "set" && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Yeni PIN (4-8 rakam)
                </label>
                <input
                  data-testid="pin-mgr-new-pin"
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mono focus:border-fuchsia-500/50 focus:outline-none"
                  placeholder="123456"
                />
                <div className="text-[10px] text-amber-400 mt-1">
                  PIN'i bayiye/kullanıcıya güvenli bir kanal üzerinden (telefon, güvenli chat) iletin.
                  Sistem <b>plaintext</b> olarak kaydetmez.
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Not (kullanıcıya iletilir, opsiyonel)
              </label>
              <input
                data-testid="pin-mgr-note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 200))}
                placeholder={modalMode === "reset" ? "Örn: Bilgi güncelleme talebiniz alındı" : "Örn: Ofis PIN'iniz yenilendi"}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs focus:border-fuchsia-500/50 focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                data-testid="pin-mgr-cancel"
                onClick={closeModal}
                className="px-4 py-2 rounded border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm font-semibold"
              >
                İptal
              </button>
              {modalMode === "reset" ? (
                <button
                  data-testid="pin-mgr-confirm-reset"
                  onClick={() => resetMut.mutate({ owner: selected.owner, note })}
                  disabled={resetMut.isPending}
                  className="px-4 py-2 rounded bg-rose-500/15 border border-rose-500/40 text-rose-200 hover:bg-rose-500/25 text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {resetMut.isPending ? "Sıfırlanıyor..." : "PIN'i Sıfırla"}
                </button>
              ) : (
                <button
                  data-testid="pin-mgr-confirm-set"
                  onClick={() => setMut.mutate({ owner: selected.owner, new_pin: newPin, note })}
                  disabled={setMut.isPending || newPin.length < 4}
                  className="px-4 py-2 rounded bg-indigo-500/15 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/25 text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {setMut.isPending ? "Uygulanıyor..." : "PIN'i Uygula"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
