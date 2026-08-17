/**
 * v43.67 — Reusable Master-Only guard component.
 *
 * Bir sayfayı sadece ana yöneticiye açmak için wrapper:
 *   <MasterOnlyGuard pageTitle="Ödeme Panosu"><PaymentsAdmin /></MasterOnlyGuard>
 *
 * Kullanım: URL'ye direkt yazan bayiler için "Erişim Reddedildi" ekranı gösterir.
 * Backend authoritative — bu sadece UX defense-in-depth.
 */
import { XCircle, ShieldOff } from "lucide-react";
import { useIsMaster } from "@/hooks/useIsMaster";
import { Card, CardBody } from "@/components/ui-primitives";

export default function MasterOnlyGuard({ children, pageTitle = "Bu Sayfa" }) {
  const { isMaster, isLoading, clientIp, masterIp } = useIsMaster();
  if (isLoading) return null;
  if (!isMaster) {
    return (
      <div className="p-6" data-testid="master-only-guarded">
        <Card>
          <CardBody className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto mb-4">
              <ShieldOff className="w-8 h-8 text-rose-400" />
            </div>
            <h1 className="text-xl font-bold text-slate-100 mb-2">Erişim Reddedildi</h1>
            <p className="text-sm text-slate-400 mb-1 max-w-md mx-auto">
              <b className="text-rose-300">{pageTitle}</b> sadece ana yönetici (Master) tarafından görüntülenebilir.
            </p>
            <p className="text-xs text-slate-500 mb-4 mono">
              Sizin IP: {clientIp || "?"} · Master IP: {masterIp || "?"}
            </p>
            <p className="text-xs text-slate-500 mb-6 max-w-md mx-auto">
              Eğer ana yönetici sizseniz, Header'daki <b>"Master Aktif Et"</b> butonuyla anahtarınızı girin.
              Bayi hesabındaysanız bu sayfa size özel değildir.
            </p>
            <a href="/panel"
               data-testid="master-only-back"
               className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/20 transition-colors">
              ← Ana sayfaya dön
            </a>
          </CardBody>
        </Card>
      </div>
    );
  }
  return children;
}
