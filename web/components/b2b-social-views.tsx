import type { ReactNode } from "react";
import { DataTable, type Row } from "@/components/data-table";
import { Badge, ButtonLink, buttonClass, Card, Empty, NameCell, Pair, SectionHead, Segmented, Stat, type BadgeTone } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import {
  accountStats,
  breakdown,
  COMMENT_KIND_LABEL,
  COMMENT_KINDS,
  commenterRows,
  GROUP_LABEL,
  groupTotals,
  topicOf,
  TOPIC_LABEL,
  COMPANY_TIER_LABEL,
  isEnterprise,
  isSignal,
  outreach,
  OUTREACH_REASON_LABEL,
  OUTREACH_REASONS,
  type OutreachReason,
  leadAccounts,
  leads,
  SENIORITIES,
  SENIORITY_LABEL,
  type BreakdownRow,
  type CommentKind,
  type CompanyTier,
  type Seniority,
  type ReachGroup,
  type ReachPost,
  median,
  type B2BSocialData,
} from "@/lib/b2b-social";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const num = (v: number | null | undefined) => (v == null ? "–" : compact.format(v));
const ratio = (v: number | null) => (v == null ? "–" : v < 10 ? v.toFixed(2) : compact.format(v));

const GROUP_TONE: Record<ReachGroup, BadgeTone> = { company: "accent", team: "green", competitor: "neutral" };
const GROUP_VIEWS = [
  { key: "all", label: "All" },
  { key: "company", label: "Company" },
  { key: "team", label: "Team" },
  { key: "competitor", label: "Competitors" },
];

function Wrap({ children, width = "min-w-[320px] max-w-[560px]" }: { children: ReactNode; width?: string }) {
  return <span className={`block whitespace-normal leading-snug ${width}`}>{children}</span>;
}

const snippet = (text: string, max = 180) => {
  // By code point, so an emoji is never cut in half (a lone surrogate breaks hydration).
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("") || "(no text)";
};

function BreakdownTable({ rows, label, views }: { rows: BreakdownRow[]; label: (key: string) => string; views: boolean }) {
  return (
    <DataTable
      columns={[
        { label: "Group" },
        { label: "Posts", align: "right" },
        ...(views ? [{ label: "Median views", align: "right" as const }] : []),
        { label: "Median likes", align: "right" },
        { label: views ? "Median bookmarks" : "Median comments", align: "right" },
      ]}
      rows={rows.map((r) => ({
        id: r.key,
        cells: [
          { node: label(r.key) },
          { node: r.posts, value: r.posts },
          ...(views ? [{ node: num(r.medianViews), value: r.medianViews }] : []),
          { node: num(r.medianLikes), value: r.medianLikes },
          views ? { node: num(r.medianBookmarks), value: r.medianBookmarks } : { node: num(r.medianComments), value: r.medianComments },
        ],
      }))}
      defaultSort={{ col: 2, dir: "desc" }}
      dense
    />
  );
}

const FORMAT_LABEL: Record<string, string> = { video: "Video", image: "Image", link: "Link", text: "Text only" };

