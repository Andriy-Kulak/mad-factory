import type { OrganicPost, OrganicSort } from "./social.ts";

export type Range = { min: number | null; max: number | null };
export type AgeUnit = "days" | "weeks" | "months";
export type OrganicView = "grid" | "table";

export interface OrganicFilters {
  /** social_accounts ids; all accounts when empty. */
  channels: string[];
  q: string;
  platform: string | null;
  outlier: Range;
  views: Range;
  /** Percent, e.g. 2.5 for 2.5%. */
  engagement: Range;
  postedWithin: { n: number; unit: AgeUnit } | null;
  favorites: boolean;
  sort: OrganicSort;
  view: OrganicView;
}

export type SearchParams = Record<string, string | string[] | undefined>;

/** Posts rendered per page of the grid; more load as the list scrolls. */
export const PAGE_SIZE = 60;
const SORTS: OrganicSort[] = ["outlier", "views", "newest", "engagement"];
export const DEFAULT_ORGANIC_SORT: OrganicSort = "newest";
const UNITS: AgeUnit[] = ["days", "weeks", "months"];
const DAY_MS = 86_400_000;
const UNIT_DAYS: Record<AgeUnit, number> = { days: 1, weeks: 7, months: 30 };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);

/** Accepts "3", "3x", "10,000", "2.5%", "10k", "1.5m"; blank or junk is null. */
export function parseNum(v: string | string[] | undefined): number | null {
  const s = one(v)
    .replace(/[,%x×\s]/gi, "")
    .toLowerCase();
  if (!s) return null;
  const mult = s.endsWith("k") ? 1e3 : s.endsWith("m") ? 1e6 : 1;
  const n = Number(mult === 1 ? s : s.slice(0, -1)) * mult;
  return Number.isFinite(n) ? n : null;
}

export function parseOrganicFilters(sp: SearchParams): OrganicFilters {
  const sort = one(sp.sort) as OrganicSort;
  const unit = one(sp.unit) as AgeUnit;
  const age = parseNum(sp.age);
  return {
    channels: many(sp.ch),
    q: one(sp.q),
    platform: one(sp.platform) || null,
    outlier: { min: parseNum(sp.omin), max: parseNum(sp.omax) },
    views: { min: parseNum(sp.vmin), max: parseNum(sp.vmax) },
    engagement: { min: parseNum(sp.emin), max: parseNum(sp.emax) },
    postedWithin: age && age > 0 ? { n: age, unit: UNITS.includes(unit) ? unit : "months" } : null,
    favorites: one(sp.fav) === "1",
    sort: SORTS.includes(sort) ? sort : DEFAULT_ORGANIC_SORT,
    view: one(sp.view) === "table" ? "table" : "grid",
  };
}

/** A post with no value for a metric fails any bound set on that metric. */
function inRange(v: number | null, r: Range): boolean {
  if (r.min == null && r.max == null) return true;
  if (v == null) return false;
  return (r.min == null || v >= r.min) && (r.max == null || v <= r.max);
}

/** `favorites` holds starred post ids. */
export function applyOrganicFilters(posts: OrganicPost[], f: OrganicFilters, now = Date.now(), favorites: ReadonlySet<string> = new Set()): OrganicPost[] {
  const channels = new Set(f.channels);
  const q = f.q.toLowerCase();
  const since = f.postedWithin ? now - f.postedWithin.n * UNIT_DAYS[f.postedWithin.unit] * DAY_MS : null;
  return posts.filter(
    (p) =>
      (!channels.size || channels.has(p.account.id)) &&
      (!f.platform || p.account.platform === f.platform) &&
      (!q || (p.caption ?? "").toLowerCase().includes(q)) &&
      (!f.favorites || favorites.has(p.id)) &&
      inRange(p.outlier, f.outlier) &&
      inRange(p.views, f.views) &&
      inRange(p.engagement == null ? null : p.engagement * 100, f.engagement) &&
      (since == null || (p.postedAt != null && Date.parse(p.postedAt) >= since)),
  );
}

export const NO_FILTERS: Omit<OrganicFilters, "sort" | "view"> = {
  channels: [],
  q: "",
  platform: null,
  outlier: { min: null, max: null },
  views: { min: null, max: null },
  engagement: { min: null, max: null },
  postedWithin: null,
  favorites: false,
};

export function sortPosts(posts: OrganicPost[], sort: OrganicSort): OrganicPost[] {
  const key = (p: OrganicPost) => (sort === "views" ? p.views : sort === "outlier" ? p.outlier : sort === "engagement" ? p.engagement : null);
  return [...posts].sort((a, b) => (sort === "newest" ? (b.postedAt ?? "").localeCompare(a.postedAt ?? "") : (key(b) ?? -1) - (key(a) ?? -1) || (b.views ?? -1) - (a.views ?? -1)));
}

/** Number of filters that narrow the posts (sort and view don't count). */
export function activeFilterCount(f: OrganicFilters): number {
  const ranges = [f.outlier, f.views, f.engagement].filter((r) => r.min != null || r.max != null).length;
  return (f.channels.length ? 1 : 0) + (f.q ? 1 : 0) + (f.platform ? 1 : 0) + (f.postedWithin ? 1 : 0) + (f.favorites ? 1 : 0) + ranges;
}

/** Query string for `f` with `patch` applied; defaults are left out so URLs stay short. */
export function organicHref(f: OrganicFilters, patch: Partial<OrganicFilters> = {}): string {
  const n = { ...f, ...patch };
  const s = new URLSearchParams();
  for (const id of n.channels) s.append("ch", id);
  if (n.q) s.set("q", n.q);
  if (n.platform) s.set("platform", n.platform);
  const range = (min: string, max: string, r: Range) => {
    if (r.min != null) s.set(min, String(r.min));
    if (r.max != null) s.set(max, String(r.max));
  };
  range("omin", "omax", n.outlier);
  range("vmin", "vmax", n.views);
  range("emin", "emax", n.engagement);
  if (n.postedWithin) {
    s.set("age", String(n.postedWithin.n));
    s.set("unit", n.postedWithin.unit);
  }
  if (n.favorites) s.set("fav", "1");
  if (n.sort !== DEFAULT_ORGANIC_SORT) s.set("sort", n.sort);
  if (n.view !== "grid") s.set("view", n.view);
  const str = s.toString();
  return str ? `?${str}` : "?";
}

/** "now", "5h ago", "3d ago", "2w ago", "4mo ago", "2y ago". */
export function fmtAgoShort(v: string | null | undefined, now = Date.now()): string {
  if (!v) return "";
  const h = Math.max(0, (now - Date.parse(v)) / 3_600_000);
  if (h < 1) return "now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
