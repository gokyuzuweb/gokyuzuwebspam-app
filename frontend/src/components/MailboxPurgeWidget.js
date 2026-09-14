/**
 * MailboxPurgeWidget — v44.00.17
 * Master paneline "Posta kutularında konu/gönderene göre toplu sil" formu.
 * Her zaman önce dry-run ile önizleme, kullanıcı onayından sonra gerçek silme.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Trash2, Eye, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui-primitives";
import { api } from "@/lib/api";

export default function MailboxPurgeWidget() {
  const [subjectContains, setSubjectContains] = useState("");
  const [fromContains, setFromContains] = useState("");
  const [olderDays, setOlderDays] = useState(0);
  const [scanFolders, setScanFolders] = useState("all");
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(false);

  const build = () => ({
    subject_contains: subjectContains.trim(),
    from_contains: fromContains.trim(),
    older_than_days: Number(olderDays) || 0,
    scan_folders: scanFolders,
    max_files: 5000,
  });

  const dryRun = useMutation({
    mutationFn: () => api.mailboxPurge({ ...build(), dry_run: true }),
    onSuccess: (d) => {
      setPreview(d);
      setConfirm(false);
      toast.info(`${d.matched_count} mail bulundu (dry-run · ${d.scanned} tarandı)`);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Hata"),
  });

  const purge = useMutation({
    mutationFn: () => api.mailboxPurge({ ...build(), dry_run: false }),
    onSuccess: (d) => {
      toast.success(`${d.deleted} mail silindi`);
      setPreview(d);
      setConfirm(false);
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Silme hatası"),
  });

  return (
    <Card data-testid="mailbox-purge-widget">
      <div className="p-4 border-b border-slate-800 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
          <Trash2 className="w-4 h-4 text-rose-300" />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-100">Toplu Mail Silme</div>
          <div className="text-[11px] text-slate-500">
            <AlertTriangle className="w-3 h-3 inline mr-0.5 text-amber-400" />
            Kalıcı silme · önce dry-run ile önizle
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase text-slate-500 tracking-widest">Konu içeriyor</label>
            <input value={subjectContains} onChange={(e) => setSubjectContains(e.target.value)}
              placeholder="[UYARI] Posta kutunuz dolu" data-testid="purge-subject-input"
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs focus:border-rose-500 focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 tracking-widest">Gönderen içeriyor</label>
            <input value={fromContains} onChange={(e) => setFromContains(e.target.value)}
              placeholder="spammer@evil.com" data-testid="purge-from-input"
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs focus:border-rose-500 focus:outline-none" />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 tracking-widest">Şundan eski (gün)</label>
            <input type="number" min={0} value={olderDays} onChange={(e) => setOlderDays(e.target.value)}
              data-testid="purge-days-input"
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs" />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500 tracking-widest">Klasör</label>
            <select value={scanFolders} onChange={(e) => setScanFolders(e.target.value)}
              data-testid="purge-folders-select"
              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs">
              <option value="all">Tümü (Inbox + Junk + diğer)</option>
              <option value="inbox">Sadece Inbox</option>
              <option value="junk">Sadece Junk</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => (subjectContains.trim() || fromContains.trim()) && dryRun.mutate()}
            disabled={dryRun.isPending || (!subjectContains.trim() && !fromContains.trim())}
            data-testid="purge-dryrun-btn"
            className="flex-1 px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
            {dryRun.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            Önizle (Dry-run)
          </button>
          <button
            onClick={() => confirm ? purge.mutate() : setConfirm(true)}
            disabled={!preview || preview.matched_count === 0 || purge.isPending}
            data-testid="purge-execute-btn"
            className={`flex-1 px-3 py-2 rounded text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-30 ${
              confirm ? "bg-rose-600 hover:bg-rose-500 text-white" : "bg-rose-900/50 hover:bg-rose-800 text-rose-200 border border-rose-700"}`}>
            {purge.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {confirm ? `EMİN MİSİN? ${preview?.matched_count} sil` : "Kalıcı Sil"}
          </button>
        </div>

        {preview && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Tarandı:</span>
              <span className="mono text-slate-300">{preview.scanned}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Eşleşen:</span>
              <span className="mono text-rose-300 font-bold">{preview.matched_count}{preview.truncated && "+"}</span>
            </div>
            {preview.deleted > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Silinen:</span>
                <span className="mono text-emerald-300 font-bold">{preview.deleted}</span>
              </div>
            )}
            {preview.sample?.length > 0 && (
              <div className="max-h-40 overflow-y-auto space-y-1 mt-2 pt-2 border-t border-slate-800">
                {preview.sample.slice(0, 10).map((m, i) => (
                  <div key={i} className="text-[10px] mono text-slate-500 truncate">
                    <span className="text-slate-300">{m.subject}</span>
                    <span className="text-slate-600"> · {m.from}</span>
                  </div>
                ))}
                {preview.sample.length > 10 && (
                  <div className="text-[10px] text-slate-600 italic">... ve {preview.matched_count - 10} daha</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