export function XView({ data }: { data: B2BSocialData }) {
  const since = new Date(Date.parse(data.capturedAt) - 30 * 86_400_000).toISOString();
  const totals = groupTotals(data, "x", since);
  const company = totals.find((t) => t.group === "company");
  const team = totals.find((t) => t.group === "team");
  const stats = accountStats(data, "x");
  const groupOf = new Map(stats.map((s) => [s.account.handle, s.account.group]));
  const nameOf = new Map(stats.map((s) => [s.account.handle, s.account.name]));
  const originals = data.posts.filter((p) => p.platform === "x" && !p.isReply);
  const own = originals.filter((p) => groupOf.get(p.handle) !== "competitor");

  const accountRows: Row[] = stats.map((s) => ({
    id: s.account.handle,
    href: s.account.url,
    tags: [s.account.group],
    search: `${s.account.name} ${s.account.handle}`,
    cells: [
      {
        node: <NameCell name={s.account.name} tone={GROUP_TONE[s.account.group]} sub={`@${s.account.handle} · ${s.account.sample === "popular" ? "top tweets" : "latest tweets"}`} />,
        value: s.account.name,
      },
      { node: num(s.account.followers), value: s.account.followers },
      { node: s.posts, value: s.posts },
      { node: <Pair top={num(s.medianViews)} sub={s.viewsPerFollower == null ? undefined : `${ratio(s.viewsPerFollower)} / follower`} />, value: s.medianViews },
      { node: num(s.topViews), value: s.topViews },
      { node: num(s.medianLikes), value: s.medianLikes },
      { node: num(s.medianBookmarks), value: s.medianBookmarks },
      { node: fmtDate(s.last), value: s.last, dim: true },
    ],
  }));

  const top = [...originals].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 200);
  const postRows: Row[] = top.map((p) => postRow(p, nameOf.get(p.handle) ?? p.handle, groupOf.get(p.handle) ?? "competitor"));

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Stat label="Company followers" value={num(company?.followers)} hint={`${company?.accounts ?? 0} accounts`} />
        <Stat label="Team followers" value={num(team?.followers)} hint={`${team?.accounts ?? 0} people`} tone="accent" />
        <Stat label="Company views, 30 days" value={num(company?.views)} hint={`${company?.posts ?? 0} posts`} />
        <Stat label="Team views, 30 days" value={num(team?.views)} hint={`${team?.posts ?? 0} posts from ${team?.active ?? 0} people`} tone="accent" />
      </div>
      <p className="text-fg-3 text-[12.5px] mb-6 max-w-[860px]">
        X returns about the last week for some accounts and ~100 top tweets for others (marked under each name), so 30-day totals count only what came back. Views per follower is the median post's
        views over followers. No likers or retweeters are available.
      </p>

      <SectionHead>Accounts</SectionHead>
      <DataTable
        columns={[
          { label: "Account" },
          { label: "Followers", align: "right" },
          { label: "Posts", align: "right" },
          { label: "Median views", align: "right" },
          { label: "Top views", align: "right" },
          { label: "Median likes", align: "right" },
          { label: "Median bookmarks", align: "right" },
          { label: "Newest", align: "right" },
        ]}
        rows={accountRows}
        defaultSort={{ col: 1, dir: "desc" }}
        views={GROUP_VIEWS}
        searchLabel="Search accounts"
        maxHeight="560px"
        dense
        stickyFirst
      />

      <div className="grid xl:grid-cols-2 gap-x-3">
        <div>
          <SectionHead>Company and team posts by format</SectionHead>
          <BreakdownTable rows={breakdown(own, (p) => p.format)} label={(k) => FORMAT_LABEL[k] ?? k} views />
        </div>
        <div>
          <SectionHead>Company and team posts by topic</SectionHead>
          <BreakdownTable rows={breakdown(own, (p) => topicOf(p.text))} label={(k) => TOPIC_LABEL[k as keyof typeof TOPIC_LABEL] ?? k} views />
        </div>
      </div>

      <SectionHead right={<span className="text-fg-3 text-[12.5px]">Top 200 by views, replies left out</span>}>Top posts</SectionHead>
      <PostTable rows={postRows} views />
    </>
  );
}

function postRow(p: ReachPost, account: string, group: ReachGroup): Row {
  const topic = topicOf(p.text);
  return {
    id: `${p.platform}-${p.id}`,
    href: p.url,
    tags: [group],
    search: `${account} ${p.text}`,
    cells: [
      {
        node: (
          <Wrap>
            <span className="font-semibold">{account}</span> <span className="text-fg-3">· {fmtDate(p.postedAt)}</span>
            <br />
            {snippet(p.text)}
          </Wrap>
        ),
        value: p.text,
      },
      { node: <Badge>{TOPIC_LABEL[topic]}</Badge>, value: topic },
      { node: FORMAT_LABEL[p.format] ?? p.format, value: p.format, dim: true },
      { node: num(p.views), value: p.views },
      { node: num(p.likes), value: p.likes },
      { node: num(p.comments), value: p.comments },
      { node: num(p.bookmarks), value: p.bookmarks },
    ],
  };
}

