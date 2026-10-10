/** Pure helpers for RevenueCat Charts responses (GET /projects/{id}/charts/{chart} and .../options). */

export interface ChartOptionValue { id: string; display_name: string }
export interface ChartOptions {
  filters: { id: string; display_name: string; options?: ChartOptionValue[] }[];
  segments: { id: string; display_name: string }[];
}

export interface ChartResponse {
  measures: { display_name: string }[];
  /** Absent when the chart is not segmented. */
  segments?: { display_name: string; is_total?: boolean }[] | null;
  values: { cohort: number; measure: number; segment?: number; value: number; incomplete?: boolean }[];
}

/** RevenueCat's label for customers without Apple Ads attribution, per dimension. */
export const UNATTRIBUTED = new Set(["No campaign", "No keyword", "No Attribution"]);

/** Values of one filter, e.g. every attribution campaign RevenueCat has seen. */
export function filterValues(options: ChartOptions, filterId: string): ChartOptionValue[] {
  const f = options.filters.find((x) => x.id === filterId);
  if (!f) throw new Error(`chart has no "${filterId}" filter (available: ${options.filters.map((x) => x.id).join(", ")})`);
  return f.options ?? [];
}

export interface SegmentPoint {
  date: string;
  /** Segment label; '' for RevenueCat's "No ..." bucket. */
  segment: string;
  values: Record<string, number>;
  incomplete: boolean;
}

/** One point per (day, segment), measures keyed by display name. The "Total" segment is dropped. */
export function segmentPoints(chart: ChartResponse): SegmentPoint[] {
  const segments = chart.segments ?? null;
  const out = new Map<string, SegmentPoint>();
  for (const v of chart.values) {
    const seg = segments ? segments[v.segment ?? 0] : undefined;
    if (seg?.is_total) continue;
    const label = seg ? (UNATTRIBUTED.has(seg.display_name) ? "" : seg.display_name) : "";
    const measure = chart.measures[v.measure]?.display_name;
    if (measure == null) throw new Error(`chart value refers to unknown measure ${v.measure}`);
    const date = new Date(v.cohort * 1000).toISOString().slice(0, 10);
    const key = `${date}|${label}`;
    const p = out.get(key) ?? out.set(key, { date, segment: label, values: {}, incomplete: false }).get(key)!;
    p.values[measure] = (p.values[measure] ?? 0) + Number(v.value);
    p.incomplete ||= Boolean(v.incomplete);
  }
  return [...out.values()];
}

export function measure(p: SegmentPoint, name: string): number {
  return p.values[name] ?? 0;
}
