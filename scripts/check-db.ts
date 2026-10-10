/** Smoke test: verify Supabase connectivity and that all expected tables exist. */
import { getDb } from "../src/db/client.ts";

// A HEAD count request succeeds even for unknown tables, so select a real column.
const tables = ["products", "tracked_sources", "ads", "creatives", "ad_creatives", "product_ads", "scrape_runs",
  "experiments", "experiment_campaigns", "apple_ads_campaigns", "apple_ads_keywords", "apple_ads_keyword_daily",
  "apple_ads_search_terms_daily", "apple_ads_changes"] as const;
const db = getDb();
let ok = true;
for (const t of tables) {
  const res = await db.from(t).select("*").limit(1);
  if (res.error) {
    ok = false;
    console.log(`x ${t}: ${res.error.message}`);
  } else console.log(`✓ ${t}`);
}
if (!ok) console.log("\nTables missing. Run: pnpm db:migrate (needs SUPABASE_DB_URL) or `supabase db push`.");
process.exit(ok ? 0 : 1);
