import assert from "node:assert/strict";
import { test } from "node:test";
import profile from "./fixtures/profile.json" with { type: "json" };
import videos from "./fixtures/videos.json" with { type: "json" };
import { normalizeTikTokPost, normalizeTikTokProfile } from "./normalize.ts";

const videoItems = (videos as { aweme_list: Array<Record<string, unknown>> }).aweme_list;

test("normalizes TikTok profile fields and account statistics", () => {
  const normalized = normalizeTikTokProfile(profile);
  assert.equal(normalized.platform, "tiktok");
  assert.equal(normalized.externalId, "1000001");
  assert.equal(normalized.handle, "sample_creator");
  assert.equal(normalized.displayName, "Sample Creator");
  assert.equal(normalized.bio, "A sample bio");
  assert.equal(normalized.followers, 3);
  assert.equal(normalized.following, 25);
  assert.equal(normalized.postsCount, 7);
  assert.equal(normalized.totalLikes, 160);
});

test("normalizes TikTok video metrics, duration, URLs, audio, and ad raw data", () => {
  const post = normalizeTikTokPost(videoItems[1]!, "sample_creator");
  assert.equal(post.platform, "tiktok");
  assert.equal(post.externalId, "7687100769052495134");
  assert.equal(post.url, "https://www.tiktok.com/@sample_creator/video/7687100769052495134");
  assert.equal(post.kind, "video");
  assert.equal(post.durationS, 68.66);
  assert.equal(post.audioId, "7687100819841878814");
  assert.equal(post.audioTitle, "Sample original sound");
  assert.deepEqual(post.hashtags, ["sampletag"]);
  assert.equal(post.metrics.views, 653);
  assert.equal(post.metrics.likes, 72);
  assert.equal(post.metrics.comments, 3);
  assert.equal(post.metrics.shares, 11);
  assert.equal(post.metrics.saves, 13);
  assert.deepEqual(post.metrics.extra, {
    repost_count: 4,
    download_count: 2,
    whatsapp_share_count: 1,
  });
  assert.equal(post.thumbnailUrl, "https://cdn.example.test/tiktok-thumb.jpg");
  assert.equal(post.videoUrl, "https://cdn.example.test/tiktok-video.mp4");
  assert.equal((post.raw as Record<string, unknown>).is_ads, true);
});

test("prefers a browser-supported cover image over a HEIC URL", () => {
  const item = structuredClone(videoItems[1]!) as Record<string, unknown>;
  const video = item.video as { cover: { url_list: string[] } };
  video.cover.url_list = ["https://cdn.example.test/cover.heic?token=heic", "https://cdn.example.test/cover.jpeg?token=jpeg"];

  const post = normalizeTikTokPost(item, "sample_creator");

  assert.equal(post.thumbnailUrl, "https://cdn.example.test/cover.jpeg?token=jpeg");
});
