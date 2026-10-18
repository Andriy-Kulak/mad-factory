/**
 * The B2B Social people list: one slim row per person worth a message, the filters over them, the URL that keeps them,
 * the watched-accounts summary and the CSV export. Pure; the page computes rows on the server and filters in the browser.
 */
import {
  COMPANY_TIER_LABEL,
  OUTREACH_REASON_LABEL,
  OUTREACH_REASONS,
  SENIORITIES,
  SENIORITY_LABEL,
  commenterRows,
  isEnterprise,
  outreach,
  type CompanyTier,
  type OutreachReason,
  type ReachGroup,
  type ReachPlatform,
  type B2BSocialData,
  type Seniority,
} from "./b2b-social.ts";
import { PERSONA_LABEL, ROUTE_LABEL, type Fit, type Intent, type Persona, type Route } from "./b2b-social-grade.ts";

export interface PersonRow {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  tier: CompanyTier;
  /** "Fortune 500 #21", "10k+ employees", "YC W24", or null for other companies. */
  tierLabel: string | null;
  seniority: Seniority;
  reason: OutreachReason;
  quote: string;
  platform: ReachPlatform;
  postUrl: string | null;
  postDate: string | null;
  /** The reply itself on X; null on LinkedIn, which only links to the post. */
  commentUrl: string | null;
  commentDate: string | null;
  account: string | null;
  accountName: string | null;
  accountGroup: ReachGroup | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  location: string | null;
  howWeKnow: string;
  opener: string;
  persona: Persona;
  fit: Fit;
  intent: Intent;
  /** "A1" … "C3". */
  grade: string;
  route: Route;
  /** Other people from the same company in the list. */
  colleagues: number;
  /** Other comments by the same person. */
  more: number;
}

