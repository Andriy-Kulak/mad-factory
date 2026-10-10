import "server-only";
import { getDb } from "./db";
import type { AppleAdsCampaignRow, AppleAdsKeywordDailyRow, AppleAdsKeywordRow, AppleAdsTermPopularityRow } from "@db/types";

export interface KeywordPopularity extends AppleAdsTermPopularityRow {
  /** Where we bid on this exact text (any match type), with impressions/taps/installs over `since`. */
  targeted: { campaignName: string; matchType: string; bid: number | null; impressions: number; taps: number; installs: number }[];
}

export interface AppleKeywords {
  rows: KeywordPopularity[];
  lastPulledAt: string | null;
  since: string;
  /** Set when the table does not exist yet (migration not applied). */
  unavailable: string | null;
}

export async function getAppleKeywords(productId: string, days: number): Promise<AppleKeywords> {
  const db = getDb();
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const pop = await db.from("apple_ads_term_popularity").select("*").eq("product_id", productId).order("popularity", { ascending: false, nullsFirst: false }).order("term");
  if (pop.error) return { rows: [], lastPulledAt: null, since, unavailable: pop.error.message };

  const campaigns = await db.from("apple_ads_campaigns").select("id,name").eq("product_id", productId).eq("deleted", false);
  if (campaigns.error) throw new Error(`apple_ads_campaigns: ${campaigns.error.message}`);
  const names = new Map((campaigns.data as Pick<AppleAdsCampaignRow, "id" | "name">[]).map((c) => [c.id, c.name]));
  const ids = [...names.keys()];
  const [kw, daily] = ids.length
    ? await Promise.all([
        db.from("apple_ads_keywords").select("id,campaign_id,text,match_type,bid").in("campaign_id", ids).eq("is_negative", false).eq("deleted", false),
        db.from("apple_ads_keyword_daily").select("keyword_id,impressions,taps,tap_installs").in("campaign_id", ids).gte("date", since),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (kw.error) throw new Error(`apple_ads_keywords: ${kw.error.message}`);
  if (daily.error) throw new Error(`apple_ads_keyword_daily: ${daily.error.message}`);

  const perf = new Map<number, { impressions: number; taps: number; installs: number }>();
  for (const d of (daily.data ?? []) as Pick<AppleAdsKeywordDailyRow, "keyword_id" | "impressions" | "taps" | "tap_installs">[]) {
    const t = perf.get(d.keyword_id) ?? perf.set(d.keyword_id, { impressions: 0, taps: 0, installs: 0 }).get(d.keyword_id)!;
    t.impressions += d.impressions; t.taps += d.taps; t.installs += d.tap_installs;
  }
  const byText = new Map<string, KeywordPopularity["targeted"]>();
  for (const k of (kw.data ?? []) as Pick<AppleAdsKeywordRow, "id" | "campaign_id" | "text" | "match_type" | "bid">[]) {
    const t = perf.get(k.id) ?? { impressions: 0, taps: 0, installs: 0 };
    const list = byText.get(k.text.toLowerCase()) ?? byText.set(k.text.toLowerCase(), []).get(k.text.toLowerCase())!;
    list.push({ campaignName: names.get(k.campaign_id) ?? String(k.campaign_id), matchType: k.match_type, bid: k.bid == null ? null : Number(k.bid), ...t });
  }

  const rows = (pop.data ?? []).map((p) => ({ ...p, targeted: byText.get(p.term) ?? [] }));
  const lastPulledAt = rows.reduce<string | null>((m, r) => (m == null || r.pulled_at > m ? r.pulled_at : m), null);
  return { rows, lastPulledAt, since, unavailable: null };
}
