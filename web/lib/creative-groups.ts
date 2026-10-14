/*
 * Creatives tab: the slim per-media fields the browser needs, grouping by one profile field, and the filters and URL
 * format. Pure, so it runs on server and client. The loader is lib/creatives.ts; the full profile (transcript,
 * mechanism, people…) loads on demand when a creative is opened.
 */

/** Competitor run length: long = 30+ days, stopped = ended within 14 days. */
export type RunBucket = "long" | "mid" | "stopped";
/** Ours, a direct competitor's, or an adjacent niche's (tracked for inspiration). */
export type Owner = "own" | "competitor" | "inspiration";
export const OWNERS: Owner[] = ["own", "competitor", "inspiration"];

export interface CreativeFields {
  angle: string | null;
  angle_suggestion: string | null;
  audience: string | null;
  hook_type: string | null;
  awareness: string | null;
  response: string | null;
  format: string | null;
  style: string | null;
  structure: string | null;
}

export interface CreativeItem {
  sha256: string;
  mediaType: string;
  url: string | null;
  owner: Owner;
  /** Own ad name(s), or the competitor's advertiser. */
  source: string;
  days: number | null;
  active: boolean | null;
  bucket: RunBucket | null;
  hook: { spoken: string | null; onscreen: string | null; visual: string | null };
  fields: CreativeFields;
}

/** Fields the tab can group by. */
export const GROUP_FIELDS = {
  angle: { label: "Angle", get: (f: CreativeFields) => f.angle },
  audience: { label: "Persona", get: (f: CreativeFields) => f.audience },
  hook: { label: "Hook type", get: (f: CreativeFields) => f.hook_type },
  awareness: { label: "Awareness", get: (f: CreativeFields) => f.awareness },
  response: { label: "Strategic response", get: (f: CreativeFields) => f.response },
  format: { label: "Format", get: (f: CreativeFields) => f.format },
  style: { label: "Visual style", get: (f: CreativeFields) => f.style },
  structure: { label: "Script structure", get: (f: CreativeFields) => f.structure },
} as const;

export type GroupKey = keyof typeof GROUP_FIELDS;
export const groupValue = (item: CreativeItem, by: GroupKey) => GROUP_FIELDS[by].get(item.fields) ?? "none";

export interface GroupRow {
  value: string;
  total: number;
  own: number;
  competitor: number;
  inspiration: number;
  long: number;
  stopped: number;
}

export function groupItems(items: CreativeItem[], by: GroupKey): GroupRow[] {
  const rows = new Map<string, GroupRow>();
  for (const item of items) {
    const value = groupValue(item, by);
    const row = rows.get(value) ?? { value, total: 0, own: 0, competitor: 0, inspiration: 0, long: 0, stopped: 0 };
    row.total++;
    row[item.owner]++;
    if (item.bucket === "long") row.long++;
    if (item.bucket === "stopped") row.stopped++;
    rows.set(value, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));
}

/** `90d` = competitor media that ran 90+ days, a subset of `long`. */
export const LONG_RUN_DAYS = 90;
export type RunFilter = "long" | "90d" | "stopped" | "live";

export interface CreativeFilters {
  owner: Owner | null;
  /** Competitor advertisers (CreativeItem.source); all when empty. */
  sources: string[];
  run: RunFilter | null;
  q: string;
  /** The breakdown table's dimension, and the row picked in it (narrows the grid). */
  by: GroupKey;
  value: string | null;
}

export type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);

export function parseCreativeFilters(sp: SearchParams): CreativeFilters {
  const owner = one(sp.owner);
  const run = one(sp.run);
  const by = one(sp.by);
  return {
    owner: (OWNERS as string[]).includes(owner) ? (owner as Owner) : null,
    sources: many(sp.src),
    run: run === "long" || run === "90d" || run === "stopped" || run === "live" ? run : null,
    q: one(sp.q),
    by: by in GROUP_FIELDS ? (by as GroupKey) : "angle",
    value: one(sp.v) || null,
  };
}

export function creativeFiltersHref(f: CreativeFilters): string {
  const s = new URLSearchParams();
  if (f.owner) s.set("owner", f.owner);
  for (const src of f.sources) s.append("src", src);
  if (f.run) s.set("run", f.run);
  if (f.q) s.set("q", f.q);
  if (f.by !== "angle") s.set("by", f.by);
  if (f.value) s.set("v", f.value);
  const str = s.toString();
  return str ? `?${str}` : "?";
}

export const NO_CREATIVE_FILTERS = { owner: null, sources: [], run: null, q: "", value: null } satisfies Partial<CreativeFilters>;

export function activeCreativeFilterCount(f: CreativeFilters): number {
  return [!!f.owner, f.sources.length > 0, !!f.run, !!f.q, !!f.value].filter(Boolean).length;
}

/** Everything except the picked breakdown row, so the breakdown table can show counts across all its values. */
export function applyScopeFilters(items: CreativeItem[], f: CreativeFilters): CreativeItem[] {
  const sources = new Set(f.sources);
  const q = f.q.toLowerCase();
  return items.filter(
    (it) =>
      (!f.owner || it.owner === f.owner) &&
      (!sources.size || sources.has(it.source)) &&
      (!f.run || runMatches(it, f.run)) &&
      (!q || [it.hook.spoken, it.hook.onscreen, it.hook.visual, it.source].some((s) => s?.toLowerCase().includes(q))),
  );
}

function runMatches(it: CreativeItem, run: RunFilter): boolean {
  if (run === "live") return it.active === true;
  if (run === "90d") return it.bucket === "long" && (it.days ?? 0) >= LONG_RUN_DAYS;
  return it.bucket === run;
}

export function applyCreativeFilters(items: CreativeItem[], f: CreativeFilters): CreativeItem[] {
  const scoped = applyScopeFilters(items, f);
  return f.value ? scoped.filter((it) => groupValue(it, f.by) === f.value) : scoped;
}

/** "grow-with-confidence" → "Grow with confidence". */
export function labelOf(slug: string | null | undefined): string {
  if (!slug) return "–";
  const words = slug.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
