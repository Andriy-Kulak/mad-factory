/**
 * Post-scrape audit against the live Supabase project.
 * Reports row counts and null rates for the fields part 2 depends on, plus
 * integrity checks (ads without products, video ads without creatives).
 * Exit 1 when a hard check fails.
 *
 *   pnpm db:audit
 */
import { getDb } from "../src/db/client.ts";

const db = getDb();
let failed = false;
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "–");

async function count(table: "products" | "tracked_sources" | "ads" | "creatives" | "ad_creatives" | "product_ads" | "scrape_runs", apply?: (q: any) => any): Promise<number> {
  let q: any = db.from(table).select("*", { count: "exact", head: true });
  if (apply) q = apply(q);
  const r = await q;
  if (r.error) throw new Error(`${table}: ${r.error.message}`);
  return r.count ?? 0;
}

const tables = ["products", "tracked_sources", "ads", "creatives", "ad_creatives", "product_ads", "scrape_runs"] as const;
console.log("Row counts");
for (const t of tables) console.log(`  ${t.padEnd(16)} ${await count(t)}`);

const ads = await count("ads");
console.log("\nads field coverage (non-null)");
const fields = ["advertiser_id", "advertiser_name", "body_text", "title", "link_url", "cta_text", "start_date", "is_active", "collation_id", "collation_count", "reach_estimate", "spend", "currency", "total_active_time"] as const;
for (const f of fields) {
  const n = await count("ads", (q) => q.not(f, "is", null));
  console.log(`  ${f.padEnd(18)} ${String(n).padStart(5)} / ${ads}  ${pct(n, ads)}`);
}
const rawEmpty = await count("ads", (q) => q.eq("raw", "{}"));
console.log(`  raw (empty)        ${rawEmpty}${rawEmpty ? "  <- FAIL: ads with empty raw payload" : ""}`);
if (rawEmpty) failed = true;

console.log("\nIntegrity");
const linked = await db.from("product_ads").select("ad_id");
if (linked.error) throw new Error(linked.error.message);
const linkedIds = new Set((linked.data ?? []).map((r) => r.ad_id));
const allAds = await db.from("ads").select("id, raw");
if (allAds.error) throw new Error(allAds.error.message);
const orphanAds = (allAds.data ?? []).filter((a) => !linkedIds.has(a.id)).length;
console.log(`  ads not linked to any product   ${orphanAds}${orphanAds ? "  <- FAIL" : ""}`);
if (orphanAds) failed = true;

const withCreative = await db.from("ad_creatives").select("ad_id");
if (withCreative.error) throw new Error(withCreative.error.message);
const creativeIds = new Set((withCreative.data ?? []).map((r) => r.ad_id));
const videoAdsMissing = (allAds.data ?? []).filter((a) => {
  const snap = (a.raw as any)?.snapshot ?? {};
  const hasVideo = [...(snap.videos ?? []), ...(snap.cards ?? [])].some((v: any) => v?.video_hd_url || v?.video_sd_url);
  return hasVideo && !creativeIds.has(a.id);
}).length;
console.log(`  video ads without a creative    ${videoAdsMissing}  (expected 0 unless scraped with --no-download or a download failed)`);

const noUrl = await count("creatives", (q) => q.is("public_url", null));
console.log(`  creatives without public_url    ${noUrl}  (0 when R2_PUBLIC_URL is set)`);

const errored = await count("scrape_runs", (q) => q.eq("status", "error"));
const running = await count("scrape_runs", (q) => q.eq("status", "running"));
console.log(`  scrape runs errored / stuck     ${errored} / ${running}`);

console.log(failed ? "\nAudit FAILED" : "\nAudit passed");
process.exit(failed ? 1 : 0);
