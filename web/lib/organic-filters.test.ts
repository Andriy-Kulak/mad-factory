import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrganicPost } from "./social.ts";
import { activeFilterCount, applyOrganicFilters, fmtAgoShort, organicHref, parseNum, parseOrganicFilters } from "./organic-filters.ts";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function post(over: Partial<OrganicPost> & { accountId?: string; platform?: string }): OrganicPost {
  const { accountId = "a1", platform = "instagram", ...rest } = over;
  return {
    id: Math.random().toString(36).slice(2),
    account: { id: accountId, handle: accountId, displayName: null, label: null, platform, relation: "inspiration" },
    url: null,
    kind: "reel",
    caption: null,
    postedAt: daysAgo(1),
    durationS: null,
    thumbnailUrl: null,
    videoUrl: null,
    views: 1000,
    viewsPrev: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    engagement: 0.02,
    outlier: 1,
    ...rest,
  };
}

test("parseNum accepts suffixes and separators, rejects junk", () => {
  assert.equal(parseNum("3x"), 3);
  assert.equal(parseNum("10,000"), 10000);
  assert.equal(parseNum("2.5%"), 2.5);
  assert.equal(parseNum("10k"), 10_000);
  assert.equal(parseNum("1.5M"), 1_500_000);
  assert.equal(parseNum(""), null);
  assert.equal(parseNum("abc"), null);
  assert.equal(parseNum(["4", "9"]), 4);
});

test("parseOrganicFilters defaults and repeated channels", () => {
  const f = parseOrganicFilters({ ch: ["a1", "a2"], sort: "bogus", age: "2", unit: "weeks" });
  assert.deepEqual(f.channels, ["a1", "a2"]);
  assert.equal(f.sort, "outlier");
  assert.equal(f.view, "grid");
  assert.deepEqual(f.postedWithin, { n: 2, unit: "weeks" });
  assert.equal(parseOrganicFilters({ age: "0" }).postedWithin, null);
  assert.equal(parseOrganicFilters({ age: "3", unit: "x" }).postedWithin?.unit, "months");
});

test("applyOrganicFilters narrows by channel, platform, keyword, ranges and age", () => {
  const posts = [
    post({ accountId: "a1", caption: "How to Repot in spring", outlier: 5, views: 50_000, engagement: 0.09, postedAt: daysAgo(2) }),
    post({ accountId: "a2", platform: "tiktok", caption: "garden tips", outlier: 0.5, views: 300, engagement: 0.01, postedAt: daysAgo(40) }),
    post({ accountId: "a3", caption: "no metrics", outlier: null, views: null, engagement: null, postedAt: null }),
  ];
  const run = (sp: Record<string, string | string[]>) => applyOrganicFilters(posts, parseOrganicFilters(sp), NOW).map((p) => p.account.id);
  assert.deepEqual(run({}), ["a1", "a2", "a3"]);
  assert.deepEqual(run({ ch: ["a2", "a3"] }), ["a2", "a3"]);
  assert.deepEqual(run({ platform: "tiktok" }), ["a2"]);
  assert.deepEqual(run({ q: "REPOT" }), ["a1"]);
  assert.deepEqual(run({ omin: "1" }), ["a1"]);
  assert.deepEqual(run({ omax: "1" }), ["a2"]);
  assert.deepEqual(run({ vmin: "1000", vmax: "100000" }), ["a1"]);
  assert.deepEqual(run({ emin: "5" }), ["a1"]);
  assert.deepEqual(run({ age: "1", unit: "weeks" }), ["a1"]);
  assert.deepEqual(run({ age: "2", unit: "months" }), ["a1", "a2"]);
  assert.deepEqual(
    applyOrganicFilters(posts, parseOrganicFilters({ fav: "1" }), NOW, new Set([posts[1]!.id])).map((p) => p.account.id),
    ["a2"],
  );
});

test("organicHref round-trips and omits defaults", () => {
  const f = parseOrganicFilters({ ch: ["a1", "a2"], q: "talk", omin: "3", age: "1", unit: "months", fav: "1", sort: "views" });
  const href = organicHref(f);
  const back = parseOrganicFilters(Object.fromEntries([...new URLSearchParams(href.slice(1)).keys()].map((k) => [k, new URLSearchParams(href.slice(1)).getAll(k)])));
  assert.deepEqual(back, f);
  assert.equal(organicHref(parseOrganicFilters({})), "?");
  assert.equal(organicHref(f, { sort: "outlier", channels: [], q: "", outlier: { min: null, max: null }, postedWithin: null, favorites: false }), "?");
  assert.equal(activeFilterCount(f), 5);
});

test("fmtAgoShort buckets", () => {
  assert.equal(fmtAgoShort(daysAgo(0.01), NOW), "now");
  assert.equal(fmtAgoShort(daysAgo(0.5), NOW), "12h ago");
  assert.equal(fmtAgoShort(daysAgo(5), NOW), "5d ago");
  assert.equal(fmtAgoShort(daysAgo(10), NOW), "1w ago");
  assert.equal(fmtAgoShort(daysAgo(95), NOW), "3mo ago");
  assert.equal(fmtAgoShort(daysAgo(800), NOW), "2y ago");
  assert.equal(fmtAgoShort(null, NOW), "");
});
