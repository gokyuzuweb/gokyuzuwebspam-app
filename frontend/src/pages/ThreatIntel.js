// v44.00.37 — Refactored: 1535 → ~70 satır. Alt tab'lar pages/threat-intel/ altında.
import { useState } from "react";
import { Globe, Radar, ShieldCheck, FileCheck2, RefreshCw, AlertTriangle } from "lucide-react";
import ModuleFooter from "@/components/ModuleFooter";
import { IocTab } from "./threat-intel/IocTab";
import { DmarcTab } from "./threat-intel/DmarcTab";
import { FeedsTab } from "./threat-intel/FeedsTab";
import { UsomTab } from "./threat-intel/UsomTab";
import { ComplianceTab } from "./threat-intel/ComplianceTab";

export default function ThreatIntel() {
  const [tab, setTab] = useState("ioc");
  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-slate-100 text-lg font-semibold flex items-center gap-2">
            <Globe className="w-5 h-5 text-indigo-400"/> Global Tehdit Zekası
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">IOC feed · DMARC agregat · Global Blocklist Sync · Uyumluluk Skoru</p>
        </div>
        <div className="flex gap-1 bg-slate-800/50 rounded p-1">
          {[
            { k: "ioc", l: "IOC Feed", i: Radar },
            { k: "dmarc", l: "DMARC", i: FileCheck2 },
            { k: "feeds", l: "Global Feeds", i: RefreshCw },
            { k: "usom", l: "USOM (TR)", i: AlertTriangle },
            { k: "compliance", l: "Uyumluluk", i: ShieldCheck },
          ].map(({ k, l, i: Icon }) => (
            <button key={k} data-testid={`ti-tab-${k}`} onClick={() => setTab(k)}
                    className={`text-xs px-3 py-1.5 rounded transition-colors flex items-center gap-1
                    ${tab === k ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400 hover:text-slate-100"}`}>
              <Icon className="w-3 h-3"/>{l}
            </button>
          ))}
        </div>
      </div>
      {tab === "ioc" && <IocTab/>}
      {tab === "dmarc" && <DmarcTab/>}
      {tab === "feeds" && <FeedsTab/>}
      {tab === "usom" && <UsomTab/>}
      {tab === "compliance" && <ComplianceTab/>}

      <ModuleFooter
        title="Global Tehdit Zekası — Nasıl Çalışır?"
        howItWorks="4 alt-modül: (1) IOC feed — IP/domain/URL/hash/email tehdit göstergeleri, (2) DMARC aggregate — ISP'lerden gelen SPF/DKIM/DMARC raporları, (3) Global Feeds — URLhaus/Spamhaus/PhishTank vs. gerçek fetch, (4) Compliance — KVKK/GDPR/HIPAA/SOC2 auto-detection. IOC listesi ingest sırasında otomatik enforce olur (blocked verdict + ioc_hit metadata)."
        technical={[
          "URLhaus gerçek API: 20 URL/sync · 14 gün TTL",
          "Spamhaus ZEN: son 24s'te top spam IP'ler için DNS lookup",
          "IOC auto-block: /api/events/ingest içinde _ioc_enforce hook",
          "DMARC XML parse: ingest endpoint (JSON pre-parsed) · rua= receiver şu an mock",
          "Compliance: 11 item sistem state'inden otomatik (AUTO rozeti)",
        ]}
        recommendations={[
          "URLhaus + Spamhaus feed'lerini 30dk peryotla senkronize et (WHM cron)",
          "IOC'lere manuel IP/domain ekleyerek özel blok listesi oluştur",
          "DMARC rua= adresini `dmarc@sizindomain.com` yap",
          "Compliance %80+ hedefiyle manuel item'ları da tikle",
          "SIEM export ile Splunk/QRadar'a IOC feed'i push et",
        ]}
      />
    </div>
  );
}
