import "server-only";
import { getDb } from "./db";
import type { FavoriteKind } from "./favorites";
import { competitorAds } from "./queries";
import { saveAd, savePost, type SavedItem } from "../../src/research/save-item.ts";

/** The research writes shared by the owner's server actions and research-scoped MCP keys. Callers check who may write. */

export type TrackedSourceInsert = { product_id: string; source: string; kind: string; value: string; country: string; label: string | null; config: Record<string, string> };

/** Adds a tracked source; a duplicate is reported, not changed (a paused one stays paused). */
export async function insertTrackedSource(row: TrackedSourceInsert, what: string): Promise<{ error?: string; ok?: string }> {
  const db = getDb();
  const res = await db.from("tracked_sources").insert(row).select("id").single();
  if (res.error?.code === "23505") {
    const existing = await db.from("tracked_sources").select("enabled").match({ product_id: row.product_id, source: row.source, kind: row.kind, value: row.value, country: row.country }).maybeSingle();
    return { error: existing.data?.enabled === false ? `${what} is already tracked but paused. Resume it below.` : `${what} is already tracked.` };
  }
  if (res.error) return { error: res.error.message };
  return { ok: `Added ${what}. It will be fetched on the next sync.` };
}

/** Stars or unstars ads/posts. Unstarring keeps the row with `favorited = false`. */
export async function writeFavorites(productId: string, kind: FavoriteKind, ids: string[], favorited: boolean): Promise<void> {
  if (kind !== "ad" && kind !== "post") throw new Error("Unknown favorite kind");
  if (!ids.length) return;
  const res = await getDb()
    .from("favorites")
    .upsert(
      ids.map((target_id) => ({ product_id: productId, kind, target_id, favorited })),
      { onConflict: "product_id,kind,target_id" },
    );
  if (res.error) throw new Error(`favorites: ${res.error.message}`);
}

/** ScrapeCreators credits one MCP key may spend per UTC day on save_url. */
export const SAVE_CREDITS_PER_DAY = 20;
const SAVE_SOURCE = "mcp_save";

/** `collector` labels the spend in scrape_runs: `mcp:<key name>` for an MCP key, `web` for the owner's Favorites page. */
export async function saveCreditsUsedToday(collector: string): Promise<number> {
  const since = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  const res = await getDb().from("scrape_runs").select("credits_used").match({ source: SAVE_SOURCE, collector }).gte("started_at", since);
  if (res.error) throw new Error(`scrape_runs: ${res.error.message}`);
  return (res.data ?? []).reduce((sum, r) => sum + (r.credits_used ?? 0), 0);
}

/** One scrape_runs row per save, so the spend shows next to the daily syncs and counts toward the key's cap. */
async function recordSave(productId: string, collector: string, credits: number, error?: string): Promise<void> {
  const now = new Date().toISOString();
  const res = await getDb()
    .from("scrape_runs")
    .insert({
      product_id: productId,
      source: SAVE_SOURCE,
      collector,
      status: error ? "error" : "done",
      started_at: now,
      finished_at: now,
      credits_used: credits,
      error: error ?? null,
    });
  if (res.error) throw new Error(`scrape_runs: ${res.error.message}`);
}

/** True when the input names one Ad Library ad (an id or an ads/library link) rather than a post link. */
export const isAdInput = (input: string) => /^\d+$/.test(input.trim()) || /facebook\.com\/ads\/library/i.test(input);

/**
 * Saves one ad or post by link and stars it, without following its page or account. Spend (and real failures) are
 * recorded in scrape_runs; input errors ("Give …") are thrown without a row. Returns the starred id: for an ad, its card id.
 */
export async function saveAndStar(productId: string, input: string, collector: string): Promise<SavedItem> {
  const link = input.trim();
  let saved: SavedItem;
  try {
    saved = isAdInput(link) ? await saveAd(productId, link) : await savePost(link);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/^Give |^That is an Ad Library/.test(message)) await recordSave(productId, collector, 0, message.slice(0, 500));
    throw new Error(message);
  }
  if (saved.credits) await recordSave(productId, collector, saved.credits);
  let id = saved.id;
  if (saved.kind === "ad") id = (await competitorAds(productId)).find((c) => c.id === saved.id || c.memberIds.includes(saved.id))?.id ?? saved.id;
  await writeFavorites(productId, saved.kind, [id], true);
  return { ...saved, id };
}
