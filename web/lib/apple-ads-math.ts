export interface Totals {
  impressions: number;
  taps: number;
  installs: number;
  spend: number;
  trials: number;
  paid: number;
  revenue: number;
}

export interface BidSummary {
  avg: number;
  min: number;
  max: number;
}

export const zero = (): Totals => ({ impressions: 0, taps: 0, installs: 0, spend: 0, trials: 0, paid: 0, revenue: 0 });

export const sumInto = (t: Totals, o: Totals) => {
  for (const k of Object.keys(t) as (keyof Totals)[]) t[k] += o[k];
};

export function summarizeBids(bids: (number | string | null)[]): BidSummary | null {
  const nums = bids
    .filter((b): b is number | string => b != null)
    .map(Number)
    .filter(Number.isFinite);
  if (!nums.length) return null;
  return { avg: nums.reduce((s, b) => s + b, 0) / nums.length, min: Math.min(...nums), max: Math.max(...nums) };
}
