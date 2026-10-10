import { getDb, unwrap } from "./client.ts";
import type { ProductGoalInsert, ProductGoalRow } from "./types.ts";
import type { CoverageCampaign, CoverageKeyword } from "../apple-ads/coverage.ts";

export async function listProductGoals(productId?: string): Promise<ProductGoalRow[]> {
  let q = getDb().from("product_goals").select("*").order("created_at");
  if (productId) q = q.eq("product_id", productId);
  return unwrap(await q, "listProductGoals");
}

export async function upsertProductGoal(row: ProductGoalInsert): Promise<ProductGoalRow> {
  return unwrap(await getDb().from("product_goals").upsert(row, { onConflict: "product_id,metric" }).select("*").single(), "upsertProductGoal");
}

/** One day's money in one currency; `channel` is the ad platform for spend rows. */
export interface DailyAmount {
  date: string;
  amount: number;
  currency: string;
}

export interface ScorecardData {
  /** RevenueCat proceeds (after store fees and taxes), summed over every campaign/keyword bucket. */
  proceeds: DailyAmount[];
  trials: { date: string; n: number }[];
  /** Ad spend per channel. A channel with no daily table yet is simply absent. */
  spend: Record<string, DailyAmount[]>;
  /** Latest date each daily table has for this product, null when it has none. */
  latest: Record<string, string | null>;
  running: { slug: string; channel: string; name: string }[];
}

const PAGE = 1000;

/** Reads every page of a query; PostgREST caps a response at 1000 rows. */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, ctx: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = unwrap(await page(from, from + PAGE - 1), ctx);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function latestDate(table: "revenuecat_keyword_daily" | "meta_ads_ad_daily", productId: string): Promise<string | null> {
  const rows = unwrap(await getDb().from(table).select("date").eq("product_id", productId).order("date", { ascending: false }).limit(1), `latest ${table}`);
  return rows[0]?.date ?? null;
}

/** Revenue, spend and freshness of one product between two dates (inclusive), straight from the synced daily tables. */
export async function loadScorecardData(productId: string, from: string, to: string): Promise<ScorecardData> {
  const db = getDb();
  const rc = await all(
    (a, b) => db.from("revenuecat_keyword_daily").select("date,proceeds,new_trials,currency").eq("product_id", productId).gte("date", from).lte("date", to).range(a, b),
    "scorecard revenuecat",
  );

  const campaignIds = unwrap(await db.from("apple_ads_campaigns").select("id").eq("product_id", productId), "scorecard apple campaigns").map((c) => c.id);
  const apple = campaignIds.length
    ? await all(
        (a, b) => db.from("apple_ads_keyword_daily").select("date,spend,currency").in("campaign_id", campaignIds).gte("date", from).lte("date", to).range(a, b),
        "scorecard apple keywords",
      )
    : [];
  // Search Match spend has no keyword row; it only shows up in the search-term report under keyword_id 0.
  const appleAuto = campaignIds.length
    ? await all(
        (a, b) => db.from("apple_ads_search_terms_daily").select("date,spend,currency").in("campaign_id", campaignIds).eq("keyword_id", 0).gte("date", from).lte("date", to).range(a, b),
        "scorecard apple search match",
      )
    : [];
  const appleLatest = campaignIds.length
    ? (unwrap(await db.from("apple_ads_keyword_daily").select("date").in("campaign_id", campaignIds).order("date", { ascending: false }).limit(1), "latest apple")[0]?.date ?? null)
    : null;

  const metaLatest = await latestDate("meta_ads_ad_daily", productId);
  const meta = await all(
    (a, b) => db.from("meta_ads_ad_daily").select("date,spend,currency").eq("product_id", productId).gte("date", from).lte("date", to).range(a, b),
    "scorecard meta",
  );

  const running = unwrap(await db.from("experiments").select("slug,channel,name").eq("product_id", productId).eq("status", "running").order("channel"), "scorecard experiments");
  const money = (rows: { date: string; currency: string }[], key: "proceeds" | "spend") =>
    rows.map((r) => ({ date: r.date, currency: r.currency, amount: Number((r as Record<string, unknown>)[key]) }));

  return {
    proceeds: money(rc, "proceeds"),
    trials: rc.map((r) => ({ date: r.date, n: r.new_trials })),
    spend: {
      ...(campaignIds.length ? { apple_ads: money([...apple, ...appleAuto], "spend") } : {}),
      ...(metaLatest ? { meta_ads: money(meta, "spend") } : {}),
    },
    latest: {
      revenuecat: await latestDate("revenuecat_keyword_daily", productId),
      ...(campaignIds.length ? { apple_ads: appleLatest } : {}),
      ...(metaLatest ? { meta_ads: metaLatest } : {}),
    },
    running,
  };
}

