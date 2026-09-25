"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CircleAlert, CircleHelp, ExternalLink, Keyboard, LoaderCircle, Mic, Minus, MousePointer2, Pencil, Radio, Sparkles, X } from "lucide-react";
import { speak, startInterim, startWakeWord, stopSpeaking, useRecorder, wakeWordSupported, type MicError } from "./voice";
import { getWake } from "./local";
import type { AgentEvent, AskPayload, ConfirmPayload, IntegrationStatus, Outcome, PlanStep, Proposal, UiState } from "@/lib/types";

// ---------------------------------------------------------------------------
type Turn = { role: "user" | "agent"; text: string; via?: "voice" | "text" };
type Final = { spoken: string; outcomes: Outcome[]; proposals: Proposal[]; status: "completed" | "failed" | "cancelled" };
type Prefs = { hands_free: boolean; speak_responses: boolean; timezone: string | null };

const SESSION_KEY = "relay.session";
const NO_SPEECH = "I didn't hear anything. You can speak whenever you're ready.";
type WakeState = "off" | "armed" | "needs-tap" | "denied" | "unsupported";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
export function currentSession() {
  let s = store.get(SESSION_KEY);
  if (!s) { s = crypto.randomUUID(); store.set(SESSION_KEY, s); }
  return s;
}

const MIC_MSG: Record<MicError, string> = {
  denied: "Microphone access is blocked. Allow it in your browser's site settings (lock icon → Microphone), or type instead.",
  no_mic: "I couldn't find a microphone. Plug one in or type instead.",
  unsupported: "This browser can't record audio here. You can type instead.",
  failed: "The microphone didn't start. Try again or type instead.",
};


async function streamAgent(body: unknown, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
  let res: Response;
  try { res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }); }
  catch { if (signal?.aborted) return; onEvent({ type: "error", userMessage: "You seem to be offline. Check your connection and try again." }); return; }
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    onEvent({ type: "error", userMessage: j.error ?? "Something went wrong. Please try again." });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    if (signal?.aborted) { reader.cancel().catch(() => {}); return; }
    const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true as const }));
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
      buf = buf.slice(i + 2);
      if (line) { try { onEvent(JSON.parse(line.slice(6))); } catch { /* partial */ } }
    }
  }
}

