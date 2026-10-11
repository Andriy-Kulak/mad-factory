import { getDb, unwrap } from "./client.ts";
import type { AppleAdsCampaignInsert, AppleAdsKeywordDailyInsert, AppleAdsKeywordInsert, AppleAdsSearchTermDailyInsert, AppleAdsTermPopularityInsert, Json, TrackedSourceRow } from "./types.ts";

const CHUNK = 500;
const PAGE_SIZE = 1000;

async function upsertChunks<T>(rows: T[], write: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>, ctx: string): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await write(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`${ctx}: ${error.message}`);
  }
  return rows.length;
}

/** Enabled tracked sources of one platform, for one product or (productId undefined) all products. */
export async function listTrackedSourcesBySource(source: string, productId?: string): Promise<TrackedSourceRow[]> {
  let q = getDb().from("tracked_sources").select("*").eq("source", source).eq("enabled", true);
  if (productId) q = q.eq("product_id", productId);
  return unwrap(await q.order("created_at"), "listTrackedSourcesBySource");
}

export function upsertAppleAdsCampaigns(rows: AppleAdsCampaignInsert[]): Promise<number> {
  return upsertChunks(rows, (c) => getDb().from("apple_ads_campaigns").upsert(c, { onConflict: "id" }), "upsertAppleAdsCampaigns");
}

export function upsertAppleAdsKeywords(rows: AppleAdsKeywordInsert[]): Promise<number> {
  return upsertChunks(rows, (c) => getDb().from("apple_ads_keywords").upsert(c, { onConflict: "id,is_negative" }), "upsertAppleAdsKeywords");
}

export function upsertAppleAdsKeywordDaily(rows: AppleAdsKeywordDailyInsert[]): Promise<number> {
  return upsertChunks(rows, (c) => getDb().from("apple_ads_keyword_daily").upsert(c, { onConflict: "date,keyword_id,country" }), "upsertAppleAdsKeywordDaily");
}

export function upsertAppleAdsSearchTermsDaily(rows: AppleAdsSearchTermDailyInsert[]): Promise<number> {
  return upsertChunks(rows, (c) => getDb().from("apple_ads_search_terms_daily").upsert(c, { onConflict: "date,campaign_id,keyword_id,search_term,country" }), "upsertAppleAdsSearchTermsDaily");
}

export async function setAppleAdsBidRecommendation(keywordId: number, recommendation: Json, at: string): Promise<void> {
  const { error } = await getDb().from("apple_ads_keywords").update({ bid_recommendation: recommendation, bid_recommendation_at: at }).eq("id", keywordId).eq("is_negative", false);
  if (error) throw new Error(`setAppleAdsBidRecommendation: ${error.message}`);
}

/** One row per (product, country, term); a re-pull overwrites popularity and pulled_at. */
export async function upsertTermPopularity(rows: AppleAdsTermPopularityInsert[]): Promise<number> {
  return upsertChunks(rows, (c) => getDb().from("apple_ads_term_popularity").upsert(c, { onConflict: "product_id,country,term" }), "upsertTermPopularity");
}

export async function listTermPopularityTerms(productId: string): Promise<Set<string>> {
  const db = getDb();
  const terms = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = unwrap(
      await db
        .from("apple_ads_term_popularity")
        .select("term")
        .eq("product_id", productId)
        .range(from, from + PAGE_SIZE - 1),
      "listTermPopularityTerms",
    );
    for (const row of rows) terms.add(row.term);
    if (rows.length < PAGE_SIZE) return terms;
  }
}
