import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Store, ThumbsUp, ThumbsDown, Download, Send, Trash2, Sparkles, Search,
  ShieldAlert, Filter, PackageCheck, Users, TrendingUp, Zap, X,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useIsMaster } from "@/hooks/useIsMaster";
const CAT_LABELS = {
  spam: "Spam", phishing: "Phishing", malware: "Malware",
  scam: "Dolandırıcılık", commercial: "Ticari", other: "Diğer",
};
const CAT_TONES = {
  spam: "warning", phishing: "danger", malware: "danger",
  scam: "warning", commercial: "info", other: "default",
};

const nfmt = (n) => new Intl.NumberFormat("tr-TR").format(n ?? 0);

export default function Marketplace() {
  const { isMaster } = useIsMaster();
  const qc = useQueryClient();
  const [tab, setTab] = useState("browse"); // browse | mine | publish
  const [sort, setSort] = useState("hot");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState(null);

  const stats = useQuery({ queryKey: ["mp-stats"], queryFn: api.mpStats, refetchInterval: 30_000 });
  const list = useQuery({
    queryKey: ["mp-list", { q, category, sort }],
    queryFn: () => api.mpSignatures({ q, category, sort, limit: 30 }),
  });

  const seed = useMutation({
    mutationFn: () => api.mpSeed(),
    onSuccess: (d) => {
      toast.success(`${d.seeded} örnek imza yüklendi`);
      qc.invalidateQueries({ queryKey: ["mp-list"] });
      qc.invalidateQueries({ queryKey: ["mp-stats"] });
    },
  });

  return (
    <div className="p-6 space-y-4" data-testid="marketplace-page">
      {/* Hero + Stats */}
      <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 via-slate-900/60 to-rose-500/5 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center shrink-0">
              <Store className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <div className="text-slate-100 text-lg font-bold flex items-center gap-2">
                Signature Marketplace
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 mono">BETA</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5 max-w-xl leading-relaxed">
                Bayilerin ve AI motorunun ürettiği MailScanner kurallarını görüp puanlayabilir, kendi hesabına yükleyebilir veya kendi kuralınızı yayınlayabilirsiniz. Her yayın <b className="text-indigo-300">sürüm-kontrollü</b> ve <b className="text-emerald-300">tersine mühendislik dostu</b>dur.
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1 max-w-[560px]">
            <MiniStat icon={<PackageCheck className="w-3.5 h-3.5"/>} label="İmza" val={stats.data?.total} testid="mp-stat-total"/>
            <MiniStat icon={<Download className="w-3.5 h-3.5"/>} label="Kurulum" val={stats.data?.total_installs} tone="text-emerald-300" testid="mp-stat-installs"/>
            <MiniStat icon={<Users className="w-3.5 h-3.5"/>} label="Yayıncı" val={stats.data?.publishers} tone="text-amber-300" testid="mp-stat-publishers"/>
            <MiniStat icon={<TrendingUp className="w-3.5 h-3.5"/>} label="Kategori" val={Object.keys(stats.data?.categories || {}).length} tone="text-rose-300" testid="mp-stat-categories"/>
          </div>
        </div>
        {stats.data?.total === 0 && isMaster && (
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => seed.mutate()}
              disabled={seed.isPending}
              data-testid="mp-seed-demo"
              className="text-xs px-3 py-1.5 rounded bg-indigo-500/20 text-indigo-200 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40"
            >
              <Sparkles className="w-3 h-3 inline mr-1"/>
              5 Örnek İmza Yükle
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800">
        {[
          { k: "browse", l: "Keşfet", i: <Search className="w-3.5 h-3.5"/> },
          { k: "mine",   l: "Yayınlarım", i: <Send className="w-3.5 h-3.5"/> },
          { k: "publish",l: "Yeni Yayınla", i: <Sparkles className="w-3.5 h-3.5"/> },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            data-testid={`mp-tab-${t.k}`}
            className={`px-3 py-2 text-xs flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
              tab === t.k ? "border-indigo-500 text-indigo-300" : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.i}
            {t.l}
          </button>
        ))}
      </div>

      {tab === "browse" && (
        <>
          {/* v43.42 — Leaderboard */}
          <LeaderboardWidget />
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500"/>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                data-testid="mp-search"
                placeholder="İmza ara…"
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded focus:border-indigo-500/50 outline-none text-slate-200"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              data-testid="mp-filter-category"
              className="text-xs bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200"
            >
              <option value="">Tüm kategoriler</option>
              {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <div className="flex items-center gap-1 ml-auto">
              {["hot", "new", "top"].map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  data-testid={`mp-sort-${s}`}
                  className={`text-[11px] px-2 py-1 rounded border ${
                    sort === s ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
                    : "border-slate-800 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {s === "hot" ? "🔥 Popüler" : s === "new" ? "Yeni" : "Kurulum"}
                </button>
              ))}
            </div>
          </div>

          <Card>
            <CardHeader title={`${list.data?.total ?? 0} imza`} subtitle="Bayilerin paylaştığı MailScanner kural katalogu"/>
            {list.isLoading && <div className="p-8 text-center text-slate-500 text-sm">Yükleniyor…</div>}
            {!list.isLoading && (list.data?.items || []).length === 0 && (
              <div className="p-12 text-center text-slate-500 text-sm">Sonuç yok — filtreleri temizleyin veya örnek verileri yükleyin.</div>
            )}
            <div className="divide-y divide-slate-800">
              {(list.data?.items || []).map((s) => (
                <SignatureRow key={s.id} sig={s} onOpen={() => setSelected(s.id)} />
              ))}
            </div>
          </Card>
        </>
      )}

      {tab === "mine" && <MinePanel />}
      {tab === "publish" && <PublishPanel onPublished={() => { setTab("mine"); qc.invalidateQueries({ queryKey: ["mp-list"] }); }} />}

      {selected && <SignatureModal sigId={selected} onClose={() => setSelected(null)}/>}
    </div>
  );
}

