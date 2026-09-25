import { deleteCred, GOOGLE_APPS, googleClient, mintZoom, saveCred, saveGoogleClient } from "@/lib/creds";
import { invalidateStatus, testIntegration } from "@/lib/integrations";
import type { IntegrationId } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pixr's own real-time connections (token paste, Zoom S2S credentials, Google OAuth client setup).
const SHAPES: Partial<Record<IntegrationId, RegExp>> = {
  slack: /^xox[bp]-[A-Za-z0-9-]{10,}$/,
  notion: /^(ntn_|secret_)[A-Za-z0-9]{20,}$/,
  github: /^(ghp_|github_pat_|gho_)[A-Za-z0-9_]{20,}$/,
  discord: /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/,
  x: /^\S{30,}$/,
  weather: /^[a-f0-9]{32}$/i,
};

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return Response.json({ googleClientConfigured: Boolean(googleClient()), redirectUri: `${origin}/api/oauth/google/callback` });
}

/** Save, prove with a real read-only call, keep only if it works. Returns the account label. */
async function saveAndProve(id: IntegrationId, save: (account: string | null) => void): Promise<Response> {
  save(null);
  invalidateStatus();
  const t = await testIntegration(id);
  if (!t.ok) {
    deleteCred(id);
    invalidateStatus();
    return Response.json({ ok: false, detail: `That didn't work: ${t.detail.slice(0, 200)}` }, { status: 400 });
  }
  save(t.detail.replace(/^Working — /, "").slice(0, 80));
  invalidateStatus();
  return Response.json({ ok: true, detail: t.detail });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { id?: string; token?: string; clientId?: string; clientSecret?: string; accountId?: string };

  if (b.id === undefined && b.clientId !== undefined) {
    const clientId = String(b.clientId).trim(), clientSecret = String(b.clientSecret ?? "").trim();
    if (!/\.apps\.googleusercontent\.com$/.test(clientId) || clientSecret.length < 10) return Response.json({ ok: false, detail: "That doesn't look like a Google OAuth Client ID and secret." }, { status: 400 });
    saveGoogleClient({ clientId, clientSecret });
    return Response.json({ ok: true, detail: "Saved. Now press “Sign in with Google”." });
  }

  const id = b.id as IntegrationId;

  if (id === "zoom") {
    const cred = { kind: "zoom" as const, accountId: String(b.accountId ?? "").trim(), clientId: String(b.clientId ?? "").trim(), clientSecret: String(b.clientSecret ?? "").trim() };
    if (!cred.accountId || !cred.clientId || !cred.clientSecret) return Response.json({ ok: false, detail: "Enter the Account ID, Client ID and Client secret." }, { status: 400 });
    let minted: Awaited<ReturnType<typeof mintZoom>>;
    try { minted = await mintZoom(cred); } catch (e) { return Response.json({ ok: false, detail: `Zoom rejected those credentials: ${(e as Error).message}` }, { status: 400 }); }
    return saveAndProve(id, (account) => saveCred(id, minted, account));
  }

  const shape = SHAPES[id];
  const token = String(b.token ?? "").trim();
  if (!shape) return Response.json({ ok: false, detail: "Unknown app" }, { status: 400 });
  if (!shape.test(token)) return Response.json({ ok: false, detail: "That doesn't look like the right kind of token — check the steps above." }, { status: 400 });
  return saveAndProve(id, (account) => saveCred(id, { kind: "token", token }, account));
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  for (const app of id === "google" ? GOOGLE_APPS : [id]) deleteCred(app);
  invalidateStatus();
  return Response.json({ ok: true });
}
