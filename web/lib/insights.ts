import { adFiltersHref, dimValue, dimValueLabel, EARLY_MAX_AGE_DAYS, INSIGHT_DIMS, isInsightDim, NO_AD_FILTERS, type AdCard, type AdFilters, type InsightDim } from "./ad-cards.ts";
import type { AdRelation } from "../../src/lib/tracked-source-input.ts";

/*
 * Competitor insights: per angle, persona, hook type, format or landing page, how many ad cards use it, how many of
 * those are working, and whether working ads over-index on it (lift). Two windows: all time (working = running 21+
 * days and top 10 or 5+ versions) and the last 14 days (cards launched since, early signal = still running and
 * already top 10 by impressions). Pure, so it runs on server and client; the page loads every card once (lib/queries.ts).
 */

export type InsightWindow = "all" | "14d";
export type InsightView = "totals" | "advertisers";

export interface InsightFilters {
  dim: InsightDim;
  view: InsightView;
  window: InsightWindow;
  /**
   * Direct competitors (the default, since angles and personas are our product's vocabulary and adjacent niches'
   * ads mostly land in "other"), adjacent niches, or both when null (`rel=all`).
   */
  relation: AdRelation | null;
}

export interface InsightRow {
  value: string;
  label: string;
  ads: number;
  working: number;
  /** Share of all ads in scope, and of all working ads. */
  adShare: number;
  workingShare: number;
  /** workingShare ÷ adShare; null when nothing in scope is working. */
  lift: number | null;
  advertisers: number;
  /** The advertiser behind most of this row's working ads, when there are any. */
  top: { name: string; working: number } | null;
  /** Longest run among this row's ads that are still running, in days. */
  longest: number | null;
  /** Launched in the last 30 days. */
  recent: number;
}

export interface InsightTable {
  rows: InsightRow[];
  /** Ads in scope (profiled ones only, except for landing pages) and how many of them are working. */
  total: number;
  working: number;
  /** Ads in the window that the dimension can't place yet (not profiled). */
  unprofiled: number;
}

export interface AdvertiserColumn {
  id: string;
  name: string;
  relation: AdRelation;
  ads: number;
  working: number;
}

export interface AdvertiserMatrix {
  columns: AdvertiserColumn[];
  rows: { value: string; label: string; ads: number; cells: Record<string, { ads: number; working: number }> }[];
}

export interface WorkingHook {
  card: AdCard;
  text: string;
}

export const LOW_N = 3;
const DAY_MS = 86_400_000;
const WINDOWS: InsightWindow[] = ["all", "14d"];

export type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export function parseInsightFilters(sp: SearchParams): InsightFilters {
  const dim = one(sp.tab);
  const window = one(sp.window) as InsightWindow;
  const relation = one(sp.rel);
  return {
    dim: isInsightDim(dim) ? dim : "angle",
    view: one(sp.view) === "advertisers" ? "advertisers" : "totals",
    window: WINDOWS.includes(window) ? window : "all",
    relation: relation === "all" ? null : relation === "inspiration" ? "inspiration" : "competitor",
  };
}

export function insightFiltersHref(f: InsightFilters): string {
  const s = new URLSearchParams();
  if (f.dim !== "angle") s.set("tab", f.dim);
  if (f.view !== "totals") s.set("view", f.view);
  if (f.window !== "all") s.set("window", f.window);
  if (f.relation !== "competitor") s.set("rel", f.relation ?? "all");
  const str = s.toString();
  return str ? `?${str}` : "?";
}

const since = (days: number, now: number) => new Date(now - days * DAY_MS).toISOString().slice(0, 10);

/** Cards in the window and relation; the 14-day window keeps only cards launched since. */
export function cardsInScope(cards: AdCard[], f: Pick<InsightFilters, "window" | "relation">, now = Date.now()): AdCard[] {
  const from = f.window === "14d" ? since(EARLY_MAX_AGE_DAYS, now) : null;
  return cards.filter((c) => (!f.relation || c.relation === f.relation) && (!from || (c.startDate != null && c.startDate.slice(0, 10) >= from)));
}

/** Working in the all-time window, early signal in the 14-day window. */
export const isWorkingIn = (c: Pick<AdCard, "signal">, window: InsightWindow) => c.signal === (window === "all" ? "working" : "early");

function placed(cards: AdCard[], dim: InsightDim): { card: AdCard; value: string }[] {
  return cards.flatMap((card) => {
    const value = dimValue(card, dim);
    return value == null ? [] : [{ card, value }];
  });
}

