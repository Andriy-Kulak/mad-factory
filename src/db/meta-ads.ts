import { getDb } from "./client.ts";
import { docName } from "../lib/product-docs.ts";
import type {
  Json,
  MetaAdsAdDailyBreakdownInsert,
  MetaAdsAdDailyInsert,
  MetaAdsAdInsert,
  MetaAdsAdsetInsert,
  MetaAdsCampaignInsert,
  MetaAdsChangeInsert,
  MetaAdsCreativeInsert,
  MetaAdsChangeRow,
} from "./types.ts";

const CHUNK = 500;

async function upsertChunks<T>(
  rows: T[],
  write: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>,
  context: string,
): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await write(rows.slice(i, i + CHUNK));
    if (error) throw new Error(`${context}: ${error.message}`);
  }
  return rows.length;
}

export function upsertMetaAdsCampaigns(rows: MetaAdsCampaignInsert[]): Promise<number> {
  return upsertChunks(rows, (chunk) => getDb().from("meta_ads_campaigns").upsert(chunk, { onConflict: "id" }), "upsertMetaAdsCampaigns");
}

export function upsertMetaAdsAdsets(rows: MetaAdsAdsetInsert[]): Promise<number> {
  return upsertChunks(rows, (chunk) => getDb().from("meta_ads_adsets").upsert(chunk, { onConflict: "id" }), "upsertMetaAdsAdsets");
}

export function upsertMetaAdsCreatives(rows: MetaAdsCreativeInsert[]): Promise<number> {
  return upsertChunks(rows, (chunk) => getDb().from("meta_ads_creatives").upsert(chunk, { onConflict: "id" }), "upsertMetaAdsCreatives");
}

export function upsertMetaAdsAds(rows: MetaAdsAdInsert[]): Promise<number> {
  return upsertChunks(rows, (chunk) => getDb().from("meta_ads_ads").upsert(chunk, { onConflict: "id" }), "upsertMetaAdsAds");
}

export function upsertMetaAdsAdDaily(rows: MetaAdsAdDailyInsert[]): Promise<number> {
  return upsertChunks(rows, (chunk) => getDb().from("meta_ads_ad_daily").upsert(chunk, { onConflict: "date,ad_id" }), "upsertMetaAdsAdDaily");
}

export function upsertMetaAdsAdDailyBreakdowns(rows: MetaAdsAdDailyBreakdownInsert[]): Promise<number> {
  return upsertChunks(
    rows,
    (chunk) => getDb().from("meta_ads_ad_daily_breakdowns").upsert(chunk, { onConflict: "date,ad_id,breakdown,value" }),
    "upsertMetaAdsAdDailyBreakdowns",
  );
}

export async function addMetaAdsChange(input: MetaAdsChangeInsert): Promise<string> {
  const { data, error } = await getDb().from("meta_ads_changes").insert(input).select("id").single();
  if (error) throw new Error(`addMetaAdsChange: ${error.message}`);
  return data.id;
}

export async function updateMetaAdsChange(id: string, patch: { status?: number | null; response?: Json | null }): Promise<void> {
  const { error } = await getDb().from("meta_ads_changes").update(patch).eq("id", id);
  if (error) throw new Error(`updateMetaAdsChange: ${error.message}`);
}

export async function listMetaAdsPlanWrites(productId: string, planPath: string): Promise<MetaAdsChangeRow[]> {
  const name = docName(planPath);
  const { data, error } = await getDb().from("meta_ads_changes")
    .select("*")
    .eq("product_id", productId)
    .in("plan_path", [name, `experiments/plans/${name}.md`, `experiments/plans/${name}.json`])
    .eq("is_write", true)
    .order("at");
  if (error) throw new Error(`listMetaAdsPlanWrites: ${error.message}`);
  return data ?? [];
}

export async function setMetaAdsAdStatus(id: string, status: string): Promise<void> {
  const { error } = await getDb().from("meta_ads_ads").update({ status }).eq("id", id);
  if (error) throw new Error(`setMetaAdsAdStatus: ${error.message}`);
}
