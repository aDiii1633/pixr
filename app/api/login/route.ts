import { NextResponse } from "next/server";
import { COOKIE, authEnabled, checkPasscode, cookieOptions, sign } from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";

let fails: number[] = [];

export async function POST(req: Request) {
  if (!authEnabled()) return NextResponse.json({ ok: true });
  if (env.authSecret.length < 32) return NextResponse.json({ error: "Server misconfigured: AUTH_SECRET must be 32+ characters." }, { status: 500 });
  fails = fails.filter((t) => Date.now() - t < 10 * 60_000);
  if (fails.length >= 10) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  const { passcode } = (await req.json().catch(() => ({}))) as { passcode?: string };
  if (!passcode || !checkPasscode(passcode)) {
    fails.push(Date.now());
    return NextResponse.json({ error: "That passcode didn't work." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, sign(), cookieOptions);
  return res;
}
