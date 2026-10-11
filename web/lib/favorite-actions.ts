"use server";

import { requireOwner } from "./auth/server";
import { getDb } from "./db";
import type { FavoriteKind } from "./favorites";

/** Stars or unstars ads/posts. Unstarring keeps the row with `favorited = false`. */
export async function setFavorite(productId: string, kind: FavoriteKind, ids: string[], favorited: boolean): Promise<void> {
  await requireOwner();
  if (kind !== "ad" && kind !== "post") throw new Error("Unknown favorite kind");
  if (!ids.length) return;
  const res = await getDb()
    .from("favorites")
    .upsert(ids.map((target_id) => ({ product_id: productId, kind, target_id, favorited })), { onConflict: "product_id,kind,target_id" });
  if (res.error) throw new Error(`favorites: ${res.error.message}`);
}
