import { env } from "@/lib/env";
import { log } from "@/lib/log";

export const runtime = "nodejs";

// Audio → text via an OpenAI-compatible transcription endpoint (Groq Whisper by default).
// Audio is streamed through and never stored.
export async function POST(req: Request) {
  if (!env.sttApiKey) return Response.json({ error: "Speech-to-text isn't configured (STT_API_KEY / LLM_API_KEY)." }, { status: 500 });
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "No audio received." }, { status: 400 });
  if (audio.size > 20 * 1024 * 1024) return Response.json({ error: "That recording is too long." }, { status: 413 });

  const out = new FormData();
  const ext = audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : "webm";
  out.append("file", audio, `speech.${ext}`);
  out.append("model", env.sttModel);
  out.append("language", "en");
  out.append("response_format", "json");
  const t0 = Date.now();
  try {
    const r = await fetch(`${env.sttBaseUrl}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${env.sttApiKey}` }, body: out, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) {
      log("warn", "stt.error", { status: r.status, latencyMs: Date.now() - t0 });
      return Response.json({ error: r.status === 429 ? "Speech service is busy — try again in a moment, or type instead." : "I couldn't transcribe that. Try again or type it." }, { status: 502 });
    }
    const j = (await r.json()) as { text?: string };
    const text = (j.text ?? "").trim();
    log("info", "stt.ok", { latencyMs: Date.now() - t0, chars: text.length });
    // Whisper hallucinates these on silence.
    if (!text || /^(thank you\.?|thanks for watching!?|you|\.)$/i.test(text)) return Response.json({ text: "" });
    return Response.json({ text });
  } catch (e) {
    log("warn", "stt.fail", { error: String(e).slice(0, 200) });
    return Response.json({ error: "I couldn't reach the speech service. Try again or type it." }, { status: 502 });
  }
}
