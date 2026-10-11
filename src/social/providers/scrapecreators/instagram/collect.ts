import { createCreditBudget } from "../budget.ts";
import { record, text } from "../../../util.ts";
import type { SocialCollector, SocialPost, SocialProfile } from "../../../types.ts";
import { normalizeInstagramPost, normalizeInstagramProfile } from "./normalize.ts";

function validateInstagramHandle(value: string): string {
  if (value !== value.toLowerCase() || value.startsWith("@") || !/^[a-z0-9._]+$/.test(value)) {
    throw new Error("Instagram account value must be a lowercase handle without @");
  }
  return value;
}

export const scrapeCreatorsInstagramCollector: SocialCollector = {
  provider: "scrapecreators",
  platform: "instagram",
  validateValue: validateInstagramHandle,
  async collect(value, options) {
    const handle = validateInstagramHandle(value);
    if (!Number.isInteger(options.maxPosts) || options.maxPosts <= 0) {
      throw new Error("maxPosts must be a positive integer");
    }

    const budget = createCreditBudget("instagram", options);
    const profileBody = await budget.get("/v1/instagram/profile", { handle });
    const profile = normalizeInstagramProfile(profileBody);
    await options.onProfile?.(profile);

    let postsSeen = 0;
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    const seenPosts = new Set<string>();
    while (postsSeen < options.maxPosts) {
      const params: Record<string, string> = { user_id: profile.externalId };
      if (cursor) params.max_id = cursor;
      const body = await budget.get("/v1/instagram/user/reels", params);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) break;

      const page: SocialPost[] = [];
      const remaining = options.maxPosts - postsSeen;
      for (const item of items) {
        const media = record(record(item)?.media);
        if (!media) continue;
        const post = normalizeInstagramPost(media);
        if (seenPosts.has(post.externalId)) continue;
        seenPosts.add(post.externalId);
        page.push(post);
        if (page.length >= remaining) break;
      }
      if (page.length) {
        await options.onPosts?.(page);
        postsSeen += page.length;
      }

      const paging = record(body.paging_info);
      const moreAvailable = paging?.more_available === true;
      const nextCursor = text(paging?.max_id);
      if (postsSeen >= options.maxPosts || !moreAvailable || !nextCursor || seenCursors.has(nextCursor)) {
        break;
      }
      seenCursors.add(nextCursor);
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

export type { SocialPost, SocialProfile };