function howWeKnow(url: string, linkedinUrl: string | null | undefined, title: string | null | undefined, employer: string | null | undefined): string {
  if (/linkedin\.com\/in\//.test(url)) return title ? "Employer from their LinkedIn profile, title from Exa" : "Employer from their LinkedIn profile";
  if (linkedinUrl) return "X account matched to their LinkedIn with Exa";
  if (title || employer) return "From their X bio";
  return "Unknown";
}

export function personRows(data: B2BSocialData): PersonRow[] {
  return outreach(data).map(({ lead, touch, reason, opener, xUrl, persona, fit, intent, route, colleagues }) => {
    const company = lead.company;
    return {
      id: lead.url,
      name: lead.name,
      title: lead.person?.title ?? null,
      company: company?.name ?? lead.person?.employer ?? null,
      tier: lead.tier,
      tierLabel: company?.fortune500 ? `Fortune 500 #${company.fortune500}` : lead.tier === "enterprise" ? "10k+ employees" : company?.yc ? `YC ${company.yc}` : null,
      seniority: lead.seniority,
      reason,
      quote: touch.comment.text,
      platform: touch.post?.platform ?? (xUrl ? "x" : "linkedin"),
      postUrl: touch.post?.url ?? null,
      postDate: touch.post?.postedAt ?? null,
      commentUrl: touch.comment.url ?? null,
      commentDate: touch.comment.postedAt ?? null,
      account: touch.account?.handle ?? null,
      accountName: touch.account?.name ?? null,
      accountGroup: touch.account?.group ?? null,
      linkedinUrl: lead.person?.linkedinUrl ?? (/linkedin\.com\/in\//.test(lead.url) ? lead.url : null),
      xUrl,
      location: lead.person?.location ?? null,
      howWeKnow: howWeKnow(lead.url, lead.person?.linkedinUrl, lead.person?.title, lead.person?.employer),
      opener,
      persona,
      fit,
      intent,
      grade: `${fit}${intent}`,
      route,
      colleagues,
      more: lead.touches.length - 1,
    };
  });
}

export const WINDOWS = ["7", "30", "all"] as const;
export type Window = (typeof WINDOWS)[number];
export const COMPANY_FILTERS = ["", "enterprise", "fortune500", "yc", "other"] as const;
export type CompanyFilter = (typeof COMPANY_FILTERS)[number];
export const COMPANY_FILTER_LABEL: Record<CompanyFilter, string> = { "": "Any size", enterprise: "Fortune 500 and 10k+", fortune500: "Fortune 500", yc: "YC", other: "Smaller" };
export const LEVEL_FILTERS = ["", "manager", "director"] as const;
export type LevelFilter = (typeof LEVEL_FILTERS)[number];
export const LEVEL_FILTER_LABEL: Record<LevelFilter, string> = { "": "Any level", manager: "Manager and up", director: "Director and up" };

export const ROUTE_FILTERS = ["", "now", "selfserve", "nurture"] as const;
export type RouteFilter = (typeof ROUTE_FILTERS)[number];

export interface PeopleFilters {
  window: Window;
  route: RouteFilter;
  reason: OutreachReason | "";
  company: CompanyFilter;
  level: LevelFilter;
  source: ReachPlatform | "";
  account: string;
  q: string;
}

export const NO_PEOPLE_FILTERS: PeopleFilters = { window: "7", route: "", reason: "", company: "", level: "", source: "", account: "", q: "" };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const pick = <T extends string>(v: string, allowed: readonly T[], fallback: T): T => ((allowed as readonly string[]).includes(v) ? (v as T) : fallback);

export function parsePeopleFilters(sp: SearchParams): PeopleFilters {
  return {
    window: pick(one(sp.days), WINDOWS, "7"),
    route: pick(one(sp.route), ROUTE_FILTERS, ""),
    reason: pick(one(sp.why), ["", ...OUTREACH_REASONS], ""),
    company: pick(one(sp.co), COMPANY_FILTERS, ""),
    level: pick(one(sp.lvl), LEVEL_FILTERS, ""),
    source: pick(one(sp.src), ["", "x", "linkedin"], ""),
    account: one(sp.acct),
    q: one(sp.q),
  };
}

export function peopleFiltersHref(f: PeopleFilters): string {
  const s = new URLSearchParams();
  if (f.window !== "7") s.set("days", f.window);
  if (f.route) s.set("route", f.route);
  if (f.reason) s.set("why", f.reason);
  if (f.company) s.set("co", f.company);
  if (f.level) s.set("lvl", f.level);
  if (f.source) s.set("src", f.source);
  if (f.account) s.set("acct", f.account);
  if (f.q) s.set("q", f.q);
  return `?${s.toString()}`;
}

export function windowSince(capturedAt: string, window: Window): string | null {
  return window === "all" ? null : new Date(Date.parse(capturedAt) - Number(window) * 86_400_000).toISOString();
}

const LEVEL_MIN: Record<Exclude<LevelFilter, "">, number> = { manager: SENIORITIES.indexOf("manager"), director: SENIORITIES.indexOf("director") };

/** Everything but the time window and search, for counting quick views inside the current window. */
export function matchesPeopleFilters(row: PersonRow, f: PeopleFilters, since: string | null): boolean {
  if (since && (row.postDate ?? "") < since) return false;
  if (f.route && row.route !== f.route) return false;
  if (f.reason && row.reason !== f.reason) return false;
  if (f.company === "enterprise" && !isEnterprise(row.tier)) return false;
  if (f.company && f.company !== "enterprise" && row.tier !== f.company) return false;
  if (f.level && SENIORITIES.indexOf(row.seniority) > LEVEL_MIN[f.level]) return false;
  if (f.source && row.platform !== f.source) return false;
  if (f.account && row.account !== f.account) return false;
  if (f.q) {
    const hay = [row.name, row.title, row.company, row.quote, row.accountName].join(" ").toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

export function filterPeople(rows: PersonRow[], f: PeopleFilters, capturedAt: string): PersonRow[] {
  const since = windowSince(capturedAt, f.window);
  return rows.filter((r) => matchesPeopleFilters(r, f, since));
}

/** The funnel strip for a window: how many comments were collected, how many of their authors we could identify. */
export function funnel(data: B2BSocialData, window: Window): { comments: number; identified: number } {
  const since = windowSince(data.capturedAt, window);
  const people = new Map(data.people.map((p) => [p.url, p]));
  const authors = new Set<string>();
  let comments = 0;
  for (const row of commenterRows(data)) {
    if (since && (row.post?.postedAt ?? "") < since) continue;
    comments++;
    const url = row.comment.authorUrl;
    const p = url ? people.get(url) : undefined;
    if (url && row.kind !== "insider" && row.kind !== "company" && (p?.title || p?.employer)) authors.add(url);
  }
  return { comments, identified: authors.size };
}

export interface WatchedAccount {
  handle: string;
  name: string;
  url: string;
  platform: ReachPlatform;
  group: ReachGroup;
  /** Posts whose comments were collected. */
  posts: number;
  /** Outside people who commented. */
  people: number;
  worth: number;
}

/** Accounts whose posts' comments were actually collected, with what each one produced. */
export function watchedAccounts(data: B2BSocialData, rows: PersonRow[]): WatchedAccount[] {
  const byAccount = new Map<string, { posts: Set<string>; people: Set<string> }>();
  for (const row of commenterRows(data)) {
    if (!row.account || !row.post) continue;
    const key = `${row.account.platform}:${row.account.handle}`;
    const cur = byAccount.get(key) ?? { posts: new Set(), people: new Set() };
    cur.posts.add(row.post.id);
    if (row.comment.authorUrl && row.kind !== "insider" && row.kind !== "company") cur.people.add(row.comment.authorUrl);
    byAccount.set(key, cur);
  }
  const order: Record<ReachGroup, number> = { company: 0, team: 1, competitor: 2 };
  return data.accounts
    .filter((a) => byAccount.has(`${a.platform}:${a.handle}`))
    .map((a) => {
      const stats = byAccount.get(`${a.platform}:${a.handle}`)!;
      return {
        handle: a.handle,
        name: a.name,
        url: a.url,
        platform: a.platform,
        group: a.group,
        posts: stats.posts.size,
        people: stats.people.size,
        worth: rows.filter((r) => r.account === a.handle && r.platform === a.platform).length,
      };
    })
    .sort((a, b) => order[a.group] - order[b.group] || b.worth - a.worth || b.people - a.people);
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The filtered list as a CSV for an enrichment tool: who, where, why, what they said, and the opener. */
export function peopleCsv(rows: PersonRow[]): string {
  const head = [
    "name",
    "title",
    "level",
    "company",
    "company_tier",
    "reason",
    "what_they_said",
    "comment_url",
    "source",
    "on_post_by",
    "post_date",
    "post_url",
    "linkedin_url",
    "x_url",
    "location",
    "opener",
    "grade",
    "route",
    "persona",
  ];
  const lines = rows.map((r) =>
    [
      r.name,
      r.title,
      SENIORITY_LABEL[r.seniority],
      r.company,
      r.tierLabel ?? COMPANY_TIER_LABEL[r.tier],
      OUTREACH_REASON_LABEL[r.reason],
      r.quote,
      r.commentUrl,
      r.platform === "x" ? "X" : "LinkedIn",
      r.accountName,
      r.postDate?.slice(0, 10),
      r.postUrl,
      r.linkedinUrl,
      r.xUrl,
      r.location,
      r.opener,
      r.grade,
      ROUTE_LABEL[r.route],
      PERSONA_LABEL[r.persona],
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[head.join(","), ...lines].join("\n")}\n`;
}
