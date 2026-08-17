import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight, MailWarning, Ban, ClipboardList, Users, AlertTriangle,
  Search, RotateCcw, Trash2, ShieldOff, ShieldCheck, X, Download, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge, StatCard } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import SavedFiltersBar from "@/components/SavedFiltersBar";
import OutboundGeoHeatmap from "@/components/OutboundGeoHeatmap";
import OutboundAttackMap from "@/components/OutboundAttackMap";
// v43.63 — Coğrafi Harita artık Kontrol Paneli'ndeki AttackMap ile aynı stack:
// ComposableMap + geoEqualEarth + real GeoJSON world atlas + curved arcs from Turkey.

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);
const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
};
// Exim null-sender ("<>") bounce/DSN mesajlarını okunabilir etikete çevir.
// Bkz. RFC 5321 §4.5.5 — mail server bounce mesajları boş envelope sender ile döner.
const displaySender = (from_addr) => {
  const s = (from_addr || "").trim();
  if (!s || s === "<>" || s === "<>" || s === "<>" || s.toLowerCase() === "mailer-daemon" || /^mailer-daemon@/i.test(s)) {
    return { label: "MAILER-DAEMON (bounce)", isBounce: true, raw: s };
  }
  return { label: s, isBounce: false, raw: s };
};
const useDebounced = (val, ms = 300) => {
  const [v, setV] = useState(val);
  useEffect(() => { const t = setTimeout(() => setV(val), ms); return () => clearTimeout(t); }, [val, ms]);
  return v;
};

const verdictTone = (v) => {
  const x = (v || "").toLowerCase();
  if (x === "clean") return { tone: "success", label: "TEMİZ" };
  if (x === "spam") return { tone: "warning", label: "SPAM" };
  if (x === "high_spam") return { tone: "danger", label: "AŞIRI SPAM" };
  if (x === "virus") return { tone: "danger", label: "VİRÜS" };
  if (x === "blocked" || x === "block") return { tone: "danger", label: "BLOKLANDI" };
  if (x === "whitelisted") return { tone: "success", label: "GÜVENİLİR" };
  return { tone: "info", label: (v || "?").toUpperCase() };
};

