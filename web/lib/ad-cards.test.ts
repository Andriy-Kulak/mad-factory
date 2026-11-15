import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adCardsPage,
  activeAdFilterCount,
  adFiltersHref,
  currentRanks,
  pickRankRuns,
  ranksAsOf,
  type RankRun,
  applyAdFilters,
  groupAdCards,
  hookOf,
  isWinner,
  landingOf,
  NO_AD_FILTERS,
  parseAdFilters,
  searchParamsOf,
  signalOf,
  sortAdCards,
  type AdSourceRow,
  type ImpressionRank,
} from "./ad-cards.ts";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString().slice(0, 10);
const rank = (r: number): ImpressionRank => ({ rank: r, prevRank: null, observedAt: "2026-10-08T00:00:00Z" });

function row(id: string, over: Partial<AdSourceRow> = {}): AdSourceRow {
  return {
    id,
    externalId: id,
    advertiserId: "p1",
    advertiserName: "Page one",
    avatarUrl: null,
    body: null,
    title: null,
    cta: null,
    linkUrl: null,
    caption: null,
    format: "VIDEO",
    startDate: daysAgo(30),
    endDate: null,
    isActive: true,
    platforms: [],
    collationId: null,
    collationCount: 1,
    firstSeenAt: "2026-10-01T00:00:00Z",
    media: { url: "https://x/v.mp4", type: "video", sha256: "v" },
    relation: "competitor",
    ...over,
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
  assert.deepEqual(
    cards.map((c) => [c.id, c.versions]),
    [
      ["v2", 2],
      ["solo", 1],
      ["solo2", 1],
    ],
  );
  assert.equal(cards[0]!.rank?.rank, 3);
  assert.equal(groupAdCards([row("a", { collationId: "c", collationCount: 7 })], new Map(), NOW)[0]!.versions, 7);
});

test("sortAdCards orders by rank, launch date, longevity and variants", () => {
  const cards = groupAdCards(
    [
      row("ranked2", { startDate: daysAgo(40) }),
      row("ranked1", { startDate: daysAgo(5) }),
      row("new", { startDate: daysAgo(1) }),
      row("old-ended", { startDate: daysAgo(300), endDate: daysAgo(100), isActive: false }),
      row("many", { startDate: daysAgo(60), collationCount: 9 }),
    ],
    new Map([
      ["ranked1", rank(1)],
      ["ranked2", rank(2)],
    ]),
    NOW,
  );
  const ids = (s: Parameters<typeof sortAdCards>[1]) => sortAdCards(cards, s).map((c) => c.id);
  assert.deepEqual(ids("impressions"), ["ranked1", "ranked2", "new", "many", "old-ended"]);
  assert.deepEqual(ids("newest"), ["new", "ranked1", "ranked2", "many", "old-ended"]);
  assert.deepEqual(ids("longest"), ["many", "ranked2", "ranked1", "new", "old-ended"]);
  assert.equal(ids("variants")[0], "many");
});

test("applyAdFilters narrows by relation", () => {
  const cards = groupAdCards([row("comp"), row("adj", { advertiserId: "p3", relation: "inspiration" })], new Map(), NOW);
  const run = (sp: Record<string, string>) =>
    applyAdFilters(cards, parseAdFilters(sp), NOW)
      .map((c) => c.id)
      .sort();
  assert.deepEqual(run({}), ["adj", "comp"]);
  assert.deepEqual(run({ rel: "competitor" }), ["comp"]);
  assert.deepEqual(run({ rel: "inspiration" }), ["adj"]);
  assert.deepEqual(run({ rel: "bogus" }), ["adj", "comp"]);
});

test("applyAdFilters narrows by advertiser, copy, status, format, winners, launch and longevity", () => {
  const cards = groupAdCards(
    [
      row("a", { advertiserId: "p1", body: "Grow with confidence", startDate: daysAgo(40) }),
      row("b", { advertiserId: "p2", title: "Take the quiz", isActive: false, endDate: daysAgo(2), startDate: daysAgo(10), media: { url: "i.jpg", type: "image", sha256: "i" } }),
      row("c", { advertiserId: "p2", startDate: daysAgo(3) }),
    ],
    new Map([["a", rank(1)]]),
    NOW,
  );
  const run = (sp: Record<string, string | string[]>) =>
    applyAdFilters(cards, parseAdFilters(sp), NOW)
      .map((c) => c.id)
      .sort();
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
  const run = (favs: string[]) =>
    applyAdFilters(cards, parseAdFilters({ fav: "1" }), NOW, new Set(favs))
      .map((c) => c.id)
      .sort();
  assert.deepEqual(run([]), []);
  assert.deepEqual(run(["v2"]), ["v1"]);
  assert.deepEqual(run(["v2", "solo"]), ["solo", "v1"]);
  assert.deepEqual(applyAdFilters(cards, parseAdFilters({}), NOW, new Set()).length, 2);
});

test("adFiltersHref round-trips and omits defaults", () => {
  const f = parseAdFilters({
    rel: "inspiration",
    adv: ["p1", "p2"],
    q: "quiz",
    status: "active",
    format: "video",
    winners: "1",
    fav: "1",
    launched: "30",
    mindays: "14",
    sort: "newest",
    view: "table",
  });
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
  assert.deepEqual(
    applyAdFilters(cards, parseAdFilters({ by: "landing", v: "example.com/b" }), NOW).map((c) => c.id),
    ["b"],
  );
  // Profile dimensions only match profiled cards.
  assert.deepEqual(applyAdFilters(cards, parseAdFilters({ by: "angle", v: "none" }), NOW), []);
  assert.equal(parseAdFilters({ by: "bogus", v: "x" }).by, null);
});

