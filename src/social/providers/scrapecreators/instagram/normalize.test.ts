import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import profile from "./fixtures/profile.json" with { type: "json" };
import { normalizeInstagramPost, normalizeInstagramProfile } from "./normalize.ts";

const reels = JSON.parse(
  readFileSync(new URL("./fixtures/reels.json", import.meta.url), "utf8"),
) as { items: Array<{ media: Record<string, unknown> }> };

test("normalizes Instagram profile identity and account counts", () => {
  const normalized = normalizeInstagramProfile(profile);

  assert.equal(normalized.platform, "instagram");
  assert.equal(normalized.externalId, "1000001");
  assert.equal(normalized.handle, "sample_creator");
  assert.equal(normalized.displayName, "Sample Creator");
  assert.equal(normalized.followers, 42);
  assert.equal(normalized.following, 19);
  assert.equal(normalized.postsCount, 8);
  assert.equal(normalized.totalLikes, null);
});

test("keeps the exact Instagram reel ID from the raw fixture text", () => {
  const post = normalizeInstagramPost(reels.items[0]!.media);

  assert.equal(reels.items[0]!.media.id, "3999488182834263933_38826560440");
  assert.equal(post.externalId, "3999488182834263933");
  assert.equal(post.url, "https://www.instagram.com/reel/SampleReelOne/");
  assert.equal(post.kind, "reel");
  assert.equal(post.audioId, "18156757657016804");
  assert.equal(post.audioTitle, "Sample track");
  assert.deepEqual(post.hashtags, ["sampletag"]);
  assert.equal(post.metrics.views, 133);
  assert.equal(post.metrics.likes, 1);
  assert.equal(post.metrics.comments, 0);
  assert.equal(post.metrics.shares, null);
  assert.equal(post.metrics.saves, null);
  assert.equal(post.thumbnailUrl, "https://cdn.example.test/instagram-thumb.jpg");
  assert.equal(post.videoUrl, "https://cdn.example.test/instagram-video.mp4");

  const raw = post.raw as Record<string, unknown>;
  assert.equal(raw.unused_field, "preserved in raw");
  assert.equal("video_versions" in raw, false);
  assert.equal("image_versions2" in raw, false);
  assert.equal("video_dash_manifest" in raw, false);
  const metadata = raw.clips_metadata as Record<string, unknown>;
  assert.equal("dash_manifest" in (metadata.music_info as Record<string, unknown>), false);
});

test("uses original-sound audio fields and only falls back to a string pk", () => {
  const second = normalizeInstagramPost(reels.items[1]!.media);
  assert.equal(second.audioId, "28470888172576852");
  assert.equal(second.audioTitle, "Sample original audio");
  assert.equal(second.metrics.views, 116);
  const raw = second.raw as Record<string, unknown>;
  const metadata = raw.clips_metadata as Record<string, unknown>;
  assert.equal("dash_manifest" in (metadata.original_sound_info as Record<string, unknown>), false);

  assert.equal(normalizeInstagramPost({ pk: "fallback-id" }).externalId, "fallback-id");
  assert.throws(() => normalizeInstagramPost({ pk: 3999488182834263933 }), /string id/);
});

test("uses ig_play_count when play_count is unavailable and preserves numeric shares and saves", () => {
  const post = normalizeInstagramPost({
    ...reels.items[0]!.media,
    play_count: null,
    ig_play_count: 9,
    share_count: 2,
    save_count: 3,
  });
  assert.equal(post.metrics.views, 9);
  assert.equal(post.metrics.shares, 2);
  assert.equal(post.metrics.saves, 3);
});
