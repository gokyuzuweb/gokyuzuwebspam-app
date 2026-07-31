import { cn } from "@/lib/utils";

export function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "bg-slate-900 border border-slate-800 rounded-lg",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, right, className }) {
  return (
    <div className={cn("flex items-start justify-between p-5 border-b border-slate-800", className)}>
      <div>
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        {subtitle ? <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

export function StatCard({ label, value, hint, tone = "default", icon: Icon, testid }) {
  const tones = {
    default: "text-slate-100",
    success: "text-emerald-400",
    warning: "text-amber-400",
    danger: "text-rose-400",
    info: "text-sky-400",
  };
  return (
    <div data-testid={testid} className="bg-slate-900 border border-slate-800 rounded-lg p-5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold">
          {label}
        </div>
        {Icon ? <Icon className="w-4 h-4 text-slate-600" /> : null}
      </div>
      <div className={cn("mt-3 mono text-3xl font-semibold tracking-tight", tones[tone])}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function Badge({ tone = "default", children, className }) {
  const t = {
    default: "bg-slate-800 text-slate-300 border-slate-700",
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    danger: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    info: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    brand: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20",
  }[tone];
  return (
    <span className={cn("mono inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border", t, className)}>
      {children}
    </span>
  );
}
