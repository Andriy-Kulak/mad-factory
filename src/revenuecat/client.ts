/**
 * RevenueCat API v2 client (https://api.revenuecat.com/v2), read-only. No dependencies.
 * Credentials: REVENUECAT_API_KEY, a v2 secret key with read-only Charts & metrics access.
 * The project id is per call; it lives in tracked_sources.value, never in env or code. The key is never printed.
 */
import { optionalEnv } from "../lib/env.ts";

const API = "https://api.revenuecat.com/v2";
/** Charts & metrics allow 25 requests per minute per key. */
const CHARTS_MIN_INTERVAL_MS = 2500;
const MAX_RETRIES = 3;

export function loadApiKey(): string {
  const key = optionalEnv("REVENUECAT_API_KEY");
  if (!key) throw new Error("RevenueCat credentials missing: set REVENUECAT_API_KEY (see .env.example)");
  return key;
}

export type Query = Record<string, string | number | boolean | undefined>;

export class RevenueCatClient {
  calls = 0;
  private lastCallAt = 0;
  private readonly apiKey: string;
  private readonly minIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, minIntervalMs = CHARTS_MIN_INTERVAL_MS, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.minIntervalMs = minIntervalMs;
    this.sleep = sleep;
    this.fetchImpl = fetchImpl;
  }

  async get<T>(path: string, query: Query = {}): Promise<T> {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastCallAt + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastCallAt = Date.now();
      this.calls++;
      const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" } });
      const text = await res.text();
      if (res.ok) return JSON.parse(text) as T;
      const body = parse(text);
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        const backoff = Number(body?.backoff_ms) || Number(res.headers.get("retry-after")) * 1000 || 5000 * (attempt + 1);
        await this.sleep(backoff);
        continue;
      }
      throw new Error(`RevenueCat GET ${url.pathname} failed: ${res.status} ${body?.type ?? ""} ${body?.message ?? text.slice(0, 200)}`.trim());
    }
  }
}

function parse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
