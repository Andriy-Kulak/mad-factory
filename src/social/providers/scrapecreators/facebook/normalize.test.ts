import assert from "node:assert/strict";
import { test } from "node:test";
import profile from "./fixtures/profile.json" with { type: "json" };
import reels from "./fixtures/reels.json" with { type: "json" };
import { normalizeFacebookProfile, normalizeFacebookReel } from "./normalize.ts";

const reelItems = (reels as { reels: Array<Record<string, unknown>> }).reels;

test("normalizes Facebook profile identity, page URL, and counts", () => {
  const normalized = normalizeFacebookProfile(profile);
  assert.equal(normalized.platform, "facebook");
  assert.equal(normalized.externalId, "1000001");
  assert.equal(normalized.handle, "1000001");
  assert.equal(normalized.displayName, "Sample Page");
  assert.equal(normalized.bio, "A sample profile");
  assert.equal(normalized.followers, 3);
  assert.equal(normalized.totalLikes, 3);
  assert.equal(normalized.avatarUrl, "https://cdn.example.test/facebook-avatar.jpg");
});

test("normalizes Facebook Reel fields and leaves unavailable metrics null", () => {
  const post = normalizeFacebookReel(reelItems[0]!);
  assert.equal(post.externalId, "2000001");
  assert.equal(post.url, "https://www.facebook.com/reel/2000001");
  assert.equal(post.kind, "reel");
  assert.equal(post.caption, "Sample reel description");
  assert.equal(post.postedAt, "2026-10-04T20:05:00.000Z");
  assert.equal(post.durationS, 18.333);
  assert.equal(post.metrics.views, 3);
  assert.equal(post.metrics.likes, null);
  assert.equal(post.metrics.comments, null);
  assert.equal(post.metrics.shares, null);
  assert.equal(post.metrics.saves, null);
  assert.equal(post.audioId, "38909626028683417");
  assert.equal(post.audioTitle, "Sample original audio");
  assert.equal(post.thumbnailUrl, "https://cdn.example.test/facebook-thumb.jpg");
  assert.equal(post.videoUrl, "https://cdn.example.test/facebook-video.mp4");
  const raw = post.raw as Record<string, unknown>;
  assert.equal("video_url" in raw, false);
  assert.equal("thumbnail" in raw, false);
});
