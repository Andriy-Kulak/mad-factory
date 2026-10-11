import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScorecard, daysInMonth, scorecardFrom } from "./scorecard.ts";
import type { ScorecardData } from "../db/scorecard.ts";

const usd = (date: string, amount: number) => ({ date, amount, currency: "USD" });

function data(over: Partial<ScorecardData> = {}): ScorecardData {
  return {
    proceeds: [usd("2026-10-01", 100), usd("2026-10-02", 100)],
    trials: [
      { date: "2026-10-01", n: 3 },
      { date: "2026-10-02", n: 2 },
    ],
    spend: { apple_ads: [usd("2026-10-01", 40), usd("2026-10-02", 40)], meta_ads: [usd("2026-10-02", 20)] },
    latest: { revenuecat: "2026-10-02", apple_ads: "2026-10-02", meta_ads: "2026-10-02" },
    running: [],
    ...over,
  };
}

test("month helpers", () => {
  assert.equal(daysInMonth("2026-02"), 28);
  assert.equal(daysInMonth("2026-10"), 31);
  assert.equal(scorecardFrom("2026-10", "2026-10-02"), "2026-09-26");
  assert.equal(scorecardFrom("2026-10", "2026-10-20"), "2026-10-01");
});

test("profit is proceeds minus every channel's spend minus prorated fixed costs, projected over the month", () => {
  const s = buildScorecard({ product: "p", month: "2026-10", through: "2026-10-02", goal: { target: 1000, currency: "USD", monthlyFixedCosts: 310 }, data: data() });
  assert.equal(s.daysElapsed, 2);
  assert.deepEqual(s.monthToDate, { proceeds: 200, spend: { apple_ads: 80, meta_ads: 20 }, spendTotal: 100, fixedCosts: 20, profit: 80 });
  assert.equal(s.projected?.profit, 3100 - 1550 - 310);
  assert.equal(s.gap, 1240 - 1000);
  assert.equal(s.trials, 5);
  assert.equal(s.spendPerTrial, 20);
  assert.deepEqual(s.warnings, []);
});

test("warns about missing goal, unset fixed costs, stale sources and other currencies", () => {
  const stale = data({ latest: { revenuecat: "2026-10-02", meta_ads: "2026-10-01", apple_ads: null } });
  assert.match(
    buildScorecard({ product: "p", month: "2026-10", through: "2026-10-02", goal: null, data: stale }).warnings.join("\n"),
    /No goal set[\s\S]*meta_ads: data only through 2026-10-01[\s\S]*apple_ads: no data/,
  );

  const eur = data({ spend: { meta_ads: [usd("2026-10-01", 5), { date: "2026-10-01", amount: 9, currency: "EUR" }] } });
  const s = buildScorecard({ product: "p", month: "2026-10", through: "2026-10-02", goal: { target: 1, currency: "USD", monthlyFixedCosts: null }, data: eur });
  assert.equal(s.monthToDate.spendTotal, 5);
  assert.match(s.warnings.join("\n"), /Fixed costs not set[\s\S]*1 row\(s\) not in USD/);
});

test("before the first full day of a month there is no month projection, only the 7-day pace", () => {
  const s = buildScorecard({ product: "p", month: "2026-11", through: "2026-10-31", goal: { target: 1, currency: "USD", monthlyFixedCosts: 0 }, data: data({ latest: {} }) });
  assert.equal(s.daysElapsed, 0);
  assert.equal(s.projected, null);
  assert.equal(s.gap, null);
});
