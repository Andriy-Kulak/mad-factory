import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOverview, formatBrief } from "./overview.ts";
import { buildScorecard } from "./scorecard.ts";
import type { ScorecardData, WindowData } from "../db/scorecard.ts";

const NOW = new Date("2026-10-06T12:00:00Z");
const window = { from: "2026-09-29", to: "2026-10-05", days: 7 };

const emptyMonth: ScorecardData = { proceeds: [], trials: [], spend: {}, latest: {}, running: [{ slug: "x", channel: "meta_ads", name: "X test" }] };
const scorecard = (target = 1000) => buildScorecard({ product: "p", month: "2026-10", through: "2026-10-05", goal: { target, currency: "USD", monthlyFixedCosts: 0 }, data: emptyMonth });

function data(over: Partial<WindowData> = {}): WindowData {
  return {
    meta: [
      { ad_id: "a", spend: 60, installs: 10, trials: 6, currency: "USD" },
      { ad_id: "a", spend: 40, installs: 5, trials: 4, currency: "USD" },
      { ad_id: "b", spend: 30, installs: 2, trials: 0, currency: "USD" },
    ],
    metaAds: [
      { id: "a", name: "Ad A", status: "ACTIVE" },
      { id: "b", name: "Ad B", status: "PAUSED" },
    ],
    apple: [{ spend: 20, installs: 4, currency: "USD" }],
    revenuecat: [
      { campaign: "c1", trials: 2, paid: 1, proceeds: 10, currency: "USD" },
      { campaign: "", trials: 18, paid: 6, proceeds: 90, currency: "USD" },
    ],
    ownPosts: [
      { platform: "tiktok", handle: "h", url: "https://x/1", posted_at: "2026-10-01T10:00:00Z", views: 50 },
      { platform: "instagram", handle: "h", url: null, posted_at: "2026-10-02T10:00:00Z", views: 500 },
    ],
    ownAccounts: 2,
    followUps: [],
    appleCoverage: { campaigns: [], keywords: [] },
    runs: [
      { source: "meta_ads", status: "done", started_at: "2026-10-06T08:00:00Z", finished_at: "2026-10-06T08:05:00Z" },
      { source: "apple_ads", status: "error", started_at: "2026-10-06T08:00:00Z", finished_at: null },
      { source: "apple_ads", status: "done", started_at: "2026-10-03T08:00:00Z", finished_at: "2026-10-03T08:05:00Z" },
    ],
    ...over,
  };
}

test("channels: Meta by its own attribution, Apple and the rest by RevenueCat, total trials from RevenueCat", () => {
  const o = buildOverview({ product: "p", window, scorecard: scorecard(), data: data(), now: NOW });
  const ch = Object.fromEntries(o.channels.map((c) => [c.key, c]));
  assert.deepEqual([ch.meta_ads!.spend, ch.meta_ads!.trials, ch.meta_ads!.costPerTrial], [130, 10, 13]);
  assert.deepEqual([ch.apple_ads!.spend, ch.apple_ads!.trials, ch.apple_ads!.proceeds, ch.apple_ads!.costPerTrial], [20, 2, 10, 10]);
  assert.deepEqual([ch.unattributed!.trials, ch.unattributed!.paid, ch.unattributed!.proceeds], [18, 6, 90]);
  assert.deepEqual([ch.total!.spend, ch.total!.trials, ch.total!.costPerTrial], [150, 20, 7.5]);
  assert.equal(o.windowProfit, -50);
  assert.equal(o.proceedsPerTrial, 5);
});

test("Meta ads roll up per ad, sorted by spend; posts by views; stale sources flagged", () => {
  const o = buildOverview({ product: "p", window, scorecard: scorecard(), data: data(), now: NOW });
  assert.deepEqual(
    o.ads.map((a) => [a.name, a.spend, a.trials, a.costPerTrial]),
    [
      ["Ad A", 100, 10, 10],
      ["Ad B", 30, 0, null],
    ],
  );
  assert.deepEqual(
    o.organic.posts.map((p) => p.views),
    [500, 50],
  );
  assert.equal(o.organic.views, 550);
  assert.deepEqual(
    o.freshness.map((f) => [f.source, f.lastStatus, f.stale]),
    [
      ["apple_ads", "error", true],
      ["meta_ads", "done", false],
    ],
  );
});

test("status follows the projection; other currencies are left out with a warning", () => {
  assert.equal(buildOverview({ product: "p", window, scorecard: scorecard(), data: data(), now: NOW }).status, "not_profitable");
  const earning = buildScorecard({
    product: "p",
    month: "2026-10",
    through: "2026-10-05",
    goal: { target: 1000, currency: "USD", monthlyFixedCosts: 0 },
    data: { ...emptyMonth, proceeds: [{ date: "2026-10-01", amount: 50, currency: "USD" }] },
  });
  assert.equal(buildOverview({ product: "p", window, scorecard: earning, data: data(), now: NOW }).status, "profitable");
  const eur = data({ apple: [{ spend: 99, installs: 1, currency: "EUR" }] });
  const o = buildOverview({ product: "p", window, scorecard: scorecard(), data: eur, now: NOW });
  assert.equal(o.channels.find((c) => c.key === "apple_ads")!.spend, 0);
  assert.match(o.warnings.join("\n"), /Apple Ads: 1 row\(s\) not in USD/);
});

