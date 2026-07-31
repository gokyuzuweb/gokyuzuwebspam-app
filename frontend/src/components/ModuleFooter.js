import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { Cpu, BookOpen, Lightbulb } from "lucide-react";

/**
 * Her modul icin standart aciklama footer'i.
 * Kullanim: <ModuleFooter howItWorks="..." technical={[...]} recommendations={[...]} />
 */
export default function ModuleFooter({ title = "Modül Detayı", howItWorks, technical = [], recommendations = [] }) {
  return (
    <Card data-testid="module-footer" className="border-slate-800">
      <CardHeader title={title} subtitle="Nasıl çalışır · Teknik özellikler · Öneriler"/>
      <CardBody className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FooterSection icon={<BookOpen className="w-4 h-4 text-sky-400"/>} label="Nasıl Çalışır" tone="sky">
          <p className="text-xs text-slate-300 leading-relaxed">{howItWorks}</p>
        </FooterSection>
        <FooterSection icon={<Cpu className="w-4 h-4 text-indigo-400"/>} label="Teknik Özellikler" tone="indigo">
          <ul className="text-xs text-slate-300 space-y-1">
            {technical.map((t, i) => (
              <li key={i} className="flex gap-2"><span className="text-indigo-400 mt-0.5">▸</span><span>{t}</span></li>
            ))}
          </ul>
        </FooterSection>
        <FooterSection icon={<Lightbulb className="w-4 h-4 text-amber-400"/>} label="Öneriler" tone="amber">
          <ul className="text-xs text-slate-300 space-y-1">
            {recommendations.map((r, i) => (
              <li key={i} className="flex gap-2"><span className="text-amber-400 mt-0.5">●</span><span>{r}</span></li>
            ))}
          </ul>
        </FooterSection>
      </CardBody>
    </Card>
  );
}

function FooterSection({ icon, label, children, tone }) {
  const borderMap = { sky: "border-sky-500/30 bg-sky-500/5", indigo: "border-indigo-500/30 bg-indigo-500/5", amber: "border-amber-500/30 bg-amber-500/5" };
  return (
    <div className={`rounded-lg border p-3 ${borderMap[tone] || ""}`}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest font-semibold text-slate-300 mb-2">
        {icon}{label}
      </div>
      {children}
    </div>
  );
}
