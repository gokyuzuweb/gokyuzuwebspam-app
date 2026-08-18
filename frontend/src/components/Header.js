import React, { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Clock, RefreshCw, Search, Sparkles, KeyRound, ShieldCheck, DownloadCloud, User2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import ThreatAlertBell from "@/components/ThreatAlertBell";
import SlashCommandBar from "@/components/SlashCommandBar";
import { ImpersonatePicker } from "@/components/Impersonate";

// v43.91/93 — Pending PIN Approval floating badge (master-only) + soft chime
function PinPendingBadge() {
  const nav = useNavigate();
  const who = useQuery({ queryKey: ["whoami-header"], queryFn: () => api.whoami(), staleTime: 60_000 });
  const isMaster = who.data?.is_master;
  const q = useQuery({
    queryKey: ["pin-approvals-pending"],
    queryFn: () => api.pinApprovalPending(),
    refetchInterval: 20_000,
    enabled: !!isMaster,
  });
  const count = q.data?.count || 0;
  const prevCountRef = React.useRef(null);

  // v43.93 — Count arttığında soft chime çal (Web Audio API)
  React.useEffect(() => {
    if (!isMaster) return;
    const prev = prevCountRef.current;
    if (prev !== null && count > prev) {
      // Sadece muted değilse çal
      const muted = localStorage.getItem("gws.pin.chime.muted") === "1";
      if (!muted) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) {
            const ctx = new AC();
            const now = ctx.currentTime;
            // 2 tonlu soft "ding-dong"
            [880, 660].forEach((freq, i) => {
              const o = ctx.createOscillator();
              const g = ctx.createGain();
              o.type = "sine";
              o.frequency.value = freq;
              g.gain.value = 0;
              const t0 = now + i * 0.18;
              g.gain.linearRampToValueAtTime(0.12, t0 + 0.02);
              g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
              o.connect(g).connect(ctx.destination);
              o.start(t0);
              o.stop(t0 + 0.42);
            });
            setTimeout(() => { try { ctx.close(); } catch {} }, 800);
          }
        } catch {}
        toast.info(`Yeni PIN talebi geldi (toplam ${count})`, { duration: 4000 });
      }
    }
    prevCountRef.current = count;
  }, [count, isMaster]);

  if (!isMaster || count === 0) return null;
  const go = () => {
    try { localStorage.setItem("gws.settings.tab", "lock"); } catch {}
    nav("/panel/settings");
  };
  const toggleMute = (e) => {
    e.stopPropagation();
    const curr = localStorage.getItem("gws.pin.chime.muted") === "1";
    localStorage.setItem("gws.pin.chime.muted", curr ? "0" : "1");
    toast.info(curr ? "🔔 PIN ses bildirimi açıldı" : "🔕 PIN ses bildirimi kapatıldı");
  };
  const muted = localStorage.getItem("gws.pin.chime.muted") === "1";
  return (
    <div className="hidden md:inline-flex items-center gap-0.5 shrink-0">
      <button
        data-testid="header-pin-pending-badge"
        type="button"
        onClick={go}
        title={`${count} PIN değişiklik talebi onay bekliyor — tıklayın`}
        className="inline-flex items-center gap-1.5 text-[11px] mono font-bold tracking-wide px-2.5 py-1 rounded-l-md border border-amber-500/60 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 transition-all animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.35)]"
      >
        <KeyRound className="w-3 h-3" />
        <span>{count} PIN Bekliyor</span>
      </button>
      <button
        data-testid="header-pin-chime-toggle"
        type="button"
        onClick={toggleMute}
        title={muted ? "PIN sesi kapalı — açmak için tıkla" : "PIN sesi açık — kapatmak için tıkla"}
        className={`inline-flex items-center px-1.5 py-1 rounded-r-md border border-l-0 text-[10px] transition-all ${
          muted ? "border-slate-700 bg-slate-800 text-slate-500 hover:text-slate-300" : "border-amber-500/60 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
        }`}
      >
        {muted ? "🔕" : "🔔"}
      </button>
    </div>
  );
}

/**
 * v43.21 Header — modern glass with global Spotlight-style search input
 * that opens the CommandPalette (dispatches `gws:open-palette`).
 */
function GlobalSearch() {
  const openPalette = (query = "") => {
    window.dispatchEvent(new CustomEvent("gws:open-palette", { detail: { query } }));
  };
  return (
    <div className="hidden md:flex flex-1 max-w-md">
      <button
        type="button"
        data-testid="global-search-btn"
        onClick={() => openPalette("")}
        onKeyDown={(e) => {
          // Kullanıcı doğrudan yazmaya başlarsa palette'i o karakterle aç
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            openPalette(e.key);
          }
        }}
        className="group relative flex-1 flex items-center gap-2.5 px-3.5 py-2 rounded-lg bg-slate-950/60 hover:bg-slate-900/80 border border-slate-800/80 hover:border-indigo-500/40 transition-all text-left focus:outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/10"
      >
        <Search className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 shrink-0 transition-colors" strokeWidth={2} />
        <span className="flex-1 text-sm text-slate-500 group-hover:text-slate-300 transition-colors truncate">
          Ara: sayfa, karantina, ayar, kural…
        </span>
        <span className="hidden lg:flex items-center gap-0.5 shrink-0">
          <kbd className="mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 group-hover:text-indigo-300 group-hover:border-indigo-500/40 transition-colors">⌘</kbd>
          <kbd className="mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 group-hover:text-indigo-300 group-hover:border-indigo-500/40 transition-colors">K</kbd>
        </span>
      </button>
    </div>
  );
}

