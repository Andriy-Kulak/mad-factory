import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, cookieOptions } from "@/lib/auth/server";
import { isAllowed, readAuthConfig, safeNext, SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, STATE_COOKIE } from "@/lib/auth/session";

/** GitHub sends the owner back here: check the state, swap the code for a token, read the username, check the allowlist. */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req.nextUrl.origin);
  const fail = (error: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${error}`, origin));
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/auth" });
    return res;
  };
  const auth = readAuthConfig();
  if (auth.disabled || !auth.config) return fail("config");
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail("denied");
  const [expected, nextEncoded] = (req.cookies.get(STATE_COOKIE)?.value ?? "").split("|");
  const code = params.get("code");
  if (!code || !expected || params.get("state") !== expected) return fail("state");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: auth.config.clientId, client_secret: auth.config.clientSecret, code, redirect_uri: `${origin}/api/auth/callback` }),
    cache: "no-store",
  });
  const token = tokenRes.ok ? ((await tokenRes.json()) as { access_token?: string }).access_token : undefined;
  if (!token) return fail("github");
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "mad-factory" },
    cache: "no-store",
  });
  const login = userRes.ok ? ((await userRes.json()) as { login?: string }).login : undefined;
  if (!login) return fail("github");
  if (!isAllowed(auth.config, login)) return fail("not_allowed");

  const session = await signSession({ login: login.toLowerCase(), exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }, auth.config.secret);
  const res = NextResponse.redirect(new URL(safeNext(decodeURIComponent(nextEncoded ?? "")), origin));
  res.cookies.set(SESSION_COOKIE, session, cookieOptions(origin, SESSION_TTL_SECONDS));
  res.cookies.delete({ name: STATE_COOKIE, path: "/api/auth" });
  return res;
}
