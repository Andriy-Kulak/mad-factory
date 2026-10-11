import { daysBetween } from "./format.ts";
import type { AdRelation } from "../../src/lib/tracked-source-input.ts";

/*
 * Competitor ad cards: grouping Ad Library rows into one card per collation (Meta's "N ads use this creative"),
 * plus the filters, sorts and URL format the Competitor ads browser uses. Pure, so it runs on server and client.
 */

export interface ImpressionRank {
  rank: number;
  prevRank: number | null;
  observedAt: string;
}

export const WINNER_MAX_RANK = 10;
export const WINNER_MIN_DAYS = 21;
const DAY_MS = 86_400_000;

/** One Ad Library row as the loader reads it (lib/queries.ts competitorAds). */
export interface AdSourceRow {
  id: string;
  /** Ad Library id (ad_archive_id). */
  externalId: string;
  advertiserId: string | null;
  advertiserName: string | null;
  avatarUrl: string | null;
  body: string | null;
  title: string | null;
  cta: string | null;
  linkUrl: string | null;
  /** Display link Meta shows under the media, e.g. "example.com". */
  caption: string | null;
  format: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean | null;
  platforms: string[];
  collationId: string | null;
  collationCount: number | null;
  firstSeenAt: string;
  media: { url: string; type: string; sha256: string } | null;
  /** Direct competitor or adjacent niche, from the tracked source that surfaced the ad. */
  relation: AdRelation;
}

export interface AdCard extends AdSourceRow {
  rank: ImpressionRank | null;
  winner: boolean;
  /** Ads sharing this card's collation (Meta's own count when larger than what we stored). */
  versions: number;
  /** Days from start to end (or today while running). */
  days: number | null;
  /** Every stored ad in the card's group; the card counts as a favorite when any of them is starred. */
  memberIds: string[];
}

/** Winner = top-ranked by impressions in its latest scrape, still running, and running for weeks. */
export function isWinner(ad: { isActive: boolean | null; startDate: string | null }, rank: ImpressionRank | null | undefined, now = Date.now()): boolean {
  if (!rank || rank.rank > WINNER_MAX_RANK || ad.isActive !== true) return false;
  return (daysSince(ad.startDate, now) ?? 0) >= WINNER_MIN_DAYS;
}

function daysSince(date: string | null, now: number): number | null {
  if (!date) return null;
  return Math.max(0, Math.round((now - Date.parse(date.length === 10 ? `${date}T12:00:00Z` : date)) / DAY_MS));
}

/**
 * One card per collation group; ads without a collation stand alone. The card shows the group's best-ranked ad
 * (else the most recently started one).
 */
