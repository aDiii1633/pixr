import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// Single-owner passcode auth (ARCHITECTURE A-10). Disabled when APP_PASSCODE is empty (local use).
export const COOKIE = "relay_session";
const MAX_AGE_S = 30 * 24 * 3600;

export const authEnabled = () => Boolean(env.passcode);

export function sign(): string {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE_S);
  return `${exp}.${createHmac("sha256", env.authSecret).update(exp).digest("base64url")}`;
}

export function verify(token: string | undefined): boolean {
  if (!authEnabled()) return true;
  if (!token || !env.authSecret) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac || Number(exp) < Date.now() / 1000) return false;
  const expected = createHmac("sha256", env.authSecret).update(exp).digest("base64url");
  return mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

export function checkPasscode(input: string): boolean {
  const a = Buffer.from(input), b = Buffer.from(env.passcode);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE_S };
