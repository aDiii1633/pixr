"use client";
import { useState } from "react";

export default function Login() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: code }) });
    setBusy(false);
    if (r.ok) location.href = "/";
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "That didn't work.");
  };
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-[32px] bg-surface p-8 md:p-12">
        <h1 className="display text-[clamp(44px,8vw,80px)] lowercase">hey, it&apos;s you?</h1>
        <label htmlFor="code" className="mt-8 block text-sm font-bold text-ink-2">Passcode</label>
        <input id="code" type="password" className="field mt-1" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="current-password" autoFocus />
        {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
        <button className="btn btn-primary mt-6 w-full" disabled={!code || busy}>{busy ? "Checking…" : "Unlock"}</button>
      </form>
    </main>
  );
}
