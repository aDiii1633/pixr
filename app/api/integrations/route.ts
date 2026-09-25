import { connect, disconnect, integrationStatuses, testIntegration } from "@/lib/integrations";
import { INTEGRATIONS, type IntegrationId } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.has("fresh");
  return Response.json(await integrationStatuses(fresh));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { id?: string; action?: string; apiKey?: string };
  if (!b.id || !(b.id in INTEGRATIONS)) return Response.json({ error: "Unknown app" }, { status: 400 });
  const id = b.id as IntegrationId;
  try {
    if (b.action === "connect") {
      connect(id, typeof b.apiKey === "string" && b.apiKey.trim() ? b.apiKey.trim() : undefined);
      return Response.json({ ok: true, detail: "A sign-in window should open in your browser. Finish there and this page will update." });
    }
    if (b.action === "disconnect") { await disconnect(id); return Response.json({ ok: true }); }
    if (b.action === "test") return Response.json(await testIntegration(id));
  } catch (e) {
    return Response.json({ ok: false, detail: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
