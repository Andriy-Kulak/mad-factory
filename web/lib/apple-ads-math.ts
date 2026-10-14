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

export const APPLE_ADS_RANGES = [2, 7, 14, 28, 90];

function isoDay(value?: string): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

export function parseAppleRange(sp: { days?: string; from?: string; to?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const from = isoDay(sp.from);
  const to = isoDay(sp.to) ?? today;
  const custom = from != null && from <= to;
  const requested = Number(sp.days);
  const days = APPLE_ADS_RANGES.includes(requested) ? requested : 28;
  return {
    since: custom ? from : new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10),
    until: custom ? to : today,
    days,
    custom,
  };
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
