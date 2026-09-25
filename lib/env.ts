import path from "node:path";
import fs from "node:fs";

// Server-only configuration. Read lazily so `next build` never needs secrets.
const v = (k: string, d = "") => (process.env[k] ?? "").trim() || d;

export const env = {
  get llmBaseUrl() { return v("LLM_BASE_URL", "https://api.groq.com/openai/v1"); },
  get llmApiKey() { return v("GROQ_API_KEY", v("LLM_API_KEY")); },
  /** Primary agent model: intent, planning, tool calls, follow-ups, final replies. */
  get llmModel() { return v("GROQ_MODEL", v("LLM_MODEL", "openai/gpt-oss-120b")); },
  get llmFallbackModel() { return v("LLM_FALLBACK_MODEL", "openai/gpt-oss-20b"); },
  get sttBaseUrl() { return v("STT_BASE_URL", this.llmBaseUrl); },
  get sttModel() { return v("STT_MODEL", "whisper-large-v3-turbo"); },
  get sttApiKey() { return v("STT_API_KEY", this.llmApiKey); },
  get swyProjectDir() { return path.resolve(v("SWYTCHCODE_PROJECT_DIR", ".")); },
  get swyBin() {
    const explicit = v("SWYTCHCODE_BIN");
    if (explicit) return explicit;
    // The npm package ships the native binary as an optional per-platform dependency.
    const exe = process.platform === "win32" ? "swytchcode.exe" : "swytchcode";
    const local = path.join(process.cwd(), "node_modules", `swytchcode-cli-${process.platform}-${process.arch}`, "bin", exe);
    return fs.existsSync(local) ? local : "swytchcode";
  },
  // Vercel functions can only write to /tmp (ephemeral: connections/history reset on cold starts).
  get dbPath() { return path.resolve(v("DATABASE_PATH", process.env.VERCEL ? "/tmp/pixr/relay.db" : "data/relay.db")); },
  get authSecret() { return v("AUTH_SECRET"); },
  get passcode() { return v("APP_PASSCODE"); },
};

export function missingConfig(): string[] {
  const out: string[] = [];
  if (!env.llmApiKey) out.push("GROQ_API_KEY");
  if (env.passcode && env.authSecret.length < 32) out.push("AUTH_SECRET (32+ chars, required with APP_PASSCODE)");
  return out;
}
