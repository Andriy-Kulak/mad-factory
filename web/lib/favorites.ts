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