/**
 * v43.24 — Master Modu chip:
 * localStorage.gws.master_license set edilmemişse (veya MS- prefix'siz),
 * "Master Modu Aktive Et" butonu gösterir. Tıklandığında MS- key promptu
 * çıkar, localStorage'a yazar ve tüm React Query cache'ini invalidate eder.
 * Set edilmişse yeşil "MASTER" chip gösterir.
 */
function MasterModeToggle() {
  const qc = useQueryClient();
  // Trigger re-render whenever localStorage'a yazılırsa
  const active = typeof window !== "undefined"
    && (localStorage.getItem("gws.master_license") || "").startsWith("MS-");
  const mode = useQuery({ queryKey: ["system-mode"], queryFn: api.systemMode, enabled: active });
  const masterIp = mode.data?.master_ip || "";
  const activate = () => {
    const val = window.prompt(
      "Master Lisans Anahtarınızı Girin (MS- prefix'li 24 karakter):",
      localStorage.getItem("gws.event_license") || ""
    );
    if (!val) return;
    const v = val.trim();
    if (!v.startsWith("MS-")) {
      toast.error("Geçersiz anahtar — MS- ile başlamalı");
      return;
    }
    localStorage.setItem("gws.master_license", v);
    localStorage.setItem("gws.event_license", v);
    localStorage.setItem("gws.license.dismissed", "1");
    toast.success("Master modu aktive edildi — tüm sorgular yenileniyor");
    qc.invalidateQueries();
    setTimeout(() => window.location.reload(), 800);
  };
  const deactivate = () => {
    if (!window.confirm("Master modundan çıkılsın mı? Yazma işlemleri demo kilidiyle korunur.")) return;
    localStorage.removeItem("gws.master_license");
    toast.info("Master modu kapatıldı");
    qc.invalidateQueries();
    setTimeout(() => window.location.reload(), 500);
  };
  if (active) {
    return (
      <button
        type="button"
        data-testid="header-master-active"
        onClick={deactivate}
        title={`Master modu aktif — ${masterIp ? `IP: ${masterIp}` : ""} — kapatmak için tıklayın`}
        className="hidden md:inline-flex items-center gap-1.5 text-[11px] mono font-bold tracking-wide px-2.5 py-1 rounded-md border border-emerald-500/60 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 transition-all shrink-0 shadow-[0_0_10px_rgba(16,185,129,0.35)]"
      >
        <ShieldCheck className="w-3 h-3" />
        <span>MASTER</span>
        {masterIp && <span className="text-[9.5px] text-emerald-400/70 ml-0.5">· {masterIp}</span>}
      </button>
    );
  }
  return (
    <button
      type="button"
      data-testid="header-master-activate"
      onClick={activate}
      title="Yazma işlemleri (toggle, düzenleme, upload) için master lisans gerekli"
      className="hidden md:inline-flex items-center gap-1.5 text-[11px] mono font-bold tracking-wide px-2.5 py-1 rounded-md border border-amber-500/60 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 hover:border-amber-500/80 transition-all shrink-0 animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.35)]"
    >
      <KeyRound className="w-3 h-3" />
      <span>Master Aktif Et</span>
    </button>
  );
}

function MasterUpdatePush() {
  const active = typeof window !== "undefined"
    && (localStorage.getItem("gws.master_license") || "").startsWith("MS-");
  if (!active) return null;
  const push = async () => {
    if (!window.confirm("Master'a bağlı tüm bayilere 'gws-update çalıştır' sinyali gönderilsin mi?")) return;
    try {
      const d = await api.pluginDemandUpdate();
      toast.success(`${d.signaled_licenses} bayiye güncelleme sinyali gönderildi`, { description: d.note, duration: 6000 });
    } catch (e) { toast.error(e?.response?.data?.detail || e.message); }
  };
  return (
    <button
      type="button"
      onClick={push}
      data-testid="header-server-update-btn"
      title="Master'a bağlı tüm bayi WHM sunucularına 'gws-update çalıştır' sinyali gönderir"
      className="hidden md:inline-flex items-center gap-1.5 text-[11px] mono font-bold tracking-wide px-2.5 py-1 rounded-md border border-sky-500/60 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30 transition-all shrink-0 shadow-[0_0_10px_rgba(14,165,233,0.35)]"
    >
      <DownloadCloud className="w-3 h-3" />
      <span>Sunucumu Güncelle</span>
    </button>
  );
}

export default function Header({ title }) {
  return <HeaderMain title={title} />;
}

