import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileText, Download, Send, Mail, Clock } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { useT } from "@/i18n";

export default function Reports() {
  const t = useT();
  const [recipient, setRecipient] = useState("admin@sunucunuz.com");

  const sendMut = useMutation({
    mutationFn: (to) => api.reportSend(to),
    onSuccess: (data) => {
      const via = data.sent_via === "sendmail" ? t("reports.via_sendmail") : t("reports.via_queued");
      toast.success(t("reports.sent_ok", { via }));
    },
    onError: () => toast.error(t("reports.send_fail")),
  });

  return (
    <div className="p-6 grid grid-cols-12 gap-6">
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
  );
}
