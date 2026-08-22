/**
 * useNarrator — v44.00.03
 *
 * Free browser-based Turkish narration using Web Speech API
 * (window.speechSynthesis). No 3rd-party API, no cost, works offline.
 *
 * Usage:
 *   const { speak, cancel, muted, setMuted, ready, voice } = useNarrator({
 *     lang: "tr-TR",
 *     rate: 1.0,
 *     pitch: 1.0,
 *   });
 *
 *   useEffect(() => { speak("Merhaba, bu bir Türkçe anlatımdır."); }, [idx]);
 *
 * Notes:
 *  · Voice list loads asynchronously in Chrome — we listen to `voiceschanged`.
 *  · `speechSynthesis.cancel()` prevents overlap when slides advance quickly.
 *  · Mute state persisted in localStorage as `gws.narrator.muted`.
 *  · Falls back gracefully when browser lacks tr-TR voice — the first
 *    multilingual voice will still speak with a foreign accent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MUTE_KEY = "gws.narrator.muted";

function pickBestVoice(voices, lang = "tr-TR") {
  if (!voices || !voices.length) return null;
  // 1) Exact tr-TR
  const exact = voices.find(v => (v.lang || "").toLowerCase() === lang.toLowerCase());
  if (exact) return exact;
  // 2) Any tr-*
  const langPrefix = lang.split("-")[0].toLowerCase();
  const prefix = voices.find(v => (v.lang || "").toLowerCase().startsWith(langPrefix));
  if (prefix) return prefix;
  // 3) Multilingual fallback (rare)
  const multi = voices.find(v => (v.name || "").toLowerCase().includes("multilingual"));
  if (multi) return multi;
  return voices[0] || null;
}

export function useNarrator({ lang = "tr-TR", rate = 1.0, pitch = 1.0 } = {}) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [voices, setVoices] = useState([]);
  const [muted, setMutedState] = useState(() => {
    try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
  });
  const utterRef = useRef(null);

  const setMuted = useCallback((v) => {
    setMutedState(v);
    try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch {}
    if (v && supported) window.speechSynthesis.cancel();
  }, [supported]);

  // Load voices (Chrome loads async)
  useEffect(() => {
    if (!supported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices() || []);
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, [supported]);

  const voice = useMemo(() => pickBestVoice(voices, lang), [voices, lang]);
  const ready = supported && voices.length > 0;

  const cancel = useCallback(() => {
    if (!supported) return;
    try { window.speechSynthesis.cancel(); } catch {}
  }, [supported]);

  const speak = useCallback((text) => {
    if (!supported || !text || muted) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = voice?.lang || lang;
      if (voice) u.voice = voice;
      u.rate = rate;
      u.pitch = pitch;
      u.volume = 1.0;
      utterRef.current = u;
      window.speechSynthesis.speak(u);
    } catch (_) { /* ignore */ }
  }, [supported, muted, voice, lang, rate, pitch]);

  // Cleanup on unmount
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch {} }, []);

  return { supported, ready, voice, voices, muted, setMuted, speak, cancel };
}
