import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { GOOGLE_APP_SCOPES, GOOGLE_APPS, GOOGLE_SCOPES, googleClient, saveCred } from "@/lib/creds";
import { invalidateStatus } from "@/lib/integrations";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "relay_oauth_state";

export async function GET(req: Request, ctx: { params: Promise<{ step: string }> }) {
  const { step } = await ctx.params;
  const url = new URL(req.url);
  const redirectUri = `${url.origin}/api/oauth/google/callback`;
  const back = (q: string) => NextResponse.redirect(`${url.origin}/apps?${q}`);
  const client = googleClient();
  if (!client) return back("error=" + encodeURIComponent("Add your Google OAuth Client ID and secret first."));

  if (step === "start") {
    const state = randomBytes(16).toString("hex");
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.search = new URLSearchParams({
      client_id: client.clientId, redirect_uri: redirectUri, response_type: "code", scope: GOOGLE_SCOPES.join(" "),
      access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
    }).toString();
    const res = NextResponse.redirect(auth.toString());
    res.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: url.protocol === "https:" });
    return res;
  }

  if (step === "callback") {
    const cookieState = req.headers.get("cookie")?.match(new RegExp(`${STATE_COOKIE}=([a-f0-9]+)`))?.[1];
    if (url.searchParams.get("error")) return back("error=" + encodeURIComponent(`Google said: ${url.searchParams.get("error")}`));
    if (!cookieState || cookieState !== url.searchParams.get("state")) return back("error=" + encodeURIComponent("Sign-in expired or was tampered with. Try again."));
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code") ?? "", client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string; error_description?: string };
    if (!r.ok || !j.access_token) {
      log("warn", "google.oauth.fail", { status: r.status });
      return back("error=" + encodeURIComponent(`Google sign-in failed: ${j.error_description ?? r.status}`));
    }
    let email: string | null = null;
    try { email = JSON.parse(Buffer.from(j.id_token!.split(".")[1], "base64url").toString()).email ?? null; } catch { /* no id_token */ }
    const cred = { kind: "google" as const, accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 };
    const granted = new Set((j.scope ?? "").split(" "));
    const connected: string[] = [];
    for (const app of GOOGLE_APPS) if (GOOGLE_APP_SCOPES[app].every((s) => granted.has(s))) { saveCred(app, cred, email); connected.push(app); }
    invalidateStatus();
    const res = back(`connected=${connected.join(",")}${connected.length < GOOGLE_APPS.length ? "&partial=1" : ""}`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  }

  return new NextResponse("Not found", { status: 404 });
}
