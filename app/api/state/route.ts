import * as store from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Preferences, memory and task history for the History/Settings pages.
export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind === "prefs") return Response.json(store.getPrefs());
  if (kind === "memory") return Response.json({ contacts: store.listContacts(), facts: store.listMemories() });
  if (kind === "tasks") return Response.json(store.listTasks(60));
  return Response.json({ error: "Unknown kind" }, { status: 400 });
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const SECRET = /(gsk_|sk-[a-z0-9]|swy_key_|xox[abp]-|ghp_|github_pat_|\b\d{13,19}\b|password)/i;

export async function PUT(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const p: Partial<store.Prefs> = {};
  const str = (k: keyof store.Prefs, max = 200) => { if (k in b) (p as Record<string, unknown>)[k] = b[k] == null || b[k] === "" ? null : String(b[k]).slice(0, max); };
  str("name"); str("email"); str("default_slack_channel"); str("default_github_repo"); str("default_notion_parent");
  if (typeof b.timezone === "string") { try { new Intl.DateTimeFormat("en-US", { timeZone: b.timezone }); p.timezone = b.timezone; } catch { return Response.json({ error: "Unknown timezone" }, { status: 400 }); } }
  if (b.default_meeting_minutes != null) { const n = Number(b.default_meeting_minutes); if (!(n >= 5 && n <= 480)) return Response.json({ error: "Meeting length must be 5–480 minutes" }, { status: 400 }); p.default_meeting_minutes = Math.round(n); }
  for (const k of ["work_start", "work_end"] as const) if (typeof b[k] === "string" && /^\d\d:\d\d$/.test(b[k] as string)) p[k] = b[k] as string;
  if (b.preferred_channel === "email" || b.preferred_channel === "slack") p.preferred_channel = b.preferred_channel;
  for (const k of ["confirm_low_risk", "hands_free", "speak_responses"] as const) if (typeof b[k] === "boolean") p[k] = b[k] as boolean;
  if (p.email && !EMAIL.test(p.email)) return Response.json({ error: "That email doesn't look right" }, { status: 400 });
  return Response.json(store.savePrefs(p));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { kind?: string; name?: string; email?: string; content?: string; source?: string };
  if (b.kind === "contact") {
    if (!b.name || !b.email || !EMAIL.test(b.email)) return Response.json({ error: "A contact needs a name and a valid email" }, { status: 400 });
    const id = store.saveContact({ name: b.name.slice(0, 100), email: b.email.toLowerCase(), source: b.source === "user_stated" ? "user_stated" : "user_confirmed_from_tool" });
    return Response.json({ id });
  }
  if (b.kind === "fact") {
    if (!b.content || SECRET.test(b.content)) return Response.json({ error: "That can't be saved" }, { status: 400 });
    return Response.json({ id: store.addMemory(b.content.slice(0, 500), "user said") });
  }
  return Response.json({ error: "Unknown kind" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const u = new URL(req.url).searchParams;
  const kind = u.get("kind"), id = u.get("id") ?? "";
  if (kind === "contact") store.deleteContact(id);
  else if (kind === "fact") store.deleteMemory(id);
  else if (kind === "all-memory") store.wipeMemory();
  else if (kind === "all-history") store.wipeHistory();
  else return Response.json({ error: "Unknown kind" }, { status: 400 });
  return Response.json({ ok: true });
}
