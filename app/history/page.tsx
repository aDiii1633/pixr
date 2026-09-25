"use client";
import { useEffect, useState } from "react";
import { Check, ExternalLink, Minus, X } from "lucide-react";
import Shell from "@/components/Shell";
import { Timeline } from "@/components/Assistant";
import type { Outcome, PlanStep } from "@/lib/types";

type Task = { id: string; request: string; status: string; created_at: string; state: { plan?: PlanStep[]; results?: { integration: string; ok: boolean; verified: boolean; cancelled?: boolean }[] }; final_result: { spoken?: string; outcomes?: Outcome[] } | null; error: { message?: string } | null };

const STATUS: Record<string, { label: string; cls: string }> = {
  completed: { label: "Completed", cls: "bg-green text-onfill" }, failed: { label: "Failed", cls: "bg-coral text-onfill" }, cancelled: { label: "Cancelled", cls: "bg-surface text-ink-3" },
  asking: { label: "Waiting for you", cls: "bg-yellow text-onfill" }, awaiting_confirmation: { label: "Waiting for you", cls: "bg-yellow text-onfill" }, running: { label: "Running", cls: "bg-sky text-onfill" },
};
const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};

export default function HistoryPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [filter, setFilter] = useState<"all" | "you" | "failed">("all");
  const [open, setOpen] = useState<Task | null>(null);
  useEffect(() => { fetch("/api/state?kind=tasks").then((r) => r.json()).then(setTasks).catch(() => setTasks([])); }, []);

  const shown = (tasks ?? []).filter((t) => filter === "all" || (filter === "failed" ? t.status === "failed" : t.status === "asking" || t.status === "awaiting_confirmation"));

  return (
    <Shell>
      <div className="mx-auto max-w-4xl px-5 md:px-8">
        <h1 className="display text-[clamp(40px,6vw,64px)] lowercase">history</h1>
        <div className="mt-6 flex gap-2" role="tablist" aria-label="Filter tasks">
          {(["all", "you", "failed"] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`btn ${filter === f ? "btn-primary" : "btn-outline"}`}>
              {f === "all" ? "All" : f === "you" ? "Needs you" : "Failed"}
            </button>
          ))}
        </div>
        {tasks === null ? <div className="card mt-6 h-40 animate-pulse" /> : shown.length === 0 ? (
          <p className="mt-10 text-center text-ink-3">Your finished tasks will show up here.</p>
        ) : (
          <ul className="mt-6 flex flex-col gap-3">
            {shown.map((t) => {
              const st = STATUS[t.status] ?? STATUS.running;
              const apps = [...new Map((t.state.results ?? []).map((r) => [r.integration, r])).values()];
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => setOpen(t)} className="card flex w-full flex-col gap-2 p-5 text-left transition hover:-translate-y-0.5">
                    <div className="flex items-start gap-3">
                      <p className="flex-1 font-bold text-ink">{t.request}</p>
                      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
                      <span>{ago(t.created_at)}</span>
                      {apps.map((r) => (
                        <span key={r.integration} className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 font-bold capitalize text-ink-2">
                          {r.cancelled ? <Minus size={12} /> : r.ok && r.verified ? <Check size={12} className="text-green" strokeWidth={3} /> : <X size={12} className="text-coral" strokeWidth={3} />}{r.integration}
                        </span>
                      ))}
                    </div>
                    {t.final_result?.spoken && <p className="text-sm text-ink-2">{t.final_result.spoken}</p>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={() => setOpen(null)} role="presentation">
          <div role="dialog" aria-modal="true" aria-label="Task details" className="sheet-in h-full w-full max-w-[480px] overflow-y-auto bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setOpen(null)} className="btn btn-outline mb-4" autoFocus>Close</button>
            <h2 className="font-display text-2xl font-semibold">{open.request}</h2>
            <p className="mt-1 text-sm text-ink-3">{new Date(open.created_at).toLocaleString()} · {(STATUS[open.status] ?? STATUS.running).label}</p>
            {open.final_result?.spoken && <p className="mt-4 text-[18px]">{open.final_result.spoken}</p>}
            {open.error?.message && <p className="mt-4 rounded-xl bg-coral/20 p-3 text-sm">{open.error.message}</p>}
            {open.state.plan?.length ? <div className="mt-6"><Timeline plan={open.state.plan} /></div> : null}
            {open.final_result?.outcomes?.flatMap((o) => o.links ?? []).map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="mr-3 mt-3 inline-flex items-center gap-1 font-bold text-blue">{l.label}<ExternalLink size={14} /></a>
            ))}
            <a href={`/?q=${encodeURIComponent(open.request)}`} className="btn btn-primary mt-6">Run again</a>
          </div>
        </div>
      )}
    </Shell>
  );
}
