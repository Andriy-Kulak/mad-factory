import assert from "node:assert/strict";
import { test } from "node:test";
import { groupAdCards, type AdCard, type AdSourceRow, type ImpressionRank } from "./ad-cards.ts";
import type { CreativeFields } from "./creative-groups.ts";
import { advertiserMatrix, browseHref, cardsInScope, drillCards, insightFiltersHref, insightTable, parseInsightFilters, workingHooks, type InsightFilters } from "./insights.ts";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString().slice(0, 10);
const rank = (r: number): ImpressionRank => ({ rank: r, prevRank: null, observedAt: "2026-10-11T00:00:00Z" });
const fields = (over: Partial<CreativeFields> = {}): CreativeFields => ({
  angle: "a1", angle_suggestion: null, audience: "p1", hook_type: "question", awareness: null, response: null, format: null, style: null, structure: null, ...over,
});

function row(id: string, over: Partial<AdSourceRow> = {}): AdSourceRow {
  return {
    id, externalId: id, advertiserId: "p1", advertiserName: "Page one", avatarUrl: null, body: null, title: null, cta: null, linkUrl: "https://www.example.com/quiz?utm=1",
    caption: null, format: "VIDEO", startDate: daysAgo(40), endDate: null, isActive: true, platforms: [], collationId: null, collationCount: 1,
    firstSeenAt: "2026-10-01T00:00:00Z", media: { url: "https://x/v.mp4", type: "video", sha256: `sha-${id}` }, relation: "competitor", ...over,
  };
}

/** Cards with profiles attached the way the loader does. */
function cards(rows: AdSourceRow[], ranks: Record<string, number>, profiles: Record<string, Partial<CreativeFields> | null>, hooks: Record<string, string> = {}): AdCard[] {
  return groupAdCards(rows, new Map(Object.entries(ranks).map(([id, r]) => [id, rank(r)])), NOW).map((c) =>
    profiles[c.id] === null ? c : { ...c, profile: { fields: fields(profiles[c.id] ?? {}), hook: hooks[c.id] ?? null } });
}

const ALL: InsightFilters = { dim: "angle", view: "totals", window: "all", relation: null, value: null, advertiserId: null };
const DEFAULTS: InsightFilters = { ...ALL, relation: "competitor" };

const sample = cards(
  [
    row("w1"), // working: top 10, 40 days
    row("w2", { advertiserId: "p2", advertiserName: "Page two", collationCount: 6 }), // working: 6 versions
    row("old", { startDate: daysAgo(60) }), // not working: no rank, 1 version
    row("ended", { isActive: false, endDate: daysAgo(5) }),
    row("new", { startDate: daysAgo(5) }), // early: top 10, 5 days
    row("new2", { startDate: daysAgo(3), advertiserId: "p3", advertiserName: "Page three", relation: "inspiration" }), // in window, no signal
    row("bare", { startDate: daysAgo(30) }), // not profiled
  ],
  { w1: 2, new: 4 },
  { w1: { angle: "a1" }, w2: { angle: "a1" }, old: { angle: "a2" }, ended: { angle: "a2" }, new: { angle: "a3" }, new2: { angle: "a3", hook_type: "demo_first" }, bare: null },
  { w1: "Ever go blank?", new: "Try this" },
);

test("all time: working share, lift and concentration per angle", () => {
  const t = insightTable(sample, ALL, NOW);
  assert.equal(t.total, 6);
  assert.equal(t.working, 2);
  assert.equal(t.unprofiled, 1);
  const a1 = t.rows.find((r) => r.value === "a1")!;
  assert.deepEqual([a1.ads, a1.working, a1.alive, a1.advertisers], [2, 2, 2, 2]);
  assert.equal(a1.lift, (2 / 2) / (2 / 6));
  assert.deepEqual(a1.top, { name: "Page one", working: 1 });
  assert.equal(t.rows[0]!.value, "a1");
  const a2 = t.rows.find((r) => r.value === "a2")!;
  assert.deepEqual([a2.working, a2.lift, a2.longest], [0, 0, sample.find((c) => c.id === "old")!.days]);
});

test("last 14 days: only cards launched since, early signal counts as working", () => {
  const f: InsightFilters = { ...ALL, window: "14d" };
  assert.deepEqual(cardsInScope(sample, f, NOW).map((c) => c.id).sort(), ["new", "new2"]);
  const t = insightTable(sample, f, NOW);
  assert.deepEqual([t.total, t.working], [2, 1]);
  assert.deepEqual(t.rows.map((r) => [r.value, r.ads, r.working]), [["a3", 2, 1]]);
});

test("relation narrows the scope; landing pages need no profile", () => {
  assert.equal(insightTable(sample, { ...ALL, relation: "inspiration" }, NOW).total, 1);
  const landing = insightTable(sample, { ...ALL, dim: "landing" }, NOW);
  assert.deepEqual([landing.total, landing.unprofiled], [7, 0]);
  assert.equal(landing.rows[0]!.value, "example.com/quiz");
});

test("advertiser matrix puts direct competitors before adjacent niches", () => {
  const m = advertiserMatrix(sample, ALL, NOW);
  assert.deepEqual(m.columns.map((c) => [c.name, c.relation, c.ads, c.working]), [["Page one", "competitor", 4, 1], ["Page two", "competitor", 1, 1], ["Page three", "inspiration", 1, 0]]);
  assert.deepEqual(m.rows.find((r) => r.value === "a1")!.cells["p2"], { ads: 1, working: 1, alive: 1 });
});

test("working hooks follow the window", () => {
  assert.deepEqual(workingHooks(sample, ALL, 5, NOW).map((h) => h.text), ["Ever go blank?"]);
  assert.deepEqual(workingHooks(sample, { ...ALL, window: "14d" }, 5, NOW).map((h) => h.text), ["Try this"]);
});

test("filters round-trip through the URL, and counts link into Competitor ads", () => {
  const f: InsightFilters = { dim: "hook", view: "advertisers", window: "14d", relation: "inspiration", value: "demo_first", advertiserId: "p3" };
  const qs = new URLSearchParams(insightFiltersHref(f).slice(1));
  assert.deepEqual(parseInsightFilters(Object.fromEntries(qs)), f);
  assert.deepEqual(parseInsightFilters({ tab: "bogus" }), DEFAULTS);
  assert.equal(insightFiltersHref(DEFAULTS), "?");
  assert.equal(insightFiltersHref(ALL), "?rel=all");
  assert.equal(parseInsightFilters({ rel: "all" }).relation, null);
  assert.equal(browseHref("demo", f, { value: "demo_first", mode: "working" }), "/p/demo/ads?rel=inspiration&signal=early&by=hook&v=demo_first&launched=14");
  assert.equal(browseHref("demo", ALL, { advertiserId: "p2" }), "/p/demo/ads?adv=p2");
  assert.equal(browseHref("demo", ALL, { value: "a2", mode: "alive" }), "/p/demo/ads?status=active&by=angle&v=a2&mindays=21");
});

test("drilling into a row or an advertiser cell lists its ads, working first by rank", () => {
  assert.equal(drillCards(sample, ALL, NOW), null);
  const row = drillCards(sample, { ...ALL, value: "a1" }, NOW)!;
  assert.deepEqual([row.working.map((c) => c.id), row.all.map((c) => c.id)], [["w1", "w2"], ["w1", "w2"]]);
  const cell = drillCards(sample, { ...ALL, value: "a2", advertiserId: "p1" }, NOW)!;
  assert.deepEqual([cell.advertiser, cell.working.length, cell.alive.map((c) => c.id), cell.all.length], ["Page one", 0, ["old"], 2]);
});
