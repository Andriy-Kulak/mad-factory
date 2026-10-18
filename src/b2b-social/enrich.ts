import { existsSync, readFileSync } from "node:fs";

/**
 * Pure helpers for the B2B Social sync: when a post's comments are due, a job from an X bio, and the Fortune 500 and
 * YC tags. The two lists are public files kept outside the repo (local/reference/), read when present.
 */

/** Comments are fetched once per post, this long after posting (most replies are in by then). */
export const COMMENT_DELAY_HOURS = 48;
/** X recent search only reaches 7 days back; LinkedIn has no limit, so stop at 14 to keep costs flat. */
export const COMMENT_WINDOW_DAYS = { x: 7, linkedin: 14 } as const;

/** Due when the post is old enough, still inside its window, and has not been checked since it got old enough. */
export function commentsDue(post: { platform: "x" | "linkedin"; posted_at: string | null; replies_checked_at: string | null }, now: Date): boolean {
  if (!post.posted_at) return false;
  const posted = Date.parse(post.posted_at);
  const readyAt = posted + COMMENT_DELAY_HOURS * 3_600_000;
  const closesAt = posted + COMMENT_WINDOW_DAYS[post.platform] * 86_400_000;
  if (now.getTime() < readyAt || now.getTime() > closesAt) return false;
  return !post.replies_checked_at || Date.parse(post.replies_checked_at) < readyAt;
}

/** "Head of Platform at Example Labs" or "eng @Sample | …" → title and company; former roles are ignored. */
export function bioJob(bio: string | null | undefined): { title: string; company: string } | null {
  for (const part of String(bio ?? "").split(/[|•·\n]/)) {
    const m = part.match(/^\s*(.{2,60}?)\s+(?:@|at)\s?@?([A-Z][\w&.-]*(?:\s[A-Z][\w&.-]*){0,2})/);
    if (m && !/^(ex|former|prev)/i.test(m[1]!)) {
      return {
        title: m[1]!.trim(),
        company: m[2]!
          .split(/\.\s/)[0]!
          .replace(/hq$/i, "")
          .replace(/[.,;:]+$/, "")
          .trim(),
      };
    }
  }
  return null;
}

export function normalizeCompany(name: string | null | undefined): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|inc|corp|corporation|company|co|group|holdings|plc|llc|ltd|financial|platforms)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ALIASES: Record<string, string> = {
  adp: "automatic data processing",
  citi: "citigroup",
  jpmorgan: "jpmorgan chase",
  google: "alphabet",
  aws: "amazon",
  "amazon web services": "amazon",
};

/** Rank by normalized company name ("Rank,Company Name,…" CSV); null when the file is missing or no match. */
export function fortune500Matcher(csvPath: string | null): (company: string | null | undefined) => number | null {
  if (!csvPath || !existsSync(csvPath)) return () => null;
  const byName = new Map<string, number>();
  for (const line of readFileSync(csvPath, "utf8").trim().split("\n").slice(1)) {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "")) ?? [];
    const rank = Number(cells[0]);
    if (rank && cells[1]) byName.set(normalizeCompany(cells[1]), rank);
  }
  return (company) => {
    const n = normalizeCompany(company);
    if (!n) return null;
    return byName.get(ALIASES[n] ? normalizeCompany(ALIASES[n]) : n) ?? null;
  };
}

export function host(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:/.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** YC batch by website domain only (names collide across companies); the yc-oss companies JSON. */
export function ycMatcher(jsonPath: string | null): (domain: string | null | undefined) => string | null {
  if (!jsonPath || !existsSync(jsonPath)) return () => null;
  const byDomain = new Map<string, string>();
  for (const c of JSON.parse(readFileSync(jsonPath, "utf8")) as { website?: string; batch?: string }[]) {
    const d = host(c.website);
    if (d && c.batch) byDomain.set(d, c.batch);
  }
  return (domain) => (domain ? (byDomain.get(domain.toLowerCase()) ?? null) : null);
}

/** LinkedIn activity ids carry their creation time (ms since epoch) in the top bits. */
export function activityTime(id: string): string | null {
  if (!/^\d{15,25}$/.test(id)) return null;
  return new Date(Number(BigInt(id) >> 22n)).toISOString();
}

export function canonicalLinkedIn(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/(^|\.)linkedin\.com$/.test(u.hostname)) return null;
    return `https://www.linkedin.com${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
