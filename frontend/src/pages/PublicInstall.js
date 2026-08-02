import { Link } from "react-router-dom";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import Install from "@/pages/Install";

/**
 * Public wrapper for the Install page — accessible without panel login.
 * Reads ?key=MS-XXXX from URL and shows the personalized install command.
 * Used post-purchase or when master shares a direct install link to a customer.
 */
export default function PublicInstall() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 grid-backdrop">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link
            to="/"
            data-testid="public-install-home"
            className="flex items-center gap-2 text-slate-300 hover:text-slate-100"
          >
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-indigo-500 to-rose-500 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4 text-white" />
            </div>
            <div className="leading-tight">
              <div className="text-slate-100 font-bold tracking-tight text-[15px]">
                Gökyüzü<span className="text-indigo-400">WebSpam</span>
              </div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 mono">
                WHM Plugin · Kurulum
              </div>
            </div>
          </Link>
          <Link
            to="/"
            data-testid="public-install-back"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            <ArrowLeft className="w-3 h-3" /> Ana Sayfa
          </Link>
        </div>
      </header>
      <div className="max-w-6xl mx-auto">
        <Install />
      </div>
    </div>
  );
}
