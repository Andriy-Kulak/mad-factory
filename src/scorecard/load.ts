import { listProductGoals, loadScorecardData, loadWindowData } from "../db/index.ts";
import { buildOverview, DEFAULT_WINDOW_DAYS, TREND_WEEKS, type Overview } from "./overview.ts";
import { addDays, buildScorecard, daysInMonth, scorecardFrom, withoutChannels, type ExcludableChannel, type Goal, type Scorecard } from "./scorecard.ts";

/**
 * Scores one product for a month. --through defaults to yesterday (UTC), the last complete day;
 * a past month is scored to its last day.
 */
export async function scorecardFor(product: { id: string; slug: string }, opts: { month?: string; through?: string; exclude?: ExcludableChannel[] } = {}): Promise<Scorecard> {
  const yesterday = addDays(new Date().toISOString().slice(0, 10), -1);
  const month = opts.month ?? (opts.through ?? yesterday).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("month is YYYY-MM");
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const through = opts.through ?? (yesterday > monthEnd ? monthEnd : yesterday);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) throw new Error("through is YYYY-MM-DD");

  const [g] = await listProductGoals(product.id);
  const goal: Goal | null = g ? { target: Number(g.target), currency: g.currency, monthlyFixedCosts: g.monthly_fixed_costs == null ? null : Number(g.monthly_fixed_costs) } : null;
  const data = withoutChannels(await loadScorecardData(product.id, scorecardFrom(month, through), through), opts.exclude ?? []);
  return buildScorecard({ product: product.slug, month, through, goal, data });
}

/** The overview for the last `days` complete days (default 7), with this month's scorecard. */
export async function overviewFor(product: { id: string; slug: string }, opts: { days?: number; now?: Date; exclude?: ExcludableChannel[] } = {}): Promise<Overview> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? DEFAULT_WINDOW_DAYS;
  const exclude = opts.exclude ?? [];
  const to = addDays(now.toISOString().slice(0, 10), -1);
  const from = addDays(to, -(days - 1));
  const [scorecard, data, trendData] = await Promise.all([
    scorecardFor(product, { through: to, exclude }),
    loadWindowData(product.id, from, to),
    loadScorecardData(product.id, addDays(to, -(7 * TREND_WEEKS - 1)), to),
  ]);
  return buildOverview({ product: product.slug, window: { from, to, days }, scorecard, data, trendData: withoutChannels(trendData, exclude), now, exclude });
}
