/**
 * B2B Social: X and LinkedIn numbers for a product, its team and its competitors, read from a local JSON snapshot
 * (local/<slug>/b2b-social.json, gitignored; nothing goes to the database). Pure math here; the loader is
 * b2b-social-data.ts. ScrapeCreators gives counts only: no likers, reposters or retweeters, and LinkedIn returns at
 * most 10 comments per post.
 */

import { fitOf, gradeRank, intentOf, personaOf, routeOf, type Fit, type Intent, type Persona, type Route } from "./b2b-social-grade.ts";

export type ReachPlatform = "x" | "linkedin";
/** company = the product's own account, team = people who work there, competitor = everyone else tracked. */
export type ReachGroup = "company" | "team" | "competitor";
export type ReachFormat = "video" | "image" | "link" | "text";

export interface ReachAccount {
  platform: ReachPlatform;
  handle: string;
  name: string;
  url: string;
  group: ReachGroup;
  followers: number | null;
  employees?: number | null;
  /** X returns about the last week for company accounts ("recent") and ~100 top tweets for people ("popular"). */
  sample: "recent" | "popular";
}

export interface ReachPost {
  platform: ReachPlatform;
  id: string;
  /** The account's handle. */
  handle: string;
  url: string;
  text: string;
  postedAt: string | null;
  format: ReachFormat;
  isReply?: boolean;
  /** Null when the source doesn't report it (LinkedIn has no views; listed LinkedIn posts have no counts at all). */
  views: number | null;
  likes: number | null;
  comments: number | null;
  reposts: number | null;
  quotes: number | null;
  bookmarks: number | null;
}

export interface ReachComment {
  postId: string;
  authorName: string | null;
  authorUrl: string | null;
  text: string;
  /** Link to this comment itself (X replies have one; LinkedIn's data has no comment id, so only the post links). */
  url?: string | null;
  /** When it was written, when the source says (X does; LinkedIn does not). */
  postedAt?: string | null;
}

/** A looked-up commenter profile. LinkedIn masks job titles, so `title` comes from a separate enrichment when present. */
export interface ReachPerson {
  url: string;
  found: boolean;
  location: string | null;
  followers: number | null;
  employer: string | null;
  /** The employer's LinkedIn page, the key into `companies`. */
  employerUrl?: string | null;
  title?: string | null;
  /** For a person found on X: their matched LinkedIn profile and X bio. */
  linkedinUrl?: string | null;
  bio?: string | null;
}

/** An employer's LinkedIn page: size bucket ("10,001+ employees"), members on LinkedIn, and its Fortune 500 rank if any. */
export interface ReachCompany {
  url: string;
  name: string;
  domain: string | null;
  size: string | null;
  employees: number | null;
  industry: string | null;
  fortune500: number | null;
  /** Y Combinator batch ("W24") when the employer is a YC company. */
  yc?: string | null;
}

export interface B2BSocialData {
  capturedAt: string;
  credits: number;
  accounts: ReachAccount[];
  posts: ReachPost[];
  comments: ReachComment[];
  people: ReachPerson[];
  companies?: ReachCompany[];
}

export function median(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
}

const max = (values: (number | null)[]): number | null => values.reduce<number | null>((m, v) => (v != null && (m == null || v > m) ? v : m), null);

export interface AccountStats {
  account: ReachAccount;
  posts: number;
  /** Posts with numbers (LinkedIn posts without a detail fetch have none). */
  measured: number;
  first: string | null;
  last: string | null;
  medianViews: number | null;
  topViews: number | null;
  medianLikes: number | null;
  medianComments: number | null;
  medianBookmarks: number | null;
  /** Median views divided by followers: how far a typical post travels beyond the audience. */
  viewsPerFollower: number | null;
  /** Median likes per 1,000 followers, for LinkedIn where there are no views. */
  likesPer1k: number | null;
}

const key = (platform: ReachPlatform, handle: string) => `${platform}:${handle}`;

