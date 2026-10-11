import assert from "node:assert/strict";
import { test } from "node:test";
import { activeAdFilterCount, adFiltersHref, applyAdFilters, groupAdCards, hookOf, isWinner, landingOf, parseAdFilters, signalOf, sortAdCards, type AdSourceRow, type ImpressionRank } from "./ad-cards.ts";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString().slice(0, 10);
const rank = (r: number): ImpressionRank => ({ rank: r, prevRank: null, observedAt: "2026-10-08T00:00:00Z" });

function row(id: string, over: Partial<AdSourceRow> = {}): AdSourceRow {
  return {
    id, externalId: id, advertiserId: "p1", advertiserName: "Page one", avatarUrl: null, body: null, title: null, cta: null, linkUrl: null, caption: null,
    format: "VIDEO", startDate: daysAgo(30), endDate: null, isActive: true, platforms: [], collationId: null, collationCount: 1,
    firstSeenAt: "2026-10-01T00:00:00Z", media: { url: "https://x/v.mp4", type: "video", sha256: "v" }, relation: "competitor", ...over,
  };
}

test("isWinner needs a top-10 rank, an active ad and 21+ days", () => {
  assert.equal(isWinner(row("a"), rank(1), NOW), true);
  assert.equal(isWinner(row("a"), rank(11), NOW), false);
  assert.equal(isWinner(row("a", { isActive: false }), rank(1), NOW), false);
  assert.equal(isWinner(row("a", { startDate: daysAgo(10) }), rank(1), NOW), false);
  assert.equal(isWinner(row("a"), null, NOW), false);
});

test("groupAdCards keeps one card per collation, shown by its best-ranked ad", () => {
  const rows = [row("v1", { collationId: "c" }), row("v2", { collationId: "c" }), row("solo"), row("solo2")];
  const cards = groupAdCards(rows, new Map([["v2", rank(3)]]), NOW);
  assert.deepEqual(cards.map((c) => [c.id, c.versions]), [["v2", 2], ["solo", 1], ["solo2", 1]]);
  assert.equal(cards[0]!.rank?.rank, 3);
  assert.equal(groupAdCards([row("a", { collationId: "c", collationCount: 7 })], new Map(), NOW)[0]!.versions, 7);
});

test("sortAdCards orders by rank, launch date, longevity and variants", () => {
  const cards = groupAdCards([
    row("ranked2", { startDate: daysAgo(40) }),
    row("ranked1", { startDate: daysAgo(5) }),
    row("new", { startDate: daysAgo(1) }),
    row("old-ended", { startDate: daysAgo(300), endDate: daysAgo(100), isActive: false }),
    row("many", { startDate: daysAgo(60), collationCount: 9 }),
  ], new Map([["ranked1", rank(1)], ["ranked2", rank(2)]]), NOW);
  const ids = (s: Parameters<typeof sortAdCards>[1]) => sortAdCards(cards, s).map((c) => c.id);
  assert.deepEqual(ids("impressions"), ["ranked1", "ranked2", "new", "many", "old-ended"]);
  assert.deepEqual(ids("newest"), ["new", "ranked1", "ranked2", "many", "old-ended"]);
  assert.deepEqual(ids("longest"), ["many", "ranked2", "ranked1", "new", "old-ended"]);
  assert.equal(ids("variants")[0], "many");
});

test("applyAdFilters narrows by relation", () => {
  const cards = groupAdCards([row("comp"), row("adj", { advertiserId: "p3", relation: "inspiration" })], new Map(), NOW);
  const run = (sp: Record<string, string>) => applyAdFilters(cards, parseAdFilters(sp), NOW).map((c) => c.id).sort();
  assert.deepEqual(run({}), ["adj", "comp"]);
  assert.deepEqual(run({ rel: "competitor" }), ["comp"]);
  assert.deepEqual(run({ rel: "inspiration" }), ["adj"]);
  assert.deepEqual(run({ rel: "bogus" }), ["adj", "comp"]);
});

