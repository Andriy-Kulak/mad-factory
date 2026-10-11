import {
  finishScrapeRun,
  markSourceScraped,
  startScrapeRun,
  upsertMetaAdsAdDaily,
  upsertMetaAdsAdDailyBreakdowns,
  upsertMetaAdsAds,
  upsertMetaAdsAdsets,
  upsertMetaAdsCampaigns,
  upsertMetaAdsCreatives,
  type TrackedSourceRow,
} from "../db/index.ts";
import type { MetaAdsClient } from "./client.ts";
import { adRow, adsetRow, breakdownRow, campaignRow, creativeRow, dailyRow } from "./map.ts";
import type { ActionTypeConfig, ApiObject } from "./types.ts";
import { dateInZone } from "../apple-ads/map.ts";

export const SOURCE = "meta_ads";
export const MAX_DAYS = 28;

const CAMPAIGN_FIELDS = "id,name,objective,status,effective_status,daily_budget,lifetime_budget,bid_strategy,created_time,updated_time";
const ADSET_FIELDS =
  "id,campaign_id,name,status,effective_status,optimization_goal,billing_event,bid_amount,daily_budget,lifetime_budget,targeting,promoted_object,learning_stage_info,is_skadnetwork_attribution";
const CREATIVE_FIELDS = "id,name,title,body,call_to_action_type,video_id,image_hash,thumbnail_url,object_story_spec,asset_feed_spec";
// Exported: launch mirrors freshly created ads with exactly the sync's fields.
export const AD_FIELDS = `id,name,adset_id,campaign_id,status,effective_status,issues_info,created_time,updated_time,creative{${CREATIVE_FIELDS}}`;
const INSIGHT_FIELDS =
  "date_start,ad_id,campaign_id,adset_id,impressions,reach,clicks,inline_link_clicks,spend,actions,conversions,cost_per_action_type,video_p25_watched_actions,video_p50_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking";

export interface SyncOptions {
  days: number | "auto";
  dryRun: boolean;
  log: (line: string) => void;
  now?: Date;
}

export interface SyncStats {
  days: number;
  campaigns: number;
  adsets: number;
  creatives: number;
  ads: number;
  dailyRows: number;
  breakdownRows: number;
  warnings: string[];
}

interface AccountConfig {
  accountId: string;
  actionTypes: ActionTypeConfig;
}

function accountConfig(ts: TrackedSourceRow): AccountConfig {
  if (ts.source !== SOURCE || ts.kind !== "ad_account") throw new Error(`Tracked source ${ts.id} is not a ${SOURCE} ad_account`);
  if (!/^act_\d+$/.test(ts.value)) throw new Error(`Tracked source ${ts.id}: value must match act_<digits>`);
  const config = (ts.config ?? {}) as Record<string, unknown>;
  const rawActions = config.action_types && typeof config.action_types === "object" ? (config.action_types as Record<string, unknown>) : {};
  const actionTypes: ActionTypeConfig = {};
  for (const key of ["installs", "trials", "purchases"] as const) {
    const values = rawActions[key];
    if (Array.isArray(values) && values.every((value) => typeof value === "string")) actionTypes[key] = values as string[];
  }
  return { accountId: ts.value, actionTypes };
}

export function autoDays(lastScrapedAt: string | null, now = new Date(), timezone = "UTC"): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
  if (weekday === "Mon" || !lastScrapedAt) return MAX_DAYS;
  const today = dateInZone(timezone, 0, now);
  const lastDate = dateInZone(timezone, 0, new Date(lastScrapedAt));
  const gap = Math.ceil((new Date(`${today}T12:00:00Z`).getTime() - new Date(`${lastDate}T12:00:00Z`).getTime()) / 86_400_000);
  return Math.min(MAX_DAYS, Math.max(7, gap + 1));
}

function insightParams(since: string, until: string, breakdown?: string) {
  return {
    level: "ad",
    time_increment: 1,
    time_range: JSON.stringify({ since, until }),
    filtering: JSON.stringify([{ field: "impressions", operator: "GREATER_THAN", value: 0 }]),
    fields: INSIGHT_FIELDS,
    limit: 500,
    ...(breakdown ? { breakdowns: breakdown } : {}),
  };
}

