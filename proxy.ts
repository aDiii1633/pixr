import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verify } from "./lib/auth";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  if (verify(req.cookies.get(COOKIE)?.value)) {
    // Same-origin check for state-changing API calls.
    if (pathname.startsWith("/api/") && req.method !== "GET") {
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== req.headers.get("host")) return new NextResponse("Bad origin", { status: 403 });
    }
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/|favicon|icon|manifest).*)"] };
