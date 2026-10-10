import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@db/types";
import { skewRetryFetch } from "../../src/db/skew-retry.ts";
import { MissingConfigError, missingConfigMessage } from "../../src/lib/integrations.ts";

export type Db = SupabaseClient<Database>;

let cached: Db | null = null;

/** Service-role client; server components and actions only. Never import from client components. */
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new MissingConfigError(missingConfigMessage("supabase"));
  cached = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: skewRetryFetch() } });
  return cached;
}
