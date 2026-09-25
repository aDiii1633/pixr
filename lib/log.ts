// Structured one-line JSON logs. Never logs secrets or message bodies.
const SECRET_KEY = /token|key|secret|authorization|password|raw|body|text|content/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 10).map((x) => redact(x, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? (typeof val === "string" ? `[${val.length} chars]` : "[redacted]") : redact(val, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 200) return value.slice(0, 200) + "…";
  return value;
}

export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  (level === "error" ? console.error : console.log)(line);
}
