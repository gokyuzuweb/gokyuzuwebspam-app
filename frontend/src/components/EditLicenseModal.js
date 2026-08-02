import { useState, useEffect } from "react";
import { X, Save, Trash2, Plus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";

/**
 * EditLicenseModal — full CRUD form for an existing license.
 * Fields: customer_name, customer_email, plan, ip_addresses (chip list — add/remove),
 * max_domains, valid_until (date), active, notes.
 */
export default function EditLicenseModal({ license, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({
    customer_name:  license.customer_name || "",
    customer_email: license.customer_email || "",
    plan:           license.plan || "pro",
    ip_addresses:   Array.isArray(license.ip_addresses) ? [...license.ip_addresses] : [],
    max_domains:    license.max_domains ?? 100,
    valid_until:    license.valid_until
      ? new Date(license.valid_until).toISOString().slice(0, 10)
      : new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    active:         license.active !== false,
    notes:          license.notes || "",
  }));
  const [ipDraft, setIpDraft] = useState("");

  const save = useMutation({
    mutationFn: (payload) => api.licenseUpdate(license.id, payload),
    onSuccess: () => {
      toast.success("Lisans güncellendi");
      qc.invalidateQueries({ queryKey: ["licenses"] });
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.detail || "Güncelleme başarısız"),
  });

  function addIp() {
    const v = ipDraft.trim();
    if (!v) return;
    // Validate IPv4 or IPv6 roughly
    const ok = /^([\d.]+|[\da-f:]+)$/i.test(v);
    if (!ok) return toast.error("Geçerli IP girin");
    if (form.ip_addresses.includes(v)) return toast.info("IP zaten listede");
    setForm({ ...form, ip_addresses: [...form.ip_addresses, v] });
    setIpDraft("");
  }
  function bulkAddIps(text) {
    // Split by whitespace / newline / comma / semicolon / tab
    const parts = String(text || "").split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const ipRe = /^([\d]{1,3}(?:\.[\d]{1,3}){3}|[\da-fA-F:]+)$/;
    const validNew = [];
    const invalid = [];
    const existing = new Set(form.ip_addresses);
    for (const p of parts) {
      if (!ipRe.test(p)) { invalid.push(p); continue; }
      if (existing.has(p)) continue;
      existing.add(p);
      validNew.push(p);
    }
    if (validNew.length) setForm({ ...form, ip_addresses: [...form.ip_addresses, ...validNew] });
    const msg = `${validNew.length} eklendi` + (invalid.length ? ` · ${invalid.length} geçersiz atlandı` : "");
    if (validNew.length) toast.success(msg);
    else if (invalid.length) toast.error(`Geçerli IP bulunamadı (${invalid.length} atlandı)`);
    setIpDraft("");
  }
  function handleIpPaste(e) {
    const pasted = e.clipboardData?.getData("text") || "";
    if (/[\s,;]/.test(pasted)) {
      e.preventDefault();
      bulkAddIps(pasted);
    }
  }
  function removeIp(ip) {
    setForm({ ...form, ip_addresses: form.ip_addresses.filter(x => x !== ip) });
  }

  function handleSave() {
    if (!form.customer_name.trim()) return toast.error("Müşteri adı zorunlu");
    if (form.ip_addresses.length === 0) return toast.error("En az bir IP olmalı");
    save.mutate({
      customer_name:  form.customer_name.trim(),
      customer_email: form.customer_email.trim(),
      plan:           form.plan,
      ip_addresses:   form.ip_addresses,
      max_domains:    parseInt(form.max_domains) || 100,
      valid_until:    new Date(form.valid_until + "T12:00:00Z").toISOString(),
      active:         !!form.active,
      notes:          form.notes || "",
    });
  }

  // ESC to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/70 z-40" data-testid="edit-lic-backdrop" />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-2xl max-h-[92vh] overflow-y-auto z-50 bg-slate-950 border border-slate-800 rounded-lg shadow-2xl"
           data-testid="edit-lic-modal">
        <div className="sticky top-0 bg-slate-950 border-b border-slate-800 px-5 py-3 flex items-center justify-between z-10">
          <div>
            <div className="text-xs text-slate-500 mono uppercase tracking-wider">Lisans Düzenle</div>
            <div className="mono text-sm text-indigo-300">{license.license_key}</div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400"
                  data-testid="edit-lic-close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Müşteri adı" required>
              <input
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100"
                data-testid="edit-lic-name"
              />
            </Field>
            <Field label="E-posta">
              <input
                value={form.customer_email}
                onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
                placeholder="admin@musteri.com"
                className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100 mono"
                data-testid="edit-lic-email"
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Plan">
              <select
                value={form.plan}
                onChange={(e) => setForm({ ...form, plan: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100"
                data-testid="edit-lic-plan"
              >
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </Field>
            <Field label="Max Domain">
              <input
                type="number" min="1"
                value={form.max_domains}
                onChange={(e) => setForm({ ...form, max_domains: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100 mono text-right"
                data-testid="edit-lic-maxdom"
              />
            </Field>
            <Field label="Bitiş">
              <input
                type="date"
                value={form.valid_until}
                onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100 mono"
                data-testid="edit-lic-until"
              />
            </Field>
          </div>

          {/* IP chips */}
          <Field label={`İzinli IP Adresleri (${form.ip_addresses.length})`} required>
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[36px] p-2 bg-slate-900 border border-slate-800 rounded" data-testid="edit-lic-ip-list">
              {form.ip_addresses.length === 0 && (
                <span className="text-xs text-slate-500 italic self-center">Hiç IP yok — en az 1 IP ekleyin</span>
              )}
              {form.ip_addresses.map((ip) => (
                <span
                  key={ip}
                  className="inline-flex items-center gap-1 mono text-xs px-2 py-1 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-200"
                  data-testid={`edit-lic-ip-chip-${ip}`}
                >
                  {ip}
                  <button
                    onClick={() => removeIp(ip)}
                    className="hover:text-rose-400 transition"
                    title="IP'yi kaldır"
                    data-testid={`edit-lic-ip-remove-${ip}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={ipDraft}
                onChange={(e) => setIpDraft(e.target.value)}
                onPaste={handleIpPaste}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addIp(); } }}
                placeholder="203.0.113.10 (Enter ile ekle · CSV/space yapıştır → toplu)"
                className="flex-1 bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100 mono"
                data-testid="edit-lic-ip-input"
              />
              <button
                type="button"
                onClick={addIp}
                className="px-3 py-2 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 text-xs inline-flex items-center gap-1"
                data-testid="edit-lic-ip-add"
              >
                <Plus className="w-3.5 h-3.5" /> Ekle
              </button>
              <button
                type="button"
                onClick={() => bulkAddIps(ipDraft)}
                className="px-3 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs"
                data-testid="edit-lic-ip-bulk"
                title="Input'taki boşluk/virgül/satır ayrılmış IP listesini toplu ekle"
              >
                Toplu Ekle
              </button>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              💡 Excel/CSV'den IP kolonunu kopyalayıp bu input'a yapıştırın — hepsi otomatik eklenir
            </div>
          </Field>

          {/* Active toggle */}
          <div className="flex items-center gap-3 p-3 bg-slate-900/60 rounded border border-slate-800">
            <button
              onClick={() => setForm({ ...form, active: !form.active })}
              className={`relative w-11 h-6 rounded-full transition ${form.active ? "bg-emerald-500" : "bg-slate-700"}`}
              data-testid="edit-lic-active-toggle"
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${form.active ? "translate-x-5" : ""}`}></span>
            </button>
            <div>
              <div className="text-sm text-slate-200">
                {form.active ? "🟢 Aktif" : "🔴 Pasif"}
              </div>
              <div className="text-xs text-slate-500">
                {form.active
                  ? "Lisans çalışır durumda, plugin heartbeat kabul eder"
                  : "Plugin bu anahtarla bağlanamaz (403 döner)"}
              </div>
            </div>
          </div>

          <Field label="Notlar">
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-100"
              placeholder="Örn: Yıllık ödeme, faturalandırma..."
              data-testid="edit-lic-notes"
            />
          </Field>

          <div className="flex gap-2 pt-3 border-t border-slate-800">
            <button
              onClick={handleSave}
              disabled={save.isPending}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-50 text-sm font-medium transition"
              data-testid="edit-lic-save"
            >
              <Save className="w-4 h-4" />
              {save.isPending ? "Kaydediliyor..." : "Kaydet"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 text-sm"
              data-testid="edit-lic-cancel"
            >
              İptal
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-widest text-slate-500 mb-1 block">
        {label} {required && <span className="text-rose-400">*</span>}
      </label>
      {children}
    </div>
  );
}