export async function syncAccount(client: MetaAdsClient, ts: TrackedSourceRow, options: SyncOptions): Promise<SyncStats> {
  const { accountId, actionTypes } = accountConfig(ts);
  const stats: SyncStats = { days: 0, campaigns: 0, adsets: 0, creatives: 0, ads: 0, dailyRows: 0, breakdownRows: 0, warnings: [] };
  const runId = options.dryRun ? null : await startScrapeRun({ product_id: ts.product_id, tracked_source_id: ts.id, source: SOURCE });

  try {
    const account = await client.get<ApiObject>(`/${accountId}`, { fields: "name,currency,timezone_name,account_status" });
    const currency = String(account.currency ?? "");
    const timezone = String(account.timezone_name ?? "");
    if (!currency) throw new Error(`Meta account ${accountId} returned no currency`);
    if (!timezone) throw new Error(`Meta account ${accountId} returned no timezone_name`);

    const days = options.days === "auto" ? autoDays(ts.last_scraped_at, options.now ?? new Date(), timezone) : options.days;
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new Error(`days must be a whole number from 1 to ${MAX_DAYS}`);
    stats.days = days;
    const syncedAt = new Date().toISOString();
    const until = dateInZone(timezone, 0, options.now);
    const since = dateInZone(timezone, days - 1, options.now);
    options.log(`Trailing ${days} day(s) (${since} through ${until})`);
    const campaigns = await client.getAll<ApiObject>(`/${accountId}/campaigns`, { fields: CAMPAIGN_FIELDS, limit: 200 });
    const allAdsets = await client.getAll<ApiObject>(`/${accountId}/adsets`, { fields: ADSET_FIELDS, limit: 200 });
    const allAds = await client.getAll<ApiObject>(`/${accountId}/ads`, { fields: AD_FIELDS, limit: 200 });

    const campaignIds = new Set(campaigns.map((campaign) => String(campaign.id)));
    const eligibleAdsets = allAdsets.filter((adset) => {
      const campaignId = String(adset.campaign_id ?? "");
      if (campaignIds.has(campaignId)) return true;
      stats.warnings.push(`Skipped ad set ${String(adset.id)} because its campaign was not returned`);
      return false;
    });
    const adsetById = new Map(eligibleAdsets.map((adset) => [String(adset.id), adset]));
    const eligibleAds = allAds.filter((ad) => {
      const adset = adsetById.get(String(ad.adset_id ?? ""));
      if (!adset) {
        stats.warnings.push(`Skipped ad ${String(ad.id)} because its ad set was not returned`);
        return false;
      }
      if (ad.campaign_id !== undefined && String(ad.campaign_id) !== String(adset.campaign_id)) {
        stats.warnings.push(`Skipped ad ${String(ad.id)} because its campaign did not match its ad set`);
        return false;
      }
      return campaignIds.has(String(adset.campaign_id));
    });

    const creativeById = new Map<string, ApiObject>();
    for (const ad of eligibleAds) {
      if (ad.creative && typeof ad.creative === "object") {
        const creative = ad.creative as ApiObject;
        if (creative.id !== undefined) creativeById.set(String(creative.id), creative);
      }
    }

    const dailyInsights = await client.getAll<ApiObject>(`/${accountId}/insights`, insightParams(since, until));
    const countryInsights = await client.getAll<ApiObject>(`/${accountId}/insights`, insightParams(since, until, "country"));

    const campaignRows = campaigns.map((row) => campaignRow(row, ts.product_id, ts.id, accountId, currency, syncedAt));
    const adsetRows = eligibleAdsets.map((row) => adsetRow(row, syncedAt));
    const creativeRows = [...creativeById.values()].map((row) => creativeRow(row, ts.product_id, accountId, syncedAt));
    const adRows = eligibleAds.map((row) => {
      const adset = adsetById.get(String(row.adset_id))!;
      return adRow({ ...row, campaign_id: row.campaign_id ?? adset.campaign_id }, syncedAt);
    });
    const dailyRows = dailyInsights.map((row) => dailyRow(row, ts.product_id, currency, syncedAt, actionTypes));
    const breakdownRows = countryInsights.map((row) => breakdownRow(row, ts.product_id, currency, syncedAt, actionTypes));

    if (!options.dryRun) {
      stats.campaigns = await upsertMetaAdsCampaigns(campaignRows);
      stats.adsets = await upsertMetaAdsAdsets(adsetRows);
      stats.creatives = await upsertMetaAdsCreatives(creativeRows);
      stats.ads = await upsertMetaAdsAds(adRows);
      stats.dailyRows = await upsertMetaAdsAdDaily(dailyRows);
      stats.breakdownRows = await upsertMetaAdsAdDailyBreakdowns(breakdownRows);
    } else {
      stats.campaigns = campaignRows.length;
      stats.adsets = adsetRows.length;
      stats.creatives = creativeRows.length;
      stats.ads = adRows.length;
      stats.dailyRows = dailyRows.length;
      stats.breakdownRows = breakdownRows.length;
    }

    options.log(
      `Account ${account.name ?? accountId} [${account.account_status ?? "unknown"}]: ${stats.campaigns} campaign(s), ${stats.adsets} ad set(s), ${stats.creatives} creative(s), ${stats.ads} ad(s), ${stats.dailyRows} daily row(s), ${stats.breakdownRows} breakdown row(s)`,
    );
    if (!options.dryRun && runId) {
      await finishScrapeRun(runId, { status: "done", ads_seen: stats.ads, error: stats.warnings.join("; ") || null });
      await markSourceScraped(ts.id);
    }
    return stats;
  } catch (error) {
    if (!options.dryRun && runId) {
      await finishScrapeRun(runId, { status: "error", error: error instanceof Error ? error.message : String(error) });
    }
    throw error;
  }
}
