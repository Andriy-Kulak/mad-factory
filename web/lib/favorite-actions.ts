"use server";

import { requireOwner } from "./auth/server";
import type { FavoriteKind } from "./favorites";
import { writeFavorites } from "./research-writes";

/** Stars or unstars ads/posts. Unstarring keeps the row with `favorited = false`. */
export async function setFavorite(productId: string, kind: FavoriteKind, ids: string[], favorited: boolean): Promise<void> {
  await requireOwner();
  await writeFavorites(productId, kind, ids, favorited);
}
