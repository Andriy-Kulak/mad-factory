export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Views relative to the account's median views: 1 = typical post, 5 = something worked. */
export function outlierScore(views: number | null, accountMedian: number | null): number | null {
  if (views == null || !accountMedian) return null;
  return views / accountMedian;
}

/** (likes + comments + shares + saves) / views, counting only the interactions the platform reports. */
export function engagementRate(
  views: number | null,
  likes: number | null,
  comments: number | null,
  shares: number | null = null,
  saves: number | null = null,
): number | null {
  const parts = [likes, comments, shares, saves];
  if (!views || parts.every((v) => v == null)) return null;
  return parts.reduce<number>((sum, v) => sum + (v ?? 0), 0) / views;
}

/** The newest snapshot and the newest one from an earlier day, for "since last sync" deltas. */
export function snapshotPair<T extends { captured_on: string; source?: string }>(rows: T[]): { latest: T | null; previous: T | null } {
  const latest = latestSnapshot(rows);
  if (!latest) return { latest: null, previous: null };
  return { latest, previous: latestSnapshot(rows.filter((r) => r.captured_on < latest.captured_on)) };
}

/** Sum that stays null when every value is missing, so "no data" never renders as 0. */
export function sumKnown(values: (number | null)[]): number | null {
  return values.some((v) => v != null) ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null;
}

/** Newest snapshot first; on the same day an official-API snapshot beats a scraped one. */
export function latestSnapshot<T extends { captured_on: string; source?: string }>(rows: T[]): T | null {
  return [...rows].sort((a, b) => b.captured_on.localeCompare(a.captured_on) || (a.source === "api" ? -1 : b.source === "api" ? 1 : 0))[0] ?? null;
}
