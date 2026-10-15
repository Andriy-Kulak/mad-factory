import "server-only";
import { fetchAll } from "./apple-ads";
import { getDb } from "./db";

export type FavoriteKind = "ad" | "post";

/** Ids of the competitor ads or organic posts starred for a product. */
export async function favoriteIds(productId: string, kind: FavoriteKind): Promise<string[]> {
  const db = getDb();
  const rows = await fetchAll<{ target_id: string }>(
    (a, b) => db.from("favorites").select("target_id").match({ product_id: productId, kind, favorited: true }).order("target_id").range(a, b),
    "favorites",
  );
  return rows.map((r) => r.target_id);
}

/** Starred-at (`updated_at`) per target id; re-starring bumps it, so it doubles as "most recently starred". */
export async function favoriteStars(productId: string, kind: FavoriteKind): Promise<Record<string, string>> {
  const db = getDb();
  const rows = await fetchAll<{ target_id: string; updated_at: string }>(
    (a, b) => db.from("favorites").select("target_id, updated_at").match({ product_id: productId, kind, favorited: true }).order("target_id").range(a, b),
    "favorites",
  );
  return Object.fromEntries(rows.map((r) => [r.target_id, r.updated_at]));
}
