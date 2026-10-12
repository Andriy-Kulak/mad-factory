import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeFacebookPostDetail, normalizeInstagramPostDetail, normalizeTikTokPostDetail, parsePostUrl } from "./single-post.ts";

test("parsePostUrl reads the platform and any id it can see", () => {
  assert.deepEqual(parsePostUrl("https://www.instagram.com/reel/AbC_1-x/?igsh=x"), {
    platform: "instagram",
    url: "https://www.instagram.com/reel/AbC_1-x/?igsh=x",
    externalId: null,
    shortcode: "AbC_1-x",
  });
  assert.equal(parsePostUrl("https://instagram.com/someone/p/Xy9/").shortcode, "Xy9");
  assert.equal(parsePostUrl("https://www.tiktok.com/@a.b/video/7600000000000000001").externalId, "7600000000000000001");
  assert.equal(parsePostUrl("https://vm.tiktok.com/ZMabc/").platform, "tiktok");
  assert.equal(parsePostUrl("https://www.facebook.com/reel/123456789").externalId, "123456789");
  assert.equal(parsePostUrl("https://www.facebook.com/watch/?v=42").externalId, "42");
  assert.equal(parsePostUrl("https://www.facebook.com/share/r/abc/").externalId, null);
});

test("parsePostUrl rejects profiles, Ad Library links and other sites", () => {
  for (const bad of [
    "https://www.instagram.com/someone/",
    "https://www.tiktok.com/@someone",
    "https://www.facebook.com/somepage",
    "https://example.com/reel/1",
    "ftp://instagram.com/p/x/",
    "not a url",
  ]) {
    assert.throws(() => parsePostUrl(bad), /Give a link/, bad);
  }
  assert.throws(() => parsePostUrl("https://www.facebook.com/ads/library/?id=1"), /save it as an ad/);
});

test("normalizeInstagramPostDetail maps the shortcode-media shape", () => {
  const { author, post } = normalizeInstagramPostDetail({
    data: {
      xdt_shortcode_media: {
        id: "111",
        shortcode: "Code1",
        product_type: "clips",
        is_video: true,
        taken_at_timestamp: 1_790_000_000,
        video_duration: 12.5,
        video_play_count: 900,
        comment_count: 3,
        edge_media_preview_like: { count: 40 },
        edge_media_to_caption: { edges: [{ node: { text: "Try this #Hook" } }] },
        clips_music_attribution_info: { audio_id: "a1", song_name: "Original audio" },
        thumbnail_src: "https://cdn.example/t.jpg",
        video_url: "https://cdn.example/v.mp4",
        owner: { id: "9", username: "maker", full_name: "Maker" },
      },
    },
  });
  assert.deepEqual(author, { platform: "instagram", externalId: "9", handle: "maker", displayName: "Maker", raw: {} });
  assert.equal(post.url, "https://www.instagram.com/reel/Code1/");
  assert.equal(post.kind, "reel");
  assert.equal(post.caption, "Try this #Hook");
  assert.deepEqual(post.hashtags, ["hook"]);
  assert.equal(post.audioId, "a1");
  assert.deepEqual([post.metrics.views, post.metrics.likes, post.metrics.comments], [900, 40, 3]);
  assert.equal(post.videoUrl, "https://cdn.example/v.mp4");
  assert.equal(JSON.stringify(post.raw).includes("cdn.example"), false);
  assert.throws(() => normalizeInstagramPostDetail({ data: {} }), /no post/);
});

test("normalizeTikTokPostDetail reuses the feed normalizer with the author's handle", () => {
  const { author, post } = normalizeTikTokPostDetail({
    aweme_detail: { aweme_id: "7600", desc: "hi", create_time: 1_790_000_000, author: { unique_id: "maker", uid: "5", nickname: "M" }, statistics: { play_count: 10 } },
  });
  assert.equal(author.handle, "maker");
  assert.equal(post.url, "https://www.tiktok.com/@maker/video/7600");
  assert.equal(post.metrics.views, 10);
  assert.throws(() => normalizeTikTokPostDetail({}), /no video/);
});

test("normalizeFacebookPostDetail keys reels by video id, like the account sync", () => {
  const { author, post } = normalizeFacebookPostDetail({
    post_id: "p1",
    url: "https://www.facebook.com/reel/777",
    description: "Caption",
    creation_time: "2026-10-01T00:00:00.000Z",
    view_count: 50,
    like_count: 4,
    share_count: 1,
    video: { id: "777", hd_url: "https://cdn.example/hd.mp4", sd_url: "https://cdn.example/sd.mp4", thumbnail: "https://cdn.example/t.jpg", length_in_second: "30.5" },
    author: { id: "123", name: "Page" },
  });
  assert.deepEqual([author.handle, author.externalId], ["123", "123"]);
  assert.deepEqual([post.externalId, post.kind, post.durationS, post.videoUrl], ["777", "reel", 30.5, "https://cdn.example/hd.mp4"]);
  assert.deepEqual([post.metrics.views, post.metrics.likes, post.metrics.comments, post.metrics.shares], [50, 4, null, 1]);
});
