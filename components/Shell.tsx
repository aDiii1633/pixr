"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { History, House, LayoutGrid, Plus, Settings, X } from "lucide-react";
import Assistant from "./Assistant";
import type { IntegrationStatus } from "@/lib/types";

const NAV = [
  { href: "/", label: "Home", Icon: House },
  { href: "/history", label: "History", Icon: History },
  { href: "/apps", label: "Apps", Icon: LayoutGrid },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function Logo() {
  return (
    <a href="/" className="relative grid h-10 w-10 place-items-center bg-ink font-display text-[13px] font-bold leading-[0.9] tracking-tight text-white" aria-label="Pixr home">
      <span className="text-left">pi<br />xr</span>
      <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-orange" aria-hidden />
    </a>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [health, setHealth] = useState<{ ok: number; total: number } | null>(null);

  useEffect(() => {
    fetch("/api/state?kind=tasks").then((r) => r.json()).then((ts: { status: string }[]) => setWaiting(ts.filter((t) => t.status === "asking" || t.status === "awaiting_confirmation").length)).catch(() => {});
    fetch("/api/integrations").then((r) => r.json()).then((xs: IntegrationStatus[]) => setHealth({ ok: xs.filter((x) => x.status === "connected").length, total: xs.length })).catch(() => {});
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (path !== "/") setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path]);

  const newConversation = () => { window.dispatchEvent(new Event("relay:new-session")); if (path !== "/") location.href = "/"; };

  return (
    <div className="flex h-dvh flex-col md:p-4 lg:p-5">
      <div className="relative flex min-h-0 flex-1 flex-col bg-surface md:rounded-[28px] md:shadow-[0_2px_24px_rgba(0,0,0,0.06)]">
        <header className="flex shrink-0 items-center gap-4 px-5 py-3 md:px-10 md:py-6">
          <Logo />
          <nav aria-label="Main" className="ml-auto hidden items-center gap-9 md:flex">
            {NAV.map(({ href, label }) => (
              <a key={href} href={href} aria-current={path === href ? "page" : undefined}
                className={`relative text-sm transition hover:text-ink ${path === href ? "font-bold text-ink" : "font-semibold text-ink-3"}`}>
                {label}
                {href === "/history" && waiting > 0 && <span className="absolute -right-4 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-orange px-1 text-[10px] font-bold text-white">{waiting}</span>}
              </a>
            ))}
          </nav>
          <button type="button" onClick={newConversation} className="btn btn-primary ml-auto min-h-10 px-5 md:ml-10" aria-label="New conversation" title={health ? `${health.ok} of ${health.total} apps connected` : undefined}>
            <Plus size={16} aria-hidden /> <span className="hidden sm:inline">New conversation</span>
          </button>
        </header>

        <main id="main" className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0">{children}</main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-raised/95 px-2 pt-2 backdrop-blur md:hidden" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
        {NAV.map(({ href, label, Icon }) => (
          <a key={href} href={href} aria-current={path === href ? "page" : undefined}
            className={`flex min-h-12 min-w-16 flex-col items-center justify-center rounded-2xl px-3 text-xs font-bold ${path === href ? "bg-ink text-surface" : "text-ink-2"}`}>
            <Icon size={20} aria-hidden />
            {label}
          </a>
        ))}
      </nav>

      {/* Floating command window (desktop, every page but Home) */}
      {path !== "/" && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Open assistant (Ctrl+K)"
            className="orb fixed bottom-24 right-5 z-40 hidden h-16 w-28 md:bottom-8 md:right-8 md:block" data-state="IDLE">
            <span className="orb-knob grid h-12 w-12 place-items-center font-sans text-xs font-bold" style={{ left: "auto", right: 8 }}>⌘K</span>
          </button>
          {open && (
            <div role="dialog" aria-label="Assistant" className="sheet-in fixed bottom-28 right-8 z-40 hidden h-[min(640px,80dvh)] w-[420px] flex-col overflow-hidden rounded-[24px] bg-raised shadow-[var(--shadow-sheet)] md:flex">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="font-display text-lg font-semibold">Ask Pixr</p>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant" className="grid h-10 w-10 place-items-center rounded-full hover:bg-surface"><X size={18} /></button>
              </div>
              <div className="min-h-0 flex-1"><Assistant variant="compact" /></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
