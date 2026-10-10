import assert from "node:assert/strict";
import { test } from "node:test";
import { engagementRate, latestSnapshot, median, outlierScore, snapshotPair, sumKnown } from "./social-score.ts";

test("median handles odd, even and empty inputs", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("outlier score divides by the account median and guards missing data", () => {
  assert.equal(outlierScore(500, 100), 5);
  assert.equal(outlierScore(null, 100), null);
  assert.equal(outlierScore(500, 0), null);
  assert.equal(outlierScore(500, null), null);
});

test("engagement rate is likes plus comments over views", () => {
  assert.equal(engagementRate(1000, 40, 10), 0.05);
  assert.equal(engagementRate(0, 40, 10), null);
  assert.equal(engagementRate(1000, null, null), null);
});

test("latest snapshot prefers the newest day, then api over scrape", () => {
  const rows = [
    { captured_on: "2026-10-01", source: "scrape", v: 1 },
    { captured_on: "2026-10-03", source: "scrape", v: 2 },
    { captured_on: "2026-10-03", source: "api", v: 3 },
  ];
  assert.equal(latestSnapshot(rows)?.v, 3);
  assert.equal(latestSnapshot([]), null);
});

test("engagement rate adds shares and saves when the platform reports them", () => {
  assert.equal(engagementRate(1000, 40, 10, 20, 30), 0.1);
  assert.equal(engagementRate(1000, null, null, 5, null), 0.005);
});

test("snapshot pair returns the latest and the newest earlier day", () => {
  const rows = [
    { captured_on: "2026-10-01", source: "scrape", v: 1 },
    { captured_on: "2026-10-03", source: "scrape", v: 2 },
    { captured_on: "2026-10-02", source: "scrape", v: 3 },
  ];
  const pair = snapshotPair(rows);
  assert.equal(pair.latest?.v, 2);
  assert.equal(pair.previous?.v, 3);
  assert.deepEqual(snapshotPair([]), { latest: null, previous: null });
});

test("sumKnown ignores nulls but stays null when nothing is known", () => {
  assert.equal(sumKnown([1, null, 2]), 3);
  assert.equal(sumKnown([null, null]), null);
});
