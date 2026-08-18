import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText, Download, Send, Mail, Clock, Search, FileSpreadsheet, Loader2,
  ArrowUpRight, ArrowDownLeft, ArrowLeftRight, CalendarClock, Trash2, Play, Plus, Pause,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useT } from "@/i18n";

// v43.90 — Scheduled Mail Reports (list + create + delete + run-now)
function ScheduledReportsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["report-schedules"], queryFn: () => api.reportSchedulesList(), refetchInterval: 30_000 });
  const items = q.data?.items || [];
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    email: "", recipient: "", direction: "both", days: 30, format: "pdf",
    day_of_week: "", hour: 8, minute: 0,
  });

  const createMut = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        day_of_week: form.day_of_week === "" ? null : Number(form.day_of_week),
        days: Number(form.days), hour: Number(form.hour), minute: Number(form.minute),
      };
      return api.reportScheduleCreate(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-schedules"] });
      setShowForm(false);
      setForm({ email: "", recipient: "", direction: "both", days: 30, format: "pdf", day_of_week: "", hour: 8, minute: 0 });
      toast.success("Zamanlama oluşturuldu");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Oluşturulamadı"),
  });

  const delMut = useMutation({
    mutationFn: (id) => api.reportScheduleDelete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["report-schedules"] }); toast.success("Zamanlama silindi"); },
  });

  const runMut = useMutation({
    mutationFn: (id) => api.reportScheduleRunNow(id),
    onSuccess: (d) => {
      const r = d?.result || {};
      toast.success(`Dry-run: ${r.sent_total ?? 0} gönderilen, ${r.received_total ?? 0} gelen (${r.content_bytes} B)`);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Çalıştırılamadı"),
  });

  const toggleMut = useMutation({
    mutationFn: (id) => api.reportScheduleToggle(id),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["report-schedules"] });
      toast.success(d.active ? "Zamanlama devam ediyor" : "Zamanlama duraklatıldı");
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "İşlem başarısız"),
  });

  const sendTestMut = useMutation({
    mutationFn: (id) => api.reportScheduleSendTest(id),
    onSuccess: (d) => {
      const r = d?.result || {};
      if (r.ok) {
        toast.success("Gerçek test emaili gönderildi ✓", {
          description: `${r.sent_via || "unknown"} · Gönderilen: ${r.sent_total ?? 0}, Gelen: ${r.received_total ?? 0}`,
          duration: 7000,
        });
      } else {
        toast.error(`Test gönderimi başarısız: ${r.error || "bilinmiyor"}`);
      }
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Test gönderilemedi"),
  });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const recipientValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.recipient.trim());
  const canCreate = emailValid && recipientValid;

  const DOW = ["Ptesi", "Salı", "Çrş", "Prş", "Cuma", "Cmt", "Pazar"];

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-cyan-400" /> Zamanlanmış Mail Raporları</span>}
        subtitle="Belirlediğiniz gün ve saatte rapor otomatik olarak email ile teslim edilir."
        right={<Badge tone="cyan">v43.90</Badge>}
      />
      <CardBody className="space-y-3">
        {/* Existing schedules */}
        {items.length > 0 && (
          <div className="space-y-1.5">
            {items.map(s => (
              <div key={s.id} data-testid={`schedule-${s.id}`}
                className={`flex items-center justify-between gap-3 border rounded-md px-3 py-2 hover:border-slate-700 ${
                  s.active === false ? "border-slate-800 bg-slate-950/30 opacity-60" : "border-slate-800 bg-slate-950/60"
                }`}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-100 truncate flex items-center gap-2">
                    {s.active === false && (
                      <span className="inline-flex items-center gap-1 text-[9px] mono font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        <Pause className="w-2.5 h-2.5" /> DURAKLATILDI
                      </span>
                    )}
                    {s.email} <span className="text-slate-500 text-xs">→</span> <span className="text-cyan-300 text-xs mono">{s.recipient}</span>
                  </div>
                  <div className="text-[10px] mono text-slate-500 mt-0.5">
                    {s.day_of_week === null ? "Her gün" : DOW[s.day_of_week]} · {String(s.hour).padStart(2,"0")}:{String(s.minute).padStart(2,"0")} UTC
                    · {s.direction} · son {s.days}g · {s.format.toUpperCase()}
                    · sonraki: {(s.next_run_at || "").slice(0, 16).replace("T", " ")}
                    {s.run_count > 0 && <> · {s.run_count} çalıştı</>}
                  </div>
                  {/* v43.95 — Son test raporu satırı */}
                  {s.last_run_at && (
                    <div className="text-[10px] mono mt-1 flex items-center gap-1.5 flex-wrap" data-testid={`schedule-last-run-${s.id}`}>
                      <span className="text-slate-500">Son:</span>
                      {s.last_run_status === "test_ok" && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30">
                          ✉️ TEST OK
                        </span>
                      )}
                      {s.last_run_status === "ok" && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          ✓ OK
                        </span>
                      )}
                      {s.last_run_status === "fail" && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30" title={s.last_run_error || ""}>
                          ✗ FAIL
                        </span>
                      )}
                      <span className="text-slate-400">{(s.last_run_at || "").slice(0, 16).replace("T", " ")} UTC</span>
                      {s.last_run_error && (
                        <span className="text-rose-400 truncate max-w-[280px]" title={s.last_run_error}>
                          · {s.last_run_error.slice(0, 60)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    data-testid={`schedule-toggle-${s.id}`}
                    type="button"
                    onClick={() => toggleMut.mutate(s.id)}
                    disabled={toggleMut.isPending}
                    title={s.active === false ? "Devam ettir" : "Duraklat"}
                    className={`p-1.5 rounded border ${
                      s.active === false
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                        : "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                    } disabled:opacity-50`}
                  >
                    {s.active === false ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    data-testid={`schedule-run-${s.id}`}
                    type="button"
                    onClick={() => runMut.mutate(s.id)}
                    disabled={runMut.isPending}
                    title="Şimdi çalıştır (dry-run, email göndermez)"
                    className="p-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                  <button
                    data-testid={`schedule-sendtest-${s.id}`}
                    type="button"
                    onClick={() => { if (window.confirm(`${s.recipient} adresine hemen GERÇEK bir test raporu email'i gönderilecek. Onaylıyor musun?`)) sendTestMut.mutate(s.id); }}
                    disabled={sendTestMut.isPending}
                    title={`Gerçek test: ${s.recipient} adresine email gönder`}
                    className="p-1.5 rounded border border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/25 disabled:opacity-50"
                  >
                    <Mail className="w-3.5 h-3.5" />
                  </button>
                  <button
                    data-testid={`schedule-delete-${s.id}`}
                    type="button"
                    onClick={() => { if (window.confirm("Bu zamanlama silinsin mi?")) delMut.mutate(s.id); }}
                    title="Sil"
                    className="p-1.5 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {items.length === 0 && !showForm && (
          <div className="text-xs text-slate-500 italic py-2">Zamanlanmış rapor yok.</div>
        )}

        {/* Add form */}
        {!showForm ? (
          <button
            data-testid="schedule-add-btn"
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 text-sm font-semibold"
          >
            <Plus className="w-4 h-4" /> Yeni Zamanlama
          </button>
        ) : (
          <div className="border border-cyan-500/30 bg-cyan-500/5 rounded-md p-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Rapor Konusu Email</label>
                <input
                  data-testid="schedule-email"
                  type="email"
                  placeholder="musteri@sunucu.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Rapor Alıcı</label>
                <input
                  data-testid="schedule-recipient"
                  type="email"
                  placeholder="admin@sunucu.com"
                  value={form.recipient}
                  onChange={(e) => setForm({ ...form, recipient: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Yön</label>
                <select
                  data-testid="schedule-direction"
                  value={form.direction}
                  onChange={(e) => setForm({ ...form, direction: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm"
                >
                  <option value="both">Her ikisi</option>
                  <option value="sent">Gönderilen</option>
                  <option value="received">Gelen</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Format</label>
                <select
                  data-testid="schedule-format"
                  value={form.format}
                  onChange={(e) => setForm({ ...form, format: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm"
                >
                  <option value="pdf">PDF</option>
                  <option value="xlsx">Excel (XLSX)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Kapsam (gün)</label>
                <input
                  data-testid="schedule-days"
                  type="number" min={1} max={365}
                  value={form.days}
                  onChange={(e) => setForm({ ...form, days: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Sıklık</label>
                <select
                  data-testid="schedule-dow"
                  value={form.day_of_week}
                  onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Her gün</option>
                  {DOW.map((d, i) => <option key={i} value={i}>{d} (haftalık)</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Saat (UTC)</label>
                <div className="flex items-center gap-2">
                  <input
                    data-testid="schedule-hour"
                    type="number" min={0} max={23}
                    value={form.hour}
                    onChange={(e) => setForm({ ...form, hour: e.target.value })}
                    className="w-16 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right"
                  />
                  <span className="text-slate-500">:</span>
                  <input
                    data-testid="schedule-minute"
                    type="number" min={0} max={59}
                    value={form.minute}
                    onChange={(e) => setForm({ ...form, minute: e.target.value })}
                    className="w-16 bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm mono text-right"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-3 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-200 text-sm"
              >
                Vazgeç
              </button>
              <button
                data-testid="schedule-save"
                type="button"
                onClick={() => createMut.mutate()}
                disabled={!canCreate || createMut.isPending}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 text-sm font-semibold disabled:opacity-50"
              >
                <CalendarClock className="w-4 h-4" /> {createMut.isPending ? "Kaydediliyor..." : "Zamanla"}
              </button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// v43.90 — Gelişmiş Mail Aktivite Raporu (POST /api/reports/mail-activity)
function AdvancedMailReportCard() {
  const [email, setEmail] = useState("");
  const [direction, setDirection] = useState("both");
  const [days, setDays] = useState(30);
  const [preview, setPreview] = useState(null);

  const previewMut = useMutation({
    mutationFn: () => api.mailActivityReport({ email: email.trim(), direction, days, format: "json", limit: 1000 }),
    onSuccess: (data) => {
      setPreview(data);
      const sT = data?.sent?.summary?.total || 0;
      const rT = data?.received?.summary?.total || 0;
      toast.success(`Rapor hazırlandı — Gönderilen: ${sT} · Gelen: ${rT}`);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Rapor hazırlanamadı"),
  });

  const downloadMut = useMutation({
    mutationFn: async (fmt) => {
      const res = await api.mailActivityDownload({ email: email.trim(), direction, days, format: fmt, limit: 5000 });
      // Trigger browser download
      const blob = new Blob([res.data], {
        type: fmt === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = email.replace(/[@/]/g, "_");
      a.download = `mail-report-${safe}-${days}d.${fmt === "pdf" ? "pdf" : "xlsx"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return fmt;
    },
    onSuccess: (fmt) => toast.success(`${fmt.toUpperCase()} indirildi`),
    onError: (e) => toast.error(e?.response?.data?.detail || "İndirme başarısız"),
  });

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canQuery = validEmail && !previewMut.isPending && !downloadMut.isPending;

  const dirButton = (val, Icon, label, tone) => {
    const active = direction === val;
    const tones = {
      indigo: "border-indigo-500/50 bg-indigo-500/15 text-indigo-200",
      emerald: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
      cyan: "border-cyan-500/50 bg-cyan-500/15 text-cyan-200",
    };
    return (
      <button
        data-testid={`mail-report-dir-${val}`}
        type="button"
        onClick={() => setDirection(val)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md border text-xs font-semibold transition-all ${
          active ? tones[tone] + " shadow-md" : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"
        }`}
      >
        <Icon className="w-3.5 h-3.5" /> {label}
      </button>
    );
  };

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Search className="w-4 h-4 text-fuchsia-400" /> Gelişmiş Mail Aktivite Raporu</span>}
        subtitle="Belirli bir email adresinin gönderdiği/aldığı tüm mailleri kimlere/kimden olduğu bilgisiyle raporlayın."
        right={<Badge tone="fuchsia">v43.90</Badge>}
      />
      <CardBody className="space-y-4">
        {/* Email Input */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Email Adresi</label>
          <div className="relative">
            <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              data-testid="mail-report-email"
              type="email"
              placeholder="ornek@musteri.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-3 py-2.5 text-sm mono focus:outline-none focus:border-fuchsia-500/50 focus:ring-2 focus:ring-fuchsia-500/10"
            />
          </div>
          {email && !validEmail && (
            <p className="text-[11px] text-rose-400 mt-1">Geçersiz email formatı</p>
          )}
        </div>

        {/* Direction Radio */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Yön</label>
          <div className="flex flex-wrap gap-2">
            {dirButton("sent", ArrowUpRight, "📤 Gönderilen", "indigo")}
            {dirButton("received", ArrowDownLeft, "📥 Gelen", "emerald")}
            {dirButton("both", ArrowLeftRight, "🔄 Her ikisi", "cyan")}
          </div>
        </div>

        {/* Days Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            Zaman Aralığı: <span className="text-fuchsia-300 mono font-bold">Son {days} gün</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {[7, 30, 90, 180, 365].map(d => (
              <button
                key={d}
                data-testid={`mail-report-days-${d}`}
                type="button"
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-md border text-xs font-semibold transition-all ${
                  days === d
                    ? "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200 shadow-md"
                    : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700"
                }`}
              >
                {d} gün
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800/60">
          <button
            data-testid="mail-report-preview"
            type="button"
            disabled={!canQuery}
            onClick={() => previewMut.mutate()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-slate-700 bg-slate-800/40 text-slate-200 hover:bg-slate-800/70 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {previewMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Önizle (JSON)
          </button>
          <button
            data-testid="mail-report-pdf"
            type="button"
            disabled={!canQuery}
            onClick={() => downloadMut.mutate("pdf")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-rose-500/10"
          >
            {downloadMut.isPending && downloadMut.variables === "pdf" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            PDF İndir
          </button>
          <button
            data-testid="mail-report-xlsx"
            type="button"
            disabled={!canQuery}
            onClick={() => downloadMut.mutate("xlsx")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-emerald-500/10"
          >
            {downloadMut.isPending && downloadMut.variables === "xlsx" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Excel İndir
          </button>
        </div>

        {/* Preview */}
        {preview && (
          <div data-testid="mail-report-preview-panel" className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {["sent", "received"].map(k => {
                const s = preview[k]?.summary || { total: 0, by_verdict: {}, top_peers: [] };
                const label = k === "sent" ? "📤 Gönderilen" : "📥 Gelen";
                const tone = k === "sent" ? "indigo" : "emerald";
                if (direction !== "both" && direction !== k) return null;
                return (
                  <div key={k} className={`rounded-md border p-3 ${tone === "indigo" ? "border-indigo-500/30 bg-indigo-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
                    <div className="text-xs font-semibold text-slate-300">{label}</div>
                    <div className={`text-2xl font-black mt-1 mono ${tone === "indigo" ? "text-indigo-300" : "text-emerald-300"}`}>{s.total}</div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      {Object.entries(s.by_verdict).length === 0
                        ? "verdict yok"
                        : Object.entries(s.by_verdict).map(([v, c]) => `${v}=${c}`).join(" · ")}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Top peers (both directions) */}
            {["sent", "received"].map(k => {
              const rows = preview[k]?.summary?.top_peers || [];
              if (rows.length === 0) return null;
              if (direction !== "both" && direction !== k) return null;
              const peerLabel = k === "sent" ? "Alıcı (peer)" : "Gönderen (peer)";
              return (
                <div key={k} className="rounded-md border border-slate-800 bg-slate-950/60">
                  <div className="text-[11px] font-bold text-slate-300 px-3 py-2 border-b border-slate-800 flex items-center gap-1.5">
                    {k === "sent" ? <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" /> : <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />}
                    Top {peerLabel} — {rows.length}
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-900/60 text-slate-500 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-1.5 font-semibold">#</th>
                          <th className="text-left px-3 py-1.5 font-semibold">{peerLabel}</th>
                          <th className="text-right px-3 py-1.5 font-semibold">Adet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 20).map((p, i) => (
                          <tr key={i} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                            <td className="px-3 py-1.5 text-slate-500 mono">{i + 1}</td>
                            <td className="px-3 py-1.5 text-slate-200 mono truncate max-w-[280px]">{p.peer}</td>
                            <td className="px-3 py-1.5 text-right text-fuchsia-300 mono font-bold">{p.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            <div className="text-[10px] text-slate-500 mono">
              Oluşturma: {(preview.generated_at || "").slice(0, 19)} UTC · Kapsam: son {preview.days} gün
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function Reports() {
  const t = useT();
  const [tab, setTab] = useState(() => localStorage.getItem("gws.reports.tab") || "activity");
  const choose = (id) => { setTab(id); try { localStorage.setItem("gws.reports.tab", id); } catch {} };

  const [recipient, setRecipient] = useState("admin@sunucunuz.com");
  const sendMut = useMutation({
    mutationFn: (to) => api.reportSend(to),
    onSuccess: (data) => {
      const via = data.sent_via === "sendmail" ? t("reports.via_sendmail") : t("reports.via_queued");
      toast.success(t("reports.sent_ok", { via }));
    },
    onError: () => toast.error(t("reports.send_fail")),
  });

  const TABS = [
    { id: "activity",  label: "Mail Aktivite",   Icon: Search,        tone: "fuchsia" },
    { id: "schedule",  label: "Zamanlanmış",     Icon: CalendarClock, tone: "cyan" },
    { id: "weekly",    label: "Haftalık PDF",    Icon: FileText,      tone: "indigo" },
  ];
  const tones = {
    fuchsia: "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200",
    cyan:    "border-cyan-500/50 bg-cyan-500/15 text-cyan-200",
    indigo:  "border-indigo-500/50 bg-indigo-500/15 text-indigo-200",
  };

  return (
    <div className="p-6 space-y-4">
      {/* Tab Bar */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3 sticky top-14 bg-slate-950/80 backdrop-blur z-10" data-testid="reports-tabs">
        {TABS.map(({ id, label, Icon, tone }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              data-testid={`reports-tab-${id}`}
              type="button"
              onClick={() => choose(id)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-all ${
                active ? tones[tone] + " shadow-md" : "border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {tab === "activity" && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8"><AdvancedMailReportCard /></div>
          <div className="col-span-12 lg:col-span-4 space-y-4">
            <Card>
              <CardHeader title="🎯 Nasıl Kullanılır?" />
              <CardBody className="text-xs text-slate-400 space-y-2.5">
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 text-[10px] font-bold flex items-center justify-center mt-0.5 shrink-0">1</span>
                  <div>Email adresi girin (örn: <span className="mono text-slate-300">musteri@sunucu.com</span>)</div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 text-[10px] font-bold flex items-center justify-center mt-0.5 shrink-0">2</span>
                  <div>Yön seçin: <span className="text-indigo-300">Gönderilen</span>, <span className="text-emerald-300">Gelen</span> veya <span className="text-cyan-300">Her ikisi</span></div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 text-[10px] font-bold flex items-center justify-center mt-0.5 shrink-0">3</span>
                  <div>Zaman aralığı belirleyin (7–365 gün)</div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 text-[10px] font-bold flex items-center justify-center mt-0.5 shrink-0">4</span>
                  <div><span className="text-rose-300">PDF</span> paylaşım için, <span className="text-emerald-300">Excel</span> analiz için indirin</div>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === "schedule" && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8"><ScheduledReportsCard /></div>
          <div className="col-span-12 lg:col-span-4">
            <Card>
              <CardHeader title="⏰ Zamanlama Rehberi" />
              <CardBody className="text-xs text-slate-400 space-y-2">
                <p>Zamanlamalar UTC saatinde çalışır. Her 5 dakikada bir tetikleyici çalışır.</p>
                <ul className="list-disc pl-4 space-y-1 text-slate-500">
                  <li><strong className="text-slate-300">Duraklat/Devam:</strong> Silmeden geçici olarak durdurun.</li>
                  <li><strong className="text-slate-300">Şimdi Çalıştır:</strong> Dry-run (email göndermeden test).</li>
                  <li><strong className="text-slate-300">Her gün:</strong> day_of_week boş bırakın.</li>
                </ul>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === "weekly" && (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8 space-y-4">
            <Card>
              <CardHeader
                title={<span className="flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-400" /> {t("reports.weekly_title")}</span>}
                subtitle={t("reports.weekly_sub")}
                right={<Badge tone="brand">{t("reports.auto")}</Badge>}
              />
              <CardBody className="space-y-4">
                <p className="text-sm text-slate-400">{t("reports.desc")}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <a
                    data-testid="report-download"
                    href={api.reportDownload()}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-md border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 text-sm"
                  >
                    <Download className="w-4 h-4" /> {t("reports.download_now")}
                  </a>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        data-testid="report-recipient"
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-3 py-3 text-sm mono"
                      />
                    </div>
                    <button
                      data-testid="report-send"
                      onClick={() => sendMut.mutate(recipient)}
                      disabled={sendMut.isPending}
                      className="inline-flex items-center gap-2 px-4 py-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-sm disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" /> {sendMut.isPending ? t("reports.sending") : t("reports.send_via_email")}
                    </button>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={<span className="flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-400" /> {t("reports.schedule_title")}</span>} />
              <CardBody className="text-sm text-slate-400 space-y-2">
                <p>{t("reports.schedule_desc")}</p>
                <pre className="mono text-[11px] bg-slate-950 border border-slate-800 rounded p-3 text-slate-400 overflow-x-auto">
{`systemctl status mailshield-report.timer
journalctl -u mailshield-report.service --since=today`}
                </pre>
              </CardBody>
            </Card>
          </div>

          <div className="col-span-12 lg:col-span-4 space-y-4">
            <Card>
              <CardHeader title={t("reports.content_title")} />
              <CardBody className="text-xs text-slate-400 space-y-2">
                <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {t("reports.c1")}</div>
                <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-indigo-400" /> {t("reports.c2")}</div>
                <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> {t("reports.c3")}</div>
                <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> {t("reports.c4")}</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="text-xs text-slate-500 space-y-1">
                <div className="mono text-slate-400">{t("reports.footer_meta")}</div>
                <div>{t("reports.footer_desc")}</div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
