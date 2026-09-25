import { spawn } from "node:child_process";
import { env } from "./env";
import { log } from "./log";

export type ErrorCategory =
  | "auth" | "not_connected" | "permission" | "policy" | "validation" | "not_found"
  | "rate_limit" | "timeout" | "network" | "provider" | "unknown";

export class ToolError extends Error {
  constructor(public category: ErrorCategory, message: string, public retryable = false, public detail?: string) {
    super(message);
  }
}

export interface ExecArgs {
  body?: unknown;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Run the Swytchcode CLI asynchronously. (The official runtime SDK uses spawnSync, which would
 * block the Node event loop and freeze every open SSE stream while a tool runs.)
 */
export function swy(args: string[], opts: { stdin?: string; timeoutMs?: number } = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(env.swyBin, args, {
      cwd: env.swyProjectDir,
      env: { ...process.env, NO_COLOR: "1", CI: "1", ...(process.env.VERCEL ? { HOME: "/tmp" } : {}) }, // Vercel: only /tmp is writable
      windowsHide: true,
    });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new ToolError("timeout", "The request timed out.", true));
    }, opts.timeoutMs ?? 60_000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new ToolError("network", `Couldn't start the Swytchcode CLI (${e.message}).`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

function classify(stderr: string, stdout: string): ToolError {
  const text = `${stderr}\n${stdout}`;
  let msg = "", cat = "", retryable = false;
  // stderr = timestamped log lines + one classified-error JSON line.
  for (const line of `${stderr}\n${stdout}`.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try {
      const j = JSON.parse(s);
      msg = j.error ?? j.message ?? "";
      cat = String(j.category ?? "");
      retryable = Boolean(j.retryable);
      if (msg) break;
    } catch { /* not JSON */ }
  }
  const detail = (msg || text).trim().slice(0, 400);
  const has = (re: RegExp) => re.test(msg) || re.test(text);
  if (has(/missing credentials|no (connected )?credential|not connected|no account/i)) return new ToolError("not_connected", detail, false, detail);
  if (has(/\b401\b|unauthori[sz]ed|invalid_auth|token_revoked|expired|invalid_grant|\bauth\b/i)) return new ToolError("auth", detail, false, detail);
  if (has(/\b403\b|forbidden|insufficient|permission|scope|not_allowed_token_type|missing_scope/i)) return new ToolError("permission", detail, false, detail);
  if (has(/polic|blocked/i)) return new ToolError("policy", detail, false, detail);
  if (has(/\b404\b|not[ _]found|channel_not_found|object_not_found/i)) return new ToolError("not_found", detail, false, detail);
  if (has(/\b429\b|rate.?limit|ratelimited/i)) return new ToolError("rate_limit", detail, true, detail);
  if (has(/\b(400|422)\b|validation|invalid|required/i)) return new ToolError("validation", detail, false, detail);
  if (has(/timeout|timed out|deadline/i)) return new ToolError("timeout", detail, true, detail);
  if (has(/network|ECONN|ENOTFOUND|dial tcp/i)) return new ToolError("network", detail, true, detail);
  return new ToolError(cat ? "provider" : "unknown", detail || "The tool failed.", retryable, detail);
}

const PREFIX: [string, string][] = [
  ["calendar.", "calendar"], ["gmail.", "gmail"], ["slack.", "slack"], ["notion.", "notion"], ["drive.", "drive"], ["google_meet.", "meet"], ["github.", "github"],
  ["zoom.", "zoom"], ["discord.", "discord"], ["google_docs.", "docs"], ["google_sheets.", "sheets"], ["google_slides.", "slides"], ["x_v2.", "x"], ["openweather.", "weather"],
];
export const integrationOf = (canonicalId: string) => PREFIX.find(([p]) => canonicalId.startsWith(p))?.[1];
const kernelMissing = new Map<string, number>(); // integration → time the kernel reported missing credentials

/**
 * Execute one Swytchcode method. Prefers the Swytchcode kernel (managed credentials, policies, retries);
 * if the app isn't connected inside Swytchcode but Pixr holds a connection, runs the same method
 * definition directly. Throws ToolError on failure.
 */
export async function exec(canonicalId: string, args: ExecArgs = {}, timeoutMs = 60_000): Promise<unknown> {
  const app = integrationOf(canonicalId);
  if (app && Date.now() - (kernelMissing.get(app) ?? 0) < 60_000) {
    const direct = await viaPixr(app, canonicalId, args, timeoutMs);
    if (direct.used) return direct.result;
  }
  try {
    return await kernelExec(canonicalId, args, timeoutMs);
  } catch (e) {
    if (!(e instanceof ToolError) || e.category !== "not_connected" || !app) throw e;
    kernelMissing.set(app, Date.now());
    const direct = await viaPixr(app, canonicalId, args, timeoutMs);
    if (direct.used) return direct.result;
    throw e;
  }
}

async function viaPixr(app: string, canonicalId: string, args: ExecArgs, timeoutMs: number): Promise<{ used: boolean; result?: unknown }> {
  const { authFor } = await import("./creds");
  let auth: Awaited<ReturnType<typeof authFor>>;
  try { auth = await authFor(app as never); }
  catch { throw new ToolError("auth", "The connection expired. Reconnect it on the Apps page."); }
  if (!auth) return { used: false };
  const { directExec } = await import("./direct");
  return { used: true, result: await directExec(canonicalId, args, auth, timeoutMs) };
}

async function kernelExec(canonicalId: string, args: ExecArgs, timeoutMs: number): Promise<unknown> {
  const t0 = Date.now();
  const { code, stdout, stderr } = await swy(["exec", canonicalId, "--json"], { stdin: JSON.stringify(args), timeoutMs });
  const latencyMs = Date.now() - t0;
  if (code !== 0) {
    const err = classify(stderr, stdout);
    log("warn", "swy.exec.error", { canonicalId, latencyMs, category: err.category, detail: err.message.slice(0, 160) });
    throw err;
  }
  log("info", "swy.exec.ok", { canonicalId, latencyMs });
  const out = stdout.trim();
  if (!out) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(out); } catch { throw new ToolError("provider", "The tool returned an unreadable response."); }
  return unwrap(parsed);
}

/** The CLI may wrap provider responses in an envelope; return the provider body. */
function unwrap(res: unknown): unknown {
  if (res && typeof res === "object" && !Array.isArray(res)) {
    const r = res as Record<string, unknown>;
    const status = Number(r.status ?? r.status_code ?? r.statusCode ?? 200);
    const body = "data" in r ? r.data : "body" in r ? r.body : "response" in r ? r.response : undefined;
    if (body !== undefined && ("status" in r || "status_code" in r || "statusCode" in r || "ok" in r)) {
      if (status >= 400) throw classify(JSON.stringify(body), `HTTP ${status}`);
      return body;
    }
  }
  return res;
}