// ===========================================================================
export default function Assistant({ variant = "home" }: { variant?: "home" | "compact" }) {
  const [sessionId, setSessionId] = useState<string>("");
  const [ui, setUi] = useState<UiState>("IDLE");
  const [label, setLabel] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [ask, setAsk] = useState<AskPayload | null>(null);
  const [confirm, setConfirm] = useState<ConfirmPayload | null>(null);
  const [final, setFinal] = useState<Final | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [prefs, setPrefs] = useState<Prefs>({ hands_free: true, speak_responses: true, timezone: null });
  const [apps, setApps] = useState<IntegrationStatus[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [wake, setWake] = useState<WakeState>("off");
  const [wakeOn, setWakeOn] = useState(true);
  const [visible, setVisible] = useState(true);
  const rec = useRecorder();
  const r = useRef({
    listening: false, stopInterim: null as null | (() => void), ask: null as AskPayload | null, finish: (() => {}) as () => void, prefs, busy: false,
    speaking: false, wantListen: false, lastVia: "text" as "voice" | "text", followUp: false, abort: null as AbortController | null,
  });
  r.current.ask = ask; r.current.prefs = prefs; r.current.busy = busy;
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    const sid = currentSession();
    setSessionId(sid);
    const q = new URLSearchParams(location.search).get("q");
    if (q) setTyped(q.slice(0, 2000));
    try { setTurns(JSON.parse(store.get(`relay.turns.${sid}`) ?? "[]")); } catch { /* ignore */ }
    fetch("/api/state?kind=prefs").then((x) => x.json()).then((p: Prefs) => {
      setPrefs(p);
      if (!p.timezone) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: tz }) });
      }
    }).catch(() => {});
    fetch("/api/integrations").then((x) => x.json()).then(setApps).catch(() => {});
    // Resume a task that was waiting on the user before a reload (T-RESUME).
    fetch(`/api/agent?sessionId=${sid}`).then((x) => x.json()).then((s: { pending: AskPayload | ConfirmPayload | null; task: { plan?: PlanStep[]; status?: string } | null }) => {
      if (s.task?.plan && s.task.status && !["completed", "failed", "cancelled"].includes(s.task.status)) setPlan(s.task.plan);
      if (s.pending?.kind === "ask") { setAsk(s.pending); setUi("ASKING"); }
      if (s.pending?.kind === "confirm") { setConfirm(s.pending); setUi("CONFIRMATION"); }
    }).catch(() => {});
    const onNew = () => {
      r.current.abort?.abort();
      r.current.abort = null;
      r.current.wantListen = false; r.current.followUp = false;
      if (r.current.listening) { r.current.listening = false; r.current.stopInterim?.(); rec.cancel(); }
      stopSpeaking(); r.current.speaking = false;
      r.current.busy = false; setBusy(false);
      const s = crypto.randomUUID();
      store.set(SESSION_KEY, s);
      setSessionId(s); setTurns([]); setPlan([]); setAsk(null); setConfirm(null); setFinal(null);
      setError(null); setNotice(null); setTyped(""); setInterim(""); setLabel(""); setUi("IDLE");
    };
    window.addEventListener("relay:new-session", onNew);
    return () => window.removeEventListener("relay:new-session", onNew);
  }, []);

  useEffect(() => { if (sessionId) store.set(`relay.turns.${sessionId}`, JSON.stringify(turns.slice(-30))); }, [turns, sessionId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns.length, ask, confirm, final, plan.length]);

  const addTurn = (t: Turn) => setTurns((xs) => [...xs, t]);

  const speakThen = useCallback((text: string, after: () => void) => {
    if (!r.current.prefs.speak_responses || !text) return after();
    setUi("SPEAKING");
    r.current.speaking = true;
    speak(text, () => { r.current.speaking = false; after(); });
  }, []);

  // ---------------------------------------------------------------- listening
  const listen = useCallback(async () => {
    if (r.current.listening || r.current.busy) return;
    stopSpeaking();
    setError(null); setNotice(null); setInterim("");
    try {
      // Follow-up answers get a little longer to start speaking.
      await rec.start(() => r.current.finish(), r.current.followUp ? 10_000 : 8_000);
    } catch (e) {
      setError(MIC_MSG[(e as MicError) ?? "failed"] ?? MIC_MSG.failed);
      setUi("ERROR");
      return;
    }
    r.current.listening = true;
    r.current.stopInterim = startInterim(setInterim);
    setUi("LISTENING");
    if (navigator.vibrate) navigator.vibrate(10);
  }, [rec]);

  const handleEvent = useCallback((e: AgentEvent) => {
    switch (e.type) {
      case "state":
        if (e.state !== "SUCCESS" && e.state !== "ERROR") setUi(e.state);
        setLabel(e.label ?? "");
        break;
      case "plan":
        setPlan((old) => e.steps.map((s) => ({ ...s, status: old.find((o) => o.id === s.id)?.status ?? s.status })));
        break;
      case "step":
        setPlan((old) => (old.some((s) => s.id === e.step.id) ? old.map((s) => (s.id === e.step.id ? { ...s, ...e.step } : s)) : [...old, e.step]));
        break;
      case "ask":
        setAsk(e.payload);
        addTurn({ role: "agent", text: e.payload.question });
        // Voice conversation: keep the mic on for the answer (the task resumes from its checkpoint).
        r.current.wantListen = r.current.prefs.hands_free && r.current.lastVia === "voice";
        speakThen(e.payload.question, () => {
          setUi("ASKING");
          if (r.current.wantListen) maybeListenRef.current();
          else setTimeout(() => inputRef.current?.focus(), 50);
        });
        break;
      case "confirm":
        setConfirm(e.payload);
        setUi("CONFIRMATION");
        if (r.current.prefs.speak_responses) speak(e.payload.title, () => {});
        break;
      case "final":
        setFinal(e);
        addTurn({ role: "agent", text: e.spoken });
        speakThen(e.spoken, () => {
          setUi(e.status === "failed" ? "ERROR" : "SUCCESS");
          setTimeout(() => setUi((u) => (u === "SUCCESS" || u === "ERROR" ? "IDLE" : u)), 1600);
        });
        break;
      case "error":
        setError(e.userMessage);
        addTurn({ role: "agent", text: e.userMessage });
        speakThen(e.userMessage, () => setUi("ERROR"));
        break;
    }
  }, [speakThen]);

  const run = useCallback(async (body: Record<string, unknown>) => {
    const ctl = new AbortController();
    r.current.abort = ctl;
    setBusy(true); r.current.busy = true;
    await streamAgent({ sessionId: currentSession(), ...body }, (e) => { if (!ctl.signal.aborted) handleEvent(e); }, ctl.signal);
    if (ctl.signal.aborted) return; // a new conversation started meanwhile
    setBusy(false); r.current.busy = false;
    maybeListenRef.current(); // a follow-up question may have arrived while the stream was open
  }, [handleEvent]);

  const submit = useCallback(async (text: string, via: "voice" | "text") => {
    const t = text.trim();
    if (!t || r.current.busy) return;
    r.current.lastVia = via;
    addTurn({ role: "user", text: t, via });
    setTyped(""); setError(null);
    if (r.current.ask) {
      setAsk(null); setUi("THINKING");
      await run({ resume: { kind: "answer", value: t } });
    } else {
      setPlan([]); setFinal(null); setUi("THINKING"); setLabel("Understanding your request");
      await run({ input: { text: t, via } });
    }
  }, [run]);

  r.current.finish = async () => {
    if (!r.current.listening) return;
    r.current.listening = false;
    r.current.followUp = false;
    r.current.stopInterim?.();
    const { blob, heard } = await rec.stop();
    setInterim("");
    if (navigator.vibrate) navigator.vibrate(10);
    if (!heard) {
      // Timed out waiting for speech: say so, go idle. A pending question stays open — answer any time.
      setNotice(NO_SPEECH);
      speakThen(NO_SPEECH, () => setUi("IDLE"));
      return;
    }
    if (!blob) { setUi(r.current.ask ? "ASKING" : "IDLE"); setError("I didn't catch that. Try again or type it."); return; }
    setUi("THINKING"); setLabel("Transcribing");
    const fd = new FormData();
    fd.append("audio", blob, "speech");
    try {
      const res = await fetch("/api/stt", { method: "POST", body: fd });
      const j = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || j.error) throw new Error(j.error ?? "stt");
      if (!j.text) { setUi(r.current.ask ? "ASKING" : "IDLE"); setError("I didn't catch that. Try again or type it."); return; }
      await submit(j.text, "voice");
    } catch (e) {
      setError(e instanceof Error && e.message !== "stt" ? e.message : "I couldn't transcribe that. Try again or type it.");
      setUi("ERROR");
    }
  };
  const listenRef = useRef(listen);
  listenRef.current = listen;
  // Start the follow-up listen once the turn has finished streaming and the question was spoken.
  const maybeListenRef = useRef(() => {});
  maybeListenRef.current = () => {
    if (!r.current.wantListen || r.current.busy || r.current.speaking || r.current.listening) return;
    r.current.wantListen = false;
    r.current.followUp = true;
    setTimeout(() => listenRef.current(), 120);
  };

  // ---------------------------------------------------------------- "Hey Pixr" wake word
  useEffect(() => {
    setWakeOn(getWake());
    if (!wakeWordSupported()) { setWake("unsupported"); return; }
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    // Only auto-start when the mic is already allowed; otherwise ask for one tap (no surprise prompts).
    navigator.permissions?.query({ name: "microphone" as PermissionName })
      .then((p) => { setWake(p.state === "granted" ? "armed" : p.state === "denied" ? "denied" : "needs-tap"); p.onchange = () => setWake(p.state === "granted" ? "armed" : p.state === "denied" ? "denied" : "needs-tap"); })
      .catch(() => setWake("needs-tap"));
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const resting = ui === "IDLE" || ui === "SUCCESS" || ui === "ERROR" || ui === "ASKING";
  const wakeListening = wakeOn && wake === "armed" && visible && resting && !busy && !confirm && !r.current.listening;
  useEffect(() => {
    if (!wakeListening) return;
    return startWakeWord(
      () => { if (navigator.vibrate) navigator.vibrate([10, 40, 10]); r.current.lastVia = "voice"; r.current.followUp = Boolean(r.current.ask); listenRef.current(); },
      (why) => setWake(why === "denied" ? "denied" : "unsupported"),
    );
  }, [wakeListening]);

  const pressOrb = () => {
    if (ui === "LISTENING") return r.current.finish();
    if (ui === "SPEAKING") { stopSpeaking(); return listen(); }
    if (busy || confirm) return;
    listen();
  };

  const decide = async (decision: "approve" | "cancel" | "edit", edits?: Record<string, string>) => {
    const c = confirm;
    setConfirm(null);
    addTurn({ role: "user", text: decision === "cancel" ? "Cancel" : decision === "edit" ? "Send with my edits" : `${c?.verb ?? "Confirm"}` });
    setUi("EXECUTING");
    await run({ resume: { kind: "confirm", decision, edits } });
  };

  // Keyboard: Space toggles listening when nothing is focused; Esc stops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape" && r.current.listening) { e.preventDefault(); r.current.finish(); }
      if (e.code === "Space" && !typing && !e.repeat && (el === document.body || el?.dataset.orb) && !confirm) { e.preventDefault(); pressOrb(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const connected = apps.filter((a) => a.status === "connected");

  // ---------------------------------------------------------------- render
  const status = (
    <div className="sr-only" aria-live="polite">{ui === "LISTENING" ? "Listening" : ui === "THINKING" || ui === "EXECUTING" ? label || "Working on it" : ""}</div>
  );

  const stage = (
    <div className="flex flex-col gap-4">
      {turns.map((t, i) => (
        <div key={i} className={`rise flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
          {t.role === "user" ? (
            <div className="card max-w-[85%] px-4 py-3 text-ink">
              <span className="mr-2 inline-flex translate-y-0.5 text-ink-3" aria-hidden>{t.via === "voice" ? <Mic size={14} /> : <Keyboard size={14} />}</span>
              {t.text}
            </div>
          ) : (
            <div className="flex max-w-[90%] items-start gap-3">
              <span className="orb mt-1 h-6 w-10 shrink-0" aria-hidden />
              <div>
                <p className="text-[18px] leading-relaxed text-ink">{t.text}</p>
                {/isn['’]?t connected|Apps page|reconnect/i.test(t.text) && <a href="/apps" className="btn btn-primary mt-3 min-h-10">Open Apps</a>}
              </div>
            </div>
          )}
        </div>
      ))}

      {ui === "LISTENING" && (
        <div className="rise flex justify-end" aria-hidden>
          <div className="max-w-[85%] rounded-3xl border-2 border-dashed border-line px-4 py-3 italic text-ink-3">{interim || "Listening…"}</div>
        </div>
      )}
      {(ui === "THINKING" || ui === "EXECUTING") && (
        <div className="flex items-center gap-2 text-ink-3"><LoaderCircle size={16} className="spin" aria-hidden /> {label || "Working on it"}…</div>
      )}

      {plan.length > 0 && <div className="xl:hidden"><Timeline plan={plan} /></div>}

      {notice && ui !== "LISTENING" && (
        <div className="rise flex items-start gap-3" role="status">
          <span className="orb mt-1 h-6 w-10 shrink-0" aria-hidden />
          <p className="text-[18px] leading-relaxed text-ink-2">{notice}</p>
        </div>
      )}
      {ask && !busy && <AskCard ask={ask} onAnswer={(v) => submit(v, "text")} onVoice={() => { r.current.followUp = true; r.current.lastVia = "voice"; listen(); }} listening={ui === "LISTENING"} inputRef={inputRef} />}
      {final && !busy && !ask && <OutcomeCard final={final} />}
      {error && !busy && ui !== "LISTENING" && (
        <div role="alert" className="card flex items-start gap-3 border-l-4 border-coral p-4">
          <CircleAlert className="mt-0.5 shrink-0 text-coral" size={20} aria-hidden />
          <div className="flex-1">
            <p className="text-ink">{error}</p>
            {/connect|Apps page|expired/i.test(error) && <a href="/apps" className="link mt-2 inline-block">Open Apps</a>}
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );

  const active = turns.length > 0 || ui !== "IDLE" || Boolean(ask || confirm);
  const dock = (
    <form className="flex items-center gap-3" onSubmit={(e) => { e.preventDefault(); submit(typed, "text"); }}>
      <label htmlFor={`type-${variant}`} className="sr-only">Type a request</label>
      <input
        id={`type-${variant}`} ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy || Boolean(confirm)}
        placeholder={ask ? "Type your answer…" : "Say “Hey Pixr” or type what you want…"}
        className="field flex-1 rounded-full px-5" autoComplete="off" type={ask?.inputHint === "email" ? "email" : "text"} inputMode={ask?.inputHint === "email" ? "email" : undefined}
      />
      {(active || variant === "compact") && <Orb state={ui} level={rec.level} size="dock" onPress={pressOrb} disabled={Boolean(confirm) || (busy && ui !== "SPEAKING")} />}
      <button type="submit" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink text-white transition active:scale-95 disabled:opacity-40" disabled={!typed.trim() || busy} aria-label="Send">
        <ArrowRight size={22} />
      </button>
    </form>
  );

  const confirmSheet = confirm && <ConfirmSheet c={confirm} onDecide={decide} />;

  const armWake = () => navigator.mediaDevices?.getUserMedia({ audio: true })
    .then((s) => { s.getTracks().forEach((t) => t.stop()); setWake("armed"); })
    .catch(() => setWake("denied"));
  const wakeChip = !wakeOn || wake === "unsupported" || wake === "off" ? null
    : wake === "needs-tap" ? <button type="button" onClick={armWake} className="hx-live hx-live-tap" title="Allow the microphone so “Hey Pixr” works">HEY PIXR</button>
    : wake === "denied" ? <span className="hx-live hx-live-off" title="“Hey Pixr” needs microphone access (site settings)">MIC OFF</span>
    : <span className={`hx-live ${wakeListening ? "" : "hx-live-off"}`} title={wakeListening ? "Listening for “Hey Pixr”" : "“Hey Pixr” paused while I work"}>
        LIVE <Radio size={18} className={wakeListening ? "animate-pulse" : ""} aria-hidden />
        <span className="sr-only">{wakeListening ? "Listening for Hey Pixr" : "Hey Pixr paused"}</span>
      </span>;

  if (variant === "compact") {
    return (
      <div className="flex h-full flex-col">
        {status}
        <div className="flex-1 overflow-y-auto p-4">{active ? stage : <p className="py-8 text-center text-ink-3">Tell me what you want. Tap the orb or type.</p>}</div>
        {plan.length > 0 && <div className="hidden max-h-48 overflow-y-auto border-t border-line p-4 xl:block"><Timeline plan={plan} /></div>}
        <div className="border-t border-line p-3">{dock}{wakeChip && <div className="mt-2 flex justify-center">{wakeChip}</div>}</div>
        {confirmSheet}
      </div>
    );
  }

  return (
    <div className={active ? "relative" : "relative h-full"}>
      {status}
      {!active ? (
        <Hero ui={ui} level={rec.level} onOrb={pressOrb} onType={() => inputRef.current?.focus()} handsFree={prefs.hands_free}
          onHandsFree={() => { const v = !prefs.hands_free; setPrefs({ ...prefs, hands_free: v }); fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ hands_free: v }) }); }}
          apps={apps} connected={connected.length} dock={dock} wakeBadge={wakeChip} />
      ) : (
        <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-40 pt-6 md:px-8 xl:grid-cols-[1fr_320px]">
          <div className="mx-auto w-full max-w-3xl">{stage}</div>
          <aside className="hidden xl:block">
            <div className="sticky top-6">{plan.length > 0 ? <Timeline plan={plan} /> : <p className="text-sm text-ink-3">Steps appear here as I work.</p>}</div>
          </aside>
        </div>
      )}
      {active && (
        <div className="fixed inset-x-0 bottom-[72px] z-20 mx-auto max-w-3xl px-4 md:bottom-6">
          {wakeChip && <div className="mb-2 flex justify-center">{wakeChip}</div>}
          <div className="glass rounded-full p-2">{dock}</div>
        </div>
      )}
      {confirmSheet}
    </div>
  );
}

// ===========================================================================
// Orb — gradient pill + glossy knob; encodes every UI state (UI_UX §5)
// ===========================================================================
export function Orb({ state, level = 0, size, onPress, disabled }: { state: UiState; level?: number; size: "hero" | "dock"; onPress: () => void; disabled?: boolean }) {
  const hero = size === "hero";
  const w = hero ? 220 : 88, h = hero ? 108 : 52, k = hero ? 88 : 40;
  const left = state === "LISTENING" ? 10 : state === "IDLE" || state === "SUCCESS" || state === "ERROR" ? w - k - 10 : (w - k) / 2;
  const aria = state === "LISTENING" ? "Stop listening" : state === "SPEAKING" ? "Stop speaking and listen" : "Start listening";
  const R = k / 2 + 5, C = 2 * Math.PI * R;
  return (
    <button type="button" data-orb="1" data-state={state} onClick={onPress} disabled={disabled} aria-label={aria} aria-pressed={state === "LISTENING"}
      className="orb shrink-0 disabled:opacity-60" style={{ width: w, height: h }}>
      <span className="orb-knob" style={{ width: k, height: k, left }}>
        {state === "LISTENING" && (
          <svg className="absolute -inset-[6px] -rotate-90" width={k + 12} height={k + 12} aria-hidden>
            <circle cx={(k + 12) / 2} cy={(k + 12) / 2} r={R} fill="none" stroke="#3563f0" strokeWidth={3} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.08, level))} style={{ transition: "stroke-dashoffset 60ms linear" }} />
          </svg>
        )}
        {(state === "THINKING" || state === "EXECUTING") && (
          <svg className="spin absolute -inset-[6px]" width={k + 12} height={k + 12} aria-hidden>
            <circle cx={(k + 12) / 2} cy={(k + 12) / 2} r={R} fill="none" stroke="#3563f0" strokeWidth={3} strokeLinecap="round" strokeDasharray={`${C * 0.28} ${C}`} />
          </svg>
        )}
        {state === "SPEAKING" ? <span className="wave" aria-hidden><span /><span /><span /><span /><span /></span>
          : state === "SUCCESS" ? <Check size={hero ? 36 : 20} className="text-onfill" aria-hidden />
          : state === "ERROR" ? <CircleAlert size={hero ? 34 : 20} className="text-onfill" aria-hidden />
          : state === "ASKING" ? <CircleHelp size={hero ? 34 : 20} className="text-onfill" aria-hidden />
          : <Mic size={hero ? 32 : 18} className={state === "LISTENING" ? "text-[#3563f0]" : "text-[#3e3d48]"} aria-hidden />}
      </span>
    </button>
  );
}

// ===========================================================================
// Hero — reference layout: stacked capsule headline whose widgets are the real controls
// ===========================================================================
const STATUS_TEXT: Record<UiState, string> = {
  IDLE: "Ready · say “Hey Pixr”", LISTENING: "Listening…", THINKING: "Thinking…", EXECUTING: "Working on it…", ASKING: "Waiting for your answer",
  CONFIRMATION: "Needs your OK", SPEAKING: "Speaking", SUCCESS: "Done", ERROR: "Needs attention",
};

function MicCircle({ ui, level, onPress }: { ui: UiState; level: number; onPress: () => void }) {
  const C = 2 * Math.PI * 46;
  const label = ui === "LISTENING" ? "Stop listening" : ui === "SPEAKING" ? "Stop speaking and listen" : "Start listening";
  return (
    <button type="button" data-orb="1" data-live={ui === "LISTENING" ? "1" : "0"} onClick={onPress} aria-label={label} aria-pressed={ui === "LISTENING"} className="hx-circle hx-mic">
      {ui === "LISTENING" && (
        <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="46" fill="none" stroke="#ff4f14" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0.1, level))} />
        </svg>
      )}
      {(ui === "THINKING" || ui === "EXECUTING") && (
        <svg className="spin absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="46" fill="none" stroke="#ff4f14" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${C * 0.28} ${C}`} />
        </svg>
      )}
      {ui === "SPEAKING" ? <span className="wave" aria-hidden><span /><span /><span /><span /><span /></span>
        : ui === "SUCCESS" ? <Check aria-hidden className="text-[#1f9d52]" />
        : ui === "ERROR" ? <CircleAlert aria-hidden className="text-[#cc3a0c]" />
        : ui === "ASKING" ? <CircleHelp aria-hidden />
        : <Mic aria-hidden className={ui === "LISTENING" ? "text-[#ff4f14]" : ""} />}
    </button>
  );
}

function Hero({ ui, level, onOrb, onType, handsFree, onHandsFree, apps, connected, dock, wakeBadge }: {
  ui: UiState; level: number; onOrb: () => void; onType: () => void; handsFree: boolean; onHandsFree: () => void;
  apps: IntegrationStatus[]; connected: number; dock: React.ReactNode; wakeBadge: React.ReactNode;
}) {
  const on = apps.filter((a) => a.status === "connected");
  const logos = (on.length ? on : apps).slice(0, 5);
  const busy = ui === "THINKING" || ui === "EXECUTING";
  return (
    <section className="flex h-full min-h-0 flex-col px-5 pb-3 md:px-10 md:pb-5">
      <h1 className="sr-only">Hey Pixr — tell me what you want, I&apos;ll do it.</h1>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {/* confetti dots, as in the reference */}
        <span className="hx-dot left-[16%] top-[28%] h-2 w-2 bg-green" aria-hidden />
        <span className="hx-dot left-[18%] top-[36%] h-1.5 w-1.5 bg-orange" aria-hidden />
        <span className="hx-dot left-[10%] top-[44%] h-1.5 w-1.5 bg-green" aria-hidden />
        <span className="hx-dot left-[22%] top-[60%] h-4 w-4 bg-orange" aria-hidden />
        <span className="hx-dot left-[14%] top-[78%] h-3.5 w-3.5 bg-orange" aria-hidden />
        <span className="hx-dot right-[20%] top-[74%] h-1.5 w-1.5 bg-ink" aria-hidden />
        <span className="hx-dot right-[14%] top-[66%] h-2.5 w-2.5 bg-green" aria-hidden />
        <span className="hx-dot right-[16%] top-[80%] h-4 w-4 bg-orange" aria-hidden />

        <div className="hx-rows lowercase">
          <div className="hx-row" style={{ marginLeft: "0.9em" }}>
            <span className="hx-cap hx-cap-fade">
              <span className="hx-pill">hey pixr</span>
              <MicCircle ui={ui} level={level} onPress={onOrb} />
            </span>
          </div>
          <div className="hx-row">
            <span className="hx-cap hx-cap-solid">
              <span className="hx-on-orange">tell me</span>
              <span className="hx-circle" aria-hidden><span className={`hx-sphere ${busy ? "hx-sphere-busy" : ""}`} /></span>
            </span>
            <span className="hx-bubble hidden sm:inline-flex" aria-hidden>
              <span className="hx-chip">
                <span className="hx-chip-logo" />
                <span className="hx-chip-text normal-case"><b>Pixr Agent</b><small>{STATUS_TEXT[ui]}</small></span>
              </span>
            </span>
          </div>
          <div className="hx-row" style={{ marginLeft: "1.3em" }}>
            <span className="hx-circle hx-circle-orange" aria-hidden><Sparkles /></span>
            <span className="relative">
              <span className="hx-pill hx-pill-outline"><span className="hx-fade-text">i&apos;ll do it</span></span>
              <svg className="absolute left-[calc(100%+0.12em)] top-1/2 hidden h-[1.4em] w-[2.6em] -translate-y-[0.09em] md:block" viewBox="0 0 120 70" fill="none" aria-hidden>
              <circle cx="6" cy="6" r="5" fill="#ffc21a" stroke="#ff4f14" strokeWidth="2" />
              <path d="M12 6 H96 Q112 6 112 22 V50 Q112 64 96 64 H70" stroke="#8f8f8f" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" />
              </svg>
            </span>
          </div>
          <div className="hx-row" style={{ marginLeft: "2.7em" }}>
            <span className="hx-cap hx-cap-solid">
              <button type="button" onClick={onType} className="hx-circle hx-circle-beige" aria-label="Type instead" title="Type instead"><Keyboard /></button>
              <button type="button" role="switch" aria-checked={handsFree} onClick={onHandsFree} className="hx-circle hx-circle-black" aria-label="Hands-free follow-ups" title={handsFree ? "Hands-free on: I keep listening after I ask" : "Hands-free off"}>
                <span className={`hx-ring ${handsFree ? "on" : ""}`} />
              </button>
              <a href="/apps" className="hx-circle" aria-label="Connect apps" title="Connect apps"><MousePointer2 /></a>
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-1 py-2 md:gap-x-16">
        {logos.map((a, i) => (
          <a key={a.id} href="/apps" className={`hx-logo hx-logo-${"abcde"[i % 5]}`} title={`${a.name}: ${a.status === "connected" ? "connected" : "not connected"}`}>
            {a.name.replace(/^Google /, "").toLowerCase()}
          </a>
        ))}
      </div>

      <div className="flex flex-col gap-3 pt-2 md:flex-row md:items-center md:gap-8">
        <div className="flex items-center gap-7">
          <div><p className="font-display text-2xl font-bold leading-none md:text-3xl">{connected}+</p><p className="text-sm text-ink-2">Apps live</p></div>
          <div><p className="font-display text-2xl font-bold leading-none md:text-3xl">{apps.length || 14}</p><p className="text-sm text-ink-2">Integrations</p></div>
          {wakeBadge}
        </div>
        <div className="min-w-0 flex-1">{dock}</div>
      </div>
    </section>
  );
}

// ===========================================================================
// Timeline — dashed connector with nodes (reference's flow path)
// ===========================================================================
function StepIcon({ s }: { s: PlanStep["status"] }) {
  if (s === "done") return <span className="grid h-7 w-7 place-items-center rounded-full bg-green text-onfill"><Check size={16} strokeWidth={3} /></span>;
  if (s === "failed") return <span className="grid h-7 w-7 place-items-center rounded-full bg-coral text-onfill"><X size={16} strokeWidth={3} /></span>;
  if (s === "running") return <span className="grid h-7 w-7 place-items-center rounded-full bg-raised shadow-[var(--shadow-soft)]"><LoaderCircle size={18} className="spin text-blue" /></span>;
  if (s === "needs_input") return <span className="grid h-7 w-7 place-items-center rounded-full bg-yellow text-onfill"><CircleHelp size={16} /></span>;
  if (s === "skipped") return <span className="grid h-7 w-7 place-items-center rounded-full bg-surface text-ink-3"><Minus size={16} /></span>;
  return <span className="grid h-7 w-7 place-items-center"><span className="h-3.5 w-3.5 rounded-full border-[3px] border-white bg-blue shadow" /></span>;
}
const STEP_WORD: Record<PlanStep["status"], string> = { done: "done", failed: "failed", running: "in progress", needs_input: "waiting for you", skipped: "skipped", pending: "pending" };

export function Timeline({ plan }: { plan: PlanStep[] }) {
  return (
    <div className="card p-5">
      <h2 className="mb-3 font-display text-lg font-semibold">What I&apos;m doing</h2>
      <ol className="flex flex-col">
        {plan.map((s, i) => (
          <li key={s.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepIcon s={s.status} />
              {i < plan.length - 1 && <span className={`dash my-1 min-h-5 flex-1 ${s.status === "done" ? "" : "dash-muted"}`} />}
            </div>
            <div className="pb-4">
              <p className="font-bold leading-7 text-ink">{s.label} <span className="sr-only">— {STEP_WORD[s.status]}</span></p>
              {s.summary && <p className="text-sm text-ink-3">{s.summary}</p>}
              {s.links?.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="mr-3 mt-1 inline-flex items-center gap-1 text-sm font-bold text-blue">{l.label}<ExternalLink size={13} /></a>)}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ===========================================================================
// Ask card — one question, input shaped by hint (AGENT_WORKFLOW §7)
// ===========================================================================
function AskCard({ ask, onAnswer, onVoice, listening, inputRef }: { ask: AskPayload; onAnswer: (v: string) => void; onVoice: () => void; listening: boolean; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [v, setV] = useState("");
  const native = ask.inputHint === "date" || ask.inputHint === "time";
  return (
    <div className="rise card border-l-[6px] border-yellow p-5" role="group" aria-labelledby="ask-q">
      <h3 id="ask-q" className="font-display text-xl font-semibold">{ask.question}</h3>
      {ask.choices?.length ? (
        <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label={ask.question}>
          {ask.choices.map((c) => <button key={c} type="button" role="radio" aria-checked={false} className="btn btn-outline" onClick={() => onAnswer(c)}>{c}</button>)}
        </div>
      ) : null}
      <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onAnswer(v); }}>
        <label htmlFor="ask-input" className="sr-only">Your answer</label>
        <input id="ask-input" ref={ask.inputHint === "email" || native ? inputRef : undefined} className="field flex-1" value={v} onChange={(e) => setV(e.target.value)}
          type={ask.inputHint === "email" ? "email" : ask.inputHint === "date" ? "date" : ask.inputHint === "time" ? "time" : "text"}
          inputMode={ask.inputHint === "email" ? "email" : undefined} autoComplete={ask.inputHint === "email" ? "email" : "off"} placeholder={ask.inputHint === "email" ? "name@company.com" : "Type your answer"} />
        <button className="btn btn-primary" disabled={!v.trim()}>Answer</button>
        <button type="button" className="btn btn-outline" onClick={onVoice} aria-pressed={listening}><Mic size={16} /> {listening ? "Listening…" : "Say it"}</button>
      </form>
    </div>
  );
}

// ===========================================================================
// Confirm sheet — preview, Confirm / Edit / Cancel (UI_UX §4, §10)
// ===========================================================================
function ConfirmSheet({ c, onDecide }: { c: ConfirmPayload; onDecide: (d: "approve" | "cancel" | "edit", edits?: Record<string, string>) => void }) {
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>(() => Object.fromEntries(c.editable.map((f) => [f.key, f.value])));
  const titleRef = useRef<HTMLHeadingElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const destructive = /cancel|delete/i.test(c.verb);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onDecide("cancel"); }
      if (e.key === "Tab" && boxRef.current) {
        const f = boxRef.current.querySelectorAll<HTMLElement>("button, input, textarea, a[href]");
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onDecide]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center" role="presentation">
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="sheet-in w-full max-w-[560px] rounded-t-[28px] bg-raised p-6 shadow-[var(--shadow-sheet)] md:rounded-[24px]" style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-line md:hidden" aria-hidden />
        <p className="text-xs font-bold uppercase tracking-wider text-ink-3">{c.risk === "high" ? "Needs your OK" : "Quick check"}</p>
        <h2 id="confirm-title" ref={titleRef} tabIndex={-1} className="mt-1 font-display text-2xl font-semibold outline-none">{c.title}</h2>

        {!editing ? (
          <dl className="mt-4 divide-y divide-line rounded-2xl border border-line">
            {c.rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-3 px-4 py-3">
                <dt className="text-sm font-bold text-ink-3">{k}</dt>
                <dd className="whitespace-pre-wrap break-words text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {c.editable.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 text-sm font-bold text-ink-2">
                {f.label}
                {f.multiline
                  ? <textarea className="field min-h-32 font-normal" value={edits[f.key]} onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })} />
                  : <input className="field font-normal" value={edits[f.key]} onChange={(e) => setEdits({ ...edits, [f.key]: e.target.value })} />}
              </label>
            ))}
          </div>
        )}

        {c.flags.map((f) => (
          <p key={f} className="mt-3 flex items-start gap-2 rounded-xl bg-yellow/30 p-3 text-sm text-ink"><CircleHelp size={16} className="mt-0.5 shrink-0" aria-hidden />{f}</p>
        ))}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {editing
            ? <button type="button" className="btn btn-primary" onClick={() => onDecide("edit", edits)}>{c.verb} with edits</button>
            : <button type="button" className={destructive ? "btn btn-danger" : "btn btn-primary"} onClick={() => onDecide("approve")}>{c.verb}</button>}
          {c.editable.length > 0 && !editing && <button type="button" className="btn btn-outline" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</button>}
          <button type="button" className="link ml-auto px-2 py-3" onClick={() => onDecide("cancel")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Outcome card — evidence links + memory proposals
// ===========================================================================
function OutcomeCard({ final }: { final: Final }) {
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const save = async (p: Proposal) => {
    const body = p.kind === "contact" ? { kind: "contact", name: p.name, email: p.email, source: "user_confirmed_from_tool" } : { kind: "fact", content: p.content };
    const r = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) setSaved((s) => ({ ...s, [p.id]: true }));
  };
  const icon = (s: Outcome["status"]) => s === "verified" ? <Check size={16} className="text-green" strokeWidth={3} /> : s === "cancelled" ? <Minus size={16} className="text-ink-3" /> : <X size={16} className="text-coral" strokeWidth={3} />;
  const word = { verified: "Verified", unverified: "Not confirmed", failed: "Failed", cancelled: "Cancelled" } as const;
  if (!final.outcomes.length && !final.proposals.length) return null;
  return (
    <div className="rise card p-5">
      <ul className="flex flex-col gap-3">
        {final.outcomes.map((o, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-1" aria-hidden>{icon(o.status)}</span>
            <div className="flex-1">
              <p className="font-bold">{o.label} <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-xs font-bold text-ink-3">{word[o.status]}</span></p>
              <p className="text-sm text-ink-3">{o.summary}</p>
              {o.links?.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="mr-3 mt-1 inline-flex items-center gap-1 text-sm font-bold text-blue">{l.label}<ExternalLink size={13} /></a>)}
            </div>
          </li>
        ))}
      </ul>
      {final.proposals.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          {final.proposals.map((p) => (
            <button key={p.id} type="button" disabled={saved[p.id]} onClick={() => save(p)} className="btn btn-outline">
              {saved[p.id] ? <><Check size={15} /> Saved</> : p.kind === "contact" ? `Save ${p.name}'s email` : `Remember: ${p.content}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
