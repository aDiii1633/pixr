import { spawn, type ChildProcess } from "node:child_process";
import { env } from "./env";
import { exec, swy, ToolError } from "./swytchcode";
import { INTEGRATIONS, type IntegrationId } from "./tools";
import { relayConnection } from "./creds";
import type { IntegrationStatus } from "./types";

const slug = (provider: string) => provider.toLowerCase().replace(/\s+/g, "-");

// `swytchcode auth status` prints: PROVIDER ACCOUNT TYPE TIER STATUS
async function readAuthTable(): Promise<Map<string, { account: string; status: string }>> {
  const { stdout, stderr } = await swy(["auth", "status"], { timeoutMs: 20_000 });
  const rows = new Map<string, { account: string; status: string }>();
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const m = line.trim().match(/^([a-z0-9-]+)\s+(\S+)\s+(oauth2|api_key|apikey|bearer|basic|\S+)\s+(\S+)\s+(.+)$/i);
    if (m && m[1].toLowerCase() !== "provider") rows.set(m[1].toLowerCase(), { account: m[2], status: m[5].trim() });
  }
  return rows;
}

const pending = new Map<string, { child: ChildProcess; startedAt: number }>();
const lastError = new Map<string, string>();

function friendlyConnectError(text: string) {
  if (/login required|not authenticated|swytchcode login/i.test(text)) return "Your Swytchcode session expired. Run `npx swytchcode login` in the project folder, then press Connect again.";
  if (/API key cannot be empty/i.test(text)) return "Paste the API key first.";
  if (/deadline exceeded|Client\.Timeout/i.test(text)) return "Couldn't reach Swytchcode (network timeout). Press Connect to try again.";
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => /error/i.test(l) && !/posthog/i.test(l));
  return line ? line.replace(/^error:\s*/i, "").slice(0, 240) : "Sign-in didn't complete.";
}
let cache: { at: number; value: IntegrationStatus[] } | null = null;

export async function integrationStatuses(fresh = false): Promise<IntegrationStatus[]> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.value;
  let table = new Map<string, { account: string; status: string }>();
  let err = "";
  try { table = await readAuthTable(); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  const value = (Object.keys(INTEGRATIONS) as IntegrationId[]).map((id): IntegrationStatus => {
    const meta = INTEGRATIONS[id];
    const row = table.get(slug(meta.provider));
    const p = pending.get(id);
    const base = { id, name: meta.name, blurb: meta.blurb, provider: meta.provider, checkedAt: new Date().toISOString() };
    if (row && /connected/i.test(row.status)) return { ...base, status: "connected", via: "swytchcode", account: row.account, detail: /expired/i.test(row.status) ? "Token expired — Swytchcode refreshes it on next use; reconnect if calls fail." : undefined };
    const relay = relayConnection(id);
    if (relay) return { ...base, status: "connected", via: "relay", account: relay.account ?? undefined, detail: "Connected in Pixr — calls use Swytchcode's method definitions directly." };
    if (p && Date.now() - p.startedAt < 5 * 60_000) return { ...base, status: "connecting", detail: "Finish signing in in the browser window that opened." };
    if (err) return { ...base, status: "error", detail: "Couldn't read connection status from Swytchcode." };
    if (lastError.has(id)) return { ...base, status: "error", detail: lastError.get(id) };
    return { ...base, status: "not_connected" };
  });
  cache = { at: Date.now(), value };
  return value;
}

export const invalidateStatus = () => { cache = null; };

export async function connectedIds(): Promise<Set<IntegrationId>> {
  return new Set((await integrationStatuses()).filter((s) => s.status === "connected").map((s) => s.id as IntegrationId));
}

