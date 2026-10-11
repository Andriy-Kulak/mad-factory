/**
 * Apple Ads Platform API client (https://api.ads.apple.com/v1). No dependencies.
 *
 * Credentials are infrastructure only and are split by access level:
 *   - read  (default): APPLE_ADS_READ_DIR or the APPLE_ADS_READ_* four; falls back to the legacy
 *     APPLE_ADS_DIR / APPLE_ADS_* names until the secrets are renamed. Enough for every sync,
 *     research call and `read()`/GET, including POSTs to `/query` endpoints.
 *   - write: APPLE_ADS_WRITE_DIR or the APPLE_ADS_WRITE_* four, set only on the machine where the
 *     owner approves writes. A client built with read credentials refuses any write call
 *     (PUT, DELETE or a non-/query POST) before the token exchange.
 * Each directory holds credentials.json ({ clientId, teamId, keyId, privateKeyPath }) and a
 * token-cache.json this client maintains; the four-var form takes PEM text, for CI.
 * The ad account id is per call; it lives in tracked_sources.config, never in env or code.
 * Secrets are never printed or stored outside the token cache.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { optionalEnv } from "../lib/env.ts";

const API = "https://api.ads.apple.com/v1";
const TOKEN_URL = "https://appleid.apple.com/auth/oauth2/token";

export interface AppleAdsCredentials {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  /** "read" clients refuse write calls; "write" clients may send them. */
  access: "read" | "write";
  /** Where to cache the access token; undefined keeps it in memory only. */
  tokenCachePath?: string;
}

export interface ApiResponse<T = unknown> {
  status: number;
  /** Parsed JSON body, or the raw text when the body is not JSON (e.g. a 503 HTML page). */
  data: T;
  rateLimitRemaining: number | null;
  retryAfterSeconds: number | null;
}

export function loadCredentials(access: "read" | "write" = "read"): AppleAdsCredentials {
  const prefix = access === "write" ? "APPLE_ADS_WRITE" : "APPLE_ADS_READ";
  const dir = optionalEnv(`${prefix}_DIR`) ?? (access === "read" ? optionalEnv("APPLE_ADS_DIR") : undefined);
  if (dir) {
    const c = JSON.parse(fs.readFileSync(path.join(dir, "credentials.json"), "utf8")) as Record<string, string>;
    const keyPath = c.privateKeyPath ?? path.join(dir, "private-key.pem");
    return {
      clientId: need(c.clientId, "clientId"),
      teamId: need(c.teamId, "teamId"),
      keyId: need(c.keyId, "keyId"),
      privateKeyPem: fs.readFileSync(keyPath, "utf8"),
      access,
      tokenCachePath: path.join(dir, "token-cache.json"),
    };
  }
  // Reads fall back to the legacy APPLE_ADS_* names; writes never do.
  const legacy = access === "read";
  const clientId = optionalEnv(`${prefix}_CLIENT_ID`) ?? (legacy ? optionalEnv("APPLE_ADS_CLIENT_ID") : undefined);
  if (!clientId) {
    const names = access === "write" ? "APPLE_ADS_WRITE_DIR or the APPLE_ADS_WRITE_* variables" : "APPLE_ADS_READ_DIR, the APPLE_ADS_READ_* variables, or the legacy APPLE_ADS_DIR / APPLE_ADS_*";
    throw new Error(`Apple Ads ${access} credentials missing: set ${names} (see .env.example)`);
  }
  const var_ = (name: string) => optionalEnv(`${prefix}_${name}`) ?? (legacy ? optionalEnv(`APPLE_ADS_${name}`) : undefined);
  return {
    clientId,
    teamId: need(var_("TEAM_ID"), `${prefix}_TEAM_ID`),
    keyId: need(var_("KEY_ID"), `${prefix}_KEY_ID`),
    privateKeyPem: normalizePem(need(var_("PRIVATE_KEY"), `${prefix}_PRIVATE_KEY`)),
    access,
  };
}

/** Secret stores often flatten a PEM to one line or escape its newlines; restore the 64-column body. */
export function normalizePem(pem: string): string {
  const m = pem.replace(/\\n/g, "\n").trim().match(/^(-----BEGIN [A-Z ]+-----)([\s\S]*?)(-----END [A-Z ]+-----)$/);
  if (!m) return pem;
  const body = (m[2] ?? "").replace(/\s+/g, "");
  return `${m[1]}\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n${m[3]}\n`;
}

function need(v: string | undefined, name: string): string {
  if (!v) throw new Error(`Apple Ads credentials: ${name} is missing`);
  return v;
}

