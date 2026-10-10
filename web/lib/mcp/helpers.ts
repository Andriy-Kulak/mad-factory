import { relative, resolve, sep } from "node:path";
import { DEFAULT_WINDOW_DAYS } from "../../../src/scorecard/overview.ts";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));

/** The last `days` complete days (through yesterday, UTC) unless from/to are given. */
export function dayRange({ days, from, to }: { days?: number; from?: string; to?: string }, now = new Date()) {
  const until = to ?? addDays(isoDay(now), -1);
  return { since: from ?? addDays(until, -((days ?? DEFAULT_WINDOW_DAYS) - 1)), until };
}

export const DOC_DIRS = ["playbooks", "docs"];
export const DOC_EXT = /\.(md|txt|json)$/;

/** The absolute path of a repo-relative doc inside DOC_DIRS, or null (no `..`, no absolute paths, no other folders). */
export function docPath(path: string, root: string): string | null {
  const abs = resolve(root, path);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel === "" || !DOC_DIRS.includes(rel.split(sep)[0]) || !DOC_EXT.test(rel)) return null;
  return abs;
}
