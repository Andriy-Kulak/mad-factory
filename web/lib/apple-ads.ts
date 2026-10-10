import "server-only";
import { getDb } from "./db";
import { blockingNegatives, negativeBlocks, sameText } from "./negatives";
import type { AppleAdsCampaignRow, AppleAdsKeywordDailyRow, AppleAdsKeywordRow, AppleAdsSearchTermDailyRow, ExperimentCampaignRow, ExperimentLogRow, ExperimentRow, RevenueCatKeywordDailyRow } from "@db/types";

export interface Totals {
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  /** RevenueCat, by the customer's Apple Ads install keyword: new trials, new paid subscriptions, proceeds. */
  trials: number;
  paid: number;
  revenue: number;
}

export const zero = (): Totals => ({ impressions: 0, taps: 0, installs: 0, spend: 0, trials: 0, paid: 0, revenue: 0 });
export const sumInto = (t: Totals, o: Totals) => {
  for (const k of Object.keys(t) as (keyof Totals)[]) t[k] += o[k];
};
const add = (t: Totals, r: { impressions: number; taps: number; tap_installs: number; spend: number }) => {
  t.impressions += r.impressions;
  t.taps += r.taps;
  t.installs += r.tap_installs;
  t.spend += Number(r.spend);
};
const addOutcomes = (t: Totals, r: RevenueCatKeywordDailyRow) => {
  t.trials += r.new_trials;
  t.paid += r.paid_subscriptions;
  t.revenue += Number(r.proceeds);
};

