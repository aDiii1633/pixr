import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "./env";

// ponytail: single-owner SQLite file. Swap for Postgres when the app becomes multi-user.
const SCHEMA = `
create table if not exists prefs (
  id integer primary key check (id = 1),
  name text, email text, timezone text,
  default_meeting_minutes integer not null default 60,
  work_start text not null default '09:00', work_end text not null default '18:00',
  preferred_channel text not null default 'email',
  confirm_low_risk integer not null default 0,
  hands_free integer not null default 1,
  speak_responses integer not null default 1,
  default_slack_channel text, default_github_repo text, default_notion_parent text,
  updated_at text
);
insert or ignore into prefs (id) values (1);
create table if not exists contacts (
  id text primary key, name text not null, aliases text not null default '[]',
  email text, slack_user_id text,
  source text not null check (source in ('user_stated','user_confirmed_from_tool')),
  last_used_at text, created_at text not null
);
create table if not exists memories (
  id text primary key, content text not null, source text not null,
  confirmed integer not null default 1, created_at text not null
);
create table if not exists messages (
  id integer primary key autoincrement, session_id text not null, task_id text,
  role text not null check (role in ('user','agent')), text text not null, via text, created_at text not null
);
create table if not exists tasks (
  id text primary key, session_id text not null, request text not null, intent text,
  status text not null, state text not null default '{}', final_result text, error text,
  created_at text not null, updated_at text not null
);
create index if not exists tasks_created on tasks(created_at desc);
create table if not exists executions (
  id integer primary key autoincrement, task_id text, action_id text unique, tool text not null,
  integration text not null, risk text, args_redacted text, status text not null, verified integer,
  summary text, evidence text, error_category text, latency_ms integer, created_at text not null
);
`;

const g = globalThis as unknown as { __relayDb?: Database.Database };

export function db(): Database.Database {
  if (!g.__relayDb) {
    fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
    const d = new Database(env.dbPath);
    d.pragma("journal_mode = WAL");
    d.exec(SCHEMA);
    // Retention: 30 days of conversation + task history (MEMORY_CONTEXT §9).
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
    d.prepare("delete from messages where created_at < ?").run(cutoff);
    d.prepare("delete from tasks where created_at < ?").run(cutoff);
    d.prepare("delete from executions where created_at < ?").run(cutoff);
    g.__relayDb = d;
  }
  return g.__relayDb;
}

const now = () => new Date().toISOString();

// ---------- preferences ----------
export interface Prefs {
  name: string | null; email: string | null; timezone: string | null;
  default_meeting_minutes: number; work_start: string; work_end: string;
  preferred_channel: "email" | "slack"; confirm_low_risk: boolean; hands_free: boolean; speak_responses: boolean;
  default_slack_channel: string | null; default_github_repo: string | null; default_notion_parent: string | null;
}
const BOOL_PREFS = ["confirm_low_risk", "hands_free", "speak_responses"] as const;

export function getPrefs(): Prefs {
  const r = db().prepare("select * from prefs where id = 1").get() as Record<string, unknown>;
  for (const k of BOOL_PREFS) r[k] = Boolean(r[k]);
  delete r.id; delete r.updated_at;
  return r as unknown as Prefs;
}

export function savePrefs(p: Partial<Prefs>) {
  const allowed = Object.keys(getPrefs()) as (keyof Prefs)[];
  const entries = Object.entries(p).filter(([k]) => allowed.includes(k as keyof Prefs));
  if (!entries.length) return getPrefs();
  const sets = entries.map(([k]) => `${k} = @${k}`).join(", ");
  const vals = Object.fromEntries(entries.map(([k, v]) => [k, typeof v === "boolean" ? Number(v) : v]));
  db().prepare(`update prefs set ${sets}, updated_at = @u where id = 1`).run({ ...vals, u: now() });
  return getPrefs();
}

// ---------- contacts & memories (user-owned; MEMORY_CONTEXT §2) ----------
export interface Contact { id: string; name: string; aliases: string[]; email: string | null; slack_user_id: string | null; source: string; last_used_at: string | null; created_at: string }

const toContact = (r: Record<string, unknown>): Contact => ({ ...(r as unknown as Contact), aliases: JSON.parse(String(r.aliases || "[]")) });

