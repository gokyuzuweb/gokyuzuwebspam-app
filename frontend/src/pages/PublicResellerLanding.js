/**
 * v43.74 — Public Reseller Landing Page
 *
 * Route: /r/:hostSlug OR /r?host=mail.bayihosting.com
 *
 * Bayı kendi domain'ini `/panel/reseller-branding` ekranından tanımladıktan sonra,
 * müşterileri bu URL'e geldiğinde bayının markalı bir satın alma sayfası görürler.
 *
 * Fetch: GET /api/public/reseller-branding?host=<host>
 * Fallback: 404 branded — "Bu sayfa bulunamadı".
 */
import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { Loader2, Mail, MessageCircle, ShieldCheck, Sparkles, CheckCircle2 } from "lucide-react";
import axios from "axios";

const BE = process.env.REACT_APP_BACKEND_URL || "";
const bare = axios.create({ baseURL: `${BE}/api`, timeout: 12000 });

const FALLBACK_COLOR = "#6366f1";

const PLAN_HIGHLIGHTS = [
  { plan: "Starter", price: "₺249/ay", features: ["1 domain", "5K mail/gün", "RBL sorgu", "Karantina", "Bildirim"] },
  { plan: "Pro",     price: "₺749/ay", features: ["10 domain", "50K mail/gün", "AI rules", "Threat Intel", "Marketplace", "SMTP relay"], hot: true },
  { plan: "Enterprise", price: "Talep Üzerine", features: ["Sınırsız domain", "Custom Branding", "Alt bayi", "SLA destek", "Kendi domain"] },
];