/** Raw rows for one window of the overview (see src/scorecard/overview.ts). */
export interface WindowData {
  meta: { ad_id: string; spend: number; installs: number; trials: number; currency: string }[];
  metaAds: { id: string; name: string; status: string }[];
  /** Apple keyword rows plus Search Match rows. */
  apple: { spend: number; installs: number; currency: string }[];
  /** campaign '' = RevenueCat could not attribute the customer (organic, Meta, anything else). */
  revenuecat: { campaign: string; trials: number; paid: number; proceeds: number; currency: string }[];
  ownPosts: { platform: string; handle: string; url: string | null; posted_at: string; views: number | null }[];
  ownAccounts: number;
  runs: { source: string; status: string; started_at: string; finished_at: string | null }[];
  /** Open follow-ups (due_on set, resolved_at null) across all of the product's experiments. */
  followUps: { id: string; experiment: string; due_on: string; body: string }[];
  appleCoverage: { campaigns: CoverageCampaign[]; keywords: CoverageKeyword[] };
}

const SOCIAL = ["instagram", "tiktok", "facebook"];

export async function loadWindowData(productId: string, from: string, to: string): Promise<WindowData> {
  const db = getDb();
  const meta = await all(
    (a, b) => db.from("meta_ads_ad_daily").select("ad_id,spend,installs,trials,currency").eq("product_id", productId).gte("date", from).lte("date", to).range(a, b),
    "overview meta",
  );
  const adIds = [...new Set(meta.map((m) => m.ad_id))];
  const metaAds = adIds.length ? unwrap(await db.from("meta_ads_ads").select("id,name,status,effective_status").in("id", adIds), "overview meta ads") : [];

  const appleCampaigns = unwrap(await db.from("apple_ads_campaigns").select("id,name").eq("product_id", productId), "overview apple coverage campaigns");
  const campaignIds = appleCampaigns.map((campaign) => campaign.id);
  const runningExperimentIds = unwrap(await db.from("experiments").select("id").eq("product_id", productId).eq("status", "running"), "overview apple coverage experiments").map((e) => e.id);
  const campaignLinks = runningExperimentIds.length
    ? unwrap(await db.from("experiment_campaigns").select("external_campaign_id,role,geo").eq("channel", "apple_ads").in("experiment_id", runningExperimentIds), "overview apple coverage campaign links")
    : [];
  const linksByCampaign = new Map(campaignLinks.map((link) => [link.external_campaign_id, link]));
  const coverageCampaigns = appleCampaigns.map((campaign) => {
    const link = linksByCampaign.get(String(campaign.id));
    return { id: campaign.id, name: campaign.name, role: link?.role ?? null, geo: link?.geo ?? null };
  });
  const appleCoverageKeywords = campaignIds.length
    ? await all(
        (a, b) => db.from("apple_ads_keywords").select("campaign_id,text,match_type,is_negative,deleted").in("campaign_id", campaignIds).range(a, b),
        "overview apple coverage keywords",
      )
    : [];
  const apple = campaignIds.length
    ? [
        ...(await all((a, b) => db.from("apple_ads_keyword_daily").select("spend,tap_installs,currency").in("campaign_id", campaignIds).gte("date", from).lte("date", to).range(a, b), "overview apple")),
        ...(await all((a, b) => db.from("apple_ads_search_terms_daily").select("spend,tap_installs,currency").in("campaign_id", campaignIds).eq("keyword_id", 0).gte("date", from).lte("date", to).range(a, b), "overview apple search match")),
      ]
    : [];

  const rc = await all(
    (a, b) => db.from("revenuecat_keyword_daily").select("campaign,new_trials,trial_conversions,proceeds,currency").eq("product_id", productId).gte("date", from).lte("date", to).range(a, b),
    "overview revenuecat",
  );

  // Own accounts: tracked_sources rows with config.relation = own, matched like the web's organic loader.
  const sources = unwrap(await db.from("tracked_sources").select("source,value,config").eq("product_id", productId).eq("kind", "account").eq("enabled", true).in("source", SOCIAL), "overview own sources")
    .filter((s) => (s.config as Record<string, unknown> | null)?.relation === "own");
  const handles = [...new Set(sources.map((s) => s.value))];
  const accounts = handles.length ? unwrap(await db.from("social_accounts").select("id,platform,handle").in("handle", handles), "overview own accounts").filter((a) => sources.some((s) => s.source === a.platform && s.value === a.handle)) : [];
  const posts = accounts.length
    ? unwrap(await db.from("social_posts").select("id,account_id,platform,url,posted_at").in("account_id", accounts.map((a) => a.id)).in("kind", ["reel", "video"]).gte("posted_at", from).lte("posted_at", `${to}T23:59:59Z`), "overview own posts")
    : [];
  const snaps = posts.length ? unwrap(await db.from("social_post_snapshots").select("post_id,captured_on,views").in("post_id", posts.map((p) => p.id)), "overview post snapshots") : [];
  const latestViews = new Map<string, { on: string; views: number | null }>();
  for (const s of snaps) {
    const cur = latestViews.get(s.post_id);
    if (!cur || s.captured_on > cur.on) latestViews.set(s.post_id, { on: s.captured_on, views: s.views });
  }
  const handleOf = new Map(accounts.map((a) => [a.id, a.handle]));

  const runs = unwrap(await db.from("scrape_runs").select("source,status,started_at,finished_at").eq("product_id", productId).order("started_at", { ascending: false }).limit(300), "overview runs");

  const experiments = unwrap(await db.from("experiments").select("id,slug,channel").eq("product_id", productId), "overview experiments");
  const expName = new Map(experiments.map((e) => [e.id, `${e.channel}/${e.slug}`]));
  const followUps = experiments.length
    ? unwrap(await db.from("experiment_log").select("id,experiment_id,due_on,body").in("experiment_id", experiments.map((e) => e.id)).not("due_on", "is", null).is("resolved_at", null).order("due_on"), "overview follow-ups")
    : [];

  return {
    meta: meta.map((m) => ({ ad_id: m.ad_id, spend: Number(m.spend), installs: m.installs ?? 0, trials: m.trials ?? 0, currency: m.currency })),
    metaAds: metaAds.map((a) => ({ id: a.id, name: a.name, status: a.effective_status ?? a.status })),
    apple: apple.map((r) => ({ spend: Number(r.spend), installs: r.tap_installs, currency: r.currency })),
    revenuecat: rc.map((r) => ({ campaign: r.campaign, trials: r.new_trials, paid: r.trial_conversions, proceeds: Number(r.proceeds), currency: r.currency })),
    ownPosts: posts.map((p) => ({ platform: p.platform, handle: handleOf.get(p.account_id) ?? "", url: p.url, posted_at: p.posted_at!, views: latestViews.get(p.id)?.views ?? null })),
    ownAccounts: accounts.length,
    runs,
    followUps: followUps.map((f) => ({ id: f.id, experiment: expName.get(f.experiment_id) ?? "", due_on: f.due_on!, body: f.body })),
    appleCoverage: {
      campaigns: coverageCampaigns,
      keywords: appleCoverageKeywords.map((keyword) => ({
        campaignId: keyword.campaign_id,
        text: keyword.text,
        matchType: keyword.match_type,
        isNegative: keyword.is_negative,
        deleted: keyword.deleted,
      })),
    },
  };
}