export function insightTable(cards: AdCard[], f: InsightFilters, now = Date.now()): InsightTable {
  const scoped = cardsInScope(cards, f, now);
  const items = placed(scoped, f.dim);
  const recentFrom = since(30, now);
  const total = items.length;
  const working = items.filter((it) => isWorkingIn(it.card, f.window)).length;
  const groups = new Map<string, AdCard[]>();
  for (const it of items) groups.set(it.value, [...(groups.get(it.value) ?? []), it.card]);

  const rows = [...groups].map(([value, group]): InsightRow => {
    const work = group.filter((c) => isWorkingIn(c, f.window));
    const byAdvertiser = new Map<string, number>();
    for (const c of work) byAdvertiser.set(c.advertiserName ?? "Unknown advertiser", (byAdvertiser.get(c.advertiserName ?? "Unknown advertiser") ?? 0) + 1);
    const [topName, topCount] = [...byAdvertiser].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
    const running = group.filter((c) => c.isActive === true && c.days != null).map((c) => c.days!);
    const adShare = group.length / total;
    const workingShare = working ? work.length / working : 0;
    return {
      value,
      label: dimValueLabel(f.dim, value),
      ads: group.length,
      working: work.length,
      adShare,
      workingShare,
      lift: working ? workingShare / adShare : null,
      advertisers: new Set(group.map((c) => c.advertiserId ?? c.advertiserName)).size,
      top: topName ? { name: topName, working: topCount! } : null,
      longest: running.length ? Math.max(...running) : null,
      recent: group.filter((c) => c.startDate != null && c.startDate.slice(0, 10) >= recentFrom).length,
    };
  });
  rows.sort((a, b) => b.working - a.working || b.ads - a.ads || a.label.localeCompare(b.label));
  return { rows, total, working, unprofiled: scoped.length - total };
}

/** Rows × advertisers: ads and working ads per cell. Direct competitors come first, then adjacent niches, each by size. */
export function advertiserMatrix(cards: AdCard[], f: InsightFilters, now = Date.now()): AdvertiserMatrix {
  const items = placed(cardsInScope(cards, f, now), f.dim);
  const columns = new Map<string, AdvertiserColumn>();
  const rows = new Map<string, AdvertiserMatrix["rows"][number]>();
  for (const { card, value } of items) {
    const id = card.advertiserId ?? card.advertiserName ?? "unknown";
    const work = isWorkingIn(card, f.window) ? 1 : 0;
    const col = columns.get(id) ?? { id, name: card.advertiserName ?? "Unknown advertiser", relation: card.relation, ads: 0, working: 0 };
    col.ads++;
    col.working += work;
    columns.set(id, col);
    const row = rows.get(value) ?? { value, label: dimValueLabel(f.dim, value), ads: 0, cells: {} };
    row.ads++;
    const cell = (row.cells[id] ??= { ads: 0, working: 0 });
    cell.ads++;
    cell.working += work;
    rows.set(value, row);
  }
  const order = (r: AdRelation) => (r === "competitor" ? 0 : 1);
  return {
    columns: [...columns.values()].sort((a, b) => order(a.relation) - order(b.relation) || b.ads - a.ads || a.name.localeCompare(b.name)),
    rows: [...rows.values()].sort((a, b) => b.ads - a.ads || a.label.localeCompare(b.label)),
  };
}

/** Working (or early-signal) cards with a profiled hook line, best impressions rank first. */
export function workingHooks(cards: AdCard[], f: InsightFilters, limit = 12, now = Date.now()): WorkingHook[] {
  return cardsInScope(cards, f, now)
    .filter((c) => isWorkingIn(c, f.window) && c.profile?.hook)
    .sort((a, b) => (a.rank?.rank ?? Infinity) - (b.rank?.rank ?? Infinity) || (b.days ?? 0) - (a.days ?? 0))
    .slice(0, limit)
    .map((card) => ({ card, text: card.profile!.hook! }));
}

/** Competitor ads URL for the cards behind a count: same window and relation, this row's value, optionally working only. */
export function browseHref(slug: string, f: InsightFilters, opts: { value?: string; advertiserId?: string; workingOnly?: boolean } = {}): string {
  const filters: AdFilters = {
    ...NO_AD_FILTERS,
    sort: "impressions",
    view: "cards",
    relation: f.relation,
    advertisers: opts.advertiserId ? [opts.advertiserId] : [],
    launchedDays: f.window === "14d" ? EARLY_MAX_AGE_DAYS : null,
    signal: opts.workingOnly ? (f.window === "all" ? "working" : "early") : null,
    by: opts.value ? f.dim : null,
    v: opts.value ?? null,
  };
  return `/p/${slug}/ads${adFiltersHref(filters)}`;
}

export const dimLabel = (dim: InsightDim) => INSIGHT_DIMS[dim];
