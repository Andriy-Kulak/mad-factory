const at = (starredAt: Record<string, string>, id: string) => {
  const t = Date.parse(starredAt[id] ?? "");
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * Orders items by their latest starred-at timestamp, descending; an item's stamp is the newest `starredAt` across
 * `idsOf(item)` (a grouped ad card's stamp is the max of its member ad ids). Items with no starred-at go last and
 * equal stamps keep input order (sort is stable). Returns a new array.
 */
export function byRecentlyStarred<T>(items: T[], idsOf: (item: T) => string[], starredAt: Record<string, string>): T[] {
  const scored = items.map((item) => ({ item, t: Math.max(-Infinity, ...idsOf(item).map((id) => at(starredAt, id))) }));
  scored.sort((a, b) => b.t - a.t);
  return scored.map((s) => s.item);
}
