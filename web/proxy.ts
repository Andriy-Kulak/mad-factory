import { NextResponse, type NextRequest } from "next/server";
import { readAuthConfig, SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { integrationStatus } from "../src/lib/integrations.ts";

/** Paths that handle their own auth: the sign-in flow itself, and the MCP endpoint (per-agent bearer keys). */
const isPublic = (path: string) => path === "/login" || path.startsWith("/api/auth/") || path === "/api/mcp" || path.startsWith("/api/mcp/");

/**
 * Every page, server action and route needs a signed-in owner (see lib/auth/session.ts). While sign-in or the
 * database is not configured, pages show /setup (what to set, names only) instead of failing.
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (isPublic(path)) return NextResponse.next();
  const isPageLoad = (req.method === "GET" || req.method === "HEAD") && !req.headers.has("next-action");
  const setup = () => (path === "/setup" ? NextResponse.next() : NextResponse.rewrite(new URL("/setup", req.url)));
  const ready = () => (integrationStatus("supabase").configured || !isPageLoad ? NextResponse.next() : setup());
  const auth = readAuthConfig();
  if (auth.disabled) return ready();
  if (!auth.config) return isPageLoad ? setup() : NextResponse.json({ error: `Sign-in is not configured. Set ${auth.missing.join(", ")}.` }, { status: 503 });
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value, auth.config)) return ready();
  if (!isPageLoad) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const login = new URL("/login", req.url);
  login.searchParams.set("next", `${path}${req.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // home/: the sign-in illustration, shown before anyone signs in.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|home/).*)"],
};
