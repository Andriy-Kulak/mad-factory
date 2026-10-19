/**
 * The one number every agent checks its work against: a product's monthly profit versus its goal.
 * Pure: takes rows from loadScorecardData and returns month-to-date totals, two projections and warnings.
 */
import type { DailyAmount, ScorecardData } from "../db/scorecard.ts";

export interface Goal {
  target: number;
  currency: string;
  /** null = the owner has not set fixed costs yet; profit then ignores them and a warning says so. */
  monthlyFixedCosts: number | null;
}

export interface Totals {
  proceeds: number;
  spend: Record<string, number>;
  spendTotal: number;
  fixedCosts: number;
  profit: number;
}

export interface Scorecard {
  product: string;
  month: string;
  through: string;
  daysElapsed: number;
  daysInMonth: number;
  currency: string;
  goal: Goal | null;
  monthToDate: Totals;
  /** Month so far, extended at the same daily pace to the whole month. Null before the first full day. */
  projected: Totals | null;
  /** The last 7 days' daily pace times the days in the month. */
  sevenDayPace: Totals;
  /** Projected profit minus the target; negative means short of the goal. */
  gap: number | null;
  trials: number;
  spendPerTrial: number | null;
  running: ScorecardData["running"];
  warnings: string[];
}

const DAY = 86_400_000;
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** The first day the scorecard needs data for: the month start, or 7 days back if that is earlier. */
export function scorecardFrom(month: string, through: string): string {
  const start = `${month}-01`;
  const week = addDays(through, -6);
  return week < start ? week : start;
}

/** Channels whose revenue RevenueCat attributes, so they can be left out. */
export const EXCLUDABLE_CHANNELS = ["apple_ads"] as const;
export type ExcludableChannel = (typeof EXCLUDABLE_CHANNELS)[number];
export const isExcludable = (c: string): c is ExcludableChannel => (EXCLUDABLE_CHANNELS as readonly string[]).includes(c);

