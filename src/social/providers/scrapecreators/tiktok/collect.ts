import { createCreditBudget } from "../budget.ts";
import { count, record, text } from "../../../util.ts";
import type { SocialCollector, SocialPost } from "../../../types.ts";
import { normalizeTikTokPost, normalizeTikTokProfile } from "./normalize.ts";

function validateTikTokHandle(value: string): string {
  if (value !== value.toLowerCase() || value.startsWith("@") || !/^[a-z0-9._]+$/.test(value)) {
    throw new Error("TikTok account value must be a lowercase handle without @");
  }
  return value;
}

export const scrapeCreatorsTikTokCollector: SocialCollector = {
  provider: "scrapecreators",
  platform: "tiktok",
  validateValue: validateTikTokHandle,
  async collect(value, options) {
    const handle = validateTikTokHandle(value);
    if (!Number.isInteger(options.maxPosts) || options.maxPosts <= 0) {
      throw new Error("maxPosts must be a positive integer");
    }

    const budget = createCreditBudget("tiktok", options);
    const profileBody = await budget.get("/v1/tiktok/profile", { handle });
    const profile = normalizeTikTokProfile(profileBody);
    await options.onProfile?.(profile);

    let postsSeen = 0;
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    const seenPosts = new Set<string>();
    while (postsSeen < options.maxPosts) {
      const params: Record<string, string> = {
        handle,
        user_id: profile.externalId,
        sort_by: "latest",
        region: "US",
      };
      if (cursor) params.max_cursor = cursor;
      const body = await budget.get("/v3/tiktok/profile/videos", params);
      const items = Array.isArray(body.aweme_list) ? body.aweme_list : [];
      if (!items.length) break;

      const page: SocialPost[] = [];
      const remaining = options.maxPosts - postsSeen;
      for (const value of items) {
        const item = record(value);
        if (!item || record(item.image_post_info) || count(item.aweme_type) === 150) continue;
        const post = normalizeTikTokPost(item, profile.handle);
        if (seenPosts.has(post.externalId)) continue;
        seenPosts.add(post.externalId);
        page.push(post);
        if (page.length >= remaining) break;
      }
      if (page.length) {
        await options.onPosts?.(page);
        postsSeen += page.length;
      }

      const moreAvailable = body.has_more === true || body.has_more === 1;
      const nextCursor = text(body.max_cursor);
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
