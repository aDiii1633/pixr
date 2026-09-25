"use client";
import { useCallback, useRef, useState } from "react";

export type MicError = "denied" | "no_mic" | "unsupported" | "failed";

/** MediaRecorder + RMS level meter + silence auto-stop (UI_UX §5, IMPLEMENTATION_PLAN P6). */
export function useRecorder() {
  const [level, setLevel] = useState(0);
  const r = useRef<{ rec?: MediaRecorder; stream?: MediaStream; ctx?: AudioContext; raf?: number; timer?: number; chunks: Blob[]; heard?: boolean }>({ chunks: [] });

  const cleanup = useCallback(() => {
    const s = r.current;
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.timer) clearTimeout(s.timer);
    s.stream?.getTracks().forEach((t) => t.stop());
    s.ctx?.close().catch(() => {});
    r.current = { chunks: [] };
    setLevel(0);
  }, []);

  /** `waitMs`: how long to wait for speech to begin before auto-stopping. */
  const start = useCallback(async (onAutoStop: () => void, waitMs = 8000) => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw "unsupported" as MicError;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const n = (e as DOMException)?.name;
      throw (n === "NotAllowedError" || n === "SecurityError" ? "denied" : n === "NotFoundError" ? "no_mic" : "failed") as MicError;
    }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const s = r.current = { rec, stream, ctx, chunks: [] as Blob[], raf: 0, timer: 0, heard: false as boolean };
    rec.ondataavailable = (e) => e.data.size && s.chunks.push(e.data);
    rec.start(250);

    let quietSince = 0, last = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      if (t - last > 50) { setLevel(Math.min(1, rms * 8)); last = t; }
      if (rms > 0.035) { s.heard = true; quietSince = 0; }
      else if (s.heard) {
        quietSince ||= t;
        if (t - quietSince > 1300) return onAutoStop(); // 1.3 s of silence after speech
      }
      if (!s.heard && t - t0 > waitMs) return onAutoStop(); // nothing said
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
    s.timer = window.setTimeout(onAutoStop, 30_000);
  }, []);

  /** Resolves the recording, and whether any speech was detected (silence is never sent to STT). */
  const stop = useCallback(() => new Promise<{ blob: Blob | null; heard: boolean }>((resolve) => {
    const s = r.current;
    const heard = Boolean(s.heard);
    if (!s.rec || s.rec.state === "inactive") { cleanup(); return resolve({ blob: null, heard }); }
    const type = s.rec.mimeType || "audio/webm";
    s.rec.onstop = () => {
      const blob = new Blob(s.chunks, { type });
      cleanup();
      resolve({ blob: heard && blob.size > 1200 ? blob : null, heard });
    };
    s.rec.stop();
  }), [cleanup]);

  return { level, start, stop, cancel: cleanup };
}

// Web Speech recognition (Chrome, Edge, Safari, Android Chrome; not Firefox).
type SR = {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: (e: { error?: string }) => void; onend: () => void; start: () => void; stop: () => void; abort: () => void;
};
const srCtor = () => {
  if (typeof window === "undefined") return undefined;
  const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return W.SpeechRecognition ?? W.webkitSpeechRecognition;
};
export const wakeWordSupported = () => Boolean(srCtor());

export const WAKE_RE = /\b(hey|hi|hay|ok|okay|a)[\s,]+(pix(e|a|o)?rs?|picks(er| her)|pixel|pixar)\b/i; // "hey pixr" as engines hear it

/**
 * Listens for "Hey Pixr" while the page is open (foreground tab only — browsers don't allow
 * background wake words). Uses the browser's speech service; restarts itself when the engine
 * times out. Returns a stop function.
 */
export function startWakeWord(onWake: () => void, onBlocked: (reason: string) => void): () => void {
  const Ctor = srCtor();
  if (!Ctor) { onBlocked("unsupported"); return () => {}; }
  let active = true, sr: SR | null = null, backoff = 250;
  const boot = () => {
    if (!active) return;
    sr = new Ctor();
    sr.continuous = true; sr.interimResults = true; sr.lang = "en-US";
    sr.onresult = (e) => {
      const heard = Array.from(e.results).map((x) => x[0]?.transcript ?? "").join(" ");
      if (WAKE_RE.test(heard)) { active = false; try { sr?.abort(); } catch { /* already stopped */ } onWake(); }
      backoff = 250;
    };
    sr.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { active = false; onBlocked("denied"); }
      else if (e.error === "network") backoff = Math.min(backoff * 2, 8000);
    };
    sr.onend = () => { if (active) setTimeout(boot, backoff); }; // engines end after silence; keep listening
    try { sr.start(); } catch { setTimeout(boot, 1000); }
  };
  boot();
  return () => { active = false; try { sr?.abort(); } catch { /* not running */ } };
}

// Display-only live transcript where the browser offers it (Chrome/Edge/Android). Whisper gives the final text.
export function startInterim(onText: (t: string) => void): (() => void) | null {
  const Ctor = srCtor();
  if (!Ctor) return null;
  try {
    const sr = new Ctor();
    sr.continuous = true; sr.interimResults = true; sr.lang = "en-US";
    sr.onresult = (e) => onText(Array.from(e.results).map((r) => r[0]?.transcript ?? "").join(" "));
    sr.onerror = () => {};
    sr.start();
    return () => { try { sr.stop(); } catch { /* already stopped */ } };
  } catch { return null; }
}

export function speak(text: string, onEnd: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) return onEnd();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  u.voice = voices.find((v) => /en[-_](US|GB|IN)/i.test(v.lang) && /natural|google|samantha|aria|jenny/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
  u.rate = 1.05;
  let done = false;
  const end = () => { if (!done) { done = true; onEnd(); } };
  u.onend = end; u.onerror = end;
  window.speechSynthesis.speak(u);
  // Some browsers never fire onend; cap by length.
  setTimeout(end, Math.max(4000, text.length * 90));
}

export const stopSpeaking = () => { if (typeof window !== "undefined") window.speechSynthesis?.cancel(); };
