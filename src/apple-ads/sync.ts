/** Pulls current state and trailing daily numbers for one tracked app into the database. Read-only towards Apple. */
import {
  finishScrapeRun,
  listTermPopularityTerms,
  markSourceScraped,
  setAppleAdsBidRecommendation,
  startScrapeRun,
  upsertAppleAdsCampaigns,
  upsertAppleAdsKeywordDaily,
  upsertAppleAdsKeywords,
  upsertAppleAdsSearchTermsDaily,
  upsertTermPopularity,
  type TrackedSourceRow,
} from "../db/index.ts";
import type { AppleAdsClient } from "./client.ts";
import { bidRecommendations, campaignRow, dateInZone, keywordDailyRows, keywordRow, reportBody, searchTermDailyRows } from "./map.ts";
import { MAX_NEW_POPULARITY_TERMS, TERM_POPULARITY_SOURCE, termPopularity, termsMissingPopularity, type TargetedTerm } from "./research.ts";
import type { ApiAdGroup, ApiCampaign, ApiKeyword, ApiReportResult, ApiReportRow, CampaignReportMeta, KeywordReportMeta, SearchTermReportMeta } from "./types.ts";

export const SOURCE = "apple_ads";

export interface AppConfig {
  adAccountId: number;
  currency: string;
  timezone: string;
}

/** tracked_sources row: source = apple_ads, kind = app, value = App Store ID, config = { ad_account_id, currency, timezone }. */
export function appConfig(ts: TrackedSourceRow): AppConfig {
  if (ts.source !== SOURCE || ts.kind !== "app") throw new Error(`Tracked source ${ts.id} is not an ${SOURCE} app`);
  const cfg = (ts.config ?? {}) as Record<string, unknown>;
  const adAccountId = Number(cfg.ad_account_id);
  if (!Number.isInteger(adAccountId) || adAccountId <= 0) throw new Error(`Tracked source ${ts.id}: config.ad_account_id is required`);
  return { adAccountId, currency: String(cfg.currency ?? "USD"), timezone: String(cfg.timezone ?? "UTC") };
}

export const MAX_DAYS = 90;

/**
 * Trailing window for a scheduled run: at least `minDays` (Apple revises recent days), widened to cover every day
 * since the source's last successful sync plus one day of overlap, so a missed run is filled by the next one.
 */
export function autoDays(lastScrapedAt: string | null, minDays: number, now = new Date()): number {
  if (!lastScrapedAt) return minDays;
  const gap = Math.ceil((now.getTime() - new Date(lastScrapedAt).getTime()) / 86_400_000);
  return Math.min(MAX_DAYS, Math.max(minDays, gap + 1));
}

export interface SyncOptions {
  days: number;
  searchTerms: boolean;
  popularity: boolean;
  log: (line: string) => void;
}

export interface SyncStats {
  campaigns: number;
  keywords: number;
  negatives: number;
  dailyRows: number;
  searchTermRows: number;
  popularityTerms: number;
  warnings: string[];
}

