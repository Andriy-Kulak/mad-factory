import type { ReactNode } from "react";
import { DataTable, type Row } from "@/components/data-table";
import { Badge, ButtonLink, NameCell, Pair, SectionHead, Stat, type BadgeTone } from "@/components/ui";
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
  type BreakdownRow,
  type CommentKind,
  type ReachGroup,
  type ReachPost,
  type SocialReachData,
} from "@/lib/social-reach";

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

export function XView({ data }: { data: SocialReachData }) {
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

export function LinkedInView({ data }: { data: SocialReachData }) {
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

const KIND_TONE: Record<CommentKind, BadgeTone> = { signal: "green", insider: "accent", commentary: "neutral", cheer: "neutral", company: "warn" };

export function CommentersView({ data, slug }: { data: SocialReachData; slug: string }) {
  const rows = commenterRows(data);
  const people = new Set(rows.map((r) => r.comment.authorUrl ?? r.comment.authorName));
  const count = (k: CommentKind) => rows.filter((r) => r.kind === k).length;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Stat label="Comments read" value={rows.length} hint={`${people.size} different people and pages`} />
        <Stat label="Questions or own use" value={count("signal")} tone="accent" hint="Worth a follow-up" />
        <Stat label="Employees and insiders" value={count("insider")} />
        <Stat label="Profiles looked up" value={data.people.length} hint={`${data.people.filter((p) => p.found).length} public`} />
      </div>
      <p className="text-fg-3 text-[12.5px] mb-6 max-w-[860px]">
        Up to 10 comments per post. A looked-up profile gives location, followers and current employer; job titles come back masked. The kind is a rule on the text (a short question or "we use / my
        team…" is a signal) and on the employer (same company as the poster is an insider).
      </p>

      <SectionHead
        right={
          <ButtonLink href={`/p/${slug}/reach/commenters.csv`} primary size="sm">
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
