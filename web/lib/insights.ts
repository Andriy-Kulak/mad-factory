import { adFiltersHref, dimValue, dimValueLabel, EARLY_MAX_AGE_DAYS, INSIGHT_DIMS, isInsightDim, NO_AD_FILTERS, type AdCard, type AdFilters, type InsightDim } from "./ad-cards.ts";
import type { AdRelation } from "../../src/lib/tracked-source-input.ts";

/*
 * Competitor insights: per angle, persona, hook type, format or landing page, how many ad cards use it, how many of
 * those are working, and which advertisers they come from. Two windows: all time (working = running 21+
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
  /** The row (and optionally the advertiser cell) whose ads are open below the table. */
  value: string | null;
  advertiserId: string | null;
}

export type DrillMode = "working" | "alive" | "all";

export interface InsightRow {
  value: string;
  label: string;
  ads: number;
  working: number;
  /** Still running after 21+ days (all time) or still running (last 14 days), whatever the rank: the softer signal. */
  alive: number;
  /** Share of all ads in scope. */
  adShare: number;
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

export interface Counts {
  ads: number;
  working: number;
  alive: number;
}

export interface AdvertiserColumn extends Counts {
  id: string;
  name: string;
  relation: AdRelation;
}

export interface AdvertiserMatrix {
  columns: AdvertiserColumn[];
  rows: { value: string; label: string; ads: number; cells: Record<string, Counts> }[];
}

/** One row's (or one advertiser cell's) ads, best first, split by signal. */
export interface Drill {
  label: string;
  advertiser: string | null;
  working: AdCard[];
  alive: AdCard[];
  all: AdCard[];
}

export interface WorkingHook {
  card: AdCard;
  text: string;
}

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
    view: one(sp.view) === "totals" ? "totals" : "advertisers",
    window: WINDOWS.includes(window) ? window : "all",
    relation: relation === "all" ? null : relation === "inspiration" ? "inspiration" : "competitor",
    value: one(sp.v) || null,
    advertiserId: one(sp.v) ? one(sp.adv) || null : null,
  };
}

export function insightFiltersHref(f: InsightFilters): string {
  const s = new URLSearchParams();
  if (f.dim !== "angle") s.set("tab", f.dim);
  if (f.view !== "advertisers") s.set("view", f.view);
  if (f.window !== "all") s.set("window", f.window);
  if (f.relation !== "competitor") s.set("rel", f.relation ?? "all");
  if (f.value) s.set("v", f.value);
  if (f.value && f.advertiserId) s.set("adv", f.advertiserId);
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

/** The softer signal: still running after 21+ days (all time) or simply still running (last 14 days). */
export const isAliveIn = (c: Pick<AdCard, "isActive" | "days">, window: InsightWindow) =>
  c.isActive === true && (window === "14d" || (c.days ?? 0) >= 21);

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
    return {
      value,
      label: dimValueLabel(f.dim, value),
      ads: group.length,
      working: work.length,
      alive: group.filter((c) => isAliveIn(c, f.window)).length,
      adShare,
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
    const alive = isAliveIn(card, f.window) ? 1 : 0;
    const col = columns.get(id) ?? { id, name: card.advertiserName ?? "Unknown advertiser", relation: card.relation, ads: 0, working: 0, alive: 0 };
    col.ads++;
    col.working += work;
    col.alive += alive;
    columns.set(id, col);
    const row = rows.get(value) ?? { value, label: dimValueLabel(f.dim, value), ads: 0, cells: {} };
    row.ads++;
    const cell = (row.cells[id] ??= { ads: 0, working: 0, alive: 0 });
    cell.ads++;
    cell.working += work;
    cell.alive += alive;
    rows.set(value, row);
  }
  const order = (r: AdRelation) => (r === "competitor" ? 0 : 1);
  return {
    columns: [...columns.values()].sort((a, b) => order(a.relation) - order(b.relation) || b.ads - a.ads || a.name.localeCompare(b.name)),
    rows: [...rows.values()].sort((a, b) => b.ads - a.ads || a.label.localeCompare(b.label)),
  };
}

const byRankThenRun = (a: AdCard, b: AdCard) => (a.rank?.rank ?? Infinity) - (b.rank?.rank ?? Infinity) || (b.days ?? 0) - (a.days ?? 0) || a.id.localeCompare(b.id);
const advertiserKey = (c: AdCard) => c.advertiserId ?? c.advertiserName ?? "unknown";

/** The selected row's (or advertiser cell's) ads in scope: working, still alive, and all, each best rank first. */
export function drillCards(cards: AdCard[], f: InsightFilters, now = Date.now()): Drill | null {
  if (!f.value) return null;
  const all = placed(cardsInScope(cards, f, now), f.dim)
    .filter((it) => it.value === f.value && (!f.advertiserId || advertiserKey(it.card) === f.advertiserId))
    .map((it) => it.card)
    .sort(byRankThenRun);
  return {
    label: dimValueLabel(f.dim, f.value),
    advertiser: f.advertiserId ? (all[0]?.advertiserName ?? null) : null,
    working: all.filter((c) => isWorkingIn(c, f.window)),
    alive: all.filter((c) => isAliveIn(c, f.window)),
    all,
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
export function browseHref(slug: string, f: InsightFilters, opts: { value?: string; advertiserId?: string; mode?: DrillMode } = {}): string {
  const filters: AdFilters = {
    ...NO_AD_FILTERS,
    sort: "impressions",
    view: "cards",
    relation: f.relation,
    advertisers: opts.advertiserId ? [opts.advertiserId] : [],
    launchedDays: f.window === "14d" ? EARLY_MAX_AGE_DAYS : null,
    signal: opts.mode === "working" ? (f.window === "all" ? "working" : "early") : null,
    status: opts.mode === "alive" ? "active" : null,
    minDays: opts.mode === "alive" && f.window === "all" ? 21 : null,
    by: opts.value ? f.dim : null,
    v: opts.value ?? null,
  };
  return `/p/${slug}/ads${adFiltersHref(filters)}`;
}

export const dimLabel = (dim: InsightDim) => INSIGHT_DIMS[dim];
