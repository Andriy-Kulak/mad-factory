import { getDb, unwrap } from "./client.ts";
import type { RevenueCatKeywordDailyInsert } from "./types.ts";

const CHUNK = 500;

export async function upsertRevenueCatKeywordDaily(rows: RevenueCatKeywordDailyInsert[]): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await getDb()
      .from("revenuecat_keyword_daily")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "tracked_source_id,date,campaign,keyword" });
    if (error) throw new Error(`upsertRevenueCatKeywordDaily: ${error.message}`);
  }
  return rows.length;
}

/** Apple Ads campaigns and targeting keywords of a product, for matching RevenueCat's attribution names to ids. */
export async function appleAdsNames(productId: string): Promise<{ campaigns: { id: number; name: string }[]; keywords: { id: number; campaign_id: number; text: string }[] }> {
  const campaigns = unwrap(await getDb().from("apple_ads_campaigns").select("id,name").eq("product_id", productId), "appleAdsNames campaigns");
  if (!campaigns.length) return { campaigns, keywords: [] };
  const keywords = unwrap(
    await getDb().from("apple_ads_keywords").select("id,campaign_id,text").in("campaign_id", campaigns.map((c) => c.id)).eq("is_negative", false),
    "appleAdsNames keywords",
  );
  return { campaigns, keywords };
}
