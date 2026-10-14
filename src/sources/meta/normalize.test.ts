import { test } from "node:test";
import assert from "node:assert/strict";
import { findAdNodes, normalize, normalizeAdDetail, parseAdIdInput, parseGraphqlBody } from "./normalize.ts";

const node = {
  ad_archive_id: "1",
  page_id: "42",
  page_name: "Advertiser",
  start_date: 1_700_000_000,
  end_date: null,
  is_active: true,
  publisher_platform: ["FACEBOOK", "INSTAGRAM"],
  collation_id: "c1",
  collation_count: 3,
  reach_estimate: { lower_bound: 1 },
  spend: null,
  currency: "USD",
  total_active_time: 12345,
  snapshot: {
    body: { text: "hello" },
    title: "t",
    link_url: "https://example.invalid",
    cta_text: "Learn more",
    videos: [{ video_hd_url: "https://cdn/hd.mp4", video_sd_url: "https://cdn/sd.mp4", video_preview_image_url: null }],
    cards: [{ video_sd_url: "https://cdn/card.mp4" }, { title: "no video" }],
  },
};

test("findAdNodes finds nested ad nodes once", () => {
  const found = findAdNodes({ data: { results: [[{ x: node }], { y: [node] }] } });
  assert.equal(found.length, 2);
});

test("normalize maps payload fields and media", () => {
  const ad = normalize(node);
  assert.equal(ad.source, "meta");
  assert.equal(ad.externalId, "1");
  assert.equal(ad.advertiserId, "42");
  assert.equal(ad.bodyText, "hello");
  assert.equal(ad.startDate?.toISOString(), new Date(1_700_000_000 * 1000).toISOString());
  assert.equal(ad.endDate, null);
  assert.deepEqual(ad.platforms, ["FACEBOOK", "INSTAGRAM"]);
  assert.equal(ad.collationId, "c1");
  assert.equal(ad.collationCount, 3);
  assert.deepEqual(ad.reachEstimate, { lower_bound: 1 });
  assert.equal(ad.totalActiveTime, 12345);
  assert.equal(ad.media.length, 2);
  assert.equal(ad.media[1]?.sdUrl, "https://cdn/card.mp4");
});

test("normalize collects snapshot images and image-only cards", () => {
  const imageAd = normalize({
    ad_archive_id: "2",
    snapshot: {
      body: { text: "b" },
      images: [{ original_image_url: "https://cdn/hd.jpg", resized_image_url: "https://cdn/sd.jpg" }],
      cards: [{ original_image_url: "https://cdn/card1.jpg" }, { video_sd_url: "https://cdn/card.mp4" }, { resized_image_url: "https://cdn/card3.jpg" }],
    },
  });
  assert.deepEqual(
    imageAd.media.map((m) => [m.kind, m.hdUrl, m.sdUrl]),
    [
      ["image", "https://cdn/hd.jpg", "https://cdn/sd.jpg"],
      ["image", "https://cdn/card1.jpg", null],
      ["video", null, "https://cdn/card.mp4"],
      ["image", null, "https://cdn/card3.jpg"],
    ],
  );
});

test("parseGraphqlBody handles multi-document bodies", () => {
  const docs = parseGraphqlBody('for (;;);{"a":1}\n{"b":2}\ngarbage\n{"broken":');
  // Only lines that start with "{" and parse cleanly survive.
  assert.deepEqual(docs, [{ b: 2 }]);
});

test("normalizeAdDetail maps the camelCase single-ad shape", () => {
  const ad = normalizeAdDetail({
    adArchiveID: "123456",
    pageID: "9",
    pageName: "Brand",
    startDate: 1_790_000_000,
    isActive: true,
    publisherPlatform: ["facebook", "instagram"],
    collationID: "c1",
    collationCount: 2,
    snapshot: { body: { text: "Hello" }, title: "T", videos: [{ video_hd_url: "https://cdn.example/hd.mp4", video_sd_url: "https://cdn.example/sd.mp4" }], images: [], cards: [] },
  });
  assert.equal(ad.externalId, "123456");
  assert.equal(ad.advertiserName, "Brand");
  assert.equal(ad.bodyText, "Hello");
  assert.equal(ad.collationCount, 2);
  assert.deepEqual(ad.platforms, ["facebook", "instagram"]);
  assert.equal(ad.media[0]?.kind, "video");
  assert.throws(() => normalizeAdDetail({ success: true }), /no ad/);
});

test("parseAdIdInput takes an ad id or an Ad Library ad link only", () => {
  assert.equal(parseAdIdInput(" 28600000000000000 "), "28600000000000000");
  assert.equal(parseAdIdInput("https://www.facebook.com/ads/library/?id=123456"), "123456");
  for (const bad of ["12", "https://example.com/ads/library/?id=123456", "nope"]) {
    assert.throws(() => parseAdIdInput(bad), /ad id/, bad);
  }
  assert.throws(() => parseAdIdInput("https://www.facebook.com/ads/library/?view_all_page_id=123456"), /^Error: Give one ad's Library ID.*not the advertiser's page link/);
});
