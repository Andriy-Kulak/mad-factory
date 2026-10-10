import { test } from "node:test";
import assert from "node:assert/strict";
import { findAdNodes, normalize, parseGraphqlBody } from "./normalize.ts";

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
      cards: [
        { original_image_url: "https://cdn/card1.jpg" },
        { video_sd_url: "https://cdn/card.mp4" },
        { resized_image_url: "https://cdn/card3.jpg" },
      ],
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