async function reportRows<M>(client: AppleAdsClient, adAccountId: number, apiPath: string, body: (offset: number, pageSize: number) => unknown): Promise<ApiReportRow<M>[]> {
  const pageSize = 1000;
  const out: ApiReportRow<M>[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await client.read<ApiReportResult<M>>(adAccountId, "POST", apiPath, body(offset, pageSize));
    const rows = page.result?.rows ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

export async function syncApp(client: AppleAdsClient, ts: TrackedSourceRow, opts: SyncOptions): Promise<SyncStats> {
  const cfg = appConfig(ts);
  const stats: SyncStats = { campaigns: 0, keywords: 0, negatives: 0, dailyRows: 0, searchTermRows: 0, popularityTerms: 0, warnings: [] };
  const runId = await startScrapeRun({ product_id: ts.product_id, tracked_source_id: ts.id, source: SOURCE });
  try {
    const syncedAt = new Date().toISOString();
    const end = dateInZone(cfg.timezone, 0);
    const start = dateInZone(cfg.timezone, opts.days - 1);

    // Campaign names do not identify the app; the promoted App Store ID does.
    const all = await client.queryAll<ApiCampaign>(cfg.adAccountId, "/campaigns/query");
    const campaigns = all.filter((c) => String(c.promotedObjectId) === ts.value);
    stats.campaigns = await upsertAppleAdsCampaigns(campaigns.map((c) => campaignRow(c, ts.product_id, ts.id, syncedAt)));

    const spendByCampaign = new Map<number, number>();
    const targeted: TargetedTerm[] = [];
    for (const c of campaigns) {
      if (c.deleted) continue;
      const country = c.targeting?.countryOrRegion?.include?.[0];
      const byCampaign = { filters: [{ field: "campaignId", operator: "EQUALS", value: c.id }] };
      const adGroups = (await client.queryAll<ApiAdGroup>(cfg.adAccountId, "/adgroups/query", byCampaign)).filter((g) => !g.deleted);
      let keywords = 0;
      let negatives = 0;
      for (const g of adGroups) {
        const byAdGroup = { filters: [{ field: "adGroupId", operator: "EQUALS", value: g.id }] };
        const kws = await client.queryAll<ApiKeyword>(cfg.adAccountId, "/keywords/query", byAdGroup);
        if (country) {
          for (const k of kws) {
            if (!k.deleted) targeted.push({ text: k.text, country });
          }
        }
        const negs = await client.queryAll<ApiKeyword>(cfg.adAccountId, "/negative-keywords/query", byAdGroup);
        keywords += await upsertAppleAdsKeywords(kws.map((k) => keywordRow(k, false, syncedAt)));
        negatives += await upsertAppleAdsKeywords(negs.map((k) => keywordRow(k, true, syncedAt)));
      }

      const grouped = await reportRows<KeywordReportMeta>(client, cfg.adAccountId, "/reports/apps/keywords/query", (o, p) => reportBody(start, end, c.id, true, o, p));
      const daily = keywordDailyRows({ rows: grouped }, cfg.currency, syncedAt);
      await upsertAppleAdsKeywordDaily(daily);
      spendByCampaign.set(
        c.id,
        daily.reduce((s, r) => s + (r.spend ?? 0), 0),
      );

      // Apple's suggested bid range is one value per row, not per day, and only comes back ungrouped.
      const ungrouped = await reportRows<KeywordReportMeta>(client, cfg.adAccountId, "/reports/apps/keywords/query", (o, p) => reportBody(start, end, c.id, false, o, p));
      for (const [keywordId, rec] of bidRecommendations({ rows: ungrouped })) await setAppleAdsBidRecommendation(keywordId, rec, syncedAt);

      let terms = 0;
      if (opts.searchTerms) {
        const st = await reportRows<SearchTermReportMeta>(client, cfg.adAccountId, "/reports/apps/searchterms/query", (o, p) => reportBody(start, end, c.id, true, o, p));
        terms = await upsertAppleAdsSearchTermsDaily(searchTermDailyRows({ rows: st }, cfg.currency, syncedAt));
      }

      stats.keywords += keywords;
      stats.negatives += negatives;
      stats.dailyRows += daily.length;
      stats.searchTermRows += terms;
      opts.log(
        `${c.name} [${c.status}${c.displayStatus && c.displayStatus !== c.status ? `/${c.displayStatus}` : ""}]: keywords ${keywords}, negatives ${negatives}, daily rows ${daily.length}, search-term rows ${terms}`,
      );
    }

    if (opts.popularity) {
      try {
        const known = await listTermPopularityTerms(ts.product_id);
        const { lookups, deferred } = termsMissingPopularity(targeted, known, MAX_NEW_POPULARITY_TERMS);
        const byCountry = new Map<string, string[]>();
        for (const term of lookups) {
          const terms = byCountry.get(term.country) ?? [];
          terms.push(term.text);
          byCountry.set(term.country, terms);
        }
        for (const [country, terms] of byCountry) {
          const popularity = await termPopularity(client, cfg.adAccountId, ts.value, [country], terms);
          const rows = [...popularity].map(([term, value]) => ({
            product_id: ts.product_id,
            country,
            term,
            popularity: value,
            source: TERM_POPULARITY_SOURCE,
            pulled_at: syncedAt,
          }));
          stats.popularityTerms += await upsertTermPopularity(rows);
        }
        if (stats.popularityTerms || deferred) {
          opts.log(`popularity: ${stats.popularityTerms} new term(s) looked up${deferred ? `, ${deferred} deferred to next sync` : ""}`);
        }
      } catch (e) {
        stats.warnings.push(`popularity lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Cross-check: campaign totals should equal the sum of keyword rows (true while Search Match is off).
    const report = await reportRows<CampaignReportMeta>(client, cfg.adAccountId, "/reports/apps/campaigns/query", (offset, pageSize) => ({
      timeRange: { start, end, timeZone: "ORTZ" },
      pagination: { offset, pageSize },
    }));
    for (const row of report) {
      const ours = spendByCampaign.get(row.metadata.id);
      if (ours == null) continue;
      const apple = Number(row.totalMetrics?.localSpend?.amount ?? 0);
      if (Math.abs(apple - ours) > 0.01) stats.warnings.push(`campaign ${row.metadata.id}: Apple reports spend ${apple.toFixed(2)} but keyword rows sum to ${ours.toFixed(2)} (${start}..${end})`);
    }

    await finishScrapeRun(runId, { status: "done", ads_seen: stats.dailyRows, error: stats.warnings.join("; ") || null });
    await markSourceScraped(ts.id);
    return stats;
  } catch (e) {
    await finishScrapeRun(runId, { status: "error", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
