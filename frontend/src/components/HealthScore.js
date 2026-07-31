import { useQuery } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "@/components/ui-primitives";
import { api } from "@/lib/api";
import { Heart, TrendingUp, TrendingDown } from "lucide-react";

/**
 * HealthScore — 0-100 composite metric summarising:
 *   - Spam ratio (lower = better, weight 40%)
 *   - Engine coverage (weight 30%)
 *   - Recent activity freshness (weight 30%)
 * Renders a big number + explanatory sub-score chips.
 */
export default function HealthScore() {
  const overview = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 20000 });
  const stats = overview.data || {};

  const spamRatio = Number(stats.spam_ratio ?? 0);
  const enginesPct = stats.engines_total
    ? Math.round((stats.engines_active / stats.engines_total) * 100) : 100;
  const hasRecent = (stats.scanned_today ?? 0) > 0;

  // Score calculation
  const spamPart   = Math.max(0, 100 - Math.min(spamRatio * 3, 100)) * 0.4;
  const enginePart = enginesPct * 0.3;
  const activityPart = (hasRecent ? 100 : 40) * 0.3;
  const score = Math.round(spamPart + enginePart + activityPart);

  const color =
    score >= 85 ? { fg: "#10b981", ring: "text-emerald-400", label: "Mükemmel", Icon: TrendingUp } :
    score >= 65 ? { fg: "#84cc16", ring: "text-lime-400",    label: "İyi",      Icon: TrendingUp } :
    score >= 45 ? { fg: "#f59e0b", ring: "text-amber-400",   label: "Dikkat",   Icon: Heart } :
                  { fg: "#f43f5e", ring: "text-rose-400",    label: "Riskli",   Icon: TrendingDown };
  const Icon = color.Icon;

  const R = 44, C = 2 * Math.PI * R;
  const dash = (score / 100) * C;

  return (
    <Card data-testid="health-score-card">
      <CardHeader
        title={<span className="flex items-center gap-2"><Heart className={`w-4 h-4 ${color.ring}`} /> Sistem Sağlık Skoru</span>}
        subtitle="Spam oranı, motor kapsamı, aktivite tazeliği — tek bakış"
      />
      <CardBody>
        <div className="flex items-center gap-6">
          <svg width="110" height="110" viewBox="0 0 110 110" className="shrink-0">
            <circle cx="55" cy="55" r={R} fill="none" stroke="#1e293b" strokeWidth="10" />
            <circle
              cx="55" cy="55" r={R}
              fill="none" stroke={color.fg} strokeWidth="10"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={0}
              transform="rotate(-90 55 55)"
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray .6s ease-out" }}
            />
            <text x="55" y="52" textAnchor="middle" fill="#e2e8f0" fontSize="26" fontWeight="700"
                  fontFamily="JetBrains Mono, monospace" data-testid="health-score-value">
              {score}
            </text>
            <text x="55" y="70" textAnchor="middle" fill="#64748b" fontSize="9">/ 100</text>
          </svg>
          <div className="flex-1 space-y-2">
            <div className={`text-sm font-semibold flex items-center gap-1 ${color.ring}`}>
              <Icon className="w-4 h-4" /> {color.label}
            </div>
            <SubScore label="Spam oranı"       value={`%${spamRatio.toFixed(1)}`}
                      tone={spamRatio < 10 ? "success" : spamRatio < 25 ? "warning" : "danger"} />
            <SubScore label="Motor kapsamı"    value={`%${enginesPct}`}
                      tone={enginesPct >= 80 ? "success" : enginesPct >= 50 ? "warning" : "danger"} />
            <SubScore label="Aktivite (24s)"   value={hasRecent ? "Aktif" : "Boş"}
                      tone={hasRecent ? "success" : "warning"} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function SubScore({ label, value, tone }) {
  const c = tone === "success" ? "text-emerald-400"
         : tone === "warning" ? "text-amber-400"
         : "text-rose-400";
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={`mono font-semibold ${c}`}>{value}</span>
    </div>
  );
}
