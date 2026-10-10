import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "../lib/env.ts";
import type { Database } from "./types.ts";
import { skewRetryFetch } from "./skew-retry.ts";

export type Db = SupabaseClient<Database>;

let cached: Db | null = null;

/** Service-role client for server-side use. Lazily created so CLIs that don't touch the DB never need creds. */
export function getDb(): Db {
  if (cached) return cached;
  cached = createClient<Database>(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: skewRetryFetch() },
  });
  return cached;
}

/** Throw a readable error for a PostgREST failure. */
export function unwrap<T>(res: { data: T; error: { message: string; code?: string } | null }, ctx: string): NonNullable<T> {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}${res.error.code ? ` (${res.error.code})` : ""}`);
  if (res.data == null) throw new Error(`${ctx}: no data returned`);
  return res.data as NonNullable<T>;
}