/** Originals only: replies are measured separately (they get a fraction of the views). */
export function accountStats(data: B2BSocialData, platform: ReachPlatform): AccountStats[] {
  const byAccount = new Map<string, ReachPost[]>();
  for (const p of data.posts) if (p.platform === platform && !p.isReply) byAccount.set(key(p.platform, p.handle), [...(byAccount.get(key(p.platform, p.handle)) ?? []), p]);
  return data.accounts
    .filter((a) => a.platform === platform)
    .map((account) => {
      const posts = byAccount.get(key(platform, account.handle)) ?? [];
      const measured = posts.filter((p) => p.likes != null || p.views != null);
      const dates = posts
        .map((p) => p.postedAt)
        .filter((d): d is string => !!d)
        .sort();
      const medianViews = median(measured.map((p) => p.views));
      const medianLikes = median(measured.map((p) => p.likes));
      return {
        account,
        posts: posts.length,
        measured: measured.length,
        first: dates[0] ?? null,
        last: dates.at(-1) ?? null,
        medianViews,
        topViews: max(measured.map((p) => p.views)),
        medianLikes,
        medianComments: median(measured.map((p) => p.comments)),
        medianBookmarks: median(measured.map((p) => p.bookmarks)),
        viewsPerFollower: medianViews != null && account.followers ? medianViews / account.followers : null,
        likesPer1k: medianLikes != null && account.followers ? (medianLikes / account.followers) * 1000 : null,
      };
    });
}

export interface GroupTotals {
  group: ReachGroup;
  accounts: number;
  followers: number;
  /** Accounts with at least one original post since `since`. */
  active: number;
  posts: number;
  views: number;
  likes: number;
  top: ReachPost | null;
}

export const GROUP_LABEL: Record<ReachGroup, string> = { company: "Company accounts", team: "Team", competitor: "Competitors" };

/** Followers per group, and what each group's original posts since `since` added up to. */
export function groupTotals(data: B2BSocialData, platform: ReachPlatform, since: string): GroupTotals[] {
  const groupOf = new Map(data.accounts.filter((a) => a.platform === platform).map((a) => [a.handle, a.group]));
  const out = new Map<ReachGroup, GroupTotals>();
  const row = (group: ReachGroup) => {
    if (!out.has(group)) out.set(group, { group, accounts: 0, followers: 0, active: 0, posts: 0, views: 0, likes: 0, top: null });
    return out.get(group)!;
  };
  for (const a of data.accounts) {
    if (a.platform !== platform) continue;
    const r = row(a.group);
    r.accounts++;
    r.followers += a.followers ?? 0;
  }
  const active = new Set<string>();
  for (const p of data.posts) {
    const group = groupOf.get(p.handle);
    if (p.platform !== platform || !group || p.isReply || !p.postedAt || p.postedAt < since) continue;
    const r = row(group);
    r.posts++;
    r.views += p.views ?? 0;
    r.likes += p.likes ?? 0;
    if (!r.top || (p.views ?? p.likes ?? 0) > (r.top.views ?? r.top.likes ?? 0)) r.top = p;
    if (!active.has(p.handle)) {
      active.add(p.handle);
      r.active++;
    }
  }
  return (["company", "team", "competitor"] as const).flatMap((g) => (out.has(g) ? [out.get(g)!] : []));
}

export const TOPICS = ["hire", "funding", "acquisition", "partnership", "launch", "customer", "event", "other"] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABEL: Record<Topic, string> = {
  hire: "Hires and welcomes",
  funding: "Funding and milestones",
  acquisition: "Acquisition",
  partnership: "Partnership",
  launch: "Launch",
  customer: "Customer story",
  event: "Events and culture",
  other: "Opinion and other",
};

