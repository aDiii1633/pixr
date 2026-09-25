"use client";
import { useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import Shell from "@/components/Shell";
import { getWake, setWake } from "@/components/local";
import { wakeWordSupported } from "@/components/voice";

type Prefs = {
  name: string | null; email: string | null; timezone: string | null; default_meeting_minutes: number; work_start: string; work_end: string;
  preferred_channel: "email" | "slack"; confirm_low_risk: boolean; hands_free: boolean; speak_responses: boolean;
  default_slack_channel: string | null; default_github_repo: string | null; default_notion_parent: string | null;
};
type Memory = { contacts: { id: string; name: string; email: string | null; source: string; created_at: string }[]; facts: { id: string; content: string; source: string; created_at: string }[] };

const zones = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { return []; } })();

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-bold text-ink-2">
      {label}
      {children}
      {hint && <span className="font-normal text-ink-3">{hint}</span>}
    </label>
  );
}
function Toggle({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange?.(!checked)} className="flex items-center justify-between gap-4 text-left disabled:opacity-70">
      <span><span className="font-bold text-ink">{label}</span>{hint && <span className="block text-sm text-ink-3">{hint}</span>}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-green" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export default function SettingsPage() {
  const [p, setP] = useState<Prefs | null>(null);
  const [mem, setMem] = useState<Memory | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fact, setFact] = useState("");
  const [wake, setWakeState] = useState(true);
  const [wakeOk, setWakeOk] = useState(true);
  useEffect(() => { setWakeState(getWake()); setWakeOk(wakeWordSupported()); }, []);

  const loadMem = () => fetch("/api/state?kind=memory").then((r) => r.json()).then(setMem);
  useEffect(() => { fetch("/api/state?kind=prefs").then((r) => r.json()).then(setP); loadMem(); }, []);

  const save = async (patch: Partial<Prefs>) => {
    setErr(null);
    const r = await fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const j = await r.json();
    if (!r.ok) return setErr(j.error ?? "Couldn't save");
    setP(j); setSaved("Saved"); setTimeout(() => setSaved(null), 1500);
  };
  const del = async (kind: string, id = "") => {
    if (kind.startsWith("all") && !confirm(kind === "all-memory" ? "Delete everything Pixr remembers about you?" : "Delete all conversation and task history?")) return;
    await fetch(`/api/state?kind=${kind}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    loadMem();
  };
  const addFact = async () => {
    if (!fact.trim()) return;
    const r = await fetch("/api/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "fact", content: fact }) });
    if (r.ok) { setFact(""); loadMem(); } else setErr((await r.json()).error);
  };

  if (!p) return <Shell><div className="mx-auto max-w-2xl px-5"><div className="card h-60 animate-pulse" /></div></Shell>;
  const text = (k: keyof Prefs) => ({ value: (p[k] as string | null) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: e.target.value }), onBlur: () => save({ [k]: p[k] } as Partial<Prefs>) });

  return (
    <Shell>
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-5 md:px-8">
        <div className="flex items-end justify-between">
          <h1 className="display text-[clamp(40px,6vw,64px)] lowercase">settings</h1>
          <span role="status" className="mb-2 text-sm font-bold text-green">{saved && <><Check size={14} className="inline" /> {saved}</>}</span>
        </div>
        {err && <p role="alert" className="rounded-xl bg-coral/20 p-3 text-sm">{err}</p>}

        <Section title="Profile">
          <Field label="Your name"><input className="field font-normal" {...text("name")} autoComplete="name" /></Field>
          <Field label="Your email"><input className="field font-normal" type="email" {...text("email")} autoComplete="email" /></Field>
          <Field label="Timezone" hint="Pixr resolves 'tomorrow at 6' in this timezone.">
            <select className="field font-normal" value={p.timezone ?? ""} onChange={(e) => save({ timezone: e.target.value })}>
              {!p.timezone && <option value="">Choose…</option>}
              {(zones.length ? zones : [p.timezone ?? "UTC"]).map((z) => <option key={z}>{z}</option>)}
            </select>
          </Field>
        </Section>

        <Section title="Scheduling">
          <Field label="Default meeting length (minutes)" hint="Used when you don't say how long.">
            <input className="field font-normal" type="number" min={5} max={480} value={p.default_meeting_minutes} onChange={(e) => setP({ ...p, default_meeting_minutes: Number(e.target.value) })} onBlur={() => save({ default_meeting_minutes: p.default_meeting_minutes })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Work starts"><input className="field font-normal" type="time" value={p.work_start} onChange={(e) => save({ work_start: e.target.value })} /></Field>
            <Field label="Work ends"><input className="field font-normal" type="time" value={p.work_end} onChange={(e) => save({ work_end: e.target.value })} /></Field>
          </div>
        </Section>

        <Section title="Communication">
          <div className="flex gap-2" role="radiogroup" aria-label="Preferred channel">
            {(["email", "slack"] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={p.preferred_channel === c} onClick={() => save({ preferred_channel: c })} className={`btn ${p.preferred_channel === c ? "btn-primary" : "btn-outline"}`}>{c === "email" ? "Email" : "Slack"}</button>
            ))}
          </div>
          <Field label="Default Slack channel" hint="e.g. #general"><input className="field font-normal" {...text("default_slack_channel")} /></Field>
          <Field label="Default GitHub repository" hint="owner/name"><input className="field font-normal" {...text("default_github_repo")} /></Field>
          <Field label="Default Notion page id" hint="Where new notes are saved. Share that page with the Swytchcode Notion integration."><input className="field font-normal" {...text("default_notion_parent")} /></Field>
        </Section>

        <Section title="Safety">
          <Toggle label="Always confirm sends, invites and cancellations" checked disabled hint="High-impact actions always ask first. This can't be turned off." />
          <Toggle label="Also confirm low-risk actions" checked={p.confirm_low_risk} onChange={(v) => save({ confirm_low_risk: v })} hint="Drafts, notes, and events without guests." />
        </Section>

        <Section title="Voice">
          <Toggle label="Speak responses" checked={p.speak_responses} onChange={(v) => save({ speak_responses: v })} />
          <Toggle label="Hands-free follow-ups" checked={p.hands_free} onChange={(v) => save({ hands_free: v })} hint="Keep the mic on after I ask you something. If you stay quiet for 10 seconds I'll stop and wait." />
          <Toggle label="Wake word “Hey Pixr”" checked={wake && wakeOk} disabled={!wakeOk} onChange={(v) => { setWake(v); setWakeState(v); }}
            hint={wakeOk
              ? "While Pixr is open in a visible tab, say “Hey Pixr” to start listening. Uses your browser's speech service. Browsers don't allow wake words when the tab is hidden or closed."
              : "This browser has no speech recognition (e.g. Firefox). Use Chrome, Edge or Safari — or tap the orb / press Space."} />
        </Section>

        <Section title="Memory">
          <p className="text-sm text-ink-3">Pixr only remembers what you save. Nothing from your email, Slack or files is stored.</p>
          <h3 className="font-bold">Contacts</h3>
          {mem?.contacts.length ? (
            <ul className="divide-y divide-line">{mem.contacts.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <div className="flex-1"><p className="font-bold">{c.name}</p><p className="text-sm text-ink-3">{c.email} · {c.source === "user_stated" ? "you said" : "confirmed by you"}, {c.created_at.slice(0, 10)}</p></div>
                <button type="button" onClick={() => del("contact", c.id)} className="grid h-11 w-11 place-items-center rounded-full hover:bg-surface" aria-label={`Forget ${c.name}`}><Trash2 size={18} /></button>
              </li>
            ))}</ul>
          ) : <p className="text-sm text-ink-3">No saved contacts. After a task, tap “Save their email” to keep one.</p>}
          <h3 className="font-bold">Facts</h3>
          {mem?.facts.length ? (
            <ul className="divide-y divide-line">{mem.facts.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-3">
                <div className="flex-1"><p>{f.content}</p><p className="text-sm text-ink-3">{f.source}, {f.created_at.slice(0, 10)}</p></div>
                <button type="button" onClick={() => del("fact", f.id)} className="grid h-11 w-11 place-items-center rounded-full hover:bg-surface" aria-label="Forget this fact"><Trash2 size={18} /></button>
              </li>
            ))}</ul>
          ) : <p className="text-sm text-ink-3">Nothing saved yet.</p>}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addFact(); }}>
            <label htmlFor="fact" className="sr-only">Add a fact</label>
            <input id="fact" className="field flex-1" placeholder="e.g. My team channel is #eng-core" value={fact} onChange={(e) => setFact(e.target.value)} />
            <button className="btn btn-primary" disabled={!fact.trim()}>Add</button>
          </form>
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <button type="button" className="btn btn-danger" onClick={() => del("all-memory")}>Delete all memory</button>
            <button type="button" className="btn btn-danger" onClick={() => del("all-history")}>Delete conversation history</button>
          </div>
        </Section>
      </div>
    </Shell>
  );
}
