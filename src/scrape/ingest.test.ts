import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaStorageTarget, toAdInsert } from "./ingest.ts";
import type { CollectedAd } from "../sources/types.ts";

/** Every analysis-relevant field the collector produces must reach the ads row. */
test("toAdInsert maps every CollectedAd field onto the ads insert", () => {
  const ad: CollectedAd = {
    source: "meta",
    externalId: "123",
    advertiserId: "p1",
    advertiserName: "Advertiser",
    bodyText: "body",
    title: "title",
    linkUrl: "https://example.invalid",
    ctaText: "Shop now",
    startDate: new Date("2026-01-02T00:00:00Z"),
    endDate: null,
    isActive: true,
    platforms: ["FACEBOOK"],
    collationId: "c1",
    collationCount: 3,
    reachEstimate: { lower_bound: 1000 },
    spend: { lower_bound: 0 },
    currency: "USD",
    totalActiveTime: 86400,
    media: [],
    raw: { ad_archive_id: "123" },
  };
  const row = toAdInsert(ad);
  assert.deepEqual(row, {
    source: "meta",
    external_id: "123",
    advertiser_id: "p1",
    advertiser_name: "Advertiser",
    body_text: "body",
    title: "title",
    link_url: "https://example.invalid",
    cta_text: "Shop now",
    start_date: "2026-01-02T00:00:00.000Z",
    end_date: null,
    is_active: true,
    platforms: ["FACEBOOK"],
    collation_id: "c1",
    collation_count: 3,
    reach_estimate: { lower_bound: 1000 },
    spend: { lower_bound: 0 },
    currency: "USD",
    total_active_time: 86400,
    raw: { ad_archive_id: "123" },
  });
  // Guard against a new CollectedAd field being forgotten here.
  const mapped = new Set(Object.keys(row));
  const ignored = new Set(["media"]);
  const toSnake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  for (const k of Object.keys(ad)) {
    if (ignored.has(k)) continue;
    assert.ok(mapped.has(toSnake(k)), `CollectedAd.${k} is not mapped onto ads.${toSnake(k)}`);
  }
});

test("mediaStorageTarget stores images under images/ as jpg", () => {
  assert.deepEqual(mediaStorageTarget("video"), { ext: "mp4", prefix: "videos" });
  assert.deepEqual(mediaStorageTarget("image"), { ext: "jpg", prefix: "images" });
});
