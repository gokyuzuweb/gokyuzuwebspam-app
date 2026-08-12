/**
 * Basit i18n katmanı — GökyüzüWebSpam
 *
 * Kullanım:
 *   import { useT } from "@/i18n";
 *   const t = useT();
 *   <h1>{t("dashboard.title")}</h1>
 *
 * Dil değiştirmek için: Ayarlar → Arayüz Dili → tr/en/de/fr/es/ar
 * "auto" seçilirse cPanel'in aktif dilini takip eder (WHM CGI proxy X-Cpanel-Language
 * header'ı ile gelir). Preview ortamında varsayılan tr.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API } from "@/lib/api";
import { STRINGS } from "@/i18n/strings";

const I18nContext = createContext({ lang: "tr", setLang: () => {}, t: (k) => k });

export function I18nProvider({ children }) {
  // GökyüzüWebSpam Türkiye pazarı için default TR — kullanıcı language selector'dan
  // istediği zaman değiştirebilir; browser diline dönmek için "auto" seçilir.
  const [lang, setLang] = useState(() => localStorage.getItem("gws.lang") || "tr");
  const [effective, setEffective] = useState("tr");

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (lang !== "auto") {
        setEffective(lang);
        return;
      }
      try {
        // Preview: try navigator.language then fall back to server /i18n/effective
        const nav = (navigator.language || "tr").slice(0, 2).toLowerCase();
        const r = await axios.get(`${API}/i18n/effective`, { params: { cpanel_lang: nav } });
        if (!cancelled) setEffective(r.data.language || "tr");
      } catch {
        if (!cancelled) setEffective("tr");
      }
    }
    resolve();
    return () => { cancelled = true; };
  }, [lang]);

  useEffect(() => { localStorage.setItem("gws.lang", lang); }, [lang]);

  const t = useMemo(() => {
    const dict = STRINGS[effective] || STRINGS.tr;
    const fallback = STRINGS.tr;
    return (key, params) => {
      const parts = key.split(".");
      let cur = dict;
      for (const p of parts) cur = cur?.[p];
      if (cur === undefined) {
        let f = fallback;
        for (const p of parts) f = f?.[p];
        cur = f;
      }
      if (cur === undefined) return key;
      if (params && typeof cur === "string") {
        return cur.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
      }
      return cur;
    };
  }, [effective]);

  return (
    <I18nContext.Provider value={{ lang, setLang, effective, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useT() { return useContext(I18nContext).t; }
export function useI18n() { return useContext(I18nContext); }
