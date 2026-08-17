/**
 * v43.64 — Kaynak IP Coğrafi Ters Analiz
 *
 * Outbound origin (server_ip)'lerin reputasyon check'i:
 *  🟢 GREEN: PTR (rDNS) sağlıklı ve sender domain ile eşleşiyor
 *  🟠 ORANGE: PTR var ama sender domain ile eşleşmiyor
 *  🔴 RED: PTR yok VEYA private/reserved IP (spam filtreleri direkt bloklar)
 */
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck, AlertTriangle, MapPin } from "lucide-react";
import { Card, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";

const FLAG_META = {
  green:  { label: "SAĞLIKLI", cls: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10", Icon: ShieldCheck },
  orange: { label: "ŞÜPHELİ",  cls: "text-orange-300 border-orange-500/40 bg-orange-500/10",  Icon: AlertTriangle },
  red:    { label: "RISKLI",   cls: "text-rose-300 border-rose-500/40 bg-rose-500/10",       Icon: ShieldAlert },
};

export default function OriginReputationCard({ hours = 24 }) {
  const q = useQuery({
    queryKey: ["outbound-origin-rep", hours],
    queryFn: () => api.outboundOriginReputation(hours),
    refetchInterval: 30000,
    staleTime: 0,
  });
  const items = q.data?.items || [];
  const summary = q.data?.summary || { total_ips: 0, red: 0, orange: 0, green: 0 };
  return (
    <Card data-testid="origin-reputation-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-rose-400"/> Kaynak IP Reputasyon Analizi</span>}
        subtitle={`Son ${hours} saatte outbound gönderen ${summary.total_ips} IP · PTR + coğrafi + sender domain kontrolü`}
        right={
          <div className="flex items-center gap-1.5">
            {summary.red > 0 && <Badge tone="danger">🔴 {summary.red} riskli</Badge>}
            {summary.orange > 0 && <Badge tone="warning">🟠 {summary.orange} şüpheli</Badge>}
            {summary.green > 0 && <Badge tone="success">🟢 {summary.green} sağlıklı</Badge>}
          </div>
        }
      />
      <div className="overflow-x-auto max-h-[420px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-950 z-10">
            <tr className="text-[11px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
              <th className="text-center px-3 py-2 font-semibold">Flag</th>
              <th className="text-left px-3 py-2 font-semibold">IP</th>
              <th className="text-left px-3 py-2 font-semibold">rDNS (PTR)</th>
              <th className="text-center px-3 py-2 font-semibold">Ülke</th>
              <th className="text-left px-3 py-2 font-semibold">Sender Domain(ler)</th>
              <th className="text-right px-3 py-2 font-semibold">Mail</th>
              <th className="text-right px-3 py-2 font-semibold">Spam</th>
              <th className="text-left px-3 py-2 font-semibold">Sebep</th>
            </tr>
          </thead>
          <tbody data-testid="origin-rep-tbody">
            {items.map((r) => {
              const m = FLAG_META[r.flag] || FLAG_META.orange;
              const Icon = m.Icon;
              return (
                <tr key={r.ip} data-testid={`origin-rep-${r.ip}`} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-flex items-center gap-1 text-[10px] mono px-1.5 py-0.5 rounded border ${m.cls}`}>
                      <Icon className="w-3 h-3" /> {m.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 mono text-slate-100">{r.ip}</td>
                  <td className="px-3 py-2 mono text-xs text-slate-300 break-all">{r.rdns || <span className="text-rose-400">— (PTR yok)</span>}</td>
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <MapPin className="w-3 h-3" /> {r.country || "?"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400 break-all">
                    {(r.sender_domains || []).slice(0, 3).join(", ")}
                    {(r.sender_domains || []).length > 3 && ` +${r.sender_domains.length - 3}`}
                  </td>
                  <td className="px-3 py-2 text-right mono text-slate-200">{r.mail_count}</td>
                  <td className="px-3 py-2 text-right mono text-amber-300">{r.spam_count}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.flag_reason}</td>
                </tr>
              );
            })}
            {items.length === 0 && !q.isLoading && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500 text-sm">Outbound origin IP verisi yok (son {hours} saat)</td></tr>
            )}
            {q.isLoading && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500 text-sm">Reputasyon analizi yapılıyor…</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {(summary.red > 0 || summary.orange > 0) && (
        <div className="px-4 py-2 bg-amber-500/5 border-t border-amber-500/20 text-[11px] text-amber-200">
          <b>Önerileri:</b> Kırmızı flag'li IP'lerin PTR record'unu (reverse DNS) DNS sağlayıcınızdan eklettirin.
          Turuncu flag'ler için PTR ile sender domain (SPF) uyumunu doğrulayın.
          Bu iki adım <b>%80'e kadar</b> spam filtresi rejection'ı önler.
        </div>
      )}
    </Card>
  );
}
