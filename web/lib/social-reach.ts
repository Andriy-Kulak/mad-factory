/**
 * Social reach: X and LinkedIn numbers for a product, its team and its competitors, read from a local JSON snapshot
 * (local/<slug>/social-reach.json, gitignored; nothing goes to the database). Pure math here; the loader is
 * social-reach-data.ts. ScrapeCreators gives counts only: no likers, reposters or retweeters, and LinkedIn returns at
 * most 10 comments per post.
 */

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
}

/** A looked-up commenter profile. Job titles come back masked, so the current employer is the useful field. */
export interface ReachPerson {
  url: string;
  found: boolean;
  location: string | null;
  followers: number | null;
  employer: string | null;
}

export interface SocialReachData {
  capturedAt: string;
  credits: number;
  accounts: ReachAccount[];
  posts: ReachPost[];
  comments: ReachComment[];
  people: ReachPerson[];
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
export function accountStats(data: SocialReachData, platform: ReachPlatform): AccountStats[] {
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
export function groupTotals(data: SocialReachData, platform: ReachPlatform, since: string): GroupTotals[] {
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
 * company: a company page commenting (often the poster linking its own blog). insider: works at the poster's company
 * (by looked-up employer) or talks like it ("our team"). signal: asks a question or describes their own use: the
 * comments worth a follow-up. commentary: long takes with no ask. cheer: congrats and emoji.
 */
export const COMMENT_KINDS = ["signal", "insider", "commentary", "cheer", "company"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const COMMENT_KIND_LABEL: Record<CommentKind, string> = {
  signal: "Question or own use",
  insider: "Employee or insider",
  commentary: "Long take, no ask",
  cheer: "Congrats and emoji",
  company: "Company page",
};

const INSIDER_TEXT = /\b(by our team|work by our|our team!|we('re| are) just getting started|loved working on|proud of (the|our) team|welcome to the team|great to work with)\b/i;
const OWN_USE =
  /\b(we use|we('ve| have) been using|we('re| are) using|i use|i('ve| have) been using|i('ve| have) applied|i have applied|my team (has|have|is)|our team (has|have|is) (been )?using|at our company|we tried|we switched|upgrade to our|improved our|changed our|in our (workflow|stack|codebase))\b/i;
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
  if (INSIDER_TEXT.test(text) && !text.includes("?")) return "insider";
  if (OWN_USE.test(text) || (text.includes("?") && text.length <= QUESTION_MAX)) return "signal";
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
export function commenterRows(data: SocialReachData): CommenterRow[] {
  const posts = new Map(data.posts.map((p) => [p.id, p]));
  const accounts = new Map(data.accounts.map((a) => [key(a.platform, a.handle), a]));
  const people = new Map(data.people.map((p) => [p.url, p]));
  // A team member's post counts as the company's: their colleagues commenting are insiders too.
  const companyNames = data.accounts.filter((a) => a.group === "company").map((a) => a.name);
  return data.comments.map((comment) => {
    const post = posts.get(comment.postId) ?? null;
    const account = post ? (accounts.get(key(post.platform, post.handle)) ?? null) : null;
    const person = comment.authorUrl ? people.get(comment.authorUrl) : undefined;
    const posterNames = account?.group === "competitor" ? [account.name] : [...companyNames, account?.name ?? ""];
    return { comment, post, account, person, kind: classifyComment(comment, person, posterNames), topic: post ? topicOf(post.text) : null };
  });
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One line per comment, ready for an enrichment tool: who, where they work, what they said, on which post. */
export function commentersCsv(rows: CommenterRow[]): string {
  const head = ["kind", "commenter", "profile_url", "employer", "location", "followers", "comment", "post_account", "post_topic", "post_date", "post_url"];
  const lines = rows.map((r) =>
    [
      r.kind,
      r.comment.authorName,
      r.comment.authorUrl,
      r.person?.employer,
      r.person?.location,
      r.person?.followers,
      r.comment.text,
      r.account?.name,
      r.topic ? TOPIC_LABEL[r.topic] : null,
      r.post?.postedAt?.slice(0, 10),
      r.post?.url,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[head.join(","), ...lines].join("\n")}\n`;
}
