import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, cookieOptions } from "@/lib/auth/server";
import { randomToken, readAuthConfig, safeNext, STATE_COOKIE } from "@/lib/auth/session";

/** Starts GitHub OAuth: a one-time state in a short-lived cookie, then off to GitHub. */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req.nextUrl.origin);
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const auth = readAuthConfig();
  if (auth.disabled) return NextResponse.redirect(new URL(next, origin));
  if (!auth.config) return NextResponse.redirect(new URL("/login?error=config", origin));
  const state = randomToken();
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", auth.config.clientId);
  github.searchParams.set("redirect_uri", `${origin}/api/auth/callback`);
  github.searchParams.set("state", state);
  github.searchParams.set("allow_signup", "false");
  const res = NextResponse.redirect(github);
  res.cookies.set(STATE_COOKIE, `${state}|${encodeURIComponent(next)}`, cookieOptions(origin, 600, "/api/auth"));
  return res;
}
