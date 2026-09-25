import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { env } from "./env";
import type { IntegrationId } from "./tools";

// Pixr-held connections, used when Swytchcode's hosted sign-in is unavailable.
// Encrypted at rest (AES-256-GCM); never sent to the browser or logged.

export const GOOGLE_APPS: IntegrationId[] = ["calendar", "gmail", "drive", "meet", "docs", "sheets", "slides"];
/** Scopes each Google app needs; the union is requested in one consent. */
export const GOOGLE_APP_SCOPES: Record<string, string[]> = {
  calendar: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"],
  gmail: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.readonly"],
  drive: ["https://www.googleapis.com/auth/drive.metadata.readonly"],
  meet: ["https://www.googleapis.com/auth/meetings.space.created"],
  docs: ["https://www.googleapis.com/auth/documents"],
  sheets: ["https://www.googleapis.com/auth/spreadsheets"],
  slides: ["https://www.googleapis.com/auth/presentations"],
};
export const GOOGLE_SCOPES = ["openid", "email", ...Object.values(GOOGLE_APP_SCOPES).flat()];

interface TokenCred { kind: "token"; token: string }
interface GoogleCred { kind: "google"; accessToken: string; refreshToken?: string; expiresAt: number }
interface ZoomCred { kind: "zoom"; accountId: string; clientId: string; clientSecret: string; accessToken?: string; expiresAt?: number }
type Cred = TokenCred | GoogleCred | ZoomCred;
export interface GoogleClient { clientId: string; clientSecret: string }

function key(): Buffer {
  const file = path.join(path.dirname(env.dbPath), "secret.key");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
}

function seal(obj: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function open<T>(blob: string): T {
  const [iv, tag, data] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8")) as T;
}

let ready = false;
function table() {
  if (!ready) {
    db().exec("create table if not exists connections (integration text primary key, kind text not null, data_enc text not null, account text, updated_at text not null)");
    ready = true;
  }
  return db();
}

export function saveCred(id: string, cred: Cred | GoogleClient, account: string | null, kind: string = (cred as Cred).kind ?? "client") {
  table().prepare("insert into connections (integration, kind, data_enc, account, updated_at) values (?,?,?,?,?) on conflict(integration) do update set kind = excluded.kind, data_enc = excluded.data_enc, account = excluded.account, updated_at = excluded.updated_at")
    .run(id, kind, seal(cred), account, new Date().toISOString());
}

export function deleteCred(id: string) { table().prepare("delete from connections where integration = ?").run(id); }

function row(id: string) {
  return table().prepare("select kind, data_enc, account, updated_at from connections where integration = ?").get(id) as { kind: string; data_enc: string; account: string | null; updated_at: string } | undefined;
}

export function relayConnection(id: IntegrationId): { account: string | null; updatedAt: string } | null {
  const r = row(id);
  return r && r.kind !== "client" ? { account: r.account, updatedAt: r.updated_at } : null;
}

export const googleClient = (): GoogleClient | null => { const r = row("google_client"); return r ? open<GoogleClient>(r.data_enc) : null; };
export const saveGoogleClient = (c: GoogleClient) => saveCred("google_client", c, null, "client");

async function refreshGoogle(c: GoogleCred): Promise<GoogleCred> {
  const client = googleClient();
  if (!c.refreshToken || !client) throw new Error("google_expired");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error("google_expired");
  const j = (await r.json()) as { access_token: string; expires_in: number };
  const next: GoogleCred = { ...c, accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
  for (const app of GOOGLE_APPS) { const r2 = row(app); if (r2) saveCred(app, next, r2.account); }
  return next;
}

/** Zoom Server-to-Server OAuth: account credentials → 1-hour access token. */
export async function mintZoom(c: ZoomCred): Promise<ZoomCred> {
  const r = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(c.accountId)}`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}` },
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; reason?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(j.reason ?? j.error ?? `Zoom said HTTP ${r.status}`);
  return { ...c, accessToken: j.access_token, expiresAt: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 };
}

export interface ProviderAuth { headers: Record<string, string>; query: Record<string, string> }

/** Auth for a direct provider call, or null when Pixr holds no connection for this app. */
export async function authFor(id: IntegrationId): Promise<ProviderAuth | null> {
  const r = row(id);
  if (!r || r.kind === "client") return null;
  let c = open<Cred>(r.data_enc);
  const bearer = (t: string): ProviderAuth => ({ headers: { Authorization: `Bearer ${t}` }, query: {} });
  if (c.kind === "google") {
    if (Date.now() > c.expiresAt) c = await refreshGoogle(c);
    return bearer(c.accessToken);
  }
  if (c.kind === "zoom") {
    if (!c.accessToken || Date.now() > (c.expiresAt ?? 0)) { c = await mintZoom(c); saveCred(id, c, r.account); }
    return bearer(c.accessToken!);
  }
  if (id === "discord") return { headers: { Authorization: `Bot ${c.token}` }, query: {} };
  if (id === "weather") return { headers: {}, query: { appid: c.token } };
  return bearer(c.token);
}
