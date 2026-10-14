import "server-only";
import { cachedByProduct } from "./cache";
import { getDb } from "./db";
import { fetchAll } from "./apple-ads";
import { rollup, type MetaAdsRollup } from "./meta-ads-rollup";
import type { MetaAdsAdDailyBreakdownRow, MetaAdsAdDailyRow, MetaAdsAdRow, MetaAdsAdsetRow, MetaAdsCampaignRow, MetaAdsCreativeRow, ScrapeRunRow } from "@db/types";

export interface MetaAdsOverview extends MetaAdsRollup {
  since: string;
  until: string;
  lastRun: ScrapeRunRow | null;
}

/** Owned Meta Ads account data for a product, or null when the meta_ads tables are not there yet (migration not applied). */
export async function getMetaAdsOverview(productId: string, { since, until }: { since: string; until: string }): Promise<MetaAdsOverview | null> {
  const db = getDb();
  const campaignsRes = await db.from("meta_ads_campaigns").select("*").eq("product_id", productId).order("name");
  if (campaignsRes.error) {
    if (/meta_ads_campaigns/.test(campaignsRes.error.message)) return null;
    throw new Error(`meta_ads_campaigns: ${campaignsRes.error.message}`);
  }
  const campaigns = campaignsRes.data ?? [];
  const ids = campaigns.map((c) => c.id);
  const [adsets, ads, creatives, daily, countries, run] = await Promise.all([
    ids.length ? fetchAll<MetaAdsAdsetRow>((a, b) => db.from("meta_ads_adsets").select("*").in("campaign_id", ids).order("id").range(a, b), "meta_ads_adsets") : Promise.resolve([]),
    ids.length ? fetchAll<MetaAdsAdRow>((a, b) => db.from("meta_ads_ads").select("*").in("campaign_id", ids).order("id").range(a, b), "meta_ads_ads") : Promise.resolve([]),
    fetchAll<MetaAdsCreativeRow>((a, b) => db.from("meta_ads_creatives").select("*").eq("product_id", productId).order("id").range(a, b), "meta_ads_creatives"),
    fetchAll<MetaAdsAdDailyRow>(
      (a, b) => db.from("meta_ads_ad_daily").select("*").eq("product_id", productId).gte("date", since).lte("date", until).order("date").order("ad_id").range(a, b),
      "meta_ads_ad_daily",
    ),
    fetchAll<MetaAdsAdDailyBreakdownRow>(
      (a, b) =>
        db
          .from("meta_ads_ad_daily_breakdowns")
          .select("*")
          .eq("product_id", productId)
          .eq("breakdown", "country")
          .gte("date", since)
          .lte("date", until)
          .order("date")
          .order("ad_id")
          .order("value")
          .range(a, b),
      "meta_ads_ad_daily_breakdowns",
    ),
    db.from("scrape_runs").select("*").eq("product_id", productId).eq("source", "meta_ads").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (run.error) throw new Error(`scrape_runs: ${run.error.message}`);
  return { ...rollup(campaigns, adsets, ads, creatives, daily, countries), since, until, lastRun: run.data };
}

export const getMetaAdsOverviewCached = cachedByProduct("metaAdsOverview", getMetaAdsOverview);
