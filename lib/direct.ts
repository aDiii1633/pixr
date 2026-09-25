import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { log } from "./log";
import { swy, ToolError, type ExecArgs } from "./swytchcode";

// Executes a Swytchcode method *definition* (endpoint, verb, input locations from the Wrekenfile)
// directly against the provider with a Pixr-held token. Used only when the app isn't connected
// inside Swytchcode (its hosted sign-in page is unavailable).

interface Spec { method: string; url: string; locations: Record<string, string> }
const specs = new Map<string, Spec>();

function manifestBase(integration: string): string {
  const file = path.join(env.swyProjectDir, ".swytchcode", "integrations", "manifest.json");
  const m = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { production_endpoint?: string }>;
  const base = m[integration]?.production_endpoint;
  if (!base) throw new ToolError("provider", `No endpoint for ${integration} in the Swytchcode manifest.`);
  return base.replace(/\/+$/, "");
}

async function spec(id: string): Promise<Spec> {
  const hit = specs.get(id);
  if (hit) return hit;
  const { code, stdout } = await swy(["info", id, "--json"], { timeoutMs: 30_000 });
  if (code !== 0) throw new ToolError("provider", `Swytchcode has no method ${id}.`);
  type Info = { integration: string; http_method?: string; endpoint?: string; inputs?: Record<string, { LOCATION?: string }>[]; wrekenfile?: { HTTP?: { METHOD?: string; ENDPOINT?: string } } };
  const info = (JSON.parse(stdout) as Info[])[0];
  const method = info.http_method ?? info.wrekenfile?.HTTP?.METHOD; // CLI ≥2.23 top-level; older nested
  const endpoint = info.endpoint ?? info.wrekenfile?.HTTP?.ENDPOINT;
  if (!method || !endpoint) throw new ToolError("provider", `Swytchcode's definition for ${id} has no endpoint.`);
  const locations: Record<string, string> = {};
  for (const item of info.inputs ?? []) for (const [k, v] of Object.entries(item)) locations[k] = String(v?.LOCATION ?? "body").toLowerCase();
  const s = { method: method.toUpperCase(), url: manifestBase(info.integration) + endpoint, locations };
  specs.set(id, s);
  return s;
}

function toolError(status: number, body: string): ToolError {
  let detail = body.slice(0, 300);
  try { const j = JSON.parse(body); detail = String(j.error?.message ?? j.message ?? j.error_description ?? j.error ?? detail).slice(0, 300); } catch { /* not JSON */ }
  if (status === 401) return new ToolError("auth", detail, false, detail);
  if (status === 403) return new ToolError("permission", detail, false, detail);
  if (status === 404) return new ToolError("not_found", detail, false, detail);
  if (status === 429) return new ToolError("rate_limit", detail, true, detail);
  if (status === 400 || status === 422) return new ToolError("validation", detail, false, detail);
  return new ToolError("provider", `HTTP ${status}: ${detail}`, status >= 500, detail);
}

export async function directExec(id: string, args: ExecArgs, auth: { headers: Record<string, string>; query: Record<string, string> }, timeoutMs = 45_000): Promise<unknown> {
  const s = await spec(id);
  let url = s.url;
  const query = new URLSearchParams(auth.query);
  for (const [k, v] of Object.entries(args.params ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    const slot = [`{${k}}`, `{+${k}}`].find((t) => url.includes(t)); // {+x} = RFC 6570 reserved expansion
    if (slot) { url = url.replace(slot, encodeURIComponent(String(v))); continue; }
    if (s.locations[k] === "header") continue;
    for (const item of Array.isArray(v) ? v : [v]) query.append(k, String(item));
  }
  if (/\{[^}]+\}/.test(url)) throw new ToolError("validation", `Missing path value in ${url}`);
  if ([...query].length) url += (url.includes("?") ? "&" : "?") + query.toString();

  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "relay-agent", ...(args.headers ?? {}), ...auth.headers };
  if (url.includes("api.github.com")) headers.Accept = "application/vnd.github+json";
  const hasBody = args.body !== undefined && s.method !== "GET" && s.method !== "DELETE";
  if (hasBody) headers["Content-Type"] = "application/json";

  const t0 = Date.now();
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { method: s.method, headers, body: hasBody ? JSON.stringify(args.body) : undefined, signal: AbortSignal.timeout(timeoutMs) })
      .catch((e: Error) => { throw new ToolError(e.name === "TimeoutError" ? "timeout" : "network", e.message, true); });
    const text = await r.text();
    if ((r.status === 429 || r.status === 503) && attempt < 3) {
      await new Promise((res) => setTimeout(res, Math.min(3000, Number(r.headers.get("retry-after") ?? 1) * 1000)));
      continue;
    }
    log(r.ok ? "info" : "warn", "direct.exec", { canonicalId: id, status: r.status, latencyMs: Date.now() - t0 }); // URL not logged: may carry an API key
    if (!r.ok) throw toolError(r.status, text);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }
}