export function withoutChannels(data: ScorecardData, channels: readonly ExcludableChannel[]): ScorecardData {
  if (!channels.length) return data;
  const out = (c: string | undefined) => c != null && (channels as readonly string[]).includes(c);
  return {
    proceeds: data.proceeds.filter((r) => !out(r.channel)),
    trials: data.trials.filter((r) => !out(r.channel)),
    spend: Object.fromEntries(Object.entries(data.spend).filter(([c]) => !out(c))),
    latest: Object.fromEntries(Object.entries(data.latest).filter(([c]) => !out(c))),
    running: data.running.filter((e) => !out(e.channel)),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

function totals(proceeds: number, spend: Record<string, number>, fixedCosts: number): Totals {
  const spendTotal = Object.values(spend).reduce((a, b) => a + b, 0);
  return {
    proceeds: round(proceeds),
    spend: Object.fromEntries(Object.entries(spend).map(([k, v]) => [k, round(v)])),
    spendTotal: round(spendTotal),
    fixedCosts: round(fixedCosts),
    profit: round(proceeds - spendTotal - fixedCosts),
  };
}

const scale = (t: Totals, f: number, fixedCosts: number): Totals => totals(t.proceeds * f, Object.fromEntries(Object.entries(t.spend).map(([k, v]) => [k, v * f])), fixedCosts);

export function buildScorecard(input: { product: string; month: string; through: string; goal: Goal | null; data: ScorecardData }): Scorecard {
  const { month, through, goal, data } = input;
  const currency = goal?.currency ?? "USD";
  const warnings: string[] = [];
  const dim = daysInMonth(month);
  const monthStart = `${month}-01`;
  const daysElapsed = through < monthStart ? 0 : Math.min(dim, Number(through.slice(8, 10)));
  const weekStart = addDays(through, -6);

  const sum = (rows: DailyAmount[], label: string, from: string) => {
    let total = 0;
    let skipped = 0;
    for (const r of rows) {
      if (r.date < from || r.date > through) continue;
      if (r.currency !== currency) skipped++;
      else total += r.amount;
    }
    if (skipped && from === monthStart) warnings.push(`${label}: ${skipped} row(s) not in ${currency} were left out (no currency conversion)`);
    return total;
  };
  const spendSince = (from: string) => Object.fromEntries(Object.entries(data.spend).map(([ch, rows]) => [ch, sum(rows, `${ch} spend`, from)]));

  const fixed = goal?.monthlyFixedCosts ?? 0;
  if (!goal) warnings.push("No goal set: pnpm scorecard goal --product <slug> --target <amount>");
  else if (goal.monthlyFixedCosts == null) warnings.push("Fixed costs not set, so profit ignores them: pnpm scorecard goal --product <slug> --fixed-costs <amount>");

  const monthToDate = totals(sum(data.proceeds, "RevenueCat proceeds", monthStart), spendSince(monthStart), (fixed * daysElapsed) / dim);
  const projected = daysElapsed ? scale(monthToDate, dim / daysElapsed, fixed) : null;
  const week = totals(sum(data.proceeds, "RevenueCat proceeds", weekStart), spendSince(weekStart), 0);
  const sevenDayPace = scale(week, dim / 7, fixed);

  for (const [source, latest] of Object.entries(data.latest)) {
    if (!latest) warnings.push(`${source}: no data synced for this product`);
    else if (latest < through) warnings.push(`${source}: data only through ${latest}; numbers after that are missing (run its sync)`);
  }

  const trials = data.trials.filter((t) => t.date >= monthStart && t.date <= through).reduce((a, t) => a + t.n, 0);
  return {
    product: input.product,
    month,
    through,
    daysElapsed,
    daysInMonth: dim,
    currency,
    goal,
    monthToDate,
    projected,
    sevenDayPace,
    gap: goal && projected ? round(projected.profit - goal.target) : null,
    trials,
    spendPerTrial: trials ? round(monthToDate.spendTotal / trials) : null,
    running: data.running,
    warnings,
  };
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function formatScorecard(s: Scorecard): string {
  const cols = [s.monthToDate, s.projected, s.sevenDayPace];
  const row = (label: string, pick: (t: Totals) => number) => label.padEnd(24) + cols.map((t) => (t ? fmt(pick(t)) : "—").padStart(16)).join("");
  const lines = [
    `${s.product} · ${s.month} through ${s.through} (${s.daysElapsed} of ${s.daysInMonth} days) · ${s.currency}`,
    s.goal ? `Goal: monthly profit ${fmt(s.goal.target)}` : "Goal: not set",
    "",
    "".padEnd(24) + ["Month to date", "Month projected", "7-day pace"].map((h) => h.padStart(16)).join(""),
    row("Proceeds (RevenueCat)", (t) => t.proceeds),
    row("Ad spend", (t) => -t.spendTotal),
    ...Object.keys(s.monthToDate.spend).map((ch) => row(`  ${ch}`, (t) => -(t.spend[ch] ?? 0))),
    row("Fixed costs", (t) => -t.fixedCosts),
    row("Profit", (t) => t.profit),
  ];
  if (s.gap != null) lines.push(`${"Gap to goal".padEnd(24)}${"".padStart(16)}${fmt(s.gap).padStart(16)}`);
  lines.push("", `Trials (RevenueCat) ${s.trials} · ad spend per trial ${fmt(s.spendPerTrial)}`);
  if (s.running.length) lines.push(`Running experiments: ${s.running.map((e) => `${e.channel}/${e.slug}`).join(", ")}`);
  if (s.warnings.length) lines.push("", "Warnings:", ...s.warnings.map((w) => `  - ${w}`));
  return lines.join("\n");
}

/** One line for `pnpm ready` and agent prompts. */
export function scorecardHeadline(s: Scorecard): string {
  const profit = s.projected?.profit ?? s.sevenDayPace.profit;
  const goal = s.goal ? ` vs goal ${fmt(s.goal.target)} (gap ${fmt(s.gap ?? profit - s.goal.target)})` : " (no goal set)";
  return `${s.product}: projected monthly profit ${fmt(profit)} ${s.currency}${goal}; month to date proceeds ${fmt(s.monthToDate.proceeds)}, ad spend ${fmt(s.monthToDate.spendTotal)}`;
}
