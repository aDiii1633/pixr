import { runTurn, sessionSnapshot, pendingInterrupt } from "@/lib/agent";
import { missingConfig } from "@/lib/env";
import { log } from "@/lib/log";
import type { AgentEvent, ResumeValue } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SESSION = /^[a-zA-Z0-9-]{8,64}$/;

// ponytail: in-process rate limit; move to shared storage if horizontally scaled.
const hits = new Map<string, number[]>();
function limited(key: string, max = 20, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}

export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get("sessionId") ?? "";
  if (!SESSION.test(sessionId)) return Response.json({ error: "Bad session" }, { status: 400 });
  return Response.json(await sessionSnapshot(sessionId));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { sessionId?: string; input?: { text?: string; via?: string }; resume?: ResumeValue } | null;
  const sessionId = body?.sessionId ?? "";
  if (!SESSION.test(sessionId)) return Response.json({ error: "Bad session" }, { status: 400 });
  if (limited(sessionId)) return Response.json({ error: "Too many requests — slow down a little." }, { status: 429 });
  const missing = missingConfig();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        if (missing.length) throw Object.assign(new Error("config"), { userMessage: `The server isn't configured yet: missing ${missing.join(", ")}. Add it to .env.local and restart.` });
        let input: Parameters<typeof runTurn>[1];
        if (body?.resume) {
          if (!(await pendingInterrupt(sessionId))) throw Object.assign(new Error("nothing pending"), { userMessage: "Nothing is waiting for an answer anymore." });
          input = { resume: body.resume };
        } else {
          const text = String(body?.input?.text ?? "").trim().slice(0, 2000);
          if (!text) throw Object.assign(new Error("empty"), { userMessage: "I didn't catch that. Try again or type it." });
          input = { text, via: body?.input?.via === "voice" ? "voice" : "text" };
        }
        for await (const ev of runTurn(sessionId, input)) send(ev);
      } catch (e) {
        const userMessage = (e as { userMessage?: string }).userMessage ?? "Something went wrong on my side. Please try again.";
        if (!(e as { userMessage?: string }).userMessage) log("error", "agent.route", { sessionId, error: String(e).slice(0, 400) });
        send({ type: "error", userMessage });
        send({ type: "done", pending: false });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
