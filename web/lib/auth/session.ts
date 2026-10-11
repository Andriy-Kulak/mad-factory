/**
 * Owner sign-in: GitHub OAuth, allowlisted by numeric GitHub user ID (usernames can be renamed and re-registered),
 * kept in an HMAC-signed cookie.
 * Web Crypto only, so the proxy, route handlers and node --test can all import it.
 */

export const SESSION_COOKIE = "mf_session";
export const STATE_COOKIE = "mf_oauth_state";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface Session {
  /** Numeric GitHub user ID; the allowlist is checked against this. */
  id: number;
  /** GitHub username at sign-in, lowercase; for display only. */
  login: string;
  /** Expiry, unix seconds. */
  exp: number;
}

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  secret: string;
  /** Numeric GitHub user IDs, as decimal strings. */
  allowed: string[];
}

const ALLOWED_IDS_VAR = "AUTH_ALLOWED_GITHUB_IDS";

/**
 * Sign-in settings, or the name of what is missing. AUTH_DISABLED=true turns the gate off outside
 * production only (local `next dev`); a production build always requires sign-in.
 */
export function readAuthConfig(env: Record<string, string | undefined> = process.env): { disabled: true } | { disabled: false; config: AuthConfig | null; missing: string[] } {
  if (env.AUTH_DISABLED === "true" && env.NODE_ENV !== "production") return { disabled: true };
  const allowed = (env[ALLOWED_IDS_VAR] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const idsOk = allowed.length > 0 && allowed.every((id) => /^[1-9]\d*$/.test(id));
  const missing = [
    !env.AUTH_GITHUB_CLIENT_ID && "AUTH_GITHUB_CLIENT_ID",
    !env.AUTH_GITHUB_CLIENT_SECRET && "AUTH_GITHUB_CLIENT_SECRET",
    (env.AUTH_SECRET ?? "").length < 32 && "AUTH_SECRET (32+ characters)",
    !idsOk && `${ALLOWED_IDS_VAR} (numeric GitHub user IDs)`,
  ].filter((m): m is string => Boolean(m));
  if (missing.length) return { disabled: false, config: null, missing };
  return { disabled: false, missing, config: { clientId: env.AUTH_GITHUB_CLIENT_ID!, clientSecret: env.AUTH_GITHUB_CLIENT_SECRET!, secret: env.AUTH_SECRET!, allowed } };
}

export const isAllowed = (config: AuthConfig, id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id > 0 && config.allowed.includes(String(id));

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** `<payload>.<signature>`, both base64url. */
export async function signSession(session: Session, secret: string): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(session)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(sig))}`;
}

/** The session when the signature checks out, it has not expired and the user is still on the allowlist. */
export async function verifySession(token: string | undefined, config: AuthConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(config.secret, "verify"), fromBase64url(sig) as BufferSource, encoder.encode(payload));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as Partial<Session>;
    if (typeof s.login !== "string" || typeof s.exp !== "number" || s.exp <= nowSeconds || !isAllowed(config, s.id)) return null;
    return { id: s.id as number, login: s.login, exp: s.exp };
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Only same-site paths survive a login round trip ("/p/x", not "//evil.com" or "https://…"). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