export default function Outbound() {
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [fromSearch, setFromSearch] = useState("");   // v43.61: full email address filter
  const [toSearch, setToSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [ipSearch, setIpSearch] = useState("");
  const [bodySearch, setBodySearch] = useState("");
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [hoursFilter, setHoursFilter] = useState("");
  const [verdict, setVerdict] = useState("all");
  const [limit, setLimit] = useState(200);
  const [advOpen, setAdvOpen] = useState(false);
  const [throttleModalOpen, setThrottleModalOpen] = useState(false);
  const [throttleUser, setThrottleUser] = useState("");
  // v43.59 — Tab layout + top user search
  const [tab, setTab] = useState("live");           // live | geo | users | alerts
  const [topUserSearch, setTopUserSearch] = useState("");
  // v43.60 — Sortable top users table
  const [topUserSortKey, setTopUserSortKey] = useState("sent");   // sent | spam | blocked | from_addr | user
  const [topUserSortDir, setTopUserSortDir] = useState("desc");   // asc | desc
  // v43.62 — User detail modal (email'e tıklayınca son 24 saat maillerini göster)
  const [userDetailEmail, setUserDetailEmail] = useState(null);
  // v43.4 Mail içeriği okuma modal state
  const [contentEventId, setContentEventId] = useState(null);
  const contentQuery = useQuery({
    queryKey: ["outbound-content", contentEventId],
    queryFn: () => api.outboundEventContent(contentEventId, { license_key: LICKEY() }),
    enabled: !!contentEventId,
  });

  // v43.5 WebSocket canlı outbound feed — yeni event ve bulk alert için toast + live counter
  const [liveCount, setLiveCount] = useState(0);
  useEffect(() => {
    const backend = process.env.REACT_APP_BACKEND_URL || "";
    const wsUrl = backend.replace(/^http/, "ws") + "/api/maintenance/ws/outbound";
    let ws;
    let reconnectTimer;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "bulk_alert") {
              toast.warning(`⚠️ Toplu Mail Uyarısı`, {
                description: `${msg.from_user} son 1 saatte ${msg.sent_count} mail atmış (limit: ${msg.limit}). Otomatik throttle uygulandı.`,
                duration: 12000,
              });
              qc.invalidateQueries({ queryKey: ["outbound-bulk-alerts"] });
              qc.invalidateQueries({ queryKey: ["outbound-throttles"] });
              qc.invalidateQueries({ queryKey: ["outbound-stats"] });
            } else if (msg.type === "event") {
              setLiveCount((c) => c + 1);
              // İlk ekran yenilenene kadar yeni event canlı sayaçta görünsün
              if (liveCount === 0) {
                qc.invalidateQueries({ queryKey: ["outbound-events"] });
              }
            }
            // "ping" mesajları görmezden gel
          } catch (_) {}
        };
        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => { try { ws.close(); } catch (_) {} };
      } catch (_) {}
    };
    connect();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) try { ws.close(); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v43.55 — Otomatik 5 dk'da bir backfill sinyali + otomatik yenileme
  useEffect(() => {
    let mounted = true;
    const trigger = async () => {
      if (!mounted) return;
      try {
        await api.outboundEximBackfill();
        qc.invalidateQueries({ queryKey: ["outbound-events"] });
        qc.invalidateQueries({ queryKey: ["outbound-stats"] });
      } catch (_) { /* sessiz — otomatik arka plan görevi */ }
    };
    const id = setInterval(trigger, 300_000); // 5 dakika
    return () => { mounted = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dSearch = useDebounced(search);
  const dFrom = useDebounced(fromSearch);
  const dTo = useDebounced(toSearch);
  const dSubj = useDebounced(subjectSearch);
  const dIp = useDebounced(ipSearch);
  const dBody = useDebounced(bodySearch);
  const dMinS = useDebounced(minScore);
  const dMaxS = useDebounced(maxScore);
  const dHours = useDebounced(hoursFilter);

  const eventsQuery = useQuery({
    queryKey: ["outbound-events", { dSearch, dFrom, dTo, dSubj, dIp, dBody, dMinS, dMaxS, dHours, verdict, limit }],
    queryFn: () => api.outboundEvents({
      limit,
      search: dSearch || undefined,
      from_search: dFrom || undefined,
      to_search: dTo || undefined,
      subject_search: dSubj || undefined,
      ip_search: dIp || undefined,
      body_search: dBody || undefined,
      min_score: dMinS ? Number(dMinS) : undefined,
      max_score: dMaxS ? Number(dMaxS) : undefined,
      hours: dHours ? Number(dHours) : undefined,
      verdict: verdict !== "all" ? verdict : undefined,
    }),
    refetchInterval: 3000,
    refetchOnWindowFocus: "always",
    refetchOnMount: "always",
    staleTime: 0,
  });

  const statsQuery = useQuery({ queryKey: ["outbound-stats"], queryFn: () => api.outboundStats(), refetchInterval: 3000, refetchOnWindowFocus: "always", staleTime: 0 });
  const bulkAlertsQuery = useQuery({ queryKey: ["outbound-bulk-alerts"], queryFn: () => api.outboundBulkAlerts(), refetchInterval: 30000 });
  const throttlesQuery = useQuery({ queryKey: ["outbound-throttles"], queryFn: () => api.outboundThrottles(), refetchInterval: 30000 });

  const s = statsQuery.data || { top_users: [], today_total: 0, today_spam: 0, today_blocked: 0, throttled_users: 0, limit_per_hour: 200 };
  const bulk = bulkAlertsQuery.data?.items || [];
  const throttles = throttlesQuery.data?.items || [];
  const events = eventsQuery.data?.items || [];

  const LICKEY = () => (typeof window !== "undefined"
    ? (localStorage.getItem("gws.master_license") || localStorage.getItem("gws.event_license") || "")
    : "");

  const actionMut = useMutation({
    mutationFn: ({ id, action }) => api.outboundEventAction(id, { action, license_key: LICKEY() }),
    onSuccess: (_, vars) => {
      const labels = { delete: "silindi", quarantine: "karantinaya alındı", whitelist_sender: "gönderen whitelist'e eklendi", throttle_sender: "gönderen throttle edildi" };
      toast.success(`Mail ${labels[vars.action] || "işlendi"}`);
      qc.invalidateQueries({ queryKey: ["outbound-events"] });
      qc.invalidateQueries({ queryKey: ["outbound-stats"] });
      qc.invalidateQueries({ queryKey: ["outbound-throttles"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "İşlem başarısız"),
  });

  const throttleMut = useMutation({
    mutationFn: (u) => api.outboundThrottleAdd({ from_user: u, license_key: LICKEY(), reason: "manual_ui" }),
    onSuccess: () => {
      toast.success("Kullanıcı throttle edildi");
      qc.invalidateQueries({ queryKey: ["outbound-throttles"] });
      qc.invalidateQueries({ queryKey: ["outbound-stats"] });
      setThrottleModalOpen(false); setThrottleUser("");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Throttle uygulanamadı"),
  });

  const unthrottleMut = useMutation({
    mutationFn: (u) => api.outboundThrottleRemove({ from_user: u, license_key: LICKEY() }),
    onSuccess: () => {
      toast.success("Throttle kaldırıldı");
      qc.invalidateQueries({ queryKey: ["outbound-throttles"] });
      qc.invalidateQueries({ queryKey: ["outbound-stats"] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Kaldırılamadı"),
  });

  const resetFilters = () => {
    setSearch(""); setFromSearch(""); setToSearch(""); setSubjectSearch(""); setIpSearch("");
    setMinScore(""); setMaxScore(""); setHoursFilter(""); setVerdict("all");
  };

  const exportCSV = () => {
    if (!events.length) return toast.info("Dışa aktarılacak veri yok");
    const rows = [["Zaman", "Gönderen", "Alıcı", "Konu", "Skor", "Verdict", "IP"]];
    events.forEach(e => rows.push([
      e.ts || "", e.from_addr || "", e.to_addr || "", (e.subject || "").replace(/,/g, ";"),
      e.total_score ?? 0, e.verdict || "", e.sender_ip || e.client_ip || "",
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `outbound_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-5" data-testid="outbound-page">
      {/* v43.55 — Yenilenmiş Hero: başlık + canlı durum + entegre aksiyonlar */}
      <div className="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <ArrowUpRight className="w-5 h-5 text-emerald-300" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Giden Posta</h1>
                <div className="text-xs text-slate-500">
                  Sunucudan gönderilen tüm outbound mail trafiği · gerçek zamanlı
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              data-testid="ob-backfill-top-btn"
              onClick={async () => {
                if (!window.confirm("Son 24 saatlik veriyi sunucudan yeniden çekmek için sinyal gönderilecek. Devam?")) return;
                const t = toast.loading("Sinyal gönderiliyor…");
                try {
                  const d = await api.outboundEximBackfill();
                  toast.dismiss(t);
                  toast.success(`✓ ${d.signaled_licenses} sunucu için backfill başlatıldı`, {
                    description: "Cron sağlıklıysa 60sn içinde veri akmaya başlar. Panel 90sn sonra otomatik yenilenecek.",
                    duration: 10000,
                  });
                  setTimeout(() => {
                    qc.invalidateQueries({ queryKey: ["outbound-events"] });
                    qc.invalidateQueries({ queryKey: ["outbound-stats"] });
                  }, 90_000);
                } catch (e) { toast.dismiss(t); toast.error(e?.response?.data?.detail || e.message); }
              }}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 transition-colors"
              title="Bash cron'a 'son 24 saati yeniden gönder' sinyali"
            >
              <span>⚡</span> Backfill 24s
            </button>
            <button
              data-testid="ob-refresh-btn"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["outbound-events"] });
                qc.invalidateQueries({ queryKey: ["outbound-stats"] });
                toast.success("Yenilendi");
              }}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
              title="DB'den güncel verileri tekrar çek"
            >
              <span>🔄</span> Yenile
            </button>
            <button
              data-testid="ob-repair-ts-btn"
              onClick={async () => {
                try {
                  const dry = await api.outboundRepairTimestamps(true);
                  const groups = dry.duplicate_groups || [];
                  if (groups.length === 0) {
                    toast.success("Aynı ts'ye sıkışmış kayıt bulunamadı", { duration: 5000 });
                    return;
                  }
                  const summary = groups.slice(0, 5).map(g => `• ${g.count} kayıt @ ${g.ts}`).join("\n");
                  if (!window.confirm(`${groups.length} grup tespit edildi (${dry.scanned} kayıt).\n\n${summary}\n\nOnarılsın mı?`)) return;
                  const res = await api.outboundRepairTimestamps(false);
                  toast.success(`✓ ${res.repaired} kayıt onarıldı`, { description: `${res.unresolved} atlandı`, duration: 8000 });
                  qc.invalidateQueries({ queryKey: ["outbound-events"] });
                } catch (e) { toast.error(e?.response?.data?.detail || e.message); }
              }}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors"
              title="Duplicate ts'leri mid'den yeniden türetir"
            >
              <span>🛠</span> TS Onar
            </button>
          </div>
        </div>
        {/* Son push durumu (kompakt tek satır) */}
        <LastPushIndicator lastPushAt={statsQuery.data?.last_push_at} />
      </div>

      {/* v43.41 — Plugin version banner (eski sürümdeyse) */}
      <PluginVersionBanner />

      {/* Stat cards — 6 kolon, temiz grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Bugün Giden" value={nfmt(s.today_total)} icon={ArrowUpRight} tone="brand" testid="ob-today-total" />
        <StatCard label="Tüm Zamanlar" value={nfmt(s.all_time_total ?? 0)} icon={ArrowUpRight} tone="info" testid="ob-alltime-total" />
        <StatCard label="Spam Giden" value={nfmt(s.today_spam)} icon={MailWarning} tone="warning" testid="ob-today-spam" />
        <StatCard label="Bloklanan" value={nfmt(s.today_blocked)} icon={Ban} tone="danger" testid="ob-today-blocked" />
        <StatCard label="Throttled" value={nfmt(s.throttled_users)} icon={Users} tone="danger" testid="ob-throttled-users" />
        <StatCard label="Saatlik Limit" value={nfmt(s.limit_per_hour)} icon={ClipboardList} tone="info" testid="ob-limit" />
      </div>

      {/* v43.59 — Tab bar (sadece uzun kaydırma yerine sekmelerle organize) */}
      <div className="flex flex-wrap gap-1 border-b border-slate-800" data-testid="ob-tabs">
        {[
          { id: "live",   label: "Canlı Trafik", icon: "📊", count: events.length },
          { id: "geo",    label: "Coğrafi Harita", icon: "🌍" },
          { id: "users",  label: "Kullanıcılar", icon: "👥", count: (s.top_users || []).length },
          { id: "alerts", label: "Uyarılar", icon: "⚠", count: bulk.length + throttles.length },
        ].map((t) => (
          <button
            key={t.id}
            data-testid={`ob-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? "border-indigo-500 text-indigo-300 bg-indigo-500/5"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
            }`}
          >
            <span className="mr-1.5">{t.icon}</span>
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span className={`ml-2 text-[10px] mono px-1.5 py-0.5 rounded ${
                tab === t.id ? "bg-indigo-500/20 text-indigo-200" : "bg-slate-800 text-slate-400"
              }`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* v43.59 — TAB: CANLI TRAFİK (varsayılan) */}
      {tab === "live" && <>
      {/* v43.24 — Boş durum rehberi: hiç kayıt yoksa neden ve nasıl açıklaması */}
      {events.length === 0 && !eventsQuery.isLoading && (
        <Card data-testid="ob-empty-hint">
          <div className="p-4 border-l-4 border-sky-500 bg-sky-500/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              <div className="flex-1 text-sm text-slate-300 space-y-1.5">
                <div className="font-semibold text-sky-300">Giden mail kaydı görünmüyor</div>
                <div className="text-xs text-slate-400 leading-relaxed">
                  Olası nedenler:
                </div>
                <ul className="text-xs text-slate-400 list-disc pl-5 space-y-0.5">
                  <li><b>Master anahtarı</b> tarayıcıda kayıtlı olmayabilir — Header'daki <b>"Master Aktif Et"</b> butonuna tıklayın.</li>
                  <li><b>Milter/logtail v43+</b> henüz kurulu değilse yeni gönderilen mailler <code className="mono text-slate-300">direction=in</code> olarak yanlış sınıflanır. WHM sunucunuzda <code className="mono text-amber-300">gws-update</code> çalıştırın.</li>
                  <li>Filtre (verdict / arama / skor / saat) çok dar olabilir — üstteki filtreleri <b>Sıfırla</b> deneyin.</li>
                </ul>
                <div className="pt-2 flex flex-wrap gap-2">
                  <button
                    data-testid="ob-diagnostic-btn"
                    onClick={async () => {
                      try {
                        const d = await api.outboundDiagnostic();
                        const msg = `Master: ${d.master_authenticated ? "✓ aktif" : "✗ yok"}\n`
                          + `Toplam outbound: ${d.outbound_total}\n`
                          + `Son 24 saat: ${d.outbound_last_24h}\n`
                          + `Son ingest: ${d.last_outbound_ts || "yok"}\n\n`
                          + `Teşhis:\n- ${(d.diagnosis || []).join("\n- ")}\n\n`
                          + `Çözüm:\n- ${(d.fix_hints || []).join("\n- ")}`;
                        alert(msg);
                      } catch (e) { toast.error(e?.response?.data?.detail || e.message); }
                    }}
                    className="text-xs px-3 py-1.5 rounded border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20"
                  >
                    🔍 Sunucumu Kontrol Et
                  </button>
                  <button
                    data-testid="ob-seed-sample-btn"
                    onClick={async () => {
                      try {
                        const d = await api.outboundSeedSample();
                        toast.success(`${d.inserted} demo outbound eklendi — sayfa yenileniyor`);
                        setTimeout(() => window.location.reload(), 800);
                      } catch (e) { toast.error(e?.response?.data?.detail || e.message); }
                    }}
                    className="text-xs px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                  >
                    🧪 Demo Outbound Ekle
                  </button>
                  <button
                    data-testid="ob-backfill-btn"
                    onClick={async () => {
                      if (!window.confirm("Son 24 saatlik Exim mainlog verilerini panele çekmek üzere bayi sunuculara sinyal gönderilecek. Devam edilsin mi?")) return;
                      try {
                        const d = await api.outboundEximBackfill();
                        toast.success(`✓ ${d.signaled_licenses} sunucuya sinyal yazıldı`, {
                          description: d.note, duration: 8000,
                        });
                      } catch (e) { toast.error(e?.response?.data?.detail || e.message); }
                    }}
                    className="text-xs px-3 py-1.5 rounded border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
                    title="Bayi WHM plugin daemon'a: /var/log/exim_mainlog son 24 saatlik veriyi hemen çek"
                  >
                    ⚡ Son 24s Backfill
                  </button>
                  <button
                    data-testid="ob-install-guide-btn"
                    onClick={() => document.getElementById("ob-install-guide")?.scrollIntoView({ behavior: "smooth" })}
                    className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                  >
                    📘 Milter Kurulum Adımları
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* v43.29 — Milter/logtail kurulum rehberi (boş durum genişletildi) */}
      {events.length === 0 && !eventsQuery.isLoading && (
        <Card data-testid="ob-install-guide" id="ob-install-guide">
          <div className="p-5 space-y-3">
            <div className="text-sm font-bold text-emerald-300 flex items-center gap-2">
              📘 Sunucunuza Milter/Logtail v43+ Kurulum
            </div>
            <div className="text-xs text-slate-400 leading-relaxed">
              "Toplam outbound: 0" görüyorsanız Milter/logtail sunucunuzda çalışmıyor.
              WHM sunucunuza SSH ile bağlanıp aşağıdaki komutları sırayla çalıştırın:
            </div>
            <div className="space-y-2">
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">1. GÜNCELLE</div>
                <pre className="text-xs mono bg-slate-950 border border-slate-800 rounded p-2 text-emerald-300 overflow-auto">gws-update</pre>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">2. LOGTAIL DAEMON'I BAŞLAT</div>
                <pre className="text-xs mono bg-slate-950 border border-slate-800 rounded p-2 text-emerald-300 overflow-auto">systemctl enable --now gws-logtail
systemctl status gws-logtail</pre>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">3. TEST ATIŞ YAP</div>
                <pre className="text-xs mono bg-slate-950 border border-slate-800 rounded p-2 text-emerald-300 overflow-auto">echo "test" | mail -s "outbound test" your-external@gmail.com
# 15 sn sonra bu sayfayı yenileyin</pre>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">4. DOĞRULA (LOG'LAR)</div>
                <pre className="text-xs mono bg-slate-950 border border-slate-800 rounded p-2 text-emerald-300 overflow-auto"># Exim'de outbound var mı?
grep "U=" /var/log/exim_mainlog | tail -5

# Logtail script ne ingest ediyor?
tail -20 /var/log/gokyuzuwebspam/logtail.log</pre>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1">5. YAYGIN SORUN</div>
                <ul className="text-xs text-slate-400 list-disc pl-5 space-y-0.5">
                  <li>Logtail script v43'ten eski — <code className="mono text-amber-300">grep "U=" /usr/local/bin/mailshield-logtail.pl</code> — <b>0 satır</b> döndüyse eski sürüm, <b>gws-update</b> gerekir</li>
                  <li>Systemd servisi yok — kur: <code className="mono text-amber-300">cp /app/deployment/gws-logtail.service /etc/systemd/system/ && systemctl daemon-reload</code></li>
                  <li>Preview panelinde de <b>0</b> gözüküyorsa Master anahtarınız gerçek bayi lisansı ile eşleşmiyor olabilir. Fiyat/Lisans sayfasından master lisansınızı doğrulayın.</li>
                </ul>
              </div>
            </div>
          </div>
        </Card>
      )}

      {bulk.length > 0 && (
        <Card data-testid="ob-bulk-banner">
          <div className="p-3 border-l-4 border-amber-500 bg-amber-500/5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-amber-300">
                {bulk.length} adet toplu giden mail uyarısı (son 24 saat)
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {bulk.slice(0, 6).map((a) => (
                  <span key={a.id} data-testid={`ob-bulk-${a.id}`}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-xs">
                    <span className="mono text-amber-200">{a.from_user}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-rose-300 mono">{a.sent_count}/{a.limit}</span>
                  </span>
                ))}
                {bulk.length > 6 && (
                  <button onClick={() => setTab("alerts")}
                          className="text-[11px] text-amber-300 hover:text-amber-200 underline">
                    +{bulk.length - 6} daha → Uyarılar sekmesi
                  </button>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardBody className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-500" />
            <input data-testid="ob-search" value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Kullanıcı ara..."
                   className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500" />
          </div>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value)} data-testid="ob-verdict"
                  className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200">
            <option value="all">Tüm Verdict</option>
            <option value="clean">Temiz</option>
            <option value="spam">Spam</option>
            <option value="high_spam">Aşırı Spam</option>
            <option value="virus">Virüs</option>
            <option value="blocked">Bloklu</option>
          </select>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-slate-200">
            {[100, 200, 500, 1000, 5000].map(n => <option key={n} value={n}>{n} kayıt</option>)}
          </select>
          <button onClick={() => setAdvOpen(v => !v)} data-testid="ob-adv-toggle"
                  className="text-xs text-indigo-300 hover:text-indigo-200 underline">
            {advOpen ? "Gelişmiş −" : "Gelişmiş +"}
          </button>
          <button onClick={resetFilters} data-testid="ob-reset"
                  className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> Sıfırla
          </button>
          <button onClick={exportCSV} data-testid="ob-export-csv"
                  className="ml-auto text-xs text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/5">
            <Download className="w-3 h-3" /> CSV
          </button>
          <button onClick={() => setThrottleModalOpen(true)} data-testid="ob-open-throttle-modal"
                  className="text-xs text-amber-300 hover:text-amber-200 inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/30 bg-amber-500/5">
            <ShieldOff className="w-3 h-3" /> Manuel Throttle
          </button>
        </CardBody>

        {advOpen && (
          <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-3 gap-2" data-testid="ob-adv-panel">
            <input value={toSearch} onChange={(e) => setToSearch(e.target.value)} data-testid="ob-adv-to"
                   placeholder="Alıcı (regex)..." className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
            <input value={subjectSearch} onChange={(e) => setSubjectSearch(e.target.value)} data-testid="ob-adv-subject"
                   placeholder="Konu (regex)..." className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
            <input value={ipSearch} onChange={(e) => setIpSearch(e.target.value)} data-testid="ob-adv-ip"
                   placeholder="IP (regex)..." className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
            <input value={bodySearch} onChange={(e) => setBodySearch(e.target.value)} data-testid="ob-adv-body"
                   placeholder="Gövde içinde ara (metin/html)..."
                   className="bg-slate-950 border border-emerald-800/40 rounded px-2 py-1.5 text-xs md:col-span-3 focus:border-emerald-500 focus:outline-none" />
            <input value={minScore} onChange={(e) => setMinScore(e.target.value)} data-testid="ob-adv-min"
                   type="number" step="0.1" placeholder="Min skor" className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
            <input value={maxScore} onChange={(e) => setMaxScore(e.target.value)} data-testid="ob-adv-max"
                   type="number" step="0.1" placeholder="Max skor" className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
            <input value={hoursFilter} onChange={(e) => setHoursFilter(e.target.value)} data-testid="ob-adv-hours"
                   type="number" placeholder="Son N saat" className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
          </div>
        )}

        <div className="px-3 pb-3 border-t border-slate-800 pt-2">
          <SavedFiltersBar
            module="outbound_events"
            currentFilters={{ search, verdict, limit, toSearch, subjectSearch, ipSearch, bodySearch, minScore, maxScore, hoursFilter }}
            onLoad={(f) => {
              setSearch(f.search ?? ""); setVerdict(f.verdict ?? "all");
              if (f.limit && Number.isFinite(Number(f.limit))) setLimit(Number(f.limit));
              setToSearch(f.toSearch ?? ""); setSubjectSearch(f.subjectSearch ?? "");
              setIpSearch(f.ipSearch ?? ""); setBodySearch(f.bodySearch ?? "");
              setMinScore(f.minScore ?? "");
              setMaxScore(f.maxScore ?? ""); setHoursFilter(f.hoursFilter ?? "");
              if (f.toSearch || f.subjectSearch || f.ipSearch || f.bodySearch || f.minScore || f.maxScore || f.hoursFilter) setAdvOpen(true);
            }}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2" data-testid="ob-live-header">
              Giden Mail Trafiği
              <span data-testid="ob-live-indicator" className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-emerald-400 mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> canlı
              </span>
              {liveCount > 0 && (
                <button
                  data-testid="ob-live-count"
                  onClick={() => { qc.invalidateQueries({ queryKey: ["outbound-events"] }); setLiveCount(0); }}
                  className="text-[10px] mono px-1.5 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30 animate-pulse">
                  +{liveCount} yeni · tıkla yenile
                </button>
              )}
            </span>
          }
          subtitle={eventsQuery.isFetching ? "Yükleniyor…" : `${events.length} kayıt (limit: ${limit})`}
          right={<Badge tone="brand">v43 Filtering</Badge>}
        />
        <div className="overflow-x-auto max-h-[600px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-950/95 z-10">
              <tr className="text-[11px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                <th className="text-left px-3 py-2 font-semibold">Zaman</th>
                <th className="text-left px-3 py-2 font-semibold">Gönderen</th>
                <th className="text-left px-3 py-2 font-semibold">Alıcı</th>
                <th className="text-left px-3 py-2 font-semibold">Konu</th>
                <th className="text-right px-3 py-2 font-semibold">Skor</th>
                <th className="text-center px-3 py-2 font-semibold">Verdict</th>
                <th className="text-center px-3 py-2 font-semibold">İşlem</th>
              </tr>
            </thead>
            <tbody data-testid="ob-events-tbody">
              {events.map((e) => {
                const vt = verdictTone(e.verdict);
                const ds = displaySender(e.from_addr);
                return (
                  <tr key={e.id} data-testid={`ob-row-${e.id}`} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                    <td className="px-3 py-2 mono text-[11px] text-slate-500 whitespace-nowrap">{fmtTime(e.ts)}</td>
                    <td className={`px-3 py-2 mono break-all ${ds.isBounce ? "text-slate-500 italic" : "text-slate-200"}`}
                        title={ds.isBounce ? `Bounce mesajı — envelope sender boş (${ds.raw || "<>"})` : e.from_addr}>
                      {ds.isBounce ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 uppercase tracking-widest">bounce</span>
                          <span className="text-slate-500">MAILER-DAEMON</span>
                        </span>
                      ) : ds.label}
                    </td>
                    <td className="px-3 py-2 mono text-slate-300 break-all" title={e.to_addr}>{e.to_addr}</td>
                    <td className="px-3 py-2 text-slate-300 truncate max-w-[240px]" title={e.subject}>{e.subject || "(konusuz)"}</td>
                    <td className="px-3 py-2 text-right mono text-amber-300">{Number(e.total_score ?? 0).toFixed(1)}</td>
                    <td className="px-3 py-2 text-center"><Badge tone={vt.tone}>{vt.label}</Badge></td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <button title="Mail içeriğini oku" data-testid={`ob-read-${e.id}`}
                              onClick={() => setContentEventId(e.id)}
                              className="p-1 rounded hover:bg-cyan-500/10 text-cyan-300 mr-1"><Eye className="w-3.5 h-3.5" /></button>
                      <button title="Karantinaya al" data-testid={`ob-quar-${e.id}`}
                              onClick={() => actionMut.mutate({ id: e.id, action: "quarantine" })}
                              className="p-1 rounded hover:bg-amber-500/10 text-amber-300 mr-1"><MailWarning className="w-3.5 h-3.5" /></button>
                      <button title="Gönderen whitelist" data-testid={`ob-wl-${e.id}`}
                              onClick={() => actionMut.mutate({ id: e.id, action: "whitelist_sender" })}
                              className="p-1 rounded hover:bg-emerald-500/10 text-emerald-300 mr-1"><ShieldCheck className="w-3.5 h-3.5" /></button>
                      <button title="Kullanıcıyı throttle" data-testid={`ob-throt-${e.id}`}
                              onClick={() => actionMut.mutate({ id: e.id, action: "throttle_sender" })}
                              className="p-1 rounded hover:bg-orange-500/10 text-orange-300 mr-1"><ShieldOff className="w-3.5 h-3.5" /></button>
                      <button title="Sil" data-testid={`ob-del-${e.id}`}
                              onClick={() => { if (confirm("Bu mail kaydını sil?")) actionMut.mutate({ id: e.id, action: "delete" }); }}
                              className="p-1 rounded hover:bg-rose-500/10 text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                );
              })}
              {events.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500 text-sm">
                  {eventsQuery.isLoading ? "Yükleniyor…" : "Giden mail kaydı yok"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      </>}
      {/* /TAB: CANLI TRAFİK */}

      {/* v43.63 — TAB: COĞRAFİ HARITA (Kontrol Paneli'ndeki AttackMap ile aynı: ComposableMap + real world atlas + arcs) */}
      {tab === "geo" && (
        <div className="space-y-4">
          <OutboundAttackMap hours={6} />
          <OutboundGeoHeatmap />
        </div>
      )}

      {/* v43.59 — TAB: KULLANICILAR (Bugün en çok + throttled) */}
      {tab === "users" && <>
      <Card>
        <CardHeader
          title="Bugün En Çok Mail Atan Kullanıcılar"
          subtitle="Tam email adresleri + arama — rate limit'e yakın user'ları izleyin"
          right={
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input
                data-testid="ob-topuser-search"
                value={topUserSearch}
                onChange={(e) => setTopUserSearch(e.target.value)}
                placeholder="Email veya kullanıcı adı ara..."
                className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-100 w-64 focus:outline-none focus:border-indigo-500"
              />
              {topUserSearch && (
                <button onClick={() => setTopUserSearch("")}
                        className="text-xs text-slate-400 hover:text-slate-200">×</button>
              )}
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-widest text-slate-500 border-b border-slate-800 select-none">
                {[
                  { key: "from_addr", label: "Email Adresi", align: "left" },
                  { key: "user", label: "Kullanıcı", align: "left" },
                  { key: "sent", label: "Gönderilen", align: "right" },
                  { key: "spam", label: "Spam", align: "right" },
                  { key: "blocked", label: "Bloklu", align: "right" },
                ].map((col) => {
                  const active = topUserSortKey === col.key;
                  const arrow = active ? (topUserSortDir === "asc" ? "▲" : "▼") : "↕";
                  return (
                    <th
                      key={col.key}
                      data-testid={`ob-topuser-sort-${col.key}`}
                      onClick={() => {
                        if (topUserSortKey === col.key) {
                          setTopUserSortDir(topUserSortDir === "asc" ? "desc" : "asc");
                        } else {
                          setTopUserSortKey(col.key);
                          setTopUserSortDir(col.key === "from_addr" || col.key === "user" ? "asc" : "desc");
                        }
                      }}
                      className={`text-${col.align} px-3 py-2 font-semibold cursor-pointer hover:text-indigo-300 transition-colors ${active ? "text-indigo-300" : ""}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        <span className={`text-[9px] ${active ? "text-indigo-400" : "text-slate-600"}`}>{arrow}</span>
                      </span>
                    </th>
                  );
                })}
                <th className="text-right px-3 py-2 font-semibold">Kullanım %</th>
                <th className="text-center px-3 py-2 font-semibold">İşlem</th>
              </tr>
            </thead>
            <tbody data-testid="ob-topusers-tbody">
              {(s.top_users || [])
                .filter((u) => {
                  if (!topUserSearch) return true;
                  const q = topUserSearch.toLowerCase();
                  return (u.from_addr || "").toLowerCase().includes(q)
                      || (u.user || "").toLowerCase().includes(q);
                })
                .slice()
                .sort((a, b) => {
                  const av = a[topUserSortKey] ?? "";
                  const bv = b[topUserSortKey] ?? "";
                  let cmp;
                  if (typeof av === "number" || typeof bv === "number") {
                    cmp = (Number(av) || 0) - (Number(bv) || 0);
                  } else {
                    cmp = String(av).localeCompare(String(bv), "tr");
                  }
                  return topUserSortDir === "asc" ? cmp : -cmp;
                })
                .map((u) => {
                  const usagePct = Math.round((u.sent / Math.max(1, s.limit_per_hour * 8)) * 100);
                  const key = u.from_addr || u.user;
                  return (
                    <tr key={key} data-testid={`ob-topuser-${key}`} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                      <td
                        className="px-3 py-2 mono text-slate-100 break-all cursor-pointer hover:text-indigo-300 hover:underline"
                        title={`Detaylı bilgi için tıkla: ${u.from_addr}`}
                        onClick={() => setUserDetailEmail(u.from_addr)}
                        data-testid={`ob-topuser-email-${key}`}
                      >
                        {u.from_addr || "(email yok)"}
                      </td>
                      <td className="px-3 py-2 mono text-slate-400 text-xs">{u.user || "—"}</td>
                      <td className="px-3 py-2 text-right mono text-slate-200">{nfmt(u.sent)}</td>
                      <td className="px-3 py-2 text-right mono text-amber-300">{nfmt(u.spam)}</td>
                      <td className="px-3 py-2 text-right mono text-rose-400">{nfmt(u.blocked)}</td>
                      <td className={`px-3 py-2 text-right mono ${usagePct > 80 ? "text-rose-400 font-semibold" : usagePct > 50 ? "text-amber-300" : "text-slate-300"}`}>%{usagePct}</td>
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        <button
                          data-testid={`ob-filter-by-${key}`}
                          onClick={() => {
                            // v43.61 — Email adresine göre filtrele (kullanıcı adına değil).
                            // "info" ile arama tüm 'info@*' adresleri getirirdi; artık tam email match.
                            setSearch("");
                            setFromSearch(u.from_addr || "");
                            setTab("live");
                          }}
                          title={`Bu email adresinden gönderilenler: ${u.from_addr}`}
                          className="text-xs text-indigo-300 hover:text-indigo-200 px-2 py-0.5 rounded border border-indigo-500/30 bg-indigo-500/5 mr-1"
                        >Mailler</button>
                        <button
                          data-testid={`ob-throt-user-${key}`}
                          onClick={() => { setThrottleUser(u.user || ""); setThrottleModalOpen(true); }}
                          title="Kullanıcıyı throttle et"
                          className="text-xs text-amber-300 hover:text-amber-200 px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/5"
                        >Sınırla</button>
                      </td>
                    </tr>
                  );
                })}
              {(!s.top_users || s.top_users.length === 0) && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500 text-sm">Bugün için user verisi yok</td></tr>
              )}
              {s.top_users && s.top_users.length > 0 && topUserSearch &&
                s.top_users.filter((u) => {
                  const q = topUserSearch.toLowerCase();
                  return (u.from_addr || "").toLowerCase().includes(q)
                      || (u.user || "").toLowerCase().includes(q);
                }).length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500 text-sm">"{topUserSearch}" ile eşleşen kullanıcı yok</td></tr>
                )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><ShieldOff className="w-4 h-4 text-amber-400" /> Sınırlandırılmış Kullanıcılar</span>}
          subtitle={`${throttles.length} kullanıcı aktif olarak throttle ediliyor`}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                <th className="text-left px-3 py-2 font-semibold">Kullanıcı</th>
                <th className="text-left px-3 py-2 font-semibold">Neden</th>
                <th className="text-right px-3 py-2 font-semibold">Sayım</th>
                <th className="text-left px-3 py-2 font-semibold">Zaman</th>
                <th className="text-center px-3 py-2 font-semibold">İşlem</th>
              </tr>
            </thead>
            <tbody data-testid="ob-throttles-tbody">
              {throttles.map((t) => (
                <tr key={`${t.license_key}::${t.from_user}`} data-testid={`ob-throt-row-${t.from_user}`} className="border-b border-slate-800/60">
                  <td className="px-3 py-2 mono text-slate-100">{t.from_user}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{t.reason || "—"}</td>
                  <td className="px-3 py-2 text-right mono text-rose-300">{t.sent_count ?? "?"} / {t.limit ?? "?"}</td>
                  <td className="px-3 py-2 mono text-[11px] text-slate-500">{fmtTime(t.throttled_at)}</td>
                  <td className="px-3 py-2 text-center">
                    <button data-testid={`ob-unthrot-${t.from_user}`}
                            onClick={() => unthrottleMut.mutate(t.from_user)}
                            className="text-xs text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/5">
                      <X className="w-3 h-3" /> Kaldır
                    </button>
                  </td>
                </tr>
              ))}
              {throttles.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500 text-sm">Aktif throttle yok</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      </>}
      {/* /TAB: KULLANICILAR */}

      {/* v43.59 — TAB: UYARILAR (bulk alerts detayı) */}
      {tab === "alerts" && (
        <Card data-testid="ob-alerts-full">
          <CardHeader
            title={<span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400"/> Toplu Mail Uyarıları — Son 24 Saat</span>}
            subtitle={`${bulk.length} otomatik tetiklenmiş uyarı`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                  <th className="text-left px-3 py-2 font-semibold">Kullanıcı</th>
                  <th className="text-right px-3 py-2 font-semibold">Sayım</th>
                  <th className="text-right px-3 py-2 font-semibold">Limit</th>
                  <th className="text-left px-3 py-2 font-semibold">Sebep</th>
                  <th className="text-left px-3 py-2 font-semibold">Zaman</th>
                </tr>
              </thead>
              <tbody>
                {bulk.map((a) => (
                  <tr key={a.id} data-testid={`ob-alert-row-${a.id}`} className="border-b border-slate-800/60">
                    <td className="px-3 py-2 mono text-amber-200">{a.from_user}</td>
                    <td className="px-3 py-2 text-right mono text-rose-300">{a.sent_count}</td>
                    <td className="px-3 py-2 text-right mono text-slate-400">{a.limit}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{a.reason || "auto_bulk_detect"}</td>
                    <td className="px-3 py-2 mono text-[11px] text-slate-500">{fmtTime(a.created_at)}</td>
                  </tr>
                ))}
                {bulk.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500 text-sm">Son 24 saatte toplu mail uyarısı yok — sistem sağlıklı ✓</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {/* /TAB: UYARILAR */}

      {/* v43.20 — Webmail-style Mail Reader ------------------------------ */}
      {contentEventId && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-start justify-center p-2 sm:p-4 overflow-y-auto"
             onClick={() => setContentEventId(null)}>
          <div className="bg-white text-slate-900 rounded-xl max-w-5xl w-full my-4 shadow-2xl border border-slate-300 overflow-hidden"
               onClick={(e) => e.stopPropagation()}
               data-testid="ob-content-modal">

            {/* Top action bar (dark) */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900 text-slate-100 border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs">
                <Eye className="w-4 h-4 text-cyan-400" />
                <span className="font-semibold">Mail Okuyucu</span>
                {contentQuery.data?.content_source === "db" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/30 text-emerald-300 border border-emerald-500/40">DB</span>
                )}
                {contentQuery.data?.content_source && contentQuery.data.content_source.startsWith("Exim") && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-600/30 text-amber-300 border border-amber-500/40">Spool</span>
                )}
              </div>
              <button onClick={() => setContentEventId(null)}
                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100" aria-label="close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {contentQuery.isLoading && (
              <div className="p-16 text-center text-slate-500 text-sm">Yükleniyor…</div>
            )}
            {contentQuery.isError && (
              <div className="p-16 text-center text-rose-600 text-sm" data-testid="ob-content-error">
                {contentQuery.error?.response?.data?.detail || "İçerik alınamadı"}
              </div>
            )}
            {contentQuery.data && (() => {
              const c = contentQuery.data;
              const hasBody = !!(c.body_preview || c.body_html);
              const senderInitial = (c.from_addr || "?").charAt(0).toUpperCase();
              const senderName = c.from_addr ? c.from_addr.split("@")[0] : "(bilinmeyen)";
              const senderDomain = c.from_addr && c.from_addr.includes("@") ? c.from_addr.split("@")[1] : "";
              const avatarHue = Math.abs((c.from_addr || "").split("").reduce((h, c) => h * 31 + c.charCodeAt(0), 5) % 360);
              return (
                <div className="bg-white">
                  {/* Subject */}
                  <div className="px-6 pt-5 pb-3">
                    <h2 className="text-xl font-semibold text-slate-900 leading-tight" data-testid="ob-mail-subject">
                      {c.subject || "(konusuz)"}
                    </h2>
                    <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
                      {c.verdict && (
                        <span className={`px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold border ${
                          c.verdict === "clean" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : c.verdict === "spam" || c.verdict === "high_spam" ? "bg-amber-50 text-amber-700 border-amber-200"
                          : c.verdict === "virus" || c.verdict === "phishing" ? "bg-rose-50 text-rose-700 border-rose-200"
                          : "bg-slate-100 text-slate-700 border-slate-200"
                        }`}>{c.verdict}</span>
                      )}
                      {typeof c.total_score === "number" && (
                        <span className="text-slate-500">Skor: <span className="font-semibold text-slate-700">{Number(c.total_score).toFixed(1)}</span></span>
                      )}
                    </div>
                  </div>

                  {/* Sender row (Gmail-style) */}
                  <div className="px-6 py-3 border-t border-slate-100 flex items-start gap-3">
                    <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
                         style={{ background: `hsl(${avatarHue}, 60%, 45%)` }}>
                      {senderInitial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-900" data-testid="ob-mail-sender">{senderName}</span>
                          {senderDomain && <span className="text-slate-500"> &lt;{c.from_addr}&gt;</span>}
                        </div>
                        <div className="text-[11px] text-slate-500 mono" data-testid="ob-mail-time">{fmtTime(c.ts)}</div>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        <span className="text-slate-400">alıcı:</span> <span data-testid="ob-mail-recipient">{c.to_addr || "—"}</span>
                        {c.from_user && <span className="ml-3"><span className="text-slate-400">user:</span> {c.from_user}</span>}
                        {c.sender_ip && <span className="ml-3"><span className="text-slate-400">ip:</span> <span className="mono">{c.sender_ip}</span></span>}
                      </div>
                    </div>
                  </div>

                  {/* Attachments (chips at top, Gmail-style) */}
                  {c.attachments && c.attachments.length > 0 && (
                    <div className="px-6 py-3 border-t border-slate-100" data-testid="ob-content-attachments">
                      <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">📎 {c.attachments.length} Ek</div>
                      <div className="flex flex-wrap gap-2">
                        {c.attachments.map((a, i) => {
                          const ct = (a.content_type || "").toLowerCase();
                          const isImage = ct.startsWith("image/");
                          const isPdf = ct === "application/pdf";
                          const isText = ct.startsWith("text/") || ct.includes("json") || ct.includes("xml");
                          const dataUrl = a.content_base64 ? `data:${a.content_type || "application/octet-stream"};base64,${a.content_base64}` : null;
                          const icon = isImage ? "🖼" : isPdf ? "📕" : isText ? "📝" : "📎";
                          return (
                            <div key={i} className="border border-slate-200 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                              <div className="flex items-center gap-2 px-3 py-2 text-xs">
                                <span>{icon}</span>
                                <span className="text-slate-800 font-medium truncate max-w-[220px]" title={a.filename}>{a.filename || "(isimsiz)"}</span>
                                <span className="text-slate-400 text-[10px]">{a.size ? `${(a.size / 1024).toFixed(1)}KB` : ""}</span>
                                {dataUrl ? (
                                  <a href={dataUrl} download={a.filename || "attachment.bin"}
                                     data-testid={`ob-att-download-${i}`}
                                     className="ml-1 text-blue-600 hover:text-blue-800 text-[10px] no-underline">⬇ İndir</a>
                                ) : (
                                  <span className="text-amber-600 text-[10px]" title="Milter içerik ingest etmedi">(içerik yok)</span>
                                )}
                              </div>
                              {dataUrl && isImage && (
                                <img src={dataUrl} alt={a.filename} data-testid={`ob-att-preview-img-${i}`}
                                     className="max-h-40 max-w-full rounded-b-lg object-contain bg-white block" />
                              )}
                              {dataUrl && isPdf && (
                                <embed src={dataUrl} type="application/pdf" data-testid={`ob-att-preview-pdf-${i}`}
                                       className="w-72 h-56 bg-white block border-t border-slate-200" />
                              )}
                              {dataUrl && isText && (
                                <pre data-testid={`ob-att-preview-text-${i}`}
                                     className="w-72 max-h-40 overflow-auto text-[10px] p-2 bg-white text-slate-700 border-t border-slate-200 whitespace-pre-wrap">
                                  {(() => { try { return atob(a.content_base64).slice(0, 4000); } catch (_) { return "(decode error)"; } })()}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* MAIL BODY — büyük, ana odak */}
                  <div className="border-t border-slate-200 bg-slate-50/50" data-testid="ob-mail-body-area">
                    {c.body_html ? (
                      <iframe
                        data-testid="ob-content-html"
                        srcDoc={c.body_html}
                        sandbox=""
                        title="mail-html"
                        className="w-full min-h-[400px] bg-white block border-0"
                      />
                    ) : c.body_preview ? (
                      <pre data-testid="ob-content-body"
                           className="w-full min-h-[300px] p-6 bg-white text-[13px] text-slate-800 whitespace-pre-wrap leading-relaxed font-sans">
                        {c.body_preview}
                      </pre>
                    ) : (
                      <div className="p-8 text-center" data-testid="ob-content-fallback">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 text-amber-600 mb-3">
                          <span className="text-2xl">✉</span>
                        </div>
                        <div className="text-slate-700 font-semibold mb-1">Bu mail için gövde kaydedilmemiş</div>
                        <div className="text-slate-500 text-xs max-w-md mx-auto leading-relaxed">
                          Milter body ingest (v43.15+) etkinleştirildikten sonra
                          <b> yeni gelen/giden mailler</b> otomatik olarak tam içerikli görünecek.
                          Eski maillerin gövdesi log-only ingest edildiği için mevcut değil.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Alt bilgi (details / debug) */}
                  <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 text-xs space-y-2">
                    {c.scores && Object.keys(c.scores).length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-slate-600 hover:text-slate-900 select-none">
                          🎯 Motor Skorları ({Object.keys(c.scores).length})
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {Object.entries(c.scores).map(([k, v]) => (
                            <span key={k} className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 mono text-[10px]">
                              {k}: {String(v)}
                            </span>
                          ))}
                        </div>
                      </details>
                    )}
                    {c.headers_full && (
                      <details>
                        <summary className="cursor-pointer text-slate-600 hover:text-slate-900 select-none">
                          📋 SMTP Headers
                        </summary>
                        <pre data-testid="ob-content-headers"
                             className="mt-1 p-3 bg-white border border-slate-200 rounded max-h-56 overflow-auto text-[10px] mono text-slate-700 whitespace-pre-wrap">{c.headers_full}</pre>
                      </details>
                    )}
                    {c.message_id && (
                      <div className="text-[10px] text-slate-400 mono select-all">
                        message-id: {c.message_id}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* v43.62 — User Detail Modal (email adresine tıklayınca son 24s maillerini göster) */}
      {userDetailEmail && (
        <UserDetailModal email={userDetailEmail} onClose={() => setUserDetailEmail(null)} />
      )}

      {throttleModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setThrottleModalOpen(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()} data-testid="ob-throttle-modal">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">Kullanıcıyı Sınırla</h3>
            <input data-testid="ob-throttle-input" autoFocus value={throttleUser}
                   onChange={(e) => setThrottleUser(e.target.value)}
                   placeholder="Kullanıcı adı (örn: kobi)"
                   onKeyDown={(e) => { if (e.key === "Enter" && throttleUser.trim()) throttleMut.mutate(throttleUser.trim()); }}
                   className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm mb-3 focus:outline-none focus:border-indigo-500" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setThrottleModalOpen(false)} className="px-3 py-1.5 text-xs rounded text-slate-400 hover:bg-slate-800">İptal</button>
              <button data-testid="ob-throttle-submit"
                      disabled={!throttleUser.trim() || throttleMut.isPending}
                      onClick={() => throttleMut.mutate(throttleUser.trim())}
                      className="px-3 py-1.5 text-xs rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 hover:bg-amber-500/30 disabled:opacity-40">
                Sınırla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// v43.41 — Bayi WHM plugin (heartbeat.pl) eski sürümdeyse büyük uyarı bandı
function PluginVersionBanner() {
  const diag = useQuery({
    queryKey: ["outbound-diagnostic-banner"],
    queryFn: () => api.outboundDiagnostic(),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  const d = diag.data;
  if (!d) return null;
  const states = d.plugin_states || [];
  const oldestVer = states.find((p) => p.plugin_version && p.plugin_version < "1.2.0");
  const noPlugin = states.length === 0 && d.outbound_last_24h === 0;
  if (!oldestVer && !noPlugin) return null;
  return (
    <div className="rounded-xl border border-rose-500/40 bg-gradient-to-r from-rose-500/15 via-rose-500/5 to-transparent p-4" data-testid="ob-version-banner">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0">
          <span className="text-2xl">⚡</span>
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold text-rose-200 flex items-center gap-2">
            {oldestVer ? `Sunucunuzda eski plugin sürümü: v${oldestVer.plugin_version}` : "Sunucunuzda henüz heartbeat.pl aktif değil"}
          </div>
          <div className="text-xs text-slate-300 mt-1 leading-relaxed">
            {oldestVer ? (
              <>
                <b className="text-emerald-300">Exim mainlog tailer</b> (giden mailleri milter olmadan çeker) <b>v1.2.0</b> ile eklendi.
                Sunucunuza SSH ile bağlanıp <code className="mono bg-slate-950 px-1.5 py-0.5 rounded text-amber-300">sudo gws-update</code> çalıştırın —
                yeni heartbeat.pl kurulacak ve <b>15 dakika içinde</b> Exim log'unuzdan tüm outbound mailler panelde görünecek.
              </>
            ) : (
              <>
                Sunucunuzdaki heartbeat.pl daemon'ı bize sinyal göndermiyor. SSH ile bağlanıp <code className="mono bg-slate-950 px-1.5 py-0.5 rounded text-amber-300">sudo gws-update</code>
                &nbsp;çalıştırın. Kurulum yoksa <code className="mono bg-slate-950 px-1.5 py-0.5 rounded text-amber-300">bash &lt;(wget -qO- panel.gokyuzuhosting.com/install)</code> ile başlayın.
              </>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <code className="mono text-[11px] bg-slate-950 px-2 py-1 rounded text-emerald-300 border border-emerald-500/20">sudo gws-update</code>
            <span className="text-[11px] text-slate-500">→</span>
            <code className="mono text-[11px] bg-slate-950 px-2 py-1 rounded text-emerald-300 border border-emerald-500/20">systemctl status gws-heartbeat</code>
            <span className="text-[11px] text-slate-500">→</span>
            <code className="mono text-[11px] bg-slate-950 px-2 py-1 rounded text-emerald-300 border border-emerald-500/20">tail /var/log/mailshield/exim-tail.log</code>
          </div>
        </div>
      </div>
    </div>
  );
}

// v43.58 — Son bash push zaman göstergesi + entegre "Push Şimdi" butonu
function LastPushIndicator({ lastPushAt }) {
  const qc = useQueryClient();
  const [pushing, setPushing] = useState(false);
  const doPush = async () => {
    setPushing(true);
    try {
      const d = await api.outboundEximBackfill();
      toast.success(`✓ Push sinyali gönderildi (${d.signaled_licenses} sunucu)`, {
        description: "Sunucudaki gws-simple-push timer her 10 saniyede zaten push yapıyor. Panel şimdi yenileniyor…",
        duration: 5000,
      });
      // Anlık refetch — timer 10sn'de push yapıyor, biz de hemen çek
      qc.invalidateQueries({ queryKey: ["outbound-events"] });
      qc.invalidateQueries({ queryKey: ["outbound-stats"] });
      // 12sn sonra tekrar bir refetch (bir sonraki timer cycle'ından sonra)
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["outbound-events"] });
        qc.invalidateQueries({ queryKey: ["outbound-stats"] });
      }, 12_000);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message);
    } finally {
      setPushing(false);
    }
  };

  if (!lastPushAt) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 flex items-start gap-3" data-testid="ob-last-push">
        <span className="text-slate-400 text-xl">◔</span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-300">Sunucudan henüz push yok</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Sunucuya <span className="mono text-slate-300">gws-simple-push</span> kurun — her 10 saniyede otomatik push yapar. Butondan manuel de tetikleyebilirsiniz.
          </div>
        </div>
        <button
          onClick={doPush}
          disabled={pushing}
          data-testid="ob-manual-push-btn"
          className="text-xs px-3 py-1.5 rounded border border-indigo-500/40 bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
        >
          {pushing ? "..." : "⚡ Push Şimdi"}
        </button>
      </div>
    );
  }
  const dt = new Date(lastPushAt);
  const seconds = Math.floor((Date.now() - dt.getTime()) / 1000);
  const label = seconds < 60 ? `${seconds} saniye önce`
    : seconds < 3600 ? `${Math.floor(seconds / 60)} dakika önce`
    : `${Math.floor(seconds / 3600)} saat önce`;
  // Sağlık göstergesi: 15sn içinde push varsa yeşil, 60sn içinde sarı, üstü kırmızı
  const health = seconds < 15 ? "emerald" : seconds < 60 ? "amber" : "rose";
  const healthDot = { emerald: "text-emerald-400", amber: "text-amber-400", rose: "text-rose-400" }[health];
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2.5 flex items-center gap-3" data-testid="ob-last-push">
      <span className={`${healthDot} text-lg`} data-testid="ob-push-health">◉</span>
      <div className="flex-1">
        <div className="text-xs text-slate-400">
          Son sunucu push: <span className="mono text-slate-200" data-testid="ob-last-push-time">{label}</span>
          <span className="text-[10px] text-slate-600 ml-2">· gws-simple-push timer her 10sn otomatik push yapıyor</span>
        </div>
      </div>
      <div className="text-[10px] mono text-slate-600">{dt.toLocaleString("tr-TR")}</div>
      <button
        onClick={doPush}
        disabled={pushing}
        data-testid="ob-manual-push-btn"
        className="text-[11px] px-2.5 py-1 rounded border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50 whitespace-nowrap"
      >
        {pushing ? "..." : "⚡ Push Şimdi"}
      </button>
    </div>
  );
}


// v43.62 — Kullanıcı Detay Modalı: bir email adresinin son 24s outbound mail'i
function UserDetailModal({ email, onClose }) {
  const q = useQuery({
    queryKey: ["outbound-user-detail", email],
    queryFn: () => api.outboundEvents({ from_search: email, hours: 24, limit: 200 }),
    enabled: !!email,
    staleTime: 0,
  });
  const items = q.data?.items || [];
  const total = items.length;
  const spam = items.filter((e) => ["spam", "high_spam", "virus"].includes((e.verdict || "").toLowerCase())).length;
  const blocked = items.filter((e) => ["blocked", "block"].includes((e.verdict || "").toLowerCase())).length;
  const clean = total - spam - blocked;
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-start justify-center p-4 overflow-y-auto"
         onClick={onClose} data-testid="ob-user-detail-modal">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-4xl w-full my-4 shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-gradient-to-r from-indigo-900/30 to-slate-900">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold mb-0.5">Kullanıcı Detayı — Son 24 Saat</div>
            <div className="text-lg font-bold text-slate-100 mono break-all" data-testid="ob-user-detail-email">{email}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
                  data-testid="ob-user-detail-close">
            <X className="w-5 h-5" />
          </button>
        </div>
        {/* Stat strip */}
        <div className="grid grid-cols-4 gap-2 p-4 border-b border-slate-800">
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Toplam</div>
            <div className="text-2xl font-bold text-slate-100" data-testid="ob-user-total">{total}</div>
          </div>
          <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/30">
            <div className="text-[10px] uppercase tracking-widest text-emerald-500">Temiz</div>
            <div className="text-2xl font-bold text-emerald-300">{clean}</div>
          </div>
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/30">
            <div className="text-[10px] uppercase tracking-widest text-amber-500">Spam</div>
            <div className="text-2xl font-bold text-amber-300">{spam}</div>
          </div>
          <div className="p-3 rounded-lg bg-rose-500/5 border border-rose-500/30">
            <div className="text-[10px] uppercase tracking-widest text-rose-500">Bloklu</div>
            <div className="text-2xl font-bold text-rose-300">{blocked}</div>
          </div>
        </div>
        {/* Mails list */}
        <div className="max-h-[60vh] overflow-y-auto">
          {q.isLoading && (
            <div className="p-8 text-center text-slate-500 text-sm">Yükleniyor…</div>
          )}
          {!q.isLoading && total === 0 && (
            <div className="p-8 text-center text-slate-500 text-sm">Son 24 saatte bu email adresinden mail bulunamadı.</div>
          )}
          {total > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-slate-950/80 sticky top-0">
                <tr className="text-[11px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                  <th className="text-left px-3 py-2">Zaman</th>
                  <th className="text-left px-3 py-2">Alıcı</th>
                  <th className="text-left px-3 py-2">Konu</th>
                  <th className="text-right px-3 py-2">Skor</th>
                  <th className="text-center px-3 py-2">Verdict</th>
                </tr>
              </thead>
              <tbody data-testid="ob-user-detail-tbody">
                {items.map((e) => {
                  const vt = verdictTone(e.verdict);
                  return (
                    <tr key={e.id} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                      <td className="px-3 py-2 mono text-[11px] text-slate-500 whitespace-nowrap">{fmtTime(e.ts)}</td>
                      <td className="px-3 py-2 mono text-slate-300 break-all">{e.to_addr}</td>
                      <td className="px-3 py-2 text-slate-300 truncate max-w-[280px]" title={e.subject}>{e.subject || "(konusuz)"}</td>
                      <td className="px-3 py-2 text-right mono text-amber-300">{Number(e.total_score ?? 0).toFixed(1)}</td>
                      <td className="px-3 py-2 text-center"><Badge tone={vt.tone}>{vt.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