/** Starts `swytchcode auth connect <provider>`: OAuth opens the browser on this machine; API-key providers read the key from stdin. */
export function connect(id: IntegrationId, apiKey?: string, attempt = 1) {
  const provider = INTEGRATIONS[id].provider;
  pending.get(id)?.child.kill();
  const child = spawn(env.swyBin, ["auth", "connect", provider], { cwd: env.swyProjectDir, env: { ...process.env, NO_COLOR: "1" }, windowsHide: true });
  let output = "";
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));
  if (apiKey) child.stdin?.end(apiKey + "\n"); // key goes straight to the CLI; never stored or logged by Pixr
  else child.stdin?.end();
  const entry = { child, startedAt: Date.now() };
  pending.set(id, entry);
  lastError.delete(id);
  const done = (code: number | null) => {
    if (pending.get(id) === entry) pending.delete(id);
    // Swytchcode's API sometimes times out before the browser step; retry those transparently.
    if (code && attempt < 3 && /deadline exceeded|Client\.Timeout|connection reset/i.test(output)) {
      setTimeout(() => connect(id, apiKey, attempt + 1), 2000);
      return;
    }
    if (code) lastError.set(id, friendlyConnectError(output));
    cache = null;
  };
  child.on("close", done);
  child.on("error", (e) => { lastError.set(id, `Couldn't start the Swytchcode CLI (${e.message}).`); done(null); });
  setTimeout(() => { if (pending.get(id) === entry) { child.kill(); lastError.set(id, "Sign-in timed out after 5 minutes. Press Connect to try again."); done(null); } }, 5 * 60_000);
  cache = null;
}

export async function disconnect(id: IntegrationId) {
  const r = await swy(["auth", "disconnect", INTEGRATIONS[id].provider], { stdin: "y\n", timeoutMs: 30_000 });
  cache = null;
  if (r.code !== 0) throw new ToolError("provider", (r.stderr || r.stdout).trim().slice(0, 300) || "Disconnect failed.");
}

const PROBES: Partial<Record<IntegrationId, () => Promise<string>>> = {
  calendar: async () => String((await exec("calendar.me.calendarList.get", { params: { calendarId: "primary" } }) as { id?: string })?.id ?? "ok"),  gmail: async () => String((await exec("gmail.user.profile.get", { params: { userId: "me" } }) as { emailAddress?: string })?.emailAddress ?? "ok"),
  slack: async () => { const r = (await exec("slack.auth.test.list", {})) as { ok?: boolean; team?: string; user?: string; error?: string }; if (r?.ok === false) throw new ToolError("auth", `Slack said: ${r.error}`); return `${r?.user ?? ""} @ ${r?.team ?? ""}`; },
  notion: async () => String((await exec("notion.me.list", { headers: { "Notion-Version": "2022-06-28" } }) as { name?: string })?.name ?? "ok"),
  drive: async () => { const r = (await exec("drive.about.list", {})) as { user?: { emailAddress?: string } }; return r?.user?.emailAddress ?? "ok"; },
  github: async () => String((await exec("github.user.list1", {}) as { login?: string })?.login ?? "ok"),
  zoom: async () => String((await exec("zoom.user.get", { params: { userId: "me" } }) as { email?: string })?.email ?? "ok"),
  discord: async () => String((await exec("discord.me.list2", {}) as { username?: string })?.username ?? "ok"),
  x: async () => `@${(await exec("x_v2.user.me.list", {}) as { data?: { username?: string } })?.data?.username ?? "?"}`,
  weather: async () => { const w = (await exec("openweather.2.5.weather.list", { params: { lat: 51.5072, lon: -0.1276 } })) as { name?: string }; if (!w?.name) throw new Error("No data"); return "API key accepted"; },
};

/** Real read-only call proving the connection works (Apps → Test). */
export async function testIntegration(id: IntegrationId): Promise<{ ok: boolean; detail: string }> {
  const probe = PROBES[id];
  if (!probe) return { ok: true, detail: "No read-only test available; status comes from Swytchcode." };
  try { return { ok: true, detail: `Working — ${await probe()}` }; }
  catch (e) { return { ok: false, detail: e instanceof Error ? e.message : String(e) }; }
}