test("applyAdFilters narrows by advertiser, copy, status, format, winners, launch and longevity", () => {
  const cards = groupAdCards([
    row("a", { advertiserId: "p1", body: "Grow with confidence", startDate: daysAgo(40) }),
    row("b", { advertiserId: "p2", title: "Take the quiz", isActive: false, endDate: daysAgo(2), startDate: daysAgo(10), media: { url: "i.jpg", type: "image", sha256: "i" } }),
    row("c", { advertiserId: "p2", startDate: daysAgo(3) }),
  ], new Map([["a", rank(1)]]), NOW);
  const run = (sp: Record<string, string | string[]>) => applyAdFilters(cards, parseAdFilters(sp), NOW).map((c) => c.id).sort();
  assert.deepEqual(run({}), ["a", "b", "c"]);
  assert.deepEqual(run({ adv: "p2" }), ["b", "c"]);
  assert.deepEqual(run({ q: "QUIZ" }), ["b"]);
  assert.deepEqual(run({ status: "ended" }), ["b"]);
  assert.deepEqual(run({ active: "yes" }), ["a", "c"]);
  assert.deepEqual(run({ format: "image" }), ["b"]);
  assert.deepEqual(run({ winners: "1" }), ["a"]);
  assert.deepEqual(run({ launched: "7" }), ["c"]);
  assert.deepEqual(run({ mindays: "30" }), ["a"]);
});

test("applyAdFilters favorites match a card when any ad in its group is starred", () => {
  const cards = groupAdCards([row("v1", { collationId: "c" }), row("v2", { collationId: "c" }), row("solo")], new Map([["v1", rank(1)]]), NOW);
  const run = (favs: string[]) => applyAdFilters(cards, parseAdFilters({ fav: "1" }), NOW, new Set(favs)).map((c) => c.id).sort();
  assert.deepEqual(run([]), []);
  assert.deepEqual(run(["v2"]), ["v1"]);
  assert.deepEqual(run(["v2", "solo"]), ["solo", "v1"]);
  assert.deepEqual(applyAdFilters(cards, parseAdFilters({}), NOW, new Set()).length, 2);
});

test("adFiltersHref round-trips and omits defaults", () => {
  const f = parseAdFilters({ rel: "inspiration", adv: ["p1", "p2"], q: "quiz", status: "active", format: "video", winners: "1", fav: "1", launched: "30", mindays: "14", sort: "newest", view: "table" });
  const qs = new URLSearchParams(adFiltersHref(f).slice(1));
  const back = parseAdFilters(Object.fromEntries([...new Set(qs.keys())].map((k) => [k, qs.getAll(k)])));
  assert.deepEqual(back, f);
  assert.equal(activeAdFilterCount(f), 9);
  assert.equal(adFiltersHref(parseAdFilters({ sort: "bogus" })), "?");
});

test("hookOf skips Meta template placeholders", () => {
  assert.equal(hookOf({ title: "{{product.name}}", body: "\nReal first line\nmore", advertiserName: "X" }), "Real first line");
  assert.equal(hookOf({ title: null, body: null, advertiserName: "X" }), "X");
});

test("signalOf: working after 21 days with a top-10 rank or 5+ versions, early within 14 days with a top-10 rank", () => {
  const card = (age: number, r: number | null, versions: number, isActive: boolean | null = true) => ({ isActive, startDate: daysAgo(age), rank: r ? rank(r) : null, versions });
  assert.equal(signalOf(card(30, 3, 1), NOW), "working");
  assert.equal(signalOf(card(30, null, 5), NOW), "working");
  assert.equal(signalOf(card(30, 11, 4), NOW), null);
  assert.equal(signalOf(card(30, 3, 1, false), NOW), null);
  assert.equal(signalOf(card(5, 8, 1), NOW), "early");
  assert.equal(signalOf(card(5, null, 15), NOW), null);
  assert.equal(signalOf(card(17, 1, 9), NOW), null);
});

test("landingOf strips protocol, www, query and trailing slash; by/v filters on a dimension", () => {
  assert.equal(landingOf("https://www.example.com/quiz/?utm_source=x#top"), "example.com/quiz");
  assert.equal(landingOf("http://example.com/"), "example.com");
  assert.equal(landingOf("not a url"), null);
  const cards = groupAdCards([row("a", { linkUrl: "https://example.com/a" }), row("b", { linkUrl: "https://example.com/b" })], new Map(), NOW);
  assert.deepEqual(applyAdFilters(cards, parseAdFilters({ by: "landing", v: "example.com/b" }), NOW).map((c) => c.id), ["b"]);
  // Profile dimensions only match profiled cards.
  assert.deepEqual(applyAdFilters(cards, parseAdFilters({ by: "angle", v: "none" }), NOW), []);
  assert.equal(parseAdFilters({ by: "bogus", v: "x" }).by, null);
});
