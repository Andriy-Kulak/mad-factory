import { creativeExists as creativeExistsRow, insertCreative as insertCreativeRow } from "../db/ads.ts";
import {
  hasSocialPostMedia,
  updateSocialAccountAvatar,
  upsertSocialAccount,
  upsertSocialAccountSnapshot,
  upsertSocialPost,
  upsertSocialPostMedia,
  upsertSocialPostSnapshot,
} from "../db/social.ts";
import type { SocialStore } from "./types.ts";

const supabaseSocialStore: SocialStore = {
  async upsertAccount({ profile, lastSyncedAt }) {
    const account = await upsertSocialAccount({
      platform: profile.platform,
      external_id: profile.externalId,
      handle: profile.handle,
      display_name: profile.displayName,
      bio: profile.bio,
      raw: profile.raw,
      last_synced_at: lastSyncedAt,
    });
    return { id: account.id };
  },
  updateAccountAvatar: updateSocialAccountAvatar,
  creativeExists: creativeExistsRow,
  async insertCreative(input) {
    await insertCreativeRow({
      sha256: input.sha256,
      media_type: input.mediaType,
      bytes: input.bytes,
      storage_key: input.storageKey,
      public_url: input.publicUrl,
    });
  },
  async upsertAccountSnapshot(input) {
    await upsertSocialAccountSnapshot({
      account_id: input.accountId,
      captured_on: input.capturedOn,
      followers: input.followers,
      following: input.following,
      posts_count: input.postsCount,
      total_likes: input.totalLikes,
      scrape_run_id: input.scrapeRunId,
    });
  },
  async upsertPost({ accountId, post, lastSyncedAt }) {
    return upsertSocialPost({
      account_id: accountId,
      platform: post.platform,
      external_id: post.externalId,
      url: post.url,
      kind: post.kind,
      caption: post.caption,
      posted_at: post.postedAt,
      duration_s: post.durationS,
      audio_id: post.audioId,
      audio_title: post.audioTitle,
      hashtags: post.hashtags,
      is_paid_partnership: post.isPaidPartnership,
      raw: post.raw,
      last_synced_at: lastSyncedAt,
    });
  },
  async upsertPostSnapshot(input) {
    await upsertSocialPostSnapshot({
      post_id: input.postId,
      captured_on: input.capturedOn,
      source: input.source,
      views: input.metrics.views,
      likes: input.metrics.likes,
      comments: input.metrics.comments,
      shares: input.metrics.shares,
      saves: input.metrics.saves,
      metrics: input.metrics.extra,
      scrape_run_id: input.scrapeRunId,
    });
  },
  hasPostMedia: hasSocialPostMedia,
  async upsertPostMedia(input) {
    await upsertSocialPostMedia({
      post_id: input.postId,
      sha256: input.sha256,
      position: input.position,
      role: input.role,
    });
  },
};

export function getSocialStore(): SocialStore {
  return supabaseSocialStore;
}
