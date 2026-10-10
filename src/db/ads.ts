import { getDb, unwrap } from "./client.ts";
import type {
  AdInsert,
  AdLibraryObservationInsert,
  AdRow,
  CreativeInsert,
  ScrapeRunInsert,
  ScrapeRunUpdate,
} from "./types.ts";

/**
 * Upsert on (source, external_id). `first_seen_at` is intentionally absent from
 * the payload so the insert default applies and conflicts leave it untouched;
 * `last_seen_at` is always bumped.
 */
export async function upsertAd(ad: AdInsert): Promise<{ id: string; isNew: boolean }> {
  const db = getDb();
  const existing = await db
    .from("ads")
    .select("id")
    .eq("source", ad.source)
    .eq("external_id", ad.external_id)
    .maybeSingle();
  if (existing.error) throw new Error(`upsertAd lookup: ${existing.error.message}`);

  const payload: AdInsert = { ...ad, last_seen_at: new Date().toISOString() };
  delete payload.first_seen_at;
  const row = unwrap(
    await db.from("ads").upsert(payload, { onConflict: "source,external_id" }).select("id").single(),
    "upsertAd",
  );
  return { id: row.id, isNew: !existing.data };
}

export async function getAd(source: string, externalId: string): Promise<AdRow | null> {
  const res = await getDb().from("ads").select("*").eq("source", source).eq("external_id", externalId).maybeSingle();
  if (res.error) throw new Error(`getAd: ${res.error.message}`);
  return res.data;
}

export async function hasCreativesForAd(adId: string): Promise<boolean> {
  const res = await getDb().from("ad_creatives").select("ad_id", { count: "exact", head: true }).eq("ad_id", adId);
  if (res.error) throw new Error(`hasCreativesForAd: ${res.error.message}`);
  return (res.count ?? 0) > 0;
}

export async function creativeExists(sha256: string): Promise<boolean> {
  const res = await getDb().from("creatives").select("sha256").eq("sha256", sha256).maybeSingle();
  if (res.error) throw new Error(`creativeExists: ${res.error.message}`);
  return !!res.data;
}

export async function insertCreative(c: CreativeInsert): Promise<void> {
  const res = await getDb().from("creatives").upsert(c, { onConflict: "sha256", ignoreDuplicates: true });
  if (res.error) throw new Error(`insertCreative: ${res.error.message}`);
}

export async function linkAdCreative(adId: string, sha256: string, position: number): Promise<void> {
  const res = await getDb()
    .from("ad_creatives")
    .upsert({ ad_id: adId, sha256, position }, { onConflict: "ad_id,position" });
  if (res.error) throw new Error(`linkAdCreative: ${res.error.message}`);
}

/** Link an ad to a product; keeps first_seen_at, bumps last_seen_at. */
export async function linkProductAd(productId: string, adId: string, trackedSourceId: string | null): Promise<void> {
  const res = await getDb()
    .from("product_ads")
    .upsert(
      { product_id: productId, ad_id: adId, tracked_source_id: trackedSourceId, last_seen_at: new Date().toISOString() },
      { onConflict: "product_id,ad_id" },
    );
  if (res.error) throw new Error(`linkProductAd: ${res.error.message}`);
}

export async function markUnseenAdsEnded(
  trackedSourceId: string,
  seenAdIds: string[],
  endedAt: string,
): Promise<number> {
  const db = getDb();
  const seen = new Set(seenAdIds);
  const unseen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const links = await db
      .from("product_ads")
      .select("ad_id")
      .eq("tracked_source_id", trackedSourceId)
      .order("ad_id")
      .range(from, from + 999);
    if (links.error) throw new Error(`markUnseenAdsEnded product_ads: ${links.error.message}`);
    for (const link of links.data ?? []) {
      if (!seen.has(link.ad_id)) unseen.add(link.ad_id);
    }
    if ((links.data ?? []).length < 1000) break;
  }

  const ids = [...unseen];
  let marked = 0;
  for (let from = 0; from < ids.length; from += 100) {
    const batch = ids.slice(from, from + 100);
    const endDates = await db
      .from("ads")
      .update({ end_date: endedAt })
      .in("id", batch)
      .is("end_date", null)
      .or("is_active.eq.true,is_active.is.null");
    if (endDates.error) throw new Error(`markUnseenAdsEnded end_date: ${endDates.error.message}`);

    const inactive = await db
      .from("ads")
      .update({ is_active: false })
      .in("id", batch)
      .or("is_active.eq.true,is_active.is.null")
      .select("id");
    if (inactive.error) throw new Error(`markUnseenAdsEnded is_active: ${inactive.error.message}`);
    marked += inactive.data?.length ?? 0;
  }
  return marked;
}

export async function startScrapeRun(input: ScrapeRunInsert): Promise<string> {
  return unwrap(await getDb().from("scrape_runs").insert(input).select("id").single(), "startScrapeRun").id;
}

export async function finishScrapeRun(id: string, patch: ScrapeRunUpdate): Promise<void> {
  const res = await getDb()
    .from("scrape_runs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", id);
  if (res.error) throw new Error(`finishScrapeRun: ${res.error.message}`);
}

export async function insertAdLibraryObservation(input: AdLibraryObservationInsert): Promise<void> {
  const res = await getDb()
    .from("ad_library_observations")
    .upsert(input, { onConflict: "scrape_run_id,ad_id" });
  if (res.error) throw new Error(`insertAdLibraryObservation: ${res.error.message}`);
}