function PostTable({ rows, views }: { rows: Row[]; views: boolean }) {
  return (
    <DataTable
      columns={[
        { label: "Post" },
        { label: "Topic" },
        { label: "Format" },
        ...(views ? [{ label: "Views", align: "right" as const }] : []),
        { label: "Likes", align: "right" },
        { label: "Comments", align: "right" },
        ...(views ? [{ label: "Bookmarks", align: "right" as const }] : []),
      ]}
      rows={views ? rows : rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => i !== 3 && i !== 6) }))}
      defaultSort={{ col: 3, dir: "desc" }}
      views={GROUP_VIEWS}
      searchLabel="Search posts"
      maxHeight="720px"
      dense
    />
  );
}

export function LinkedInView({ data }: { data: B2BSocialData }) {
  const stats = accountStats(data, "linkedin");
  const page = stats.find((s) => s.account.group === "company");
  const groupOf = new Map(stats.map((s) => [s.account.handle, s.account.group]));
  const nameOf = new Map(stats.map((s) => [s.account.handle, s.account.name]));
  const posts = data.posts.filter((p) => p.platform === "linkedin");
  const companyPosts = posts.filter((p) => groupOf.get(p.handle) === "company");

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Stat label="Page followers" value={num(page?.account.followers)} hint={page?.account.employees ? `${num(page.account.employees)} employees on LinkedIn` : undefined} />
        <Stat label="Posts listed" value={page?.posts ?? 0} hint={`${page?.measured ?? 0} with likes and comments`} />
        <Stat label="Median likes" value={num(page?.medianLikes)} hint={page?.likesPer1k == null ? undefined : `${ratio(page.likesPer1k)} per 1k followers`} />
        <Stat label="Median comments" value={num(page?.medianComments)} />
      </div>
      <p className="text-fg-3 text-[12.5px] mb-6 max-w-[860px]">
        The company's post list has text and dates only; likes, comment counts and up to 10 comments come from one call per post. LinkedIn has no view counts, and likers and reposters aren't
        available.
      </p>

      <SectionHead>Pages and people</SectionHead>
      <DataTable
        columns={[
          { label: "Account" },
          { label: "Followers", align: "right" },
          { label: "Posts", align: "right" },
          { label: "Median likes", align: "right" },
          { label: "Median comments", align: "right" },
          { label: "Likes per 1k followers", align: "right" },
        ]}
        rows={stats.map((s) => ({
          id: s.account.handle,
          href: s.account.url,
          cells: [
            { node: <NameCell name={s.account.name} tone={GROUP_TONE[s.account.group]} sub={`${GROUP_LABEL[s.account.group]} · ${s.measured} of ${s.posts} posts measured`} />, value: s.account.name },
            { node: num(s.account.followers), value: s.account.followers },
            { node: s.posts, value: s.posts },
            { node: num(s.medianLikes), value: s.medianLikes },
            { node: num(s.medianComments), value: s.medianComments },
            { node: ratio(s.likesPer1k), value: s.likesPer1k },
          ],
        }))}
        defaultSort={{ col: 1, dir: "desc" }}
        dense
      />

      <SectionHead>Company posts by topic</SectionHead>
      <BreakdownTable rows={breakdown(companyPosts, (p) => topicOf(p.text))} label={(k) => TOPIC_LABEL[k as keyof typeof TOPIC_LABEL] ?? k} views={false} />

      <SectionHead>Posts</SectionHead>
      <PostTable rows={posts.map((p) => postRow(p, nameOf.get(p.handle) ?? p.handle, groupOf.get(p.handle) ?? "competitor"))} views={false} />
    </>
  );
}

