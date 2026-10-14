"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "./auth/server";
import type { FavoriteKind } from "./favorites";
import { saveAndStar, writeFavorites } from "./research-writes";
import type { SourceFormState } from "./source-actions";

/** Stars or unstars ads/posts. Unstarring keeps the row with `favorited = false`. */
export async function setFavorite(productId: string, kind: FavoriteKind, ids: string[], favorited: boolean): Promise<void> {
  await requireOwner();
  await writeFavorites(productId, kind, ids, favorited);
}

/** Saves one Ad Library ad or social post by link and stars it (about 1 ScrapeCreators credit when it isn't stored yet). */
export async function saveFavoriteLink(productId: string, slug: string, _prev: SourceFormState, form: FormData): Promise<SourceFormState> {
  await requireOwner();
  const input = String(form.get("url") ?? "").trim();
  if (!input) return { error: "Paste an Ad Library ad ID or link, or a post link." };
  if (!process.env.SCRAPECREATORS_API_KEY) return { error: "Saving by link needs SCRAPECREATORS_API_KEY on this server." };
  try {
    const saved = await saveAndStar(productId, input, "web");
    revalidatePath(`/p/${slug}`, "layout");
    const what = saved.kind === "ad" ? "ad" : "post";
    return { ok: saved.alreadyStored ? `That ${what} was already stored; it's starred now.` : `Saved and starred the ${what}${saved.mediaStored ? "" : " (no media stored)"}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