test("the brief leads with the goal and names stale data", () => {
  const text = formatBrief(buildOverview({ product: "p", window, scorecard: scorecard(), data: data(), now: NOW }));
  assert.match(text.split("\n").slice(0, 4).join("\n"), /Goal: 1,000\.00 USD profit per month/);
  assert.match(text, /\| Meta ads \| Meta-reported \(AppsFlyer\) \| 130\.00 \| 17 \| 10 \|/);
  assert.match(text, /apple_ads: last successful sync 2026-10-03T08:05:00Z \(latest run error\)/);
  assert.match(text, /meta_ads\/x: X test/);
});

test("discovery coverage gaps appear in warnings and the brief", () => {
  const o = buildOverview({
    product: "p",
    window,
    scorecard: scorecard(),
    data: data({
      appleCoverage: {
        campaigns: [
          { id: 1, name: "Discovery", role: "discovery", geo: "US" },
          { id: 2, name: "Generic", role: "generic", geo: "US" },
        ],
        keywords: [{ campaignId: 2, text: "watering", matchType: "EXACT", isNegative: false, deleted: false }],
      },
    }),
    now: NOW,
  });
  assert.deepEqual(o.warnings.slice(0, 2), [
    'Apple Ads Discovery: 1 generic EXACT keyword(s) without a BROAD twin: watering (playbooks/apple-ads.md "Discovery mirror")',
    'Apple Ads Discovery: 1 EXACT keyword(s) not negated in discovery: watering (playbooks/apple-ads.md "Discovery mirror")',
  ]);
  assert.match(formatBrief(o), /## Check before trusting the numbers\n(?:.*\n)*- Apple Ads Discovery: 1 generic EXACT keyword\(s\) without a BROAD twin: watering/);
});

test("follow-ups: due ones are listed with their resolve command, upcoming ones counted", () => {
  const o = buildOverview({
    product: "p",
    window,
    scorecard: scorecard(),
    data: data({
      followUps: [
        { id: "aaaaaaaa-0000-0000-0000-000000000001", experiment: "meta_ads/x", due_on: "2026-10-04", body: "check the new hook's trials" },
        { id: "bbbbbbbb-0000-0000-0000-000000000002", experiment: "apple_ads/y", due_on: "2026-10-06", body: "re-check the bid cut" },
        { id: "cccccccc-0000-0000-0000-000000000003", experiment: "meta_ads/x", due_on: "2026-10-10", body: "future thing" },
      ],
    }),
    now: NOW,
  });
  const text = formatBrief(o);
  assert.match(text, /2026-10-04 \(2 days overdue\) meta_ads\/x: check the new hook's trials/);
  assert.match(text, /pnpm experiment resolve --product p --id aaaaaaaa-0000-0000-0000-000000000001/);
  assert.match(text, /2026-10-06 \(due today\) apple_ads\/y: re-check the bid cut/);
  assert.match(text, /pnpm experiment resolve --product p --id bbbbbbbb-0000-0000-0000-000000000002/);
  assert.doesNotMatch(text, /future thing/);
  assert.match(text, /Upcoming: 1 \(next 2026-10-10 meta_ads\/x\)/);
  assert.equal(o.followUps.map((f) => f.daysOverdue).join(","), "2,0,-4");
});

test("follow-ups: no follow-ups means no heading", () => {
  const text = formatBrief(buildOverview({ product: "p", window, scorecard: scorecard(), data: data(), now: NOW }));
  assert.doesNotMatch(text, /Follow-ups/);
});

test("weekly trend: 7-day blocks ending on the window end, all channels' spend, other currencies left out", () => {
  const trendData: ScorecardData = {
    proceeds: [
      { date: "2026-09-08", amount: 99, currency: "USD" },
      { date: "2026-09-09", amount: 10, currency: "USD" },
      { date: "2026-10-05", amount: 30, currency: "USD" },
      { date: "2026-10-05", amount: 50, currency: "EUR" },
    ],
    trials: [
      { date: "2026-09-15", n: 4, paid: 1 },
      { date: "2026-09-29", n: 6, paid: 2 },
    ],
    spend: {
      meta_ads: [{ date: "2026-09-29", amount: 20, currency: "USD" }],
      apple_ads: [{ date: "2026-10-05", amount: 5, currency: "USD" }],
    },
    latest: {},
    running: [],
  };
  const o = buildOverview({ product: "p", window, scorecard: scorecard(), data: data(), trendData, now: NOW });
  assert.deepEqual(
    o.trend.map((w) => [w.from, w.to, w.spend, w.spendByChannel, w.proceeds, w.profit, w.trials, w.paid]),
    [
      ["2026-09-08", "2026-09-14", 0, { meta_ads: 0, apple_ads: 0 }, 109, 109, 0, 0],
      ["2026-09-15", "2026-09-21", 0, { meta_ads: 0, apple_ads: 0 }, 0, 0, 4, 1],
      ["2026-09-22", "2026-09-28", 0, { meta_ads: 0, apple_ads: 0 }, 0, 0, 0, 0],
      ["2026-09-29", "2026-10-05", 25, { meta_ads: 20, apple_ads: 5 }, 30, 5, 6, 2],
    ],
  );
  assert.match(
    formatBrief(o),
    /## Weekly trend\n\| Week \| Spend \| meta_ads \| apple_ads \| Proceeds \| Profit \| Trials \| Paid \|\n\| --- \| ---: \| ---: \| ---: \| ---: \| ---: \| ---: \| ---: \|\n\| 2026-09-08 to 2026-09-14 \| 0\.00 \| 0\.00 \| 0\.00 \| 109\.00 \| 109\.00 \| 0 \| 0 \|/,
  );
  assert.deepEqual(buildOverview({ product: "p", window, scorecard: scorecard(), data: data(), now: NOW }).trend, []);
});