/** RevenueCat rows for a product, or null when RevenueCat is not synced (table missing or no rows). */
async function revenueCatRows(productId: string, since: string, until?: string): Promise<RevenueCatKeywordDailyRow[] | null> {
  const db = getDb();
  try {
    const rows = await fetchAll<RevenueCatKeywordDailyRow>((a, b) => {
      let q = db.from("revenuecat_keyword_daily").select("*").eq("product_id", productId).gte("date", since);
      if (until) q = q.lte("date", until);
      return q.order("date").order("campaign").order("keyword").range(a, b);
    }, "revenuecat_keyword_daily");
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

export interface RevenueCatStatus {
  /** Everything RevenueCat saw in range, attributed to Apple Ads or not. */
  all: Totals;
  /** The part RevenueCat attributed to an Apple Ads campaign. */
  attributed: Totals;
  lastSyncedAt: string | null;
}

/** PostgREST caps a response at 1000 rows; page through everything. */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, ctx: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`${ctx}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

/** Keyword-level bid summary for a campaign; null when no keyword carries a bid. */
export interface BidSummary {
  avg: number;
  min: number;
  max: number;
}

export function summarizeBids(bids: (number | string | null)[]): BidSummary | null {
  const nums = bids.filter((b): b is number | string => b != null).map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return { avg: nums.reduce((s, b) => s + b, 0) / nums.length, min: Math.min(...nums), max: Math.max(...nums) };
}

/** The negative keyword that blocks a search term now, and since when (Apple's creation time, UTC). */
export interface Blocker {
  text: string;
  matchType: string;
  since: string | null;
}

export type KeywordTerm = { term: string; blockedBy: Blocker | null } & Totals;

export interface NegativeSummary {
  id: number;
  text: string;
  matchType: string;
  status: string;
  campaignName: string;
  /** null: campaign-level negative. */
  adGroupId: number | null;
  addedAt: string | null;
  /** Search-term traffic in range that this negative matches (mostly from before it was added). */
  matched: Totals;
  /** Matched impressions on days after the day it was added: should be 0 if it blocks. */
  matchedSinceAdded: number;
  /** Campaigns where the same text is a targeting keyword. */
  keywordIn: string[];
}

export interface DateRange {
  since: string;
  until: string;
}

export interface AppleAdsOverview {
  campaigns: (AppleAdsCampaignRow & { totals: Totals; keywords: number; negatives: number; unserved: number; bid: BidSummary | null })[];
  /** `terms`: the search terms that triggered the keyword, withheld low-volume terms as one `term: ""` entry. */
  keywords: (AppleAdsKeywordRow & { totals: Totals; campaignName: string; terms: KeywordTerm[]; negativeIn: string[] })[];
  countries: ({ country: string } & Totals)[];
  days: ({ date: string } & Totals)[];
  searchTerms: ({ term: string; keyword: string; campaignName: string; blockedBy: Blocker | null } & Totals)[];
  negatives: NegativeSummary[];
  withheldSearchTermRows: number;
  totals: Totals;
  revenuecat: RevenueCatStatus | null;
  since: string;
  until: string;
  lastSyncedAt: string | null;
}

export async function getAppleAdsOverview(productId: string, { since, until }: DateRange): Promise<AppleAdsOverview> {
  const db = getDb();

  const campaignsRes = await db.from("apple_ads_campaigns").select("*").eq("product_id", productId).eq("deleted", false).order("name");
  if (campaignsRes.error) throw new Error(`apple_ads_campaigns: ${campaignsRes.error.message}`);
  const campaignRows = campaignsRes.data ?? [];
  const ids = campaignRows.map((c) => c.id);
  const empty: AppleAdsOverview = { campaigns: [], keywords: [], countries: [], days: [], searchTerms: [], negatives: [], withheldSearchTermRows: 0, totals: zero(), revenuecat: null, since, until, lastSyncedAt: null };
  if (!ids.length) return empty;

  const [keywordRows, daily, terms, outcomes] = await Promise.all([
    fetchAll<AppleAdsKeywordRow>((a, b) => db.from("apple_ads_keywords").select("*").in("campaign_id", ids).eq("deleted", false).order("id").range(a, b), "apple_ads_keywords"),
    fetchAll<AppleAdsKeywordDailyRow>((a, b) => db.from("apple_ads_keyword_daily").select("*").in("campaign_id", ids).gte("date", since).lte("date", until).order("date").order("keyword_id").order("country").range(a, b), "apple_ads_keyword_daily"),
    fetchAll<AppleAdsSearchTermDailyRow>((a, b) => db.from("apple_ads_search_terms_daily").select("*").in("campaign_id", ids).gte("date", since).lte("date", until).order("date").order("keyword_id").order("search_term").order("country").range(a, b), "apple_ads_search_terms_daily"),
    revenueCatRows(productId, since, until),
  ]);

  const byCampaign = new Map<number, Totals>();
  const byKeyword = new Map<number, Totals>();
  const byCountry = new Map<string, Totals>();
  const byDay = new Map<string, Totals>();
  const totals = zero();
  const bump = <K,>(m: Map<K, Totals>, k: K, r: AppleAdsKeywordDailyRow) => add(m.get(k) ?? m.set(k, zero()).get(k)!, r);
  for (const r of daily) {
    bump(byCampaign, r.campaign_id, r);
    bump(byKeyword, r.keyword_id, r);
    bump(byCountry, r.country, r);
    bump(byDay, r.date, r);
    add(totals, r);
  }
  let revenuecat: RevenueCatStatus | null = null;
  if (outcomes) {
    revenuecat = { all: zero(), attributed: zero(), lastSyncedAt: null };
    const tally = <K,>(m: Map<K, Totals>, k: K, r: RevenueCatKeywordDailyRow) => addOutcomes(m.get(k) ?? m.set(k, zero()).get(k)!, r);
    for (const r of outcomes) {
      addOutcomes(revenuecat.all, r);
      if (revenuecat.lastSyncedAt == null || r.synced_at > revenuecat.lastSyncedAt) revenuecat.lastSyncedAt = r.synced_at;
      if (r.campaign === "") continue;
      addOutcomes(revenuecat.attributed, r);
      if (r.apple_campaign_id == null) continue;
      tally(byCampaign, r.apple_campaign_id, r);
      if (r.apple_keyword_id != null) tally(byKeyword, r.apple_keyword_id, r);
      tally(byDay, r.date, r);
      addOutcomes(totals, r);
    }
  }

  const name = new Map(campaignRows.map((c) => [c.id, c.name]));
  const targeting = keywordRows.filter((k) => !k.is_negative);
  const keywordText = new Map(targeting.map((k) => [k.id, k.text]));
  const keywordById = new Map(targeting.map((k) => [k.id, k]));
  const negativeRows = keywordRows.filter((k) => k.is_negative);
  const blockerOf = (campaignId: number, keywordId: number, term: string): Blocker | null => {
    const n = blockingNegatives(negativeRows, campaignId, keywordById.get(keywordId)?.ad_group_id ?? null, term)[0];
    return n ? { text: n.text, matchType: n.match_type, since: n.apple_created_at } : null;
  };
  const negatives: NegativeSummary[] = negativeRows.map((n) => ({
    id: n.id,
    text: n.text,
    matchType: n.match_type,
    status: n.status,
    campaignName: name.get(n.campaign_id) ?? "",
    adGroupId: n.ad_group_id,
    addedAt: n.apple_created_at,
    matched: zero(),
    matchedSinceAdded: 0,
    keywordIn: [...new Set(targeting.filter((k) => sameText(k.text, n.text)).map((k) => name.get(k.campaign_id) ?? ""))],
  }));

  const byTerm = new Map<string, { term: string; keyword: string; campaignName: string; blockedBy: Blocker | null } & Totals>();
  const termsByKeyword = new Map<number, Map<string, KeywordTerm>>();
  let withheld = 0;
  for (const r of terms) {
    const kt = termsByKeyword.get(r.keyword_id) ?? termsByKeyword.set(r.keyword_id, new Map()).get(r.keyword_id)!;
    add(kt.get(r.search_term) ?? kt.set(r.search_term, { term: r.search_term, blockedBy: blockerOf(r.campaign_id, r.keyword_id, r.search_term), ...zero() }).get(r.search_term)!, r);
    const adGroup = keywordById.get(r.keyword_id)?.ad_group_id ?? null;
    for (const [i, n] of negativeRows.entries()) {
      if (n.campaign_id !== r.campaign_id || (n.ad_group_id != null && n.ad_group_id !== adGroup) || !negativeBlocks(n, r.search_term)) continue;
      add(negatives[i]!.matched, r);
      if (n.apple_created_at != null && r.date > n.apple_created_at.slice(0, 10)) negatives[i]!.matchedSinceAdded += r.impressions;
    }
    if (r.search_term === "") {
      withheld++;
      continue;
    }
    const key = `${r.campaign_id}|${r.keyword_id}|${r.search_term}`;
    const t = byTerm.get(key) ?? byTerm.set(key, { term: r.search_term, keyword: keywordText.get(r.keyword_id) ?? "–", campaignName: name.get(r.campaign_id) ?? "", blockedBy: blockerOf(r.campaign_id, r.keyword_id, r.search_term), ...zero() }).get(key)!;
    add(t, r);
  }

  return {
    campaigns: campaignRows.map((c) => {
      const kws = targeting.filter((k) => k.campaign_id === c.id);
      return {
        ...c,
        totals: byCampaign.get(c.id) ?? zero(),
        keywords: kws.length,
        negatives: keywordRows.filter((k) => k.is_negative && k.campaign_id === c.id).length,
        unserved: kws.filter((k) => !(byKeyword.get(k.id)?.impressions)).length,
        bid: summarizeBids(kws.map((k) => k.bid)),
      };
    }),
    keywords: targeting
      .map((k) => ({
        ...k,
        totals: byKeyword.get(k.id) ?? zero(),
        campaignName: name.get(k.campaign_id) ?? "",
        terms: [...(termsByKeyword.get(k.id)?.values() ?? [])].sort((a, b) => b.taps - a.taps || b.impressions - a.impressions || b.spend - a.spend),
        negativeIn: [...new Set(negativeRows.filter((n) => n.status === "ENABLED" && n.campaign_id !== k.campaign_id && sameText(n.text, k.text)).map((n) => name.get(n.campaign_id) ?? ""))],
      }))
      .sort((a, b) => b.totals.spend - a.totals.spend || b.totals.impressions - a.totals.impressions || a.campaignName.localeCompare(b.campaignName) || a.text.localeCompare(b.text)),
    countries: [...byCountry].map(([country, t]) => ({ country, ...t })).sort((a, b) => b.spend - a.spend || b.impressions - a.impressions),
    days: [...byDay].map(([date, t]) => ({ date, ...t })).sort((a, b) => a.date.localeCompare(b.date)),
    searchTerms: [...byTerm.values()].sort((a, b) => b.taps - a.taps || b.impressions - a.impressions),
    negatives: negatives.sort((a, b) => b.matched.impressions - a.matched.impressions || (b.addedAt ?? "").localeCompare(a.addedAt ?? "") || a.text.localeCompare(b.text)),
    withheldSearchTermRows: withheld,
    totals,
    revenuecat,
    since,
    until,
    lastSyncedAt: campaignRows.reduce<string | null>((m, c) => (m == null || c.last_synced_at > m ? c.last_synced_at : m), null),
  };
}

export interface ExperimentSummary {
  experiment: ExperimentRow;
  links: ExperimentCampaignRow[];
  /** Dated narrative history, newest first. */
  log: ExperimentLogRow[];
  /** Totals inside the experiment window, per linked campaign id. */
  byCampaign: Map<number, Totals>;
  totals: Totals;
  yesterdaySpend: number;
  day: number;
  length: number | null;
}

/** Experiments on this channel for the product, newest first, with totals inside each experiment's own window. */
export async function getAppleAdsExperiments(productId: string): Promise<ExperimentSummary[]> {
  const db = getDb();
  const res = await db.from("experiments").select("*").eq("product_id", productId).eq("channel", "apple_ads").order("start_date", { ascending: false });
  if (res.error) throw new Error(`experiments: ${res.error.message}`);
  const out: ExperimentSummary[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  for (const experiment of res.data ?? []) {
    const linksRes = await db.from("experiment_campaigns").select("*").eq("experiment_id", experiment.id);
    if (linksRes.error) throw new Error(`experiment_campaigns: ${linksRes.error.message}`);
    const links = linksRes.data ?? [];
    const logRes = await db.from("experiment_log").select("*").eq("experiment_id", experiment.id).order("at", { ascending: false });
    if (logRes.error) throw new Error(`experiment_log: ${logRes.error.message}`);
    const ids = links.map((l) => Number(l.external_campaign_id)).filter(Number.isFinite);
    const byCampaign = new Map<number, Totals>();
    const totals = zero();
    let yesterdaySpend = 0;
    if (ids.length && experiment.start_date) {
      const outcomes = await revenueCatRows(productId, experiment.start_date, experiment.end_date ?? today);
      for (const r of outcomes ?? []) {
        if (r.apple_campaign_id == null || !ids.includes(r.apple_campaign_id)) continue;
        addOutcomes(byCampaign.get(r.apple_campaign_id) ?? byCampaign.set(r.apple_campaign_id, zero()).get(r.apple_campaign_id)!, r);
        addOutcomes(totals, r);
      }
      const rows = await fetchAll<AppleAdsKeywordDailyRow>(
        (a, b) => db.from("apple_ads_keyword_daily").select("*").in("campaign_id", ids).gte("date", experiment.start_date!).lte("date", experiment.end_date ?? today).order("date").order("keyword_id").order("country").range(a, b),
        "apple_ads_keyword_daily",
      );
      for (const r of rows) {
        add(byCampaign.get(r.campaign_id) ?? byCampaign.set(r.campaign_id, zero()).get(r.campaign_id)!, r);
        add(totals, r);
        if (r.date === yesterday) yesterdaySpend += Number(r.spend);
      }
    }
    const end = experiment.end_date && experiment.end_date < today ? experiment.end_date : today;
    out.push({
      experiment,
      links,
      log: logRes.data ?? [],
      byCampaign,
      totals,
      yesterdaySpend,
      day: experiment.start_date ? Math.max(0, dayDiff(experiment.start_date, end)) + 1 : 0,
      length: experiment.start_date && experiment.end_date ? dayDiff(experiment.start_date, experiment.end_date) : null,
    });
  }
  return out;
}
