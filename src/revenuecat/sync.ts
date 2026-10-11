/** Pulls trials, conversions and revenue per Apple Ads campaign and keyword for one RevenueCat project. Read-only. */
import { appleAdsNames, finishScrapeRun, markSourceScraped, startScrapeRun, upsertRevenueCatKeywordDaily, type RevenueCatKeywordDailyInsert, type TrackedSourceRow } from "../db/index.ts";
import { UNATTRIBUTED, filterValues, measure, segmentPoints, type ChartOptions, type ChartResponse } from "./charts.ts";
import type { RevenueCatClient } from "./client.ts";

export const SOURCE = "revenuecat";

export interface ProjectConfig {
  projectId: string;
  currency: string;
}

/** tracked_sources row: source = revenuecat, kind = project, value = RevenueCat project ID, config = { currency }. */
export function projectConfig(ts: TrackedSourceRow): ProjectConfig {
  if (ts.source !== SOURCE || ts.kind !== "project") throw new Error(`Tracked source ${ts.id} is not a ${SOURCE} project`);
  const cfg = (ts.config ?? {}) as Record<string, unknown>;
  return { projectId: ts.value, currency: String(cfg.currency ?? "USD") };
}

type Metric = "new_trials" | "trial_conversions" | "paid_subscriptions" | "transactions" | "revenue" | "proceeds";

/** Which chart measure fills which column. Revenue is requested twice: gross, and proceeds after store fees and taxes. */
export const CHARTS: { chart: string; selectors?: Record<string, string>; measures: Partial<Record<Metric, string>> }[] = [
  { chart: "trials_new", measures: { new_trials: "New Trials" } },
  { chart: "actives_new", measures: { trial_conversions: "Trial Conversions", paid_subscriptions: "Total Paid Subscriptions" } },
  { chart: "revenue", selectors: { revenue_type: "revenue" }, measures: { revenue: "Revenue", transactions: "Transactions" } },
  { chart: "revenue", selectors: { revenue_type: "proceeds" }, measures: { proceeds: "Proceeds" } },
];

const CAMPAIGN = "attribution_campaign";
const KEYWORD = "attribution_keyword";

export interface SyncOptions {
  days: number;
  log: (line: string) => void;
  now?: Date;
}

export interface SyncStats {
  campaigns: number;
  rows: number;
  attributedRows: number;
  unmatched: string[];
}

const utcDate = (d: Date, daysBack: number) => new Date(d.getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);

export async function syncProject(client: RevenueCatClient, ts: TrackedSourceRow, opts: SyncOptions): Promise<SyncStats> {
  const cfg = projectConfig(ts);
  const base = `/projects/${encodeURIComponent(cfg.projectId)}/charts`;
  const runId = await startScrapeRun({ product_id: ts.product_id, tracked_source_id: ts.id, source: SOURCE });
  try {
    const syncedAt = new Date().toISOString();
    const now = opts.now ?? new Date();
    const range = { start_date: utcDate(now, opts.days - 1), end_date: utcDate(now, 0), resolution: 0, currency: cfg.currency };

    // Every attribution campaign RevenueCat knows, including its "No campaign" bucket.
    const campaigns = new Map<string, string>();
    for (const chart of new Set(CHARTS.map((c) => c.chart))) {
      for (const v of filterValues(await client.get<ChartOptions>(`${base}/${chart}/options`), CAMPAIGN)) campaigns.set(v.id, v.display_name);
    }

    const names = await appleAdsNames(ts.product_id);
    const campaignId = new Map(names.campaigns.map((c) => [c.name, c.id]));
    const keywordId = new Map(names.keywords.map((k) => [`${k.campaign_id}|${k.text.toLowerCase()}`, k.id]));
    const unmatched = new Set<string>();

    const rows = new Map<string, RevenueCatKeywordDailyInsert>();
    for (const [filterId, displayName] of campaigns) {
      const campaign = UNATTRIBUTED.has(displayName) ? "" : displayName;
      const appleCampaign = campaign ? (campaignId.get(campaign) ?? null) : null;
      if (campaign && appleCampaign == null) unmatched.add(`campaign "${campaign}"`);
      for (const spec of CHARTS) {
        const chart = await client.get<ChartResponse>(`${base}/${spec.chart}`, {
          ...range,
          segment: KEYWORD,
          filters: JSON.stringify([{ name: CAMPAIGN, values: [filterId] }]),
          selectors: spec.selectors ? JSON.stringify(spec.selectors) : undefined,
        });
        for (const p of segmentPoints(chart)) {
          const key = `${p.date}|${campaign}|${p.segment}`;
          let row = rows.get(key);
          if (!row) {
            const appleKeyword = appleCampaign != null && p.segment ? (keywordId.get(`${appleCampaign}|${p.segment.toLowerCase()}`) ?? null) : null;
            if (appleCampaign != null && p.segment && appleKeyword == null) unmatched.add(`keyword "${p.segment}" in ${campaign}`);
            row = {
              tracked_source_id: ts.id,
              product_id: ts.product_id,
              date: p.date,
              campaign,
              keyword: p.segment,
              apple_campaign_id: appleCampaign,
              apple_keyword_id: appleKeyword,
              new_trials: 0,
              trial_conversions: 0,
              paid_subscriptions: 0,
              transactions: 0,
              revenue: 0,
              proceeds: 0,
              currency: cfg.currency,
              incomplete: false,
              synced_at: syncedAt,
            };
            rows.set(key, row);
          }
          for (const [column, name] of Object.entries(spec.measures) as [Metric, string][]) {
            if (!(name in p.values)) throw new Error(`${spec.chart}: measure "${name}" missing (got ${Object.keys(p.values).join(", ")})`);
            row[column] = measure(p, name);
          }
          row.incomplete ||= p.incomplete;
        }
      }
      opts.log(`${campaign || "(not attributed)"}${campaign && appleCampaign == null ? " [no matching Apple Ads campaign]" : ""}`);
    }

    const all = [...rows.values()];
    const stats: SyncStats = {
      campaigns: [...campaigns.values()].filter((n) => !UNATTRIBUTED.has(n)).length,
      rows: await upsertRevenueCatKeywordDaily(all),
      attributedRows: all.filter((r) => r.campaign !== "").length,
      unmatched: [...unmatched],
    };
    await finishScrapeRun(runId, { status: "done", ads_seen: stats.rows, error: stats.unmatched.length ? `unmatched: ${stats.unmatched.join("; ")}` : null });
    await markSourceScraped(ts.id);
    return stats;
  } catch (e) {
    await finishScrapeRun(runId, { status: "error", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