export function groupAdCards(rows: AdSourceRow[], ranks: Map<string, ImpressionRank>, now = Date.now()): AdCard[] {
  const groups = new Map<string, AdSourceRow[]>();
  for (const r of rows) {
    const key = r.collationId ? `c:${r.collationId}` : `a:${r.id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((g) => {
    const rep = [...g].sort((a, b) => (ranks.get(a.id)?.rank ?? Infinity) - (ranks.get(b.id)?.rank ?? Infinity) || (b.startDate ?? "").localeCompare(a.startDate ?? ""))[0]!;
    const rank = ranks.get(rep.id) ?? null;
    return {
      ...rep,
      rank,
      winner: isWinner(rep, rank, now),
      versions: Math.max(g.length, ...g.map((r) => r.collationCount ?? 1)),
      days: rep.startDate ? (daysBetween(rep.startDate, rep.isActive ? null : rep.endDate) ?? null) : null,
      memberIds: g.map((r) => r.id),
    };
  });
}

export type AdSort = "impressions" | "newest" | "longest" | "variants";
export type AdStatus = "active" | "ended";
export type AdFormat = "video" | "image";
export type AdView = "cards" | "table";

export interface AdFilters {
  /** Direct competitors or adjacent niches; both when null. */
  relation: AdRelation | null;
  /** advertiser ids; all when empty. */
  advertisers: string[];
  q: string;
  status: AdStatus | null;
  format: AdFormat | null;
  winners: boolean;
  favorites: boolean;
  /** Launched within the last N days. */
  launchedDays: number | null;
  /** Running for at least N days. */
  minDays: number | null;
  sort: AdSort;
  view: AdView;
}

export type SearchParams = Record<string, string | string[] | undefined>;

export const NO_AD_FILTERS: Omit<AdFilters, "sort" | "view"> = { relation: null, advertisers: [], q: "", status: null, format: null, winners: false, favorites: false, launchedDays: null, minDays: null };
const SORTS: AdSort[] = ["impressions", "newest", "longest", "variants"];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);
const posInt = (v: string | string[] | undefined) => {
  const n = Number(one(v));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

export function parseAdFilters(sp: SearchParams): AdFilters {
  const sort = one(sp.sort) as AdSort;
  const status = one(sp.status) || (one(sp.active) === "yes" ? "active" : one(sp.active) === "no" ? "ended" : "");
  const format = one(sp.format);
  const relation = one(sp.rel);
  return {
    relation: relation === "competitor" || relation === "inspiration" ? relation : null,
    advertisers: many(sp.adv),
    q: one(sp.q),
    status: status === "active" || status === "ended" ? status : null,
    format: format === "video" || format === "image" ? format : null,
    winners: one(sp.winners) === "1",
    favorites: one(sp.fav) === "1",
    launchedDays: posInt(sp.launched),
    minDays: posInt(sp.mindays),
    sort: SORTS.includes(sort) ? sort : "impressions",
    view: one(sp.view) === "table" ? "table" : "cards",
  };
}

/** Query string for `f`; defaults are left out so URLs stay short. */
export function adFiltersHref(f: AdFilters): string {
  const s = new URLSearchParams();
  if (f.relation) s.set("rel", f.relation);
  for (const a of f.advertisers) s.append("adv", a);
  if (f.q) s.set("q", f.q);
  if (f.status) s.set("status", f.status);
  if (f.format) s.set("format", f.format);
  if (f.winners) s.set("winners", "1");
  if (f.favorites) s.set("fav", "1");
  if (f.launchedDays) s.set("launched", String(f.launchedDays));
  if (f.minDays) s.set("mindays", String(f.minDays));
  if (f.sort !== "impressions") s.set("sort", f.sort);
  if (f.view !== "cards") s.set("view", f.view);
  const str = s.toString();
  return str ? `?${str}` : "?";
}

export function activeAdFilterCount(f: AdFilters): number {
  return [!!f.relation, f.advertisers.length > 0, !!f.q, !!f.status, !!f.format, f.winners, f.favorites, !!f.launchedDays, !!f.minDays].filter(Boolean).length;
}

export const mediaFormat = (c: Pick<AdCard, "media" | "format">): AdFormat | null =>
  c.media ? (c.media.type === "image" ? "image" : "video") : c.format === "IMAGE" ? "image" : c.format === "VIDEO" ? "video" : null;

/** `favorites` holds starred ad ids; a card matches the favorites filter when any ad in its group is starred. */
export function applyAdFilters(cards: AdCard[], f: AdFilters, now = Date.now(), favorites: ReadonlySet<string> = new Set()): AdCard[] {
  const advertisers = new Set(f.advertisers);
  const q = f.q.toLowerCase();
  const since = f.launchedDays ? new Date(now - f.launchedDays * DAY_MS).toISOString().slice(0, 10) : null;
  return cards.filter((c) =>
    (!f.relation || c.relation === f.relation) &&
    (!advertisers.size || advertisers.has(c.advertiserId ?? "")) &&
    (!q || [c.body, c.title, c.advertiserName, c.caption].some((s) => s?.toLowerCase().includes(q))) &&
    (!f.status || (f.status === "active" ? c.isActive === true : c.isActive === false)) &&
    (!f.format || mediaFormat(c) === f.format) &&
    (!f.winners || c.winner) &&
    (!f.favorites || c.memberIds.some((id) => favorites.has(id))) &&
    (!since || (c.startDate != null && c.startDate.slice(0, 10) >= since)) &&
    (!f.minDays || (c.days ?? 0) >= f.minDays),
  );
}

const byStartDesc = (a: AdCard, b: AdCard) => (b.startDate ?? "").localeCompare(a.startDate ?? "") || a.id.localeCompare(b.id);

/**
 * impressions = best Ad Library rank first, unranked after by launch date; newest = latest launch first;
 * longest = running ads first, earliest start first; variants = most versions first.
 */
export function sortAdCards(cards: AdCard[], sort: AdSort): AdCard[] {
  return [...cards].sort((a, b) => {
    if (sort === "newest") return byStartDesc(a, b);
    if (sort === "variants") return b.versions - a.versions || (a.rank?.rank ?? Infinity) - (b.rank?.rank ?? Infinity) || byStartDesc(a, b);
    if (sort === "longest") {
      const active = (v: boolean | null) => (v === true ? 0 : v === false ? 1 : 2);
      return active(a.isActive) - active(b.isActive) || (b.days ?? -1) - (a.days ?? -1) || a.id.localeCompare(b.id);
    }
    const ra = a.rank?.rank ?? Infinity;
    const rb = b.rank?.rank ?? Infinity;
    return ra === rb ? byStartDesc(a, b) : ra - rb;
  });
}

/** Hook line: the headline if it isn't a Meta template, else the first clean line of body copy. */
export function hookOf(ad: { title: string | null; body: string | null; advertiserName: string | null }): string {
  const clean = (v: string | null) => (v ?? "").split("\n").map((s) => s.trim()).find((s) => s && !s.includes("{{"));
  return clean(ad.title) ?? clean(ad.body) ?? ad.advertiserName ?? "Untitled";
}

/** Meta templates ({{product.name}}) aren't real copy. */
export const cleanText = (v: string | null) => (v && !v.includes("{{") ? v.trim() : null);
