import { test } from "node:test";
import assert from "node:assert/strict";
import { bidRecommendations, dateInZone, keywordDailyRows, reportBody, searchTermDailyRows, utc } from "./map.ts";

const usd = (amount: string) => ({ amount, currency: "USD" });

test("report body matches the shape the live API accepts", () => {
  assert.deepEqual(reportBody("2026-01-01", "2026-01-07", 42, true), {
    timeRange: { start: "2026-01-01", end: "2026-01-07", timeZone: "ORTZ", granularity: "DAILY" },
    groupBy: ["countryOrRegion"],
    filters: [{ field: "campaignId", operator: "EQUALS", value: 42 }],
    pagination: { offset: 0, pageSize: 1000 },
  });
  assert.equal("groupBy" in reportBody("2026-01-01", "2026-01-07", 42, false), false);
});

test("an empty report result ({} without rows) yields no rows", () => {
  assert.deepEqual(keywordDailyRows({}, "USD", "t"), []);
  assert.deepEqual(searchTermDailyRows({}, "USD", "t"), []);
  assert.equal(bidRecommendations({}).size, 0);
});

test("keyword daily rows skip date-only days and keep four-decimal spend", () => {
  const rows = keywordDailyRows(
    {
      rows: [
        {
          metadata: { id: 7, campaignId: 1, countryOrRegion: "AU" },
          granularMetrics: [{ date: "2026-01-01" }, { date: "2026-01-02", impressions: 2, taps: 1, tapInstalls: 1, localSpend: usd("0.3749") }],
        },
      ],
    },
    "USD",
    "t",
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { ...rows[0] },
    { date: "2026-01-02", keyword_id: 7, country: "AU", campaign_id: 1, impressions: 2, taps: 1, tap_installs: 1, view_installs: 0, new_downloads: 0, redownloads: 0, spend: 0.3749, currency: "USD", synced_at: "t" },
  );
});

test("withheld search terms become '' and rows with the same key are summed", () => {
  const day = { date: "2026-01-02", impressions: 3, taps: 1, localSpend: usd("0.50") };
  const meta = { campaignId: 1, searchTermText: null, searchTermSource: "TARGETED", keyword: { id: 7 }, countryOrRegion: "US" };
  const rows = searchTermDailyRows({ rows: [{ metadata: meta, granularMetrics: [day] }, { metadata: meta, granularMetrics: [day] }] }, "USD", "t");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.search_term, "");
  assert.equal(rows[0]!.impressions, 6);
  assert.equal(rows[0]!.spend, 1);
});

test("search match rows without a keyword use keyword_id 0", () => {
  const rows = searchTermDailyRows(
    { rows: [{ metadata: { campaignId: 1, searchTermText: "abc", searchTermSource: "AUTO", keyword: null, countryOrRegion: "US" }, granularMetrics: [{ date: "2026-01-02", impressions: 1 }] }] },
    "USD",
    "t",
  );
  assert.equal(rows[0]!.keyword_id, 0);
});

test("empty bid recommendations are ignored", () => {
  const recs = bidRecommendations({
    rows: [
      { metadata: { id: 1, campaignId: 1 }, insights: { bidRecommendation: {} } },
      { metadata: { id: 2, campaignId: 1 }, insights: { bidRecommendation: { bidMin: usd("0.5") } } },
    ],
  });
  assert.deepEqual([...recs.keys()], [2]);
});

test("dates are computed in the account time zone", () => {
  const now = new Date("2026-03-10T03:00:00Z"); // still 9 March in Denver
  assert.equal(dateInZone("America/Denver", 0, now), "2026-03-09");
  assert.equal(dateInZone("America/Denver", 6, now), "2026-03-03");
  assert.equal(utc("2026-01-01T10:00:00.000"), "2026-01-01T10:00:00.000Z");
});