// v43.90 — Master welcome + last login chip
function WelcomeChip() {
  const who = useQuery({
    queryKey: ["whoami-header"],
    queryFn: () => api.whoami(),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const d = who.data || {};
  if (!d.is_master) return null;
  const name = d.customer_name || "Master";
  const lastIp = d.last_login_ip || "";
  const lastAt = d.last_login_at || "";
  const relTime = lastAt ? formatRelative(lastAt) : "";
  const tooltip = lastAt
    ? `Son giriş: ${lastAt.slice(0, 19)} UTC · IP: ${lastIp || "?"}`
    : "İlk oturum";
  return (
    <div
      data-testid="header-welcome-chip"
      title={tooltip}
      className="hidden lg:flex items-center gap-2 pl-3 pr-3 py-1 rounded-md border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent shadow-[0_0_10px_rgba(16,185,129,0.15)] shrink-0"
    >
      <User2 className="w-3.5 h-3.5 text-emerald-300 shrink-0" strokeWidth={2.2} />
      <div className="flex flex-col leading-none">
        <span className="text-[11px] font-bold text-emerald-200 truncate max-w-[220px]">
          Hoşgeldin, <span className="text-emerald-100">{name}</span>
        </span>
        {lastAt && (
          <span className="text-[9.5px] mono text-emerald-400/70 mt-0.5">
            Son: {relTime}{lastIp ? ` · ${lastIp}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function formatRelative(iso) {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then) / 1000;
    if (diff < 60) return `${Math.floor(diff)}sn önce`;
    if (diff < 3600) return `${Math.floor(diff / 60)}dk önce`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}sa önce`;
    if (diff < 30 * 86400) return `${Math.floor(diff / 86400)}g önce`;
    return iso.slice(0, 10);
  } catch {
    return iso.slice(0, 16);
  }
}

function HeaderMain({ title }) {
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["overview-header"],
    queryFn: api.overview,
    refetchInterval: 15000,
  });
  const ver = useQuery({
    queryKey: ["version-panel"],
    queryFn: api.versionPanel,
    staleTime: 5 * 60 * 1000, // 5 dk (VERSION dosyası nadiren değişir)
    refetchInterval: 60_000,
  });
  const version = ver.data?.version || "";
  const active = data?.engines_active ?? 0;
  const total = data?.engines_total ?? 0;
  const status = active > 0 ? "aktif" : "durduruldu";
  const dot = active > 0 ? "bg-emerald-400 text-emerald-400" : "bg-rose-500 text-rose-500";
  return (
    <header data-testid="app-header" className="sticky top-0 z-30 h-14 border-b border-slate-800 bg-gradient-to-b from-slate-900/95 to-slate-950/90 backdrop-blur px-4 md:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 shrink-0 min-w-0">
        <h1 data-testid="header-page-title" className="text-xl font-black tracking-tight bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-rose-300 bg-clip-text text-transparent truncate drop-shadow-[0_0_6px_rgba(99,102,241,0.35)]">{title}</h1>
        <span className="hidden sm:inline text-[10px] mono tracking-widest font-bold text-indigo-200 uppercase border border-indigo-500/50 bg-indigo-500/10 rounded px-1.5 py-0.5 shrink-0 shadow-[0_0_8px_rgba(99,102,241,0.25)]">
          WHM PLUGIN
        </span>
        {version && (
          <a
            href="/panel/version-publish"
            data-testid="header-version-chip"
            title={`Panel sürümü: ${version} — sürüm notları için tıkla`}
            className="hidden md:inline-flex items-center gap-1.5 text-[11px] mono font-bold tracking-wide px-2 py-1 rounded-md border border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/25 hover:border-fuchsia-500/70 transition-all shrink-0 shadow-[0_0_10px_rgba(217,70,239,0.3)]"
          >
            <Sparkles className="w-3 h-3" />
            <span>{version}</span>
          </a>
        )}
      </div>
      <GlobalSearch />
      <div className="flex items-center gap-3 shrink-0">
        <WelcomeChip />
        <PinPendingBadge />
        <MasterModeToggle />
        <MasterUpdatePush />
        <div className="hidden xl:flex items-center gap-2 text-xs text-slate-400 mono">
          <Clock className="w-3.5 h-3.5" />
          Son 24 saat
        </div>
        <button
          data-testid="refresh-btn"
          onClick={() => refetch()}
          className="text-slate-400 hover:text-slate-100 transition-colors"
          title="Yenile"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
        <ImpersonatePicker />
        <SlashCommandBar />
        <ThreatAlertBell />
        <div data-testid="engine-status" className="flex items-center gap-2 text-xs">
          <span className="relative inline-flex w-2.5 h-2.5">
            <span className={`absolute inset-0 rounded-full ${dot.split(" ")[0]} shadow-[0_0_8px_currentColor]`}></span>
            <span className={`pulse-dot ${dot.split(" ")[1]}`}></span>
          </span>
          <span className="hidden sm:inline mono uppercase tracking-widest font-bold text-slate-200">Motor {status}</span>
          <span className="mono font-bold text-emerald-300">{active}/{total}</span>
        </div>
      </div>
    </header>
  );
}