function MiniStat({ icon, label, val, tone = "text-indigo-300", testid }) {
  return (
    <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1">{icon}{label}</div>
      <div className={`text-lg font-bold mono mt-0.5 ${tone}`}>{nfmt(val)}</div>
    </div>
  );
}

function SignatureRow({ sig, onOpen }) {
  const net = (sig.stats?.upvotes || 0) - (sig.stats?.downvotes || 0);
  return (
    <div
      onClick={onOpen}
      data-testid={`mp-row-${sig.id}`}
      className="px-4 py-3 hover:bg-indigo-500/5 cursor-pointer transition-colors flex items-start gap-3"
    >
      <div className="shrink-0 w-8 h-8 rounded bg-slate-900 border border-slate-800 flex items-center justify-center mono text-[10px] text-emerald-300">
        v{sig.version}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-200 font-medium">{sig.name}</span>
          <Badge tone={CAT_TONES[sig.category] || "default"}>{CAT_LABELS[sig.category] || sig.category}</Badge>
          <span className="text-[10px] text-slate-500 mono">{sig.publisher_masked}</span>
        </div>
        <div className="text-[11px] text-slate-500 mono truncate max-w-[720px] mt-0.5" title={sig.pattern}>
          /{sig.pattern}/ · {sig.target}
        </div>
        {sig.description && <div className="text-xs text-slate-400 mt-1 line-clamp-1">{sig.description}</div>}
      </div>
      <div className="shrink-0 text-right space-y-0.5">
        <div className="text-[11px] flex items-center gap-2 justify-end">
          <span className="text-emerald-400 flex items-center gap-0.5"><ThumbsUp className="w-3 h-3"/>{sig.stats?.upvotes || 0}</span>
          <span className="text-rose-400 flex items-center gap-0.5"><ThumbsDown className="w-3 h-3"/>{sig.stats?.downvotes || 0}</span>
        </div>
        <div className="text-[10px] text-slate-500 flex items-center gap-1 justify-end">
          <Download className="w-3 h-3"/> {sig.stats?.installs || 0} kurulum
        </div>
        <div className="mono text-[10px] text-slate-600">skor: {sig.score}</div>
      </div>
    </div>
  );
}

