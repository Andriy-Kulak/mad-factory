/** Pure mapping from Apple Ads API payloads to table rows. No I/O, so it is unit-tested directly. */
import type { AppleAdsCampaignInsert, AppleAdsKeywordDailyInsert, AppleAdsKeywordInsert, AppleAdsSearchTermDailyInsert, Json } from "../db/types.ts";
import type { ApiCampaign, ApiGranularMetrics, ApiKeyword, ApiReportResult, KeywordReportMeta, SearchTermReportMeta } from "./types.ts";

/** Entity endpoints return UTC timestamps without an offset suffix. */
export function utc(ts: string | undefined): string | null {
  return ts ? `${ts}Z` : null;
}

export function reportBody(start: string, end: string, campaignId: number, groupByCountry: boolean, offset = 0, pageSize = 1000) {
  return {
    timeRange: { start, end, timeZone: "ORTZ", granularity: "DAILY" },
    ...(groupByCountry ? { groupBy: ["countryOrRegion"] } : {}),
    filters: [{ field: "campaignId", operator: "EQUALS", value: campaignId }],
    pagination: { offset, pageSize },
  };
}

/** Calendar date `daysAgo` days before today in the given IANA time zone, as YYYY-MM-DD. */
export function dateInZone(timeZone: string, daysAgo = 0, now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function campaignRow(c: ApiCampaign, productId: string, trackedSourceId: string, syncedAt: string): AppleAdsCampaignInsert {
  const budget = c.dailyBudget?.value;
  return {
    id: c.id,
    product_id: productId,
    tracked_source_id: trackedSourceId,
    ad_account_id: c.adAccountId,
    app_store_id: c.promotedObjectId,
    name: c.name,
    status: c.status,
    display_status: c.displayStatus ?? null,
    daily_budget: budget ? Number(budget.amount) : null,
    currency: budget?.currency ?? null,
    countries: c.targeting?.countryOrRegion?.include ?? [],
    deleted: c.deleted ?? false,
    apple_created_at: utc(c.creationTime),
    apple_modified_at: utc(c.modificationTime),
    raw: c as unknown as Json,
    last_synced_at: syncedAt,
  };
}

export function keywordRow(k: ApiKeyword, isNegative: boolean, syncedAt: string): AppleAdsKeywordInsert {
  return {
    id: k.id,
    is_negative: isNegative,
    campaign_id: k.campaignId,
    ad_group_id: k.adGroupId,
    text: k.text,
    match_type: k.matchType,
    bid: k.bid ? Number(k.bid.amount) : null,
    currency: k.bid?.currency ?? null,
    status: k.status,
    display_status: k.displayStatus ?? null,
    deleted: k.deleted ?? false,
    apple_created_at: utc(k.creationTime),
    apple_modified_at: utc(k.modificationTime),
    raw: k as unknown as Json,
    last_synced_at: syncedAt,
  };
}

function metrics(g: ApiGranularMetrics, fallbackCurrency: string) {
  return {
    impressions: g.impressions ?? 0,
    taps: g.taps ?? 0,
    tap_installs: g.tapInstalls ?? 0,
    view_installs: g.viewInstalls ?? 0,
    new_downloads: g.totalNewDownloads ?? 0,
    redownloads: g.totalRedownloads ?? 0,
    spend: Number(g.localSpend?.amount ?? 0),
    currency: g.localSpend?.currency ?? fallbackCurrency,
  };
}

/** Days without activity carry only `date`; they are not stored. */
const hasActivity = (g: ApiGranularMetrics) => Object.keys(g).length > 1;

export function keywordDailyRows(result: ApiReportResult<KeywordReportMeta>, currency: string, syncedAt: string): AppleAdsKeywordDailyInsert[] {
  const out: AppleAdsKeywordDailyInsert[] = [];
  for (const row of result.rows ?? []) {
    const country = row.metadata.countryOrRegion;
    if (!country) continue;
    for (const g of row.granularMetrics ?? []) {
      if (!hasActivity(g)) continue;
      out.push({ date: g.date, keyword_id: row.metadata.id, country, campaign_id: row.metadata.campaignId, ...metrics(g, currency), synced_at: syncedAt });
    }
  }
  return out;
}

export function searchTermDailyRows(result: ApiReportResult<SearchTermReportMeta>, currency: string, syncedAt: string): AppleAdsSearchTermDailyInsert[] {
  // Apple can return several rows that collapse to one key (e.g. casing variants withheld as null); sum them.
  const byKey = new Map<string, AppleAdsSearchTermDailyInsert>();
  for (const row of result.rows ?? []) {
    const m = row.metadata;
    if (!m.countryOrRegion) continue;
    for (const g of row.granularMetrics ?? []) {
      if (!hasActivity(g)) continue;
      const next: AppleAdsSearchTermDailyInsert = {
        date: g.date,
        campaign_id: m.campaignId,
        keyword_id: m.keyword?.id ?? 0,
        search_term: m.searchTermText ?? "",
        country: m.countryOrRegion,
        source: m.searchTermSource ?? null,
        ...metrics(g, currency),
        synced_at: syncedAt,
      };
      const key = [next.date, next.campaign_id, next.keyword_id, next.search_term, next.country].join("|");
      const prev = byKey.get(key);
      if (!prev) byKey.set(key, next);
      else {
        for (const f of ["impressions", "taps", "tap_installs", "view_installs", "new_downloads", "redownloads", "spend"] as const) {
          prev[f] = (prev[f] ?? 0) + (next[f] ?? 0);
        }
      }
    }
  }
  return [...byKey.values()];
}

/** keyword id -> Apple's suggested bid range, skipping the empty `{}` Apple sends when it has none. */
export function bidRecommendations(result: ApiReportResult<KeywordReportMeta>): Map<number, Json> {
  const out = new Map<number, Json>();
  for (const row of result.rows ?? []) {
    const rec = row.insights?.bidRecommendation;
    if (rec && Object.keys(rec).length) out.set(row.metadata.id, rec as Json);
  }
  return out;
}
