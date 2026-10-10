import { createCreditBudget } from "../budget.ts";
import { record, text } from "../../../util.ts";
import type { SocialCollector, SocialPost } from "../../../types.ts";
import { normalizeFacebookProfile, normalizeFacebookReel } from "./normalize.ts";

function validateFacebookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Facebook account value must be an HTTPS facebook.com profile URL");
  }
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "facebook.com" && url.hostname !== "www.facebook.com")
  ) {
    throw new Error("Facebook account value must be an HTTPS facebook.com profile URL");
  }
  return value;
}

export const scrapeCreatorsFacebookCollector: SocialCollector = {
  provider: "scrapecreators",
  platform: "facebook",
  validateValue: validateFacebookUrl,
  async collect(value, options) {
    const url = validateFacebookUrl(value);
    if (!Number.isInteger(options.maxPosts) || options.maxPosts <= 0) {
      throw new Error("maxPosts must be a positive integer");
    }

    const since = options.since ? new Date(options.since).toISOString() : null;
    const budget = createCreditBudget("facebook", options);
    const profileBody = await budget.get("/v1/facebook/profile", { url });
    const profile = normalizeFacebookProfile(profileBody);
    await options.onProfile?.(profile);

    let postsSeen = 0;
    let nextPageId: string | null = null;
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    const seenPosts = new Set<string>();
    while (postsSeen < options.maxPosts) {
      const params: Record<string, string> = { url };
      if (nextPageId && cursor) {
        params.next_page_id = nextPageId;
        params.cursor = cursor;
      }
      const body = await budget.get("/v1/facebook/profile/reels", params);
      const items = Array.isArray(body.reels) ? body.reels : [];
      if (!items.length) break;

      const page: SocialPost[] = [];
      const remaining = options.maxPosts - postsSeen;
      let lastPostedAt: string | null = null;
      for (const value of items) {
        const item = record(value);
        if (!item) continue;
        const post = normalizeFacebookReel(item);
        lastPostedAt = post.postedAt ?? lastPostedAt;
        if (seenPosts.has(post.externalId)) continue;
        seenPosts.add(post.externalId);
        if (since && post.postedAt && post.postedAt < since) continue;
        page.push(post);
        if (page.length >= remaining) break;
      }
      if (page.length) {
        await options.onPosts?.(page);
        postsSeen += page.length;
      }

      const next = text(body.next_page_id);
      const nextCursor = text(body.cursor);
      const cursorKey = next && nextCursor ? `${next}\u0000${nextCursor}` : null;
      // Pinned reels come first, so only the page's last reel says whether older pages are still in range.
      const pastSince = since !== null && lastPostedAt !== null && lastPostedAt < since;
      if (
        pastSince ||
        postsSeen >= options.maxPosts ||
        !next ||
        !nextCursor ||
        !cursorKey ||
        seenCursors.has(cursorKey)
      ) {
        break;
      }
      seenCursors.add(cursorKey);
      nextPageId = next;
      cursor = nextCursor;
    }

    return {
      profile,
      postsSeen,
      creditsUsed: budget.creditsUsed,
      creditsRemaining: budget.creditsRemaining,
    };
  },
};
