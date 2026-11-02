import "server-only";
import { deflateSync, inflateSync } from "node:zlib";
import { cache } from "react";
import { cachedByProduct } from "./cache";
import { getDb } from "./db";
import { groupAdCards, type AdCard, type AdSourceRow, type CardProfile, type ImpressionRank } from "./ad-cards.ts";
import { mergeAdRelations } from "../../src/lib/tracked-source-input.ts";
import { adSourceRelations } from "./tracked-sources";
import { loadSlimProfiles } from "./creatives";
import type { AdRow, CreativeRow, ProductRow, ScrapeRunRow, TrackedSourceRow } from "@db/types";

function fail(ctx: string, e: { message: string } | null): never {
  throw new Error(`${ctx}: ${e?.message ?? "unknown error"}`);
}

export interface ProductSummary extends ProductRow {
  sourceCount: number;
  adCount: number;
  lastRun: ScrapeRunRow | null;
}

export async function listProductSummaries(): Promise<ProductSummary[]> {
  const db = getDb();
  const products = await db.from("products").select("*").order("created_at");
  if (products.error) fail("products", products.error);
  return Promise.all(
    (products.data ?? []).map(async (p) => {
      const [sources, links, run] = await Promise.all([
        db.from("tracked_sources").select("id", { count: "exact", head: true }).eq("product_id", p.id),
        db.from("product_ads").select("ad_id", { count: "exact", head: true }).eq("product_id", p.id),
        db.from("scrape_runs").select("*").eq("product_id", p.id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (sources.error) fail("tracked_sources count", sources.error);
      if (links.error) fail("product_ads count", links.error);
      if (run.error) fail("scrape_runs latest", run.error);
      return { ...p, sourceCount: sources.count ?? 0, adCount: links.count ?? 0, lastRun: run.data };
    }),
  );
}

/** Cached per request: the product layout and its page both look the product up. */
export const getProductBySlug = cache(async (slug: string): Promise<ProductRow | null> => {
  const res = await getDb().from("products").select("*").eq("slug", slug).maybeSingle();
  if (res.error) fail("product", res.error);
  return res.data;
});

/** Slug and name of every product, for the product switcher. */
export async function listProductNames(): Promise<Pick<ProductRow, "slug" | "name">[]> {
  const res = await getDb().from("products").select("slug, name").order("created_at");
  if (res.error) fail("product names", res.error);
  return res.data ?? [];
}

export async function getTrackedSources(productId: string): Promise<TrackedSourceRow[]> {
  const res = await getDb().from("tracked_sources").select("*").eq("product_id", productId).order("created_at");
  if (res.error) fail("tracked_sources", res.error);
  return res.data ?? [];
}

export async function getScrapeRuns(productId: string, limit = 20): Promise<ScrapeRunRow[]> {
  const res = await getDb().from("scrape_runs").select("*").eq("product_id", productId).order("started_at", { ascending: false }).limit(limit);
  if (res.error) fail("scrape_runs", res.error);
  return res.data ?? [];
}

/**
 * Latest total-impressions rank per ad for a product: per tracked source take the newest impressions-sorted
 * run (and the one before it for movement); an ad surfaced by several sources keeps its best rank.
 */
export async function impressionRanks(productId: string): Promise<Map<string, ImpressionRank>> {
  const db = getDb();
  const runs = await db
    .from("scrape_runs")
    .select("id,tracked_source_id,started_at")
    .eq("product_id", productId)
    .eq("status", "done")
    .eq("collector", "scrapecreators")
    .order("started_at", { ascending: false })
    .limit(500);
  if (runs.error) fail("scrape_runs", runs.error);
  const latest = new Set<string>();
  const previous = new Set<string>();
  const seen = new Map<string, number>();
  for (const r of runs.data ?? []) {
    if (!r.tracked_source_id) continue;
    const n = seen.get(r.tracked_source_id) ?? 0;
    if (n === 0) latest.add(r.id);
    else if (n === 1) previous.add(r.id);
    seen.set(r.tracked_source_id, n + 1);
  }
  const out = new Map<string, ImpressionRank>();
  const runIds = [...latest, ...previous];
  if (!runIds.length) return out;

  const rows: { scrape_run_id: string; ad_id: string; rank: number; observed_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await db
      .from("ad_library_observations")
      .select("scrape_run_id,ad_id,rank,observed_at")
      .in("scrape_run_id", runIds)
      .eq("sort_mode", "total_impressions")
      .range(from, from + 999);
    if (res.error) fail("ad_library_observations", res.error);
    rows.push(...(res.data ?? []));
    if ((res.data ?? []).length < 1000) break;
  }
  const prev = new Map<string, number>();
  for (const o of rows) {
    if (previous.has(o.scrape_run_id)) prev.set(o.ad_id, Math.min(prev.get(o.ad_id) ?? Infinity, o.rank));
  }
  for (const o of rows) {
    if (!latest.has(o.scrape_run_id)) continue;
    const cur = out.get(o.ad_id);
    if (!cur || o.rank < cur.rank) out.set(o.ad_id, { rank: o.rank, prevRank: null, observedAt: o.observed_at });
  }
  for (const [adId, r] of out) r.prevRank = prev.get(adId) ?? null;
  return out;
}

/** Longest primary text sent to the browser per card; Ad Library copy rarely runs past it. */
const BODY_MAX = 2000;

/** product_ads rows per cached chunk; each chunk is cached on its own so it stays under Next's 2MB cache-entry limit. */
const AD_PAGE_ROWS = 1000;

/** One chunk of a product's Ad Library ads (product_ads rows from ad_id `start` up to the next chunk's) plus their media files' slim profiles. */
interface AdPage {
  links: { trackedSourceId: string | null; row: Omit<AdSourceRow, "relation"> }[];
  profiles: [sha256: string, profile: CardProfile][];
}

async function adPage(productId: string, start: string, end: string | null): Promise<AdPage> {
  const cols = `tracked_source_id,ad:ads(id,external_id,advertiser_id,advertiser_name,body_text,title,cta_text,link_url,start_date,end_date,is_active,platforms,collation_id,collation_count,first_seen_at,
    avatar:raw->snapshot->>page_profile_picture_url,caption:raw->snapshot->>caption,format:raw->snapshot->>display_format,
    ad_creatives(position,creatives(sha256,public_url,media_type)))`;
  type Row = {
    id: string;
    external_id: string;
    advertiser_id: string | null;
    advertiser_name: string | null;
    body_text: string | null;
    title: string | null;
    cta_text: string | null;
    link_url: string | null;
    start_date: string | null;
    end_date: string | null;
    is_active: boolean | null;
    platforms: string[];
    collation_id: string | null;
    collation_count: number | null;
    first_seen_at: string;
    avatar: string | null;
    caption: string | null;
    format: string | null;
    ad_creatives: { position: number; creatives: { sha256: string; public_url: string | null; media_type: string } | null }[];
  };
  // Keyset bounds, not an offset: deep offsets over this embedded join hit the database statement timeout.
  let q = getDb().from("product_ads").select(cols).eq("product_id", productId).gte("ad_id", start);
  if (end) q = q.lt("ad_id", end);
  const res = await q.order("ad_id");
  if (res.error) fail("product_ads", res.error);
  const links: AdPage["links"] = [];
  for (const { tracked_source_id, ad } of (res.data ?? []) as unknown as { tracked_source_id: string | null; ad: Row | null }[]) {
    if (!ad) continue;
    const media = [...ad.ad_creatives].sort((x, y) => x.position - y.position).find((c) => c.creatives?.public_url)?.creatives;
    links.push({
      trackedSourceId: tracked_source_id,
      row: {
        id: ad.id,
        externalId: ad.external_id,
        advertiserId: ad.advertiser_id,
        advertiserName: ad.advertiser_name,
        avatarUrl: ad.avatar,
        body: ad.body_text && ad.body_text.length > BODY_MAX ? `${ad.body_text.slice(0, BODY_MAX)}…` : ad.body_text,
        title: ad.title,
        cta: ad.cta_text,
        linkUrl: ad.link_url,
        caption: ad.caption,
        format: ad.format,
        startDate: ad.start_date,
        endDate: ad.end_date,
        isActive: ad.is_active,
        platforms: ad.platforms,
        collationId: ad.collation_id,
        collationCount: ad.collation_count,
        firstSeenAt: ad.first_seen_at,
        media: media?.public_url ? { url: media.public_url, type: media.media_type, sha256: media.sha256 } : null,
      },
    });
  }
  const profiles = await loadSlimProfiles(links.flatMap((l) => (l.row.media ? [l.row.media.sha256] : [])));
  return { links, profiles: [...profiles].map(([sha, p]) => [sha, { fields: p.fields, hook: p.hook.spoken ?? p.hook.onscreen }]) };
}

/** The first ad_id of each AD_PAGE_ROWS-row chunk of the product's product_ads, in ad_id order. */
async function adPageStarts(productId: string): Promise<string[]> {
  const db = getDb();
  const count = await db.from("product_ads").select("ad_id", { count: "exact", head: true }).eq("product_id", productId);
  if (count.error) fail("product_ads count", count.error);
  const starts = await Promise.all(
    Array.from({ length: Math.ceil((count.count ?? 0) / AD_PAGE_ROWS) }, async (_, i) => {
      const res = await db
        .from("product_ads")
        .select("ad_id")
        .eq("product_id", productId)
        .order("ad_id")
        .range(i * AD_PAGE_ROWS, i * AD_PAGE_ROWS);
      if (res.error) fail("product_ads", res.error);
      return res.data?.[0]?.ad_id ?? null;
    }),
  );
  return starts.filter((s): s is string => s != null);
}

interface AdLoaders {
  starts: (productId: string) => Promise<string[]>;
  page: (productId: string, start: string, end: string | null) => Promise<AdPage>;
  ranks: (productId: string) => Promise<Map<string, ImpressionRank>>;
}

async function buildCompetitorAds(productId: string, load: AdLoaders): Promise<AdCard[]> {
  const [starts, ranks, relations] = await Promise.all([load.starts(productId), load.ranks(productId), adSourceRelations(productId)]);
  const pages = await Promise.all(starts.map((start, i) => load.page(productId, start, starts[i + 1] ?? null)));
  const rows = new Map<string, AdSourceRow>();
  const profiles = new Map<string, CardProfile>();
  for (const page of pages) {
    for (const [sha, p] of page.profiles) profiles.set(sha, p);
    for (const { trackedSourceId, row } of page.links) {
      const relation = relations.get(trackedSourceId ?? "") ?? "competitor";
      const seen = rows.get(row.id);
      if (seen) seen.relation = mergeAdRelations(seen.relation, relation);
      else rows.set(row.id, { ...row, relation });
    }
  }
  return groupAdCards([...rows.values()], ranks).map((c) => {
    const p = c.media ? profiles.get(c.media.sha256) : undefined;
    return p ? { ...c, profile: p } : c;
  });
}

/**
 * Every Ad Library ad a product tracks, one card per collation, ranked by the latest impressions scrape. Paged,
 * embedded queries (ad + first creative + a few raw payload fields) run alongside the rank lookup; each card
 * then gets its media file's slim creative profile (angle, persona, hook…) when one exists.
 */
export function competitorAds(productId: string): Promise<AdCard[]> {
  return buildCompetitorAds(productId, { starts: adPageStarts, page: adPage, ranks: impressionRanks });
}

const pack = (v: unknown) => deflateSync(JSON.stringify(v)).toString("base64");
const unpack = <T>(payload: string) => JSON.parse(inflateSync(Buffer.from(payload, "base64")).toString("utf8")) as T;
const adPageStartsCached = cachedByProduct("competitorAdPageStarts", adPageStarts);
const adPageCached = cachedByProduct("competitorAdPage", async (productId: string, start: string, end: string | null) => pack(await adPage(productId, start, end)));
const impressionRanksCached = cachedByProduct("impressionRanks", async (productId: string) => pack([...(await impressionRanks(productId))]));

/** competitorAds from the per-product cache, stored in chunks (one cache entry for everything went over 2MB and was never cached). */
export function competitorAdsCached(productId: string): Promise<AdCard[]> {
  return buildCompetitorAds(productId, {
    starts: adPageStartsCached,
    page: async (id, start, end) => unpack<AdPage>(await adPageCached(id, start, end)),
    ranks: async (id) => new Map(unpack<[string, ImpressionRank][]>(await impressionRanksCached(id))),
  });
}

async function creativesForAds(adIds: string[]): Promise<Map<string, CreativeRow[]>> {
  const out = new Map<string, CreativeRow[]>();
  if (!adIds.length) return out;
  const links = await getDb().from("ad_creatives").select("ad_id,position,creatives(*)").in("ad_id", adIds).order("position");
  if (links.error) fail("ad_creatives", links.error);
  for (const l of links.data ?? []) {
    const c = l.creatives as unknown as CreativeRow | null;
    if (!c) continue;
    const arr = out.get(l.ad_id) ?? [];
    arr.push(c);
    out.set(l.ad_id, arr);
  }
  return out;
}

export interface AdDetail extends AdRow {
  creatives: CreativeRow[];
  products: Pick<ProductRow, "id" | "slug" | "name">[];
}

export async function getAd(id: string): Promise<AdDetail | null> {
  const db = getDb();
  const res = await db.from("ads").select("*").eq("id", id).maybeSingle();
  if (res.error) fail("ad", res.error);
  if (!res.data) return null;
  const [creatives, links] = await Promise.all([creativesForAds([id]), db.from("product_ads").select("products(id,slug,name)").eq("ad_id", id)]);
  const products = (links.data ?? []).map((l) => l.products as unknown as Pick<ProductRow, "id" | "slug" | "name"> | null).filter((p): p is Pick<ProductRow, "id" | "slug" | "name"> => !!p);
  return { ...res.data, creatives: creatives.get(id) ?? [], products };
}

export async function globalStats() {
  const db = getDb();
  const [ads, creatives, products] = await Promise.all([
    db.from("ads").select("*", { count: "exact", head: true }),
    db.from("creatives").select("bytes"),
    db.from("products").select("*", { count: "exact", head: true }),
  ]);
  const bytes = (creatives.data ?? []).reduce((s, c) => s + Number(c.bytes), 0);
  return { ads: ads.count ?? 0, creatives: creatives.data?.length ?? 0, bytes, products: products.count ?? 0 };
}