const KIND_TONE: Record<CommentKind, BadgeTone> = { using: "green", pain: "red", evaluating: "green", insider: "accent", commentary: "neutral", cheer: "neutral", company: "warn" };

export function CommentersView({ data, slug }: { data: B2BSocialData; slug: string }) {
  const rows = commenterRows(data);
  const people = new Set(rows.map((r) => r.comment.authorUrl ?? r.comment.authorName));
  const count = (k: CommentKind) => rows.filter((r) => r.kind === k).length;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Stat label="Comments read" value={rows.length} hint={`${people.size} different people and pages`} />
        <Stat label="Signals" value={rows.filter((r) => isSignal(r.kind)).length} tone="accent" hint={`${count("using")} using · ${count("pain")} pain · ${count("evaluating")} evaluating`} />
        <Stat label="Employees and insiders" value={count("insider")} />
        <Stat label="Profiles looked up" value={data.people.length} hint={`${data.people.filter((p) => p.found).length} public`} />
      </div>
      <p className="text-fg-3 text-[12.5px] mb-6 max-w-[860px]">
        Up to 10 comments per post. A looked-up profile gives location, followers and current employer; job titles come back masked. The kind is a rule on the text (a short question or "we use / my
        team…" is a signal) and on the employer (same company as the poster is an insider).
      </p>

      <SectionHead
        right={
          <ButtonLink href={`/p/${slug}/b2b-social/commenters.csv`} primary size="sm">
            Download CSV
          </ButtonLink>
        }
      >
        Comments
      </SectionHead>
      <DataTable
        columns={[{ label: "Commenter" }, { label: "Comment" }, { label: "Kind" }, { label: "On post" }]}
        rows={rows.map((r, i) => ({
          id: String(i),
          href: r.comment.authorUrl ?? undefined,
          tags: [r.kind],
          search: `${r.comment.authorName ?? ""} ${r.person?.employer ?? ""} ${r.comment.text}`,
          cells: [
            {
              node: <NameCell name={r.comment.authorName ?? "Unknown"} sub={[r.person?.employer, r.person?.location].filter(Boolean).join(" · ") || undefined} />,
              value: r.comment.authorName,
            },
            { node: <Wrap>{snippet(r.comment.text, 280)}</Wrap>, value: r.comment.text },
            { node: <Badge tone={KIND_TONE[r.kind]}>{COMMENT_KIND_LABEL[r.kind]}</Badge>, value: COMMENT_KINDS.indexOf(r.kind) },
            {
              node: r.post ? (
                <Wrap width="min-w-[200px] max-w-[300px]">
                  <a href={r.post.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {r.account?.name ?? r.post.handle} · {fmtDate(r.post.postedAt)}
                  </a>
                  <br />
                  <span className="text-fg-3">{snippet(r.post.text, 70)}</span>
                </Wrap>
              ) : (
                "–"
              ),
              value: r.post?.postedAt ?? null,
            },
          ],
        }))}
        defaultSort={{ col: 2, dir: "asc" }}
        views={[{ key: "all", label: "All" }, ...COMMENT_KINDS.map((k) => ({ key: k, label: COMMENT_KIND_LABEL[k] }))]}
        searchLabel="Search comments or employers"
        maxHeight="760px"
        dense
      />
    </>
  );
}

const TIER_TONE: Record<CompanyTier, BadgeTone> = { fortune500: "green", enterprise: "accent", yc: "warn", other: "neutral" };
const SENIORITY_TONE: Record<Seniority, BadgeTone> = { exec: "green", vp: "green", director: "accent", manager: "accent", senior: "neutral", ic: "neutral", unknown: "neutral" };
// DataTable's first view always holds every row, so the leads tables only get enterprise rows to begin with.
const TIER_VIEWS = [
  { key: "enterprise-any", label: "Fortune 500 and 10k+" },
  { key: "fortune500", label: "Fortune 500" },
  { key: "enterprise", label: "Other 10k+" },
];
const tierTags = (tier: CompanyTier) => [tier];

export const LEAD_WINDOWS = ["7", "30", "all"] as const;
export type LeadWindow = (typeof LEAD_WINDOWS)[number];

export function LeadsView({ data, slug, window }: { data: B2BSocialData; slug: string; window: LeadWindow }) {
  const since = window === "all" ? null : new Date(Date.parse(data.capturedAt) - Number(window) * 86_400_000).toISOString();
  const list = leads(data, since);
  const accounts = leadAccounts(list);
  const big = list.filter((l) => isEnterprise(l.tier));
  const bigAccounts = accounts.filter((a) => isEnterprise(a.tier));
  const senior = big.filter((l) => ["exec", "vp", "director", "manager"].includes(l.seniority));

  // Which topics pull enterprise people into the comments: the content answer that matters for outreach.
  const byPost = new Map<string, Set<string>>();
  for (const lead of big) for (const t of lead.touches) if (t.post) byPost.set(t.post.id, (byPost.get(t.post.id) ?? new Set()).add(lead.url));
  const posts = data.posts.filter((p) => p.platform === "linkedin" && p.likes != null && (!since || (p.postedAt ?? "") >= since));
  const competitorHandles = new Set(data.accounts.filter((a) => a.group === "competitor").map((a) => a.handle));
  const windowLabel = window === "all" ? "all time" : `the last ${window} days`;
  const topicRows = [...new Set(posts.map((p) => topicOf(p.text)))].map((topic) => {
    const ps = posts.filter((p) => topicOf(p.text) === topic);
    const people = ps.reduce((n, p) => n + (byPost.get(p.id)?.size ?? 0), 0);
    return { topic, posts: ps.length, likes: median(ps.map((p) => p.likes)), people, perPost: people / ps.length };
  });
  const nameOf = new Map(data.accounts.map((a) => [a.handle, a.name]));
  const topPosts = posts
    .filter((p) => byPost.has(p.id))
    .sort((a, b) => byPost.get(b.id)!.size - byPost.get(a.id)!.size)
    .slice(0, 10);

  return (
    <>
      <div className="mb-4">
        <WindowToggle slug={slug} view="leads" window={window} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Stat label="Fortune 500 companies" value={bigAccounts.filter((a) => a.tier === "fortune500").length} hint={`commented in ${windowLabel}`} tone="accent" />
        <Stat label="Other 10k+ companies" value={bigAccounts.filter((a) => a.tier === "enterprise").length} />
        <Stat label="People at these companies" value={big.length} hint={`${senior.length} manager level or above`} />
        <Stat label="Signals from them" value={big.filter((l) => isSignal(l.kind)).length} hint={`${list.filter((l) => isSignal(l.kind)).length} from everyone, any company size`} tone="accent" />
      </div>
      <p className="text-fg-3 text-[12.5px] mb-6 max-w-[900px]">
        Everyone outside the company who commented on the tracked LinkedIn posts (the company's, its sales and leadership team's, and competitors') in {windowLabel}. LinkedIn gives no comment dates,
        so a comment counts from its post's date. Each person comes with their employer from their profile, the employer's size from its LinkedIn page, and its 2026 Fortune 500 rank matched by name.
        Titles come from a people-data lookup on enterprise commenters only. Score = company tier × seniority × strongest comment (already using, a complaint or a question beats a long take, which
        beats a congrats) × 1.5 if in the last 30 days.
      </p>

      <SectionHead>Accounts</SectionHead>
      <DataTable
        columns={[
          { label: "Company" },
          { label: "People", align: "right" },
          { label: "Signals", align: "right", title: "Questions or own use" },
          { label: "Most senior" },
          { label: "Last comment", align: "right" },
          { label: "Score", align: "right" },
        ]}
        rows={bigAccounts.map((a) => ({
          id: a.company.url,
          href: a.company.url,
          tags: tierTags(a.tier),
          search: `${a.company.name} ${a.company.industry ?? ""} ${a.people.map((p) => p.name).join(" ")}`,
          cells: [
            {
              node: (
                <NameCell
                  name={a.company.name}
                  tone={TIER_TONE[a.tier]}
                  sub={[a.company.fortune500 ? `Fortune 500 #${a.company.fortune500}` : COMPANY_TIER_LABEL[a.tier], a.company.industry].filter(Boolean).join(" · ")}
                />
              ),
              value: a.company.name,
            },
            { node: a.people.length, value: a.people.length },
            { node: a.signals || "–", value: a.signals, dim: !a.signals },
            { node: <Badge tone={SENIORITY_TONE[a.topSeniority]}>{SENIORITY_LABEL[a.topSeniority]}</Badge>, value: SENIORITIES.length - SENIORITIES.indexOf(a.topSeniority) },
            { node: fmtDate(a.lastAt), value: a.lastAt, dim: true },
            { node: a.score, value: a.score },
          ],
        }))}
        defaultSort={{ col: 5, dir: "desc" }}
        views={TIER_VIEWS}
        searchLabel="Search companies"
        empty="No commenters from Fortune 500 or 10k+ companies yet."
        maxHeight="520px"
        dense
      />

      <SectionHead
        right={
          <ButtonLink href={`/p/${slug}/b2b-social/commenters.csv`} primary size="sm">
            Download CSV for Clay
          </ButtonLink>
        }
      >
        People
      </SectionHead>
      <DataTable
        columns={[{ label: "Person" }, { label: "Level" }, { label: "Company" }, { label: "What they said" }, { label: "On post" }, { label: "Score", align: "right" }]}
        rows={big.map((l) => {
          const t = l.touches[0]!;
          return {
            id: l.url,
            href: l.url.startsWith("http") ? l.url : undefined,
            tags: tierTags(l.tier),
            search: `${l.name} ${l.person?.title ?? ""} ${l.company?.name ?? l.person?.employer ?? ""} ${t.comment.text}`,
            cells: [
              { node: <NameCell name={l.name} sub={l.person?.title ?? l.person?.location ?? undefined} />, value: l.name },
              { node: <Badge tone={SENIORITY_TONE[l.seniority]}>{SENIORITY_LABEL[l.seniority]}</Badge>, value: SENIORITIES.length - SENIORITIES.indexOf(l.seniority) },
              {
                node: (
                  <Wrap width="min-w-[150px] max-w-[220px]">
                    {l.company?.name ?? l.person?.employer ?? "–"}
                    {isEnterprise(l.tier) && (
                      <>
                        <br />
                        <span className="text-[11.5px] text-fg-3">{l.company?.fortune500 ? `Fortune 500 #${l.company.fortune500}` : COMPANY_TIER_LABEL[l.tier]}</span>
                      </>
                    )}
                  </Wrap>
                ),
                value: l.company?.fortune500 ? 1000 - l.company.fortune500 : l.tier === "enterprise" ? 0 : -1,
              },
              {
                node: (
                  <Wrap>
                    <Badge tone={KIND_TONE[l.kind]}>{COMMENT_KIND_LABEL[l.kind]}</Badge> {snippet(t.comment.text, 220)}
                    {l.touches.length > 1 && <span className="text-fg-3"> · +{l.touches.length - 1} more</span>}
                  </Wrap>
                ),
                value: t.comment.text,
              },
              {
                node: t.post ? (
                  <Wrap width="min-w-[180px] max-w-[260px]">
                    <a href={t.post.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {t.account?.name ?? t.post.handle} · {fmtDate(t.post.postedAt)}
                    </a>
                    <br />
                    <span className="text-fg-3">
                      {competitorHandles.has(t.post.handle) ? "Competitor post · " : ""}
                      {TOPIC_LABEL[topicOf(t.post.text)]}
                    </span>
                  </Wrap>
                ) : (
                  "–"
                ),
                value: l.lastAt,
              },
              { node: l.score, value: l.score },
            ],
          };
        })}
        defaultSort={{ col: 5, dir: "desc" }}
        views={TIER_VIEWS}
        searchLabel="Search people, titles, companies"
        empty="No commenters from Fortune 500 or 10k+ companies yet."
        maxHeight="760px"
        dense
      />

      <div className="grid xl:grid-cols-2 gap-x-3">
        <div>
          <SectionHead>Which topics bring enterprise people into the comments</SectionHead>
          <DataTable
            columns={[
              { label: "Topic" },
              { label: "Posts", align: "right" },
              { label: "Median likes", align: "right" },
              { label: "Enterprise commenters", align: "right" },
              { label: "Per post", align: "right" },
            ]}
            rows={topicRows.map((r) => ({
              id: r.topic,
              cells: [
                { node: TOPIC_LABEL[r.topic] },
                { node: r.posts, value: r.posts },
                { node: num(r.likes), value: r.likes },
                { node: r.people, value: r.people },
                { node: r.perPost.toFixed(1), value: r.perPost },
              ],
            }))}
            defaultSort={{ col: 4, dir: "desc" }}
            dense
          />
        </div>
        <div>
          <SectionHead>Posts that drew the most</SectionHead>
          <DataTable
            columns={[{ label: "Post" }, { label: "Likes", align: "right" }, { label: "Enterprise", align: "right" }]}
            rows={topPosts.map((p) => ({
              id: p.id,
              href: p.url,
              cells: [
                {
                  node: (
                    <Wrap width="min-w-[260px] max-w-[440px]">
                      <span className="font-semibold">{nameOf.get(p.handle) ?? p.handle}</span> <span className="text-fg-3">· {fmtDate(p.postedAt)}</span>
                      <br />
                      {snippet(p.text, 120)}
                    </Wrap>
                  ),
                  value: p.text,
                },
                { node: num(p.likes), value: p.likes },
                { node: byPost.get(p.id)!.size, value: byPost.get(p.id)!.size },
              ],
            }))}
            defaultSort={{ col: 2, dir: "desc" }}
            dense
          />
        </div>
      </div>
    </>
  );
}

const REASON_TONE: Record<OutreachReason, BadgeTone> = { switching: "red", using: "green", asking: "accent", evaluating: "warn", senior: "neutral" };

function windowSince(data: B2BSocialData, window: LeadWindow): string | null {
  return window === "all" ? null : new Date(Date.parse(data.capturedAt) - Number(window) * 86_400_000).toISOString();
}

function WindowToggle({ slug, view, window }: { slug: string; view: string; window: LeadWindow }) {
  const base = `/p/${slug}/b2b-social${view === "outreach" ? "" : `?view=${view}`}`;
  const join = base.includes("?") ? "&" : "?";
  return (
    <Segmented
      label="Time window"
      active={window}
      items={[
        { key: "7", label: "Last 7 days", href: base },
        { key: "30", label: "Last 30 days", href: `${base}${join}days=30` },
        { key: "all", label: "All time", href: `${base}${join}days=all` },
      ]}
    />
  );
}

/** The main tab: people worth a message now, why, and a first line to send. */
export function OutreachView({ data, slug, window }: { data: B2BSocialData; slug: string; window: LeadWindow }) {
  const list = outreach(data, windowSince(data, window));
  const count = (r: OutreachReason) => list.filter((o) => o.reason === r).length;
  const windowLabel = window === "all" ? "all time" : `the last ${window} days`;
  return (
    <>
      <div className="mb-4">
        <WindowToggle slug={slug} view="outreach" window={window} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
        <Stat label="People to reach out to" value={list.length} hint={windowLabel} tone="accent" />
        <Stat label={OUTREACH_REASON_LABEL.switching} value={count("switching")} hint="pain on a competitor's post" />
        <Stat label={OUTREACH_REASON_LABEL.using} value={count("using")} hint="expansion" />
        <Stat label="Asking or comparing" value={count("asking") + count("evaluating")} />
        <Stat label="At Fortune 500 or 10k+" value={list.filter((o) => isEnterprise(o.lead.tier)).length} />
      </div>
      <p className="text-fg-3 text-[12.5px] mb-6 max-w-[900px]">
        Everyone outside the company who replied on X or commented on LinkedIn under the company's, its team's or competitors' posts, kept only when they said something worth answering (already using
        it, a complaint, a question) or are senior at a big company, and when we know who they are. Ranked by company size, seniority and how actionable the reason is. The opener is a starting point,
        not a script.
      </p>
      {list.length === 0 ? (
        <Empty>Nobody worth a message in {windowLabel}. Try a longer window.</Empty>
      ) : (
        <div className="grid xl:grid-cols-2 gap-3">
          {list.map((o) => {
            const { lead, touch } = o;
            const company = lead.company?.name ?? lead.person?.employer;
            const tier = lead.company?.fortune500 ? `Fortune 500 #${lead.company.fortune500}` : lead.tier === "enterprise" ? "10k+ employees" : lead.company?.yc ? `YC ${lead.company.yc}` : null;
            const platform = touch.post?.platform === "x" ? "X" : "LinkedIn";
            return (
              <Card key={lead.url} className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[15px]">{lead.name}</span>
                      <Badge tone={REASON_TONE[o.reason]}>{OUTREACH_REASON_LABEL[o.reason]}</Badge>
                      {tier && <Badge tone={TIER_TONE[lead.tier]}>{tier}</Badge>}
                    </div>
                    <div className="text-[12.5px] text-fg-2 mt-0.5">{[lead.person?.title, company].filter(Boolean).join(" at ") || lead.person?.location || "–"}</div>
                  </div>
                  <span className="num text-[12px] text-fg-3 shrink-0" title="Priority">
                    {o.priority}
                  </span>
                </div>
                <blockquote className="border-l-2 border-line pl-3 text-[13px] leading-snug whitespace-pre-line">{snippet(touch.comment.text, 320)}</blockquote>
                <div className="text-[12px] text-fg-3">
                  {platform} {touch.post?.platform === "x" ? "reply" : "comment"} on{" "}
                  {touch.post ? (
                    <a href={touch.post.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline text-fg-2">
                      {touch.account?.name ?? touch.post.handle}&apos;s post · {fmtDate(touch.post.postedAt)}
                    </a>
                  ) : (
                    "a post"
                  )}
                  {touch.account?.group === "competitor" ? " · competitor" : ""}
                  {lead.touches.length > 1 ? ` · +${lead.touches.length - 1} more` : ""}
                </div>
                <div className="rounded-[3px] bg-bg-3 px-3 py-2 text-[12.5px] leading-snug">
                  <span className="label block mb-1">Suggested opener</span>
                  {o.opener}
                </div>
                <div className="flex flex-wrap gap-2">
                  {lead.person?.linkedinUrl || /linkedin\.com\/in\//.test(lead.url) ? (
                    <a className={buttonClass("secondary", "sm")} href={lead.person?.linkedinUrl ?? lead.url} target="_blank" rel="noopener noreferrer">
                      LinkedIn
                    </a>
                  ) : null}
                  {o.xUrl && (
                    <a className={buttonClass("secondary", "sm")} href={o.xUrl} target="_blank" rel="noopener noreferrer">
                      X profile
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
