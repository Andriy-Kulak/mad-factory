import "server-only";
import { cookies } from "next/headers";
import { readAuthConfig, SESSION_COOKIE, verifySession } from "./session";

/** The public origin GitHub redirects back to. AUTH_URL overrides it behind a proxy that rewrites the host. */
export function appOrigin(requestOrigin: string): string {
  return (process.env.AUTH_URL ?? requestOrigin).replace(/\/+$/, "");
}

export const cookieOptions = (origin: string, maxAge: number, path = "/") => ({ httpOnly: true, sameSite: "lax" as const, secure: origin.startsWith("https:"), path, maxAge });

/** The signed-in GitHub username, or null (signed out, or sign-in is off in local dev). */
export async function currentUser(): Promise<string | null> {
  const auth = readAuthConfig();
  if (auth.disabled || !auth.config) return null;
  return (await verifySession((await cookies()).get(SESSION_COOKIE)?.value, auth.config))?.login ?? null;
}

/**
 * Throws unless the request comes from a signed-in owner. The proxy already gates every route; server actions
 * call this as well so they stay protected if the proxy matcher ever changes.
 */
export async function requireOwner(): Promise<void> {
  const auth = readAuthConfig();
  if (auth.disabled) return;
  if (!auth.config) throw new Error(`Sign-in is not configured: set ${auth.missing.join(", ")}`);
  if (!(await verifySession((await cookies()).get(SESSION_COOKIE)?.value, auth.config))) throw new Error("Not signed in");
}
