import "server-only";
import { getDb } from "./db";
import type { FavoriteKind } from "./favorites";

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