export function listContacts(): Contact[] {
  return (db().prepare("select * from contacts order by coalesce(last_used_at, created_at) desc").all() as Record<string, unknown>[]).map(toContact);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findContacts(text: string): Contact[] {
  const t = text.toLowerCase();
  return listContacts()
    .filter((c) => [c.name, ...c.aliases].some((n) => n && new RegExp(`\\b${esc(n.toLowerCase().split(/\s+/)[0])}\\b`).test(t)))
    .slice(0, 5);
}

export function saveContact(c: { name: string; email?: string | null; slack_user_id?: string | null; aliases?: string[]; source: "user_stated" | "user_confirmed_from_tool" }) {
  const existing = listContacts().find((x) => x.name.toLowerCase() === c.name.toLowerCase());
  if (existing) {
    db().prepare("update contacts set email = coalesce(?, email), slack_user_id = coalesce(?, slack_user_id), source = ?, last_used_at = ? where id = ?")
      .run(c.email ?? null, c.slack_user_id ?? null, c.source, now(), existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db().prepare("insert into contacts (id, name, aliases, email, slack_user_id, source, created_at) values (?,?,?,?,?,?,?)")
    .run(id, c.name, JSON.stringify(c.aliases ?? []), c.email ?? null, c.slack_user_id ?? null, c.source, now());
  return id;
}

export const deleteContact = (id: string) => db().prepare("delete from contacts where id = ?").run(id);

export interface Memory { id: string; content: string; source: string; created_at: string }
export const listMemories = () => db().prepare("select id, content, source, created_at from memories where confirmed = 1 order by created_at desc").all() as Memory[];

export function searchMemories(text: string): Memory[] {
  // ponytail: keyword overlap; add embeddings when memories > ~1k.
  const words = new Set(text.toLowerCase().match(/[a-z0-9#@._-]{3,}/g) ?? []);
  return listMemories()
    .map((m) => ({ m, score: (m.content.toLowerCase().match(/[a-z0-9#@._-]{3,}/g) ?? []).filter((w) => words.has(w)).length }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.m);
}

export function addMemory(content: string, source: string) {
  const id = randomUUID();
  db().prepare("insert into memories (id, content, source, confirmed, created_at) values (?,?,?,1,?)").run(id, content, source, now());
  return id;
}
export const deleteMemory = (id: string) => db().prepare("delete from memories where id = ?").run(id);

export function wipeMemory() {
  db().exec("delete from contacts; delete from memories;");
}
export function wipeHistory() {
  db().exec("delete from messages; delete from tasks; delete from executions;");
}

// ---------- conversation + tasks ----------
export function addMessage(sessionId: string, role: "user" | "agent", text: string, via: "voice" | "text" | null, taskId?: string) {
  db().prepare("insert into messages (session_id, task_id, role, text, via, created_at) values (?,?,?,?,?,?)").run(sessionId, taskId ?? null, role, text, via, now());
}

export interface TaskRow { id: string; session_id: string; request: string; intent: string | null; status: string; state: unknown; final_result: unknown; error: unknown; created_at: string; updated_at: string }

export function upsertTask(t: { id: string; sessionId: string; request: string; intent?: string | null; status: string; state: unknown; finalResult?: unknown; error?: unknown }) {
  db().prepare(`insert into tasks (id, session_id, request, intent, status, state, final_result, error, created_at, updated_at)
    values (@id, @s, @r, @i, @st, @state, @f, @e, @now, @now)
    on conflict(id) do update set intent = coalesce(@i, intent), status = @st, state = @state, final_result = @f, error = @e, updated_at = @now`)
    .run({ id: t.id, s: t.sessionId, r: t.request, i: t.intent ?? null, st: t.status, state: JSON.stringify(t.state ?? {}), f: t.finalResult ? JSON.stringify(t.finalResult) : null, e: t.error ? JSON.stringify(t.error) : null, now: now() });
}

const parseTask = (r: Record<string, unknown>): TaskRow => ({
  ...(r as unknown as TaskRow),
  state: JSON.parse(String(r.state || "{}")),
  final_result: r.final_result ? JSON.parse(String(r.final_result)) : null,
  error: r.error ? JSON.parse(String(r.error)) : null,
});

export const listTasks = (limit = 50) => (db().prepare("select * from tasks order by created_at desc limit ?").all(limit) as Record<string, unknown>[]).map(parseTask);
export const recentSessionTasks = (sessionId: string, limit = 5) =>
  (db().prepare("select * from tasks where session_id = ? and status in ('completed','failed','cancelled') order by created_at desc limit ?").all(sessionId, limit) as Record<string, unknown>[]).map(parseTask);

// ---------- tool executions (idempotency + audit) ----------
export interface ExecutionRow { action_id: string; status: string; verified: number; summary: string; evidence: string | null }
export const findExecution = (actionId: string) =>
  db().prepare("select action_id, status, verified, summary, evidence from executions where action_id = ? and status = 'ok'").get(actionId) as ExecutionRow | undefined;

export function recordExecution(e: { taskId: string; actionId: string; tool: string; integration: string; risk: string; args: unknown; status: "ok" | "error" | "cancelled"; verified?: boolean; summary?: string; evidence?: unknown; errorCategory?: string; latencyMs?: number }) {
  db().prepare(`insert into executions (task_id, action_id, tool, integration, risk, args_redacted, status, verified, summary, evidence, error_category, latency_ms, created_at)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?) on conflict(action_id) do update set status = excluded.status, verified = excluded.verified, summary = excluded.summary, evidence = excluded.evidence, error_category = excluded.error_category, latency_ms = excluded.latency_ms`)
    .run(e.taskId, e.actionId, e.tool, e.integration, e.risk, JSON.stringify(e.args ?? {}).slice(0, 2000), e.status, e.verified == null ? null : Number(e.verified), e.summary ?? null, e.evidence ? JSON.stringify(e.evidence) : null, e.errorCategory ?? null, e.latencyMs ?? null, now());
}