/** ES256 JWT used as the OAuth client secret. */
export function buildClientSecret(c: AppleAdsCredentials, nowSeconds: number, lifetimeSeconds = 3600): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "ES256", kid: c.keyId })}.${b64({
    iss: c.teamId,
    sub: c.clientId,
    aud: "https://appleid.apple.com",
    iat: nowSeconds,
    exp: nowSeconds + lifetimeSeconds,
  })}`;
  const signature = crypto
    .sign("sha256", Buffer.from(unsigned), { key: c.privateKeyPem, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${unsigned}.${signature}`;
}

/** Apple uses POST for read-only queries; only these count as changes to the ad account. */
export function isWrite(method: string, apiPath: string): boolean {
  const m = method.toUpperCase();
  if (m === "PUT" || m === "DELETE") return true;
  return m === "POST" && !apiPath.endsWith("/query");
}

export class AppleAdsClient {
  private readonly creds: AppleAdsCredentials;
  private readonly fetchFn: typeof fetch;
  private token: { accessToken: string; expiresAt: number } | null = null;
  calls = 0;
  rateLimitRemaining: number | null = null;

  constructor(creds: AppleAdsCredentials, fetchFn: typeof fetch = fetch) {
    this.creds = creds;
    this.fetchFn = fetchFn;
  }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (!this.token && this.creds.tokenCachePath) {
      try {
        // expiresAt is epoch seconds, the format earlier operator tooling wrote.
        this.token = JSON.parse(fs.readFileSync(this.creds.tokenCachePath, "utf8"));
      } catch {}
    }
    if (this.token?.accessToken && this.token.expiresAt - now > 120) return this.token.accessToken;

    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.creds.clientId,
        client_secret: buildClientSecret(this.creds, now),
        grant_type: "client_credentials",
        scope: "searchadsorg",
      }),
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!json.access_token) throw new Error(`Apple Ads token exchange failed (${res.status}): ${json.error ?? "unknown error"}`);
    this.token = { accessToken: json.access_token, expiresAt: now + (json.expires_in ?? 3600) };
    if (this.creds.tokenCachePath) fs.writeFileSync(this.creds.tokenCachePath, JSON.stringify(this.token), { mode: 0o600 });
    return this.token.accessToken;
  }

  async call<T = unknown>(adAccountId: number, method: string, apiPath: string, body?: unknown): Promise<ApiResponse<T>> {
    if (isWrite(method, apiPath) && this.creds.access !== "write") {
      throw new Error("Apple Ads write blocked: this client has read credentials; writes need APPLE_ADS_WRITE_* (playbooks/ad-changes.md)");
    }
    const res = await this.fetchFn(API + apiPath, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "X-AP-Context": `adAccountId=${adAccountId}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    const num = (h: string) => (res.headers.get(h) == null ? null : Number(res.headers.get(h)));
    this.calls++;
    this.rateLimitRemaining = num("ratelimit-remaining");
    return { status: res.status, data: data as T, rateLimitRemaining: this.rateLimitRemaining, retryAfterSeconds: num("retry-after") };
  }

  /**
   * Read-only call that returns `result`. Waits once on 429, never retries validation errors,
   * and stops before the rate limit is exhausted.
   */
  async read<T>(adAccountId: number, method: "GET" | "POST", apiPath: string, body?: unknown): Promise<{ result: T; pagination?: Pagination }> {
    if (isWrite(method, apiPath)) throw new Error(`read() refused a write call: ${method} ${apiPath}`);
    if (this.rateLimitRemaining != null && this.rateLimitRemaining < 20) {
      throw new Error(`Apple Ads rate limit nearly exhausted (${this.rateLimitRemaining} remaining); stopping`);
    }
    let res = await this.call<{ result: T; pagination?: Pagination }>(adAccountId, method, apiPath, body);
    if (res.status === 429 && res.retryAfterSeconds != null && res.retryAfterSeconds <= 120) {
      await new Promise((r) => setTimeout(r, (res.retryAfterSeconds! + 1) * 1000));
      res = await this.call(adAccountId, method, apiPath, body);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Apple Ads ${method} ${apiPath}: HTTP ${res.status}. The API key may be revoked or its user removed from the ad account.`);
    }
    if (res.status >= 400) throw new Error(`Apple Ads ${method} ${apiPath}: HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 500)}`);
    return res.data;
  }

  /** Follows offset pagination of a `/query` endpoint whose `result` is an array. */
  async queryAll<T>(adAccountId: number, apiPath: string, body: Record<string, unknown> = {}, pageSize = 200): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.read<T[]>(adAccountId, "POST", apiPath, { ...body, pagination: { offset, pageSize } });
      const rows = page.result ?? [];
      out.push(...rows);
      if (rows.length < pageSize) return out;
    }
  }
}

export interface Pagination {
  offset: number;
  pageSize: number;
  totalCount?: number;
}
