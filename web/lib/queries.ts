import "server-only";
import { cache } from "react";
import { getDb } from "./db";
import { groupAdCards, type AdCard, type AdSourceRow, type ImpressionRank } from "./ad-cards.ts";
import { adRelationOf, mergeAdRelations, type AdRelation } from "../../src/lib/tracked-source-input.ts";
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
  const res = await getDb()
    .from("scrape_runs")
    .select("*")
    .eq("product_id", productId)
    .order("started_at", { ascending: false })
    .limit(limit);
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

/** Direct competitor or adjacent niche, per tracked Ad Library source id (tracked_sources.config.relation). */
export async function adSourceRelations(productId: string): Promise<Map<string, AdRelation>> {
  const res = await getDb().from("tracked_sources").select("id,config").eq("product_id", productId).eq("source", "meta");
  if (res.error) fail("tracked_sources", res.error);
  return new Map((res.data ?? []).map((s) => [s.id, adRelationOf(s.config)]));
}

/** Longest primary text sent to the browser per card; Ad Library copy rarely runs past it. */
const BODY_MAX = 2000;

/**
 * Every Ad Library ad a product tracks, one card per collation, ranked by the latest impressions scrape. One
 * paged, embedded query (ad + first creative + a few raw payload fields) runs alongside the rank lookup.
 */
export async function competitorAds(productId: string): Promise<AdCard[]> {
  const db = getDb();
  const cols = `tracked_source_id,ad:ads(id,external_id,advertiser_id,advertiser_name,body_text,title,cta_text,link_url,start_date,end_date,is_active,platforms,collation_id,collation_count,first_seen_at,
    avatar:raw->snapshot->>page_profile_picture_url,caption:raw->snapshot->>caption,format:raw->snapshot->>display_format,
    ad_creatives(position,creatives(public_url,media_type)))`;
  const page = (from: number) => db.from("product_ads").select(cols).eq("product_id", productId).order("ad_id").range(from, from + 999);
  type Row = {
    id: string; external_id: string; advertiser_id: string | null; advertiser_name: string | null; body_text: string | null; title: string | null; cta_text: string | null;
    link_url: string | null; start_date: string | null; end_date: string | null; is_active: boolean | null; platforms: string[]; collation_id: string | null;
    collation_count: number | null; first_seen_at: string; avatar: string | null; caption: string | null; format: string | null;
    ad_creatives: { position: number; creatives: { public_url: string | null; media_type: string } | null }[];
  };
  const [count, ranks, relations] = await Promise.all([
    db.from("product_ads").select("ad_id", { count: "exact", head: true }).eq("product_id", productId),
    impressionRanks(productId),
    adSourceRelations(productId),
  ]);
  if (count.error) fail("product_ads count", count.error);
  const pages = await Promise.all(Array.from({ length: Math.ceil((count.count ?? 0) / 1000) }, (_, i) => page(i * 1000)));
  const rows = new Map<string, AdSourceRow>();
  for (const res of pages) {
    if (res.error) fail("product_ads", res.error);
    for (const { tracked_source_id, ad } of (res.data ?? []) as unknown as { tracked_source_id: string | null; ad: Row | null }[]) {
      if (!ad) continue;
      const relation = relations.get(tracked_source_id ?? "") ?? "competitor";
      const seen = rows.get(ad.id);
      if (seen) {
        seen.relation = mergeAdRelations(seen.relation, relation);
        continue;
      }
      const media = [...ad.ad_creatives].sort((x, y) => x.position - y.position).find((c) => c.creatives?.public_url)?.creatives;
      rows.set(ad.id, {
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
        media: media?.public_url ? { url: media.public_url, type: media.media_type } : null,
        relation,
      });
    }
  }
  return groupAdCards([...rows.values()], ranks);
}

async function creativesForAds(adIds: string[]): Promise<Map<string, CreativeRow[]>> {
  const out = new Map<string, CreativeRow[]>();
  if (!adIds.length) return out;
  const links = await getDb()
    .from("ad_creatives")
    .select("ad_id,position,creatives(*)")
    .in("ad_id", adIds)
    .order("position");
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
  const [creatives, links] = await Promise.all([
    creativesForAds([id]),
    db.from("product_ads").select("products(id,slug,name)").eq("ad_id", id),
  ]);
  const products = (links.data ?? [])
    .map((l) => l.products as unknown as Pick<ProductRow, "id" | "slug" | "name"> | null)
    .filter((p): p is Pick<ProductRow, "id" | "slug" | "name"> => !!p);
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