test("adCardsPage pages the filtered, sorted cards and counts over all of them", () => {
  const cards = groupAdCards(
    [row("a", { startDate: daysAgo(3) }), row("b", { startDate: daysAgo(2), isActive: false }), row("c", { startDate: daysAgo(1), advertiserId: "p2", advertiserName: "Page two" })],
    new Map([["a", rank(1)]]),
    NOW,
  );
  const f = { ...NO_AD_FILTERS, sort: "newest" as const, view: "cards" as const };
  const page = adCardsPage(cards, f, new Set(["b"]), 1, 1, NOW);
  assert.deepEqual(
    page.ads.map((c) => c.id),
    ["b"],
  );
  assert.equal(page.matched, 3);
  assert.equal(page.total, 3);
  assert.equal(page.stats.running, 2);
  assert.equal(page.favCount, 1);
  assert.deepEqual(
    page.advertisers.map((a) => [a.id, a.ads, a.running]),
    [
      ["p1", 2, 1],
      ["p2", 1, 1],
    ],
  );
  const running = adCardsPage(cards, { ...f, status: "active" }, new Set(), 0, 36, NOW);
  assert.deepEqual(
    running.ads.map((c) => c.id),
    ["c", "a"],
  );
  assert.equal(running.total, 3);
});

test("searchParamsOf keeps repeated keys as arrays", () => {
  const sp = searchParamsOf(new URLSearchParams("adv=1&adv=2&sort=newest"));
  assert.deepEqual(sp, { adv: ["1", "2"], sort: "newest" });
  assert.deepEqual(parseAdFilters(sp).advertisers, ["1", "2"]);
});

const run = (id: string, startedAt: string, status: string, adsSeen: number, trackedSourceId = "s1"): RankRun => ({ id, trackedSourceId, startedAt, status, adsSeen });
const obs = (runId: string, ranks: Record<string, number>) => Object.entries(ranks).map(([adId, r]) => ({ runId, adId, rank: r, observedAt: `${runId}-time` }));

test("pickRankRuns uses a failed run for the ranks it reached and stops at the last finished run", () => {
  const [picked] = pickRankRuns(
    [
      run("old-done", "2026-10-03T12:00:00Z", "done", 250),
      run("done", "2026-10-05T12:00:00Z", "done", 250),
      run("empty", "2026-10-06T12:00:00Z", "error", 0),
      run("deep", "2026-10-08T10:00:00Z", "error", 150),
      run("shallow", "2026-10-08T11:00:00Z", "error", 30),
    ],
    NOW,
  );
  assert.deepEqual(
    picked!.current.map((r) => r.id),
    ["shallow", "deep", "done"],
  );
  assert.equal(picked!.previous?.id, "done");
});

test("pickRankRuns ignores runs older than a week and sources with nothing usable", () => {
  assert.deepEqual(pickRankRuns([run("stale", "2026-09-20T12:00:00Z", "done", 250), run("failed", "2026-10-08T10:00:00Z", "error", 0, "s2")], NOW), []);
});

test("currentRanks drops an ad that left the part of the list the newest run read", () => {
  const picked = pickRankRuns([run("done", "2026-10-05T12:00:00Z", "done", 4), run("partial", "2026-10-08T10:00:00Z", "error", 2)], NOW);
  const ranks = currentRanks(picked, [...obs("done", { gone: 1, a: 2, b: 3, deep: 4 }), ...obs("partial", { a: 1, b: 2 })]);
  assert.equal(ranks.has("gone"), false);
  assert.deepEqual(ranks.get("a"), { rank: 1, prevRank: 2, observedAt: "partial-time" });
  assert.deepEqual(ranks.get("b"), { rank: 2, prevRank: 3, observedAt: "partial-time" });
  assert.deepEqual(ranks.get("deep"), { rank: 4, prevRank: 4, observedAt: "done-time" });
});

test("currentRanks keeps an ad's best rank across sources", () => {
  const picked = pickRankRuns([run("r1", "2026-10-08T10:00:00Z", "done", 5, "s1"), run("r2", "2026-10-08T10:00:00Z", "done", 5, "s2")], NOW);
  assert.equal(currentRanks(picked, [...obs("r1", { a: 5 }), ...obs("r2", { a: 2 })]).get("a")?.rank, 2);
});

test("ranksAsOf reports the stalest and freshest advertiser", () => {
  const at = (r: number, observedAt: string): ImpressionRank => ({ rank: r, prevRank: null, observedAt });
  const cards = groupAdCards(
    [row("a"), row("b"), row("c", { advertiserId: "p2" }), row("d", { advertiserId: "p3" })],
    new Map([
      ["a", at(1, "2026-10-08T10:00:00Z")],
      ["b", at(200, "2026-10-05T10:00:00Z")],
      ["c", at(1, "2026-10-06T10:00:00Z")],
    ]),
    NOW,
  );
  assert.deepEqual(ranksAsOf(cards), { oldest: "2026-10-06T10:00:00Z", newest: "2026-10-08T10:00:00Z" });
  assert.equal(ranksAsOf(cards.filter((c) => !c.rank)), null);
});