export default function PublicResellerLanding() {
  const { hostSlug } = useParams();
  const [sp] = useSearchParams();
  const host = (hostSlug || sp.get("host") || window.location.hostname || "").toLowerCase();
  const [state, setState] = useState({ loading: true, data: null, err: null });

  useEffect(() => {
    if (!host || host === "localhost") {
      setState({ loading: false, data: null, err: "Host parametresi eksik. Örn: /r/mail.bayihosting.com" });
      return;
    }
    bare.get("/public/reseller-branding", { params: { host } })
      .then((r) => setState({ loading: false, data: r.data, err: null }))
      .catch((e) => setState({ loading: false, data: null, err: e?.response?.data?.detail || "Bu domain için aktif bayı bulunamadı" }));
  }, [host]);

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (state.err || !state.data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300 p-6" data-testid="pub-landing-404">
        <div className="text-center max-w-md">
          <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-100 mb-2">Bu Sayfa Bulunamadı</h1>
          <p className="text-sm text-slate-500 mb-4">{state.err}</p>
          <p className="text-xs text-slate-600 mono">host: {host}</p>
          <Link to="/" className="inline-block mt-4 text-sm text-indigo-400 hover:text-indigo-300">Ana sayfaya dön →</Link>
        </div>
      </div>
    );
  }

  const b = state.data;
  const brand = b.brand_name || "GökyüzüWebSpam";
  const color = b.primary_color || FALLBACK_COLOR;
  const tagline = b.brand_tagline || "Kurumsal Mail Güvenliği";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" data-testid="pub-landing">
      {/* HEADER */}
      <header
        className="relative overflow-hidden border-b border-slate-800"
        style={{ background: `linear-gradient(135deg, ${color}22 0%, rgba(15,23,42,0.9) 60%)` }}
      >
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-center gap-4">
          {b.logo_url && (
            <img src={b.logo_url} alt={brand} className="h-12" onError={(e) => (e.currentTarget.style.display = "none")} />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-2xl font-black" style={{ color }}>{brand}</div>
            <div className="text-sm text-slate-300 mt-0.5">{tagline}</div>
          </div>
          <div className="hidden md:flex items-center gap-4 text-sm">
            {b.support_email && <a href={`mailto:${b.support_email}`} className="text-slate-400 hover:text-slate-200 flex items-center gap-1"><Mail className="w-3.5 h-3.5"/>{b.support_email}</a>}
            {b.support_whatsapp && <a href={`https://wa.me/${b.support_whatsapp.replace(/\D/g,"")}`} className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1" target="_blank" rel="noreferrer"><MessageCircle className="w-3.5 h-3.5"/>WhatsApp</a>}
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 py-14 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs mb-6"
             style={{ background: color + "22", color: color, border: `1px solid ${color}55` }}>
          <Sparkles className="w-3 h-3"/> Sunucularınızı spam ve saldırılardan koruyun
        </div>
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-black mb-4 tracking-tight">
          Mail Trafiğinizi <span style={{ color }}>Güvence Altına</span> Alın
        </h1>
        <p className="text-slate-400 max-w-2xl mx-auto text-base">
          {brand} olarak kurumsal seviyede spam, phishing ve BEC koruması sunuyoruz.
          Dakikalar içinde WHM/cPanel sunucunuza entegre edin, canlı trafiğinizi kontrol edin.
        </p>
        {b.pricing_note && (
          <div className="mt-6 max-w-lg mx-auto p-4 rounded-lg border text-sm whitespace-pre-line"
               style={{ borderColor: color + "55", background: color + "0f", color: color }}>
            {b.pricing_note}
          </div>
        )}
      </section>

      {/* PLANS */}
      <section className="max-w-6xl mx-auto px-6 pb-14">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLAN_HIGHLIGHTS.map((p) => (
            <div
              key={p.plan}
              data-testid={`pub-plan-${p.plan.toLowerCase()}`}
              className={`p-6 rounded-xl border backdrop-blur transition-all hover:-translate-y-0.5 ${
                p.hot ? "shadow-lg" : "border-slate-800 bg-slate-900/40"
              }`}
              style={p.hot ? { borderColor: color, boxShadow: `0 8px 24px ${color}22` } : {}}
            >
              {p.hot && (
                <div className="text-[10px] uppercase tracking-widest font-bold mb-2" style={{ color }}>
                  ⭐ Popüler
                </div>
              )}
              <div className="text-lg font-bold text-slate-100 mb-1">{p.plan}</div>
              <div className="text-2xl font-black mb-4" style={{ color: p.hot ? color : "#f1f5f9" }}>{p.price}</div>
              <ul className="space-y-2 mb-6">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color }} /> {f}
                  </li>
                ))}
              </ul>
              <a
                href={b.support_email ? `mailto:${b.support_email}?subject=${encodeURIComponent(p.plan + " paketi hakkında")}` : "#"}
                data-testid={`pub-cta-${p.plan.toLowerCase()}`}
                className="block w-full text-center py-2.5 rounded-lg font-semibold text-sm transition-all"
                style={{ background: p.hot ? color : "#1e293b", color: p.hot ? "#fff" : "#f1f5f9" }}
              >
                Bayı ile İletişime Geç
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-800 py-10">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-2xl font-bold mb-2">Sorularınız mı var?</h2>
          <p className="text-slate-400 text-sm mb-6">{brand} ekibi size özel çözümler sunar.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {b.support_email && (
              <a href={`mailto:${b.support_email}`} data-testid="pub-contact-email"
                 className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm"
                 style={{ background: color, color: "#fff" }}>
                <Mail className="w-4 h-4"/> {b.support_email}
              </a>
            )}
            {b.support_whatsapp && (
              <a href={`https://wa.me/${b.support_whatsapp.replace(/\D/g,"")}`} target="_blank" rel="noreferrer" data-testid="pub-contact-wa"
                 className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm border-2"
                 style={{ borderColor: color, color: color }}>
                <MessageCircle className="w-4 h-4"/> WhatsApp
              </a>
            )}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-600">
        © {new Date().getFullYear()} {brand} · GökyüzüWebSpam altyapısı ile güçlendirildi
      </footer>
    </div>
  );
}