const TOPIC_RULES: [Topic, RegExp][] = [
  ["launch", /^\s*introducing\b/i],
  ["hire", /(\b(has joined|have joined|joins (us|our|the)|joined (us|the team)|thrilled to welcome|excited to welcome|please welcome)\b|^welcome\b)/im],
  ["funding", /\b(raised|raising|valuation|series [a-h]\b|run[- ]rate|funding round|\$\d[\d.,]*\s?(b|bn|billion)\b)/i],
  ["acquisition", /\b(acquir(e|es|ed|ing)|acquisition of|is now part of|joining forces)\b/i],
  ["partnership", /\b(partnered|partnering|partnership with|team(s|ed)? up)\b/i],
  [
    "launch",
    /\b(introducing|is (now )?available|now available|launch(ed|ing)?|is here|now (natively )?(supports|works|has|lets|live)|rolling out|starting today|new:|today we('re| are)? (releasing|shipping|announcing))\b/i,
  ],
  ["customer", /(case study|read the (full )?story|customer stor|\/customers\/|\b\d+(\.\d+)?x['’]?ed\b|\b\d+(\.\d+)?x (more|faster|increase)|\b\d[\d,]* engineers\b)/i],
  ["event", /\b(behind the scenes|offsite|retreat|summit|keynote|on stage|the stage|conference|hackathon|meetup|headquarters|sponsor)\b/i],
];

/** First matching rule wins; the order puts company news ahead of the launch words it often contains. */
export function topicOf(text: string): Topic {
  for (const [topic, re] of TOPIC_RULES) if (re.test(text)) return topic;
  return "other";
}

export interface BreakdownRow {
  key: string;
  posts: number;
  medianViews: number | null;
  medianLikes: number | null;
  medianComments: number | null;
  medianBookmarks: number | null;
}

/** Measured posts grouped by `by`, largest groups first. */
export function breakdown(posts: ReachPost[], by: (p: ReachPost) => string): BreakdownRow[] {
  const groups = new Map<string, ReachPost[]>();
  for (const p of posts) if (p.likes != null || p.views != null) groups.set(by(p), [...(groups.get(by(p)) ?? []), p]);
  return [...groups.entries()]
    .map(([k, ps]) => ({
      key: k,
      posts: ps.length,
      medianViews: median(ps.map((p) => p.views)),
      medianLikes: median(ps.map((p) => p.likes)),
      medianComments: median(ps.map((p) => p.comments)),
      medianBookmarks: median(ps.map((p) => p.bookmarks)),
    }))
    .sort((a, b) => b.posts - a.posts);
}

/**
 * company: a company page commenting (often the poster linking its own blog). insider: works at the poster's company or
 * the tracked company (by looked-up employer or a tracked team profile) or talks like it ("our team"). The three signal
 * kinds are the comments worth a follow-up: using (describes their own use), pain (a complaint about price, limits or
 * reliability, most useful on a competitor's post) and evaluating (a short question or a comparison). commentary: long
 * takes with no ask. cheer: congrats and emoji.
 */
export const COMMENT_KINDS = ["using", "pain", "evaluating", "insider", "commentary", "cheer", "company"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];
export const SIGNAL_KINDS: readonly CommentKind[] = ["using", "pain", "evaluating"];
export const isSignal = (kind: CommentKind) => SIGNAL_KINDS.includes(kind);

export const COMMENT_KIND_LABEL: Record<CommentKind, string> = {
  using: "Already using",
  pain: "Pain or complaint",
  evaluating: "Question or evaluating",
  insider: "Employee or insider",
  commentary: "Long take, no ask",
  cheer: "Congrats and emoji",
  company: "Company page",
};

const INSIDER_TEXT = /\b(by our team|work by our|our team!|we('re| are) just getting started|loved working on|proud of (the|our) team|welcome to the team|great to work with)\b/i;
/** A vendor's support staff answering in the thread. */
const VENDOR_SUPPORT = /\b(sorry about that|should be resolved now|we('re| are) looking into (it|this)|please (dm|email) (us|support)|reach out to (our )?support)\b/i;
const USING =
  /\b(we use|we('ve| have) been using|we('re| are) using|i use|i('ve| have) been using|i('ve| have) applied|i have applied|my team (has|have|is)|our team (has|have|is) (been )?using|at our company|we tried|we switched|upgrade to our|improved our|changed our|in our (workflow|stack|codebase))\b/i;
const PAIN =
  /\b(price (hike|increase)|nuked|too expensive|expensive|costly|confusing|rate[- ]limit(s|ed)?|usage limits?|hit (the|my|a) limit|quota|too slow|so slow|broken|buggy|unusable|cancel(l?ed|ling)?|switch(ed|ing)? (to|from|away)|downgrad\w*|frustrat\w*|disappointed|regress\w*|outage|keeps (failing|crashing)|worse than)\b/i;
const EVALUATING = /\b(compare[ds]?|compared to|vs\.?|versus|alternative to|advantage over|does it (work|support|handle)|can it|any plans|on the roadmap|is there a way|how (does|do|can|is))\b/i;
/** Long comments with a question mark are usually rhetorical takes; a real question is short. */
const QUESTION_MAX = 220;

export function normalizeName(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function classifyComment(comment: ReachComment, person: ReachPerson | undefined, posterNames: string[]): CommentKind {
  if (comment.authorUrl && /\/(company|school)\//.test(comment.authorUrl)) return "company";
  const employer = normalizeName(person?.employer ?? null);
  if (employer && posterNames.some((n) => n && normalizeName(n) === employer)) return "insider";
  const text = comment.text.trim();
  if ((INSIDER_TEXT.test(text) && !text.includes("?")) || VENDOR_SUPPORT.test(text)) return "insider";
  if (USING.test(text)) return "using";
  if (PAIN.test(text)) return "pain";
  if (EVALUATING.test(text) || (text.includes("?") && text.length <= QUESTION_MAX)) return "evaluating";
  return text.length >= 160 ? "commentary" : "cheer";
}

export interface CommenterRow {
  comment: ReachComment;
  post: ReachPost | null;
  account: ReachAccount | null;
  person: ReachPerson | undefined;
  kind: CommentKind;
  topic: Topic | null;
}

/** Every comment joined to its post, the account that posted it and the commenter's profile when looked up. */
export function commenterRows(data: B2BSocialData): CommenterRow[] {
  const posts = new Map(data.posts.map((p) => [p.id, p]));
  const accounts = new Map(data.accounts.map((a) => [key(a.platform, a.handle), a]));
  const people = new Map(data.people.map((p) => [p.url, p]));
  // The tracked company's people never count as leads, wherever they comment, and neither do the poster's colleagues.
  const companyNames = data.accounts.filter((a) => a.group === "company").map((a) => a.name);
  const teamUrls = new Set(data.accounts.filter((a) => a.group !== "competitor").map((a) => a.url.toLowerCase()));
  return data.comments.map((comment) => {
    const post = posts.get(comment.postId) ?? null;
    const account = post ? (accounts.get(key(post.platform, post.handle)) ?? null) : null;
    const person = comment.authorUrl ? people.get(comment.authorUrl) : undefined;
    const posterNames = [...companyNames, account?.name ?? ""];
    const ownProfile = comment.authorUrl && /\/in\//.test(comment.authorUrl) && teamUrls.has(comment.authorUrl.toLowerCase());
    const kind = ownProfile ? "insider" : classifyComment(comment, person, posterNames);
    return { comment, post, account, person, kind, topic: post ? topicOf(post.text) : null };
  });
}

export const SENIORITIES = ["exec", "vp", "director", "manager", "senior", "ic", "unknown"] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const SENIORITY_LABEL: Record<Seniority, string> = {
  exec: "C-level or founder",
  vp: "VP",
  director: "Director or head",
  manager: "Manager or lead",
  senior: "Senior or staff",
  ic: "Individual contributor",
  unknown: "Unknown",
};

const SENIORITY_RULES: [Seniority, RegExp][] = [
  ["exec", /\b(chief|ceo|cto|cio|ciso|cfo|coo|cpo|cmo|cro|founder|co-founder|cofounder|(?<!vice[ -])president|managing partner|general partner)\b/i],
  ["vp", /\b(svp|evp|avp|vp|vice president)\b/i],
  ["director", /\b(director|head of|head,|global head|managing director)\b/i],
  ["manager", /\b(manager|lead|leader|architect|supervisor|product owner)\b/i],
  ["senior", /\b(senior|sr\.?|staff|principal|distinguished)\b/i],
  ["ic", /\b(engineer|developer|analyst|consultant|scientist|designer|specialist|associate|programmer|intern|student)\b/i],
];

/** First matching rule wins, top-down, so "Senior Director" is a director and "Platform Lead - SVP" a VP. */
export function seniorityOf(title: string | null | undefined): Seniority {
  if (!title) return "unknown";
  for (const [level, re] of SENIORITY_RULES) if (re.test(title)) return level;
  return "unknown";
}

export type CompanyTier = "fortune500" | "enterprise" | "yc" | "other";

export const COMPANY_TIER_LABEL: Record<CompanyTier, string> = { fortune500: "Fortune 500", enterprise: "10k+ employees", yc: "YC startup", other: "Smaller company" };
export const isEnterprise = (tier: CompanyTier) => tier === "fortune500" || tier === "enterprise";

/** Fortune 500 by rank; otherwise enterprise when LinkedIn puts it in the 10,001+ bucket or lists 10k+ members. */
/** LinkedIn's catch-all pages ("Self-Employed" lists 10,001+ employees) are not employers. */
const NOT_AN_EMPLOYER = /^(self[- ]?employed|freelance\w*|stealth\w*( startup| mode)?|confidential|independent( consultant)?|retired|open to work)$/i;

export function companyTier(company: ReachCompany | undefined): CompanyTier {
  if (!company || NOT_AN_EMPLOYER.test(company.name.trim())) return "other";
  if (company.fortune500 != null) return "fortune500";
  if (/10,?001\+/.test(company.size ?? "") || (company.employees ?? 0) >= 10_000) return "enterprise";
  if (company.yc) return "yc";
  return "other";
}

const SENIORITY_WEIGHT: Record<Seniority, number> = { exec: 5, vp: 4, director: 3, manager: 2, senior: 1.5, ic: 1, unknown: 1 };
const TIER_WEIGHT: Record<CompanyTier, number> = { fortune500: 3, enterprise: 2, yc: 1.5, other: 1 };
const KIND_WEIGHT: Record<CommentKind, number> = { using: 3, pain: 3, evaluating: 2.5, commentary: 1.5, cheer: 1, insider: 0, company: 0 };

export interface Lead {
  url: string;
  name: string;
  person: ReachPerson | undefined;
  company: ReachCompany | undefined;
  tier: CompanyTier;
  seniority: Seniority;
  /** Their comments, strongest kind first. */
  touches: CommenterRow[];
  /** Highest touch kind. */
  kind: CommentKind;
  lastAt: string | null;
  score: number;
}

/**
 * One row per outside person who commented: company tier x seniority x the strongest thing they said, with a bonus for
 * the last 30 days (relative to the snapshot). Insiders and company pages are left out. `since` keeps only comments on
 * posts from that date on.
 */
export function leads(data: B2BSocialData, since: string | null = null): Lead[] {
  const companies = new Map((data.companies ?? []).map((c) => [c.url, c]));
  const recentSince = new Date(Date.parse(data.capturedAt) - 30 * 86_400_000).toISOString();
  const byPerson = new Map<string, CommenterRow[]>();
  for (const row of commenterRows(data)) {
    const key = row.comment.authorUrl ?? row.comment.authorName;
    if (!key || row.kind === "insider" || row.kind === "company") continue;
    // LinkedIn gives no comment dates, so the post's date stands in for when they commented.
    if (since && (row.post?.postedAt ?? "") < since) continue;
    byPerson.set(key, [...(byPerson.get(key) ?? []), row]);
  }
  return [...byPerson.entries()]
    .map(([url, touches]) => {
      const sorted = [...touches].sort((a, b) => KIND_WEIGHT[b.kind] - KIND_WEIGHT[a.kind]);
      const person = sorted[0]!.person;
      const company = person?.employerUrl ? companies.get(person.employerUrl) : undefined;
      const tier = companyTier(company);
      const seniority = seniorityOf(person?.title);
      const kind = sorted[0]!.kind;
      const lastAt =
        touches
          .map((t) => t.post?.postedAt ?? "")
          .sort()
          .at(-1) || null;
      const recency = lastAt && lastAt >= recentSince ? 1.5 : 1;
      const repeat = 1 + 0.25 * (touches.length - 1);
      return {
        url,
        name: sorted[0]!.comment.authorName ?? "Unknown",
        person,
        company,
        tier,
        seniority,
        touches: sorted,
        kind,
        lastAt,
        score: Math.round(TIER_WEIGHT[tier] * SENIORITY_WEIGHT[seniority] * KIND_WEIGHT[kind] * recency * repeat * 10) / 10,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export const OUTREACH_REASONS = ["switching", "using", "asking", "evaluating", "senior"] as const;
export type OutreachReason = (typeof OUTREACH_REASONS)[number];

export const OUTREACH_REASON_LABEL: Record<OutreachReason, string> = {
  switching: "Unhappy with a competitor",
  using: "Already a user",
  asking: "Asked about the product",
  evaluating: "Weighing a competitor",
  senior: "Senior person at a big company",
};

export interface Outreach {
  lead: Lead;
  reason: OutreachReason;
  /** The comment that makes it worth reaching out. */
  touch: CommenterRow;
  /** Where to message them: LinkedIn when known, else their X profile. */
  profileUrl: string;
  xUrl: string | null;
  opener: string;
  persona: Persona;
  fit: Fit;
  intent: Intent;
  route: Route;
  /** Other people from the same company in the list. */
  colleagues: number;
}

const quote = (text: string, max = 90) => {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
};

/** A first line a rep could send, built only from what the person said and where. */
function openerFor(reason: OutreachReason, touch: CommenterRow, lead: Lead, ownName: string): string {
  const where = touch.account?.name ?? "a post";
  const said = quote(touch.comment.text);
  const at = lead.company?.name ?? lead.person?.employer;
  switch (reason) {
    case "switching":
      return `Saw your reply on ${where}'s post ("${said}"). If that change is pushing you to look around, happy to show how ${ownName} handles it${at ? ` for teams like ${at}` : ""}.`;
    case "using":
      return `Thanks for sharing how you use ${ownName} ("${said}"). Would love 15 minutes to hear what's working${at ? ` at ${at}` : ""} and what would help it go further.`;
    case "asking":
      return `You asked "${said}" on ${where}'s post. Quick answer and a 15-minute walkthrough if useful?`;
    case "evaluating":
      return `Noticed your question on ${where}'s post ("${said}"). If you're comparing options, happy to share how ${ownName} stacks up.`;
    case "senior":
      return `Noticed you engaged with ${where}'s post on ${TOPIC_LABEL[touch.topic ?? "other"].toLowerCase()}. Curious how ${at ?? "your team"} is thinking about it; open to a quick chat?`;
  }
}

/**
 * The short list a rep acts on: outside people with a reason to reach out now. A signal on a competitor's post is a
 * switching or evaluating moment; on the company's own posts it's a user or a question; a senior person at a big company
 * qualifies even without a signal. Each gets a Fit × Intent grade and a route (b2b-social-grade.ts), best grade first.
 */
export function outreach(data: B2BSocialData, since: string | null = null): Outreach[] {
  const ownName = data.accounts.find((a) => a.group === "company")?.name ?? "us";
  const picked: { lead: Lead; reason: OutreachReason }[] = [];
  for (const lead of leads(data, since)) {
    // Only people a rep can identify and reach; brand and bot accounts (1M+ followers) are not leads.
    if (!lead.person?.title && !lead.company && !lead.person?.employer) continue;
    if ((lead.person?.followers ?? 0) >= 1_000_000) continue;
    const onCompetitor = lead.touches[0]!.account?.group === "competitor";
    const seniorBig = isEnterprise(lead.tier) && ["exec", "vp", "director", "manager"].includes(lead.seniority);
    let reason: OutreachReason | null = null;
    if (lead.kind === "using") reason = "using";
    else if (lead.kind === "pain") reason = onCompetitor ? "switching" : "asking";
    else if (lead.kind === "evaluating") reason = onCompetitor ? "evaluating" : "asking";
    else if (seniorBig) reason = "senior";
    if (reason) picked.push({ lead, reason });
  }
  const companyKey = (lead: Lead) => normalizeName(lead.company?.name ?? lead.person?.employer ?? "");
  const perCompany = new Map<string, number>();
  for (const { lead } of picked) if (companyKey(lead)) perCompany.set(companyKey(lead), (perCompany.get(companyKey(lead)) ?? 0) + 1);
  return picked
    .map(({ lead, reason }) => {
      const touch = lead.touches[0]!;
      const persona = personaOf(lead.seniority);
      const colleagues = companyKey(lead) ? (perCompany.get(companyKey(lead)) ?? 1) - 1 : 0;
      const fit = fitOf(lead.tier, persona, !!(lead.company || lead.person?.employer));
      const intent = intentOf({ kind: lead.kind, signals: lead.touches.filter((t) => isSignal(t.kind)).length, colleagues: colleagues + 1, lastAt: lead.lastAt, capturedAt: data.capturedAt });
      return {
        lead,
        reason,
        touch,
        profileUrl: lead.person?.linkedinUrl ?? lead.url,
        xUrl: /^https:\/\/x\.com\//.test(lead.url) ? lead.url : null,
        opener: openerFor(reason, touch, lead, ownName),
        persona,
        fit,
        intent,
        route: routeOf(fit, intent),
        colleagues,
      };
    })
    .sort((a, b) => gradeRank(a.fit, a.intent) - gradeRank(b.fit, b.intent) || (b.lead.lastAt ?? "").localeCompare(a.lead.lastAt ?? ""));
}
