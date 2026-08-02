import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Radar, Search, Send, ExternalLink, CheckCircle2, XCircle, Clock,
  AlertTriangle, ClipboardCheck, RotateCcw, Mail,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge, StatCard } from "@/components/ui-primitives";
import { PlanBadge } from "@/components/PlanGate";
import { api } from "@/lib/api";

const isoDT = (iso) => iso ? new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS_META = {
  pending:   { tone: "warning", label: "BEKLİYOR" },
  submitted: { tone: "info",    label: "GÖNDERİLDİ" },
  resolved:  { tone: "success", label: "ÇÖZÜLDÜ" },
  failed:    { tone: "danger",  label: "BAŞARISIZ" },
};

export default function Blacklist() {
  const qc = useQueryClient();
  const [target, setTarget] = useState("185.220.101.42");
  const [type, setType] = useState("ip");
  const [contactEmail, setContactEmail] = useState("admin@sunucunuz.com");
  const [reason, setReason] = useState(
    "Sunucumuzun IP itibarı üzerinde çalıştık, gerekli güvenlik önlemlerini aldık. Lütfen kaydınızdan çıkarır mısınız?"
  );
  const [selected, setSelected] = useState(new Set());

  const check = useMutation({
    mutationFn: () => api.blacklistCheck({ target, type }),
    onSuccess: (data) => {
      toast.success(`${data.listed_count}/${data.providers_checked} sağlayıcıda kayıtlı`);
      // Auto-select listed providers for delist request
      const listed = new Set(data.results.filter(r => r.listed).map(r => r.code));
      setSelected(listed);
    },
    onError: () => toast.error("Kontrol başarısız"),
  });

  const delist = useMutation({
    mutationFn: () => api.blacklistDelist({
      target, type, contact_email: contactEmail, reason,
      provider_codes: Array.from(selected),
    }),
    onSuccess: (data) => {
      toast.success(`${data.created} delisting talebi oluşturuldu · ${data.email_attempts} e-posta gönderildi`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["delist-requests"] });
    },
    onError: () => toast.error("Talep oluşturulamadı"),
  });

  const requests = useQuery({ queryKey: ["delist-requests"], queryFn: api.blacklistRequests });
  const updateStatus = useMutation({
    mutationFn: ({ id, status }) => api.blacklistUpdateRequest(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["delist-requests"] }),
  });

  const results = check.data?.results || [];
  const listedCount = results.filter(r => r.listed).length;

  const toggle = (code) => {
    const n = new Set(selected);
    n.has(code) ? n.delete(code) : n.add(code);
    setSelected(n);
  };

  const reqRows = requests.data || [];

  return (
    <div className="p-6 space-y-6">
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Radar className="w-4 h-4 text-indigo-400" /> Blacklist / RBL Sorgusu <PlanBadge className="ml-1"/></span>}
          subtitle="15+ sağlayıcıda (Spamhaus, Barracuda, SORBS, SpamCop, SURBL, URIBL vs.) IP veya domain kontrolü"
        />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 md:col-span-2">
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Tip</label>
              <select data-testid="bl-type" value={type} onChange={(e) => setType(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm">
                <option value="ip">IP Adresi</option>
                <option value="domain">Alan Adı</option>
              </select>
            </div>
            <div className="col-span-12 md:col-span-6">
              <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">
                {type === "ip" ? "IP Adresi" : "Alan Adı"}
              </label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input data-testid="bl-target" value={target} onChange={(e) => setTarget(e.target.value)}
                  placeholder={type === "ip" ? "192.0.2.42" : "sunucunuz.com"}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-3 py-2 text-sm mono" />
              </div>
            </div>
            <div className="col-span-12 md:col-span-4 flex items-end">
              <button data-testid="bl-check" onClick={() => check.mutate()} disabled={check.isPending}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50">
                <Radar className={`w-4 h-4 ${check.isPending ? "animate-spin" : ""}`} />
                {check.isPending ? "Kontrol ediliyor…" : "Blacklist Kontrol Et"}
              </button>
            </div>
          </div>

          {check.data && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-slate-300">
                  <span className="mono text-indigo-300">{check.data.target}</span> ·
                  {" "}<span className="mono text-slate-400">{isoDT(check.data.checked_at)}</span> ·
                  <Badge tone={listedCount === 0 ? "success" : listedCount < 3 ? "warning" : "danger"} className="ml-2">
                    {listedCount === 0 ? "TEMİZ" : `${listedCount} LİSTEDE`}
                  </Badge>
                </div>
                <div className="text-xs text-slate-500 mono">
                  {selected.size} seçili · {check.data.providers_checked} sağlayıcı sorgulandı
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {results.filter(r => !r.skipped).map((r) => (
                  <label key={r.code}
                    data-testid={`bl-provider-${r.code}`}
                    className={`flex items-start gap-2 p-3 rounded border cursor-pointer transition-colors ${
                      r.listed
                        ? "border-rose-500/30 bg-rose-500/5"
                        : "border-slate-800 bg-slate-950/40"
                    } ${selected.has(r.code) ? "ring-1 ring-indigo-500/60" : ""}`}>
                    <input type="checkbox" className="accent-indigo-500 mt-0.5"
                      checked={selected.has(r.code)}
                      onChange={() => toggle(r.code)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {r.listed
                          ? <XCircle className="w-3.5 h-3.5 text-rose-400" />
                          : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                        <span className="text-sm text-slate-200 truncate">{r.name}</span>
                      </div>
                      <div className="mono text-[10px] text-slate-500 truncate mt-0.5">{r.dns}</div>
                      {r.response && r.listed && (
                        <div className="mono text-[10px] text-rose-300 mt-0.5">→ {r.response}</div>
                      )}
                    </div>
                    <a href={r.removal_url} target="_blank" rel="noreferrer"
                       onClick={(e) => e.stopPropagation()}
                       className="text-slate-500 hover:text-indigo-400" title="Sağlayıcı portalı">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Delist request form */}
          <div className="mt-6 pt-6 border-t border-slate-800 space-y-3">
            <div className="text-sm text-slate-200 font-medium flex items-center gap-2">
              <Send className="w-4 h-4 text-emerald-400" /> Seçili Sağlayıcılara Delisting Talebi Gönder
            </div>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-12 md:col-span-6">
                <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">İletişim e-postası</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input data-testid="bl-contact" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-md pl-9 pr-3 py-2 text-sm mono" />
                </div>
              </div>
              <div className="col-span-12 md:col-span-6 flex items-end">
                <button data-testid="bl-delist" onClick={() => delist.mutate()}
                  disabled={selected.size === 0 || delist.isPending || !contactEmail}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40">
                  <Send className="w-4 h-4" />
                  {delist.isPending ? "Gönderiliyor…" : `${selected.size} Sağlayıcıya Talep Aç`}
                </button>
              </div>
              <div className="col-span-12">
                <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">Delisting sebebi (Türkçe/İngilizce)</label>
                <textarea rows={3} data-testid="bl-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="text-xs text-slate-500">
              <b>Not:</b> Bazı sağlayıcılar e-posta ile talep kabul eder ve WHM'de kurulduğunda sistem
              otomatik olarak <span className="mono">/usr/sbin/sendmail</span> ile yollar. Web portalı gerektirenler için
              her satırdaki <ExternalLink className="w-3 h-3 inline" /> ikonundan kayıt sayfasına gidin;
              talebiniz "Bekliyor" durumunda listede tutulur.
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-indigo-400" /> Açık Delisting Talepleri</span>}
          subtitle="Sağlayıcı yanıtı geldikçe durumu güncelleyin"
          right={<Badge tone="brand">{reqRows.length} kayıt</Badge>}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-widest text-slate-500">
                <th className="text-left px-4 py-3 font-semibold">Tarih</th>
                <th className="text-left px-4 py-3 font-semibold">Hedef</th>
                <th className="text-left px-4 py-3 font-semibold">Sağlayıcı</th>
                <th className="text-left px-4 py-3 font-semibold">Gönderim</th>
                <th className="text-left px-4 py-3 font-semibold">Durum</th>
                <th className="text-right px-4 py-3 font-semibold w-40">Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {reqRows.map((r) => {
                const meta = STATUS_META[r.status] || STATUS_META.pending;
                return (
                  <tr key={r.id} data-row data-testid={`bl-req-${r.id}`} className="border-t border-slate-800">
                    <td className="px-4 py-2.5 mono text-[11px] text-slate-400">{isoDT(r.at)}</td>
                    <td className="px-4 py-2.5">
                      <div className="mono text-slate-200">{r.target}</div>
                      <div className="text-[10px] text-slate-500 uppercase">{r.type}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-200">{r.provider_name}</div>
                      <a href={r.provider_url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-400 hover:underline mono truncate max-w-[220px] inline-block">
                        {r.provider_url}
                      </a>
                    </td>
                    <td className="px-4 py-2.5"><Badge tone={r.submitted_via === "email" ? "success" : "default"}>{r.submitted_via.toUpperCase()}</Badge></td>
                    <td className="px-4 py-2.5"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1">
                        <button title="Çözüldü olarak işaretle" onClick={() => updateStatus.mutate({ id: r.id, status: "resolved" })}
                          className="text-slate-500 hover:text-emerald-400"><CheckCircle2 className="w-4 h-4" /></button>
                        <button title="Beklemede" onClick={() => updateStatus.mutate({ id: r.id, status: "pending" })}
                          className="text-slate-500 hover:text-amber-400"><Clock className="w-4 h-4" /></button>
                        <button title="Başarısız" onClick={() => updateStatus.mutate({ id: r.id, status: "failed" })}
                          className="text-slate-500 hover:text-rose-400"><XCircle className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {reqRows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Henüz delisting talebi yok</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