function SignatureModal({ sigId, onClose }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mp-sig", sigId], queryFn: () => api.mpSignature(sigId) });
  const masterKey = typeof window !== "undefined" ? (localStorage.getItem("gws.master_license") || "") : "";
  const sig = q.data;

  const vote = useMutation({
    mutationFn: (kind) => api.mpVote(sigId, { license_key: masterKey, kind }),
    onSuccess: (d) => { toast.success(`Oy ${d.action === "removed" ? "geri alındı" : "kaydedildi"}`); qc.invalidateQueries({ queryKey: ["mp-sig", sigId] }); qc.invalidateQueries({ queryKey: ["mp-list"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });
  const install = useMutation({
    mutationFn: () => api.mpInstall(sigId, { license_key: masterKey, enable: true }),
    onSuccess: (d) => { toast.success(d.already_installed ? "İmza güncellendi (yeni sürüm)" : "İmza yüklendi ve aktif edildi"); qc.invalidateQueries({ queryKey: ["mp-sig", sigId] }); qc.invalidateQueries({ queryKey: ["mp-stats"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });

  return (
    <div className="fixed inset-0 bg-black/75 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose} data-testid="mp-modal-backdrop">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full my-8 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="mp-modal">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-indigo-400"/>
            <span className="text-slate-100 font-semibold">İmza Detayı</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100" data-testid="mp-modal-close"><X className="w-5 h-5"/></button>
        </div>
        {q.isLoading && <div className="p-12 text-center text-slate-500">Yükleniyor…</div>}
        {sig && (
          <div className="p-5 space-y-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg text-slate-100 font-bold">{sig.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 mono">v{sig.version}</span>
                <Badge tone={CAT_TONES[sig.category]}>{CAT_LABELS[sig.category]}</Badge>
              </div>
              <div className="text-xs text-slate-400 mt-1">Yayınlayan: <span className="mono text-indigo-300">{sig.publisher_masked}</span> · {sig.published_at ? new Date(sig.published_at).toLocaleString("tr-TR") : "—"}</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetricCell label="Upvote" val={sig.stats?.upvotes} tone="text-emerald-300"/>
              <MetricCell label="Downvote" val={sig.stats?.downvotes} tone="text-rose-300"/>
              <MetricCell label="Kurulum" val={sig.stats?.installs} tone="text-indigo-300"/>
            </div>
            <div>
              <div className="text-[11px] uppercase text-slate-500 mb-1">Regex Pattern</div>
              <code className="block bg-slate-950 border border-slate-800 rounded px-3 py-2 mono text-xs text-slate-200 break-all">/{sig.pattern}/i · target=<span className="text-indigo-300">{sig.target}</span> · skor=<span className="text-amber-300">{sig.score}</span></code>
            </div>
            {sig.description && (
              <div>
                <div className="text-[11px] uppercase text-slate-500 mb-1">Açıklama</div>
                <p className="text-sm text-slate-300 leading-relaxed">{sig.description}</p>
              </div>
            )}
            {(sig.other_versions || []).length > 0 && (
              <div>
                <div className="text-[11px] uppercase text-slate-500 mb-1">Diğer Sürümler</div>
                <div className="text-[11px] text-slate-400 space-y-0.5">
                  {sig.other_versions.map((v) => <div key={v.id} className="mono">v{v.version} · {v.published_at?.slice(0, 10)}</div>)}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => vote.mutate("up")}
                disabled={vote.isPending}
                data-testid="mp-vote-up"
                className="text-xs px-3 py-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 inline-flex items-center gap-1"
              ><ThumbsUp className="w-3 h-3"/> Beğen</button>
              <button
                onClick={() => vote.mutate("down")}
                disabled={vote.isPending}
                data-testid="mp-vote-down"
                className="text-xs px-3 py-1.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-40 inline-flex items-center gap-1"
              ><ThumbsDown className="w-3 h-3"/> Uygun Değil</button>
              <button
                onClick={() => install.mutate()}
                disabled={install.isPending || !masterKey}
                data-testid="mp-install"
                className="ml-auto text-xs px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 inline-flex items-center gap-1.5"
                title={masterKey ? "Bu imzayı kendi kural setine ekle" : "Master lisansı gerekli"}
              ><Download className="w-3.5 h-3.5"/> {install.isPending ? "Yükleniyor…" : "Kendi Panelime Yükle"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCell({ label, val, tone }) {
  return (
    <div className="p-2 rounded bg-slate-950/60 border border-slate-800 text-center">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className={`text-lg font-bold mono ${tone}`}>{nfmt(val)}</div>
    </div>
  );
}

function MinePanel() {
  const qc = useQueryClient();
  const masterKey = typeof window !== "undefined" ? (localStorage.getItem("gws.master_license") || "") : "";
  const mine = useQuery({
    queryKey: ["mp-mine", masterKey],
    queryFn: () => api.mpMine(masterKey),
    enabled: !!masterKey,
  });
  const del = useMutation({
    mutationFn: (id) => api.mpDelete(id, masterKey),
    onSuccess: () => { toast.success("İmza silindi"); qc.invalidateQueries({ queryKey: ["mp-mine"] }); qc.invalidateQueries({ queryKey: ["mp-list"] }); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });

  if (!masterKey) return <div className="text-sm text-slate-500 italic p-6">Yayın yönetimi için master lisans gerekli.</div>;

  return (
    <Card>
      <CardHeader title="Yayınlarım" subtitle="Bu hesap altında marketplace'e yayınlanmış imzalar"/>
      {(mine.data?.items || []).length === 0 && (
        <div className="p-8 text-center text-slate-500 text-sm">Henüz yayın yok — "Yeni Yayınla" sekmesinden ilk imzanızı paylaşın.</div>
      )}
      <div className="divide-y divide-slate-800">
        {(mine.data?.items || []).map((s) => (
          <div key={s.id} className="px-4 py-3 flex items-start gap-3" data-testid={`mp-mine-row-${s.id}`}>
            <span className="shrink-0 w-8 h-8 rounded bg-slate-900 border border-slate-800 flex items-center justify-center mono text-[10px] text-emerald-300">v{s.version}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-slate-200">{s.name}</span>
                <Badge tone={CAT_TONES[s.category]}>{CAT_LABELS[s.category]}</Badge>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                <span className="text-emerald-400">↑ {s.stats?.upvotes || 0}</span>
                <span className="mx-1.5 text-slate-700">·</span>
                <span className="text-rose-400">↓ {s.stats?.downvotes || 0}</span>
                <span className="mx-1.5 text-slate-700">·</span>
                <span className="text-indigo-400">{s.stats?.installs || 0} kurulum</span>
              </div>
            </div>
            <button
              onClick={() => { if (window.confirm(`"${s.name}" imzasını sil?`)) del.mutate(s.id); }}
              disabled={del.isPending}
              data-testid={`mp-mine-delete-${s.id}`}
              className="text-rose-400 hover:text-rose-300 p-1"
              title="Sil"
            ><Trash2 className="w-4 h-4"/></button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PublishPanel({ onPublished }) {
  const [form, setForm] = useState({
    name: "", pattern: "", target: "subject", score: 4.0,
    description: "", category: "spam",
  });
  const masterKey = typeof window !== "undefined" ? (localStorage.getItem("gws.master_license") || "") : "";

  const publish = useMutation({
    mutationFn: () => api.mpPublish({ license_key: masterKey, ...form }),
    onSuccess: (d) => { toast.success(`İmza yayınlandı (v${d.version})`); onPublished(); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });

  return (
    <Card>
      <CardHeader
        title="Yeni İmza Yayınla"
        subtitle="Kendi kuralınızı marketplace'e ekleyin — diğer bayiler görebilir/kurulabilir"
      />
      <div className="p-5 space-y-3">
        <Field label="Ad">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            data-testid="mp-publish-name"
            placeholder="Örn: PayPal sahte fatura"
            className="w-full text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 focus:border-indigo-500/50 outline-none text-slate-200"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hedef">
            <select value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}
              data-testid="mp-publish-target"
              className="w-full text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-200">
              {["subject", "from", "to", "body", "header"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Kategori">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              data-testid="mp-publish-category"
              className="w-full text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-200">
              {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Regex Pattern (Python re uyumlu)">
          <textarea
            value={form.pattern}
            onChange={(e) => setForm({ ...form, pattern: e.target.value })}
            data-testid="mp-publish-pattern"
            placeholder="(?i)(paypal|fatura).*(\\.exe|\\.scr)"
            rows={2}
            className="w-full text-xs mono bg-slate-950 border border-slate-800 rounded px-3 py-2 focus:border-indigo-500/50 outline-none text-slate-200"
          />
        </Field>
        <Field label={`Spam Skoru: ${form.score}`}>
          <input
            type="range" min="-10" max="20" step="0.5"
            value={form.score}
            onChange={(e) => setForm({ ...form, score: parseFloat(e.target.value) })}
            data-testid="mp-publish-score"
            className="w-full accent-indigo-500"
          />
        </Field>
        <Field label="Açıklama">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            data-testid="mp-publish-description"
            rows={3}
            placeholder="Bu kural neyi tespit eder? Örnek subject: 'PayPal fatura ödemesi'"
            className="w-full text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-200"
          />
        </Field>
        <div className="flex justify-end">
          <button
            onClick={() => publish.mutate()}
            disabled={publish.isPending || !form.name || !form.pattern || !masterKey}
            data-testid="mp-publish-submit"
            className="text-sm px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 inline-flex items-center gap-1.5"
          ><Send className="w-3.5 h-3.5"/> {publish.isPending ? "Yayınlanıyor…" : "Yayınla"}</button>
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

// v43.42 — Leaderboard widget
function LeaderboardWidget() {
  const [period, setPeriod] = useState("week");
  const q = useQuery({
    queryKey: ["mp-leaderboard", period],
    queryFn: () => api.mpLeaderboard(period),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const data = q.data;
  if (q.isLoading || !data || data.top_publishers.length === 0) return null;
  return (
    <Card data-testid="mp-leaderboard">
      <CardHeader
        title="🏆 Marketplace Liderlik Tablosu"
        subtitle={period === "week" ? "Bu haftanın en aktif yayıncıları ve en çok kurulan imzaları" : period === "month" ? "Aylık liderler" : "Tüm zamanların şampiyonları"}
        right={
          <div className="flex items-center gap-1">
            {["week", "month", "all"].map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                data-testid={`mp-lb-period-${p}`}
                className={`text-[11px] px-2 py-1 rounded border ${period === p ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300" : "border-slate-800 text-slate-500 hover:text-slate-300"}`}>
                {p === "week" ? "Bu Hafta" : p === "month" ? "Bu Ay" : "Tüm Zaman"}
              </button>
            ))}
          </div>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Top Yayıncılar</div>
          <div className="space-y-1.5">
            {data.top_publishers.slice(0, 5).map((p, i) => (
              <div key={p.publisher_license}
                data-testid={`mp-lb-pub-${i}`}
                className="flex items-center gap-3 px-3 py-2 rounded border border-slate-800 bg-slate-950/40 hover:bg-slate-900/40">
                <span className={`text-lg font-bold mono w-6 text-center ${i === 0 ? "text-amber-400" : i === 1 ? "text-slate-300" : i === 2 ? "text-orange-500" : "text-slate-600"}`}>
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-200 mono truncate">{p.publisher_masked}</div>
                  <div className="text-[10px] text-slate-500">
                    <span style={{ color: p.badge.color }}>{p.badge.label}</span>
                    <span className="mx-1 text-slate-700">·</span>
                    {p.signatures} imza · {p.total_upvotes} beğeni
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm mono font-bold text-emerald-300">{p.period_installs}</div>
                  <div className="text-[9px] text-slate-500">bu dönem</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-widest text-slate-500 mb-2">Top İmzalar</div>
          <div className="space-y-1.5">
            {data.top_signatures.slice(0, 5).map((s, i) => (
              <div key={s.id}
                data-testid={`mp-lb-sig-${i}`}
                className="px-3 py-2 rounded border border-slate-800 bg-slate-950/40">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 mono text-xs">#{i + 1}</span>
                  <span className="text-sm text-slate-200 flex-1 truncate">{s.name}</span>
                  <span className="text-[10px] mono text-emerald-400">{s.period_installs}↓</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                  <Badge tone={CAT_TONES[s.category]}>{CAT_LABELS[s.category]}</Badge>
                  <span>v{s.version}</span>
                  <span>· ↑{s.stats?.upvotes || 0}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Badge tiers legend */}
      <div className="px-4 pb-4">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">Rozet Seviyeleri</div>
        <div className="flex flex-wrap gap-2">
          {data.badge_tiers.map((b) => (
            <span key={b.tier}
              className="text-[11px] px-2 py-0.5 rounded border mono"
              style={{ borderColor: `${b.color}66`, color: b.color, background: `${b.color}11` }}>
              {b.label} — ≥{b.min} kurulum
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

