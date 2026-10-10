import type { OrganicPost } from "@/lib/social";
import { fmtDate } from "@/lib/format";
import { Badge, Card } from "@/components/ui";

export const OUTLIER_MIN = 3;

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const fmtCount = (v: number | null) => (v == null ? "–" : compact.format(Math.abs(v) >= 1000 ? v : Math.round(v)));

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook" };
export const platformLabel = (p: string) => PLATFORM_LABEL[p] ?? p;

type MetricKey = "likes" | "comments" | "shares" | "saves";
const METRICS: { key: MetricKey; label: string }[] = [
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" },
  { key: "saves", label: "Saves" },
];

/** Table of posts; interaction columns only appear when at least one post has that number. */
export function PostTable({ posts, accountColumn = "handle" }: { posts: OrganicPost[]; accountColumn?: "handle" | "label" }) {
  const metrics = METRICS.filter((m) => posts.some((p) => p[m.key] != null));
  const grid = { gridTemplateColumns: `28px 48px minmax(180px,1fr) 130px 76px 60px 64px ${metrics.map(() => "64px").join(" ")} 76px` };
  const cls = "grid gap-3 items-center px-4 min-w-[1000px]";
  return (
    <Card className="overflow-x-auto">
      <div className={`${cls} label h-10 border-b border-line`} style={grid}>
        <div>#</div>
        <div></div>
        <div>Caption</div>
        <div>Account</div>
        <div>Posted</div>
        <div className="text-right" title="Views ÷ the account's median views across stored posts">Outlier</div>
        <div className="text-right">Views</div>
        {metrics.map((m) => <div key={m.key} className="text-right">{m.label}</div>)}
        <div className="text-right" title="(likes + comments + shares + saves) ÷ views, using what the platform reports">Engagement</div>
      </div>
      {posts.map((p, i) => <PostRow key={p.id} p={p} i={i + 1} metrics={metrics} grid={grid} cls={cls} accountColumn={accountColumn} />)}
    </Card>
  );
}

function PostRow({ p, i, metrics, grid, cls, accountColumn }: { p: OrganicPost; i: number; metrics: typeof METRICS; grid: { gridTemplateColumns: string }; cls: string; accountColumn: "handle" | "label" }) {
  const hot = (p.outlier ?? 0) >= OUTLIER_MIN;
  const caption = p.caption?.split("\n").map((s) => s.trim()).find(Boolean) ?? "(no caption)";
  const viewsDelta = p.views != null && p.viewsPrev != null ? p.views - p.viewsPrev : null;
  const handle = p.account.platform === "facebook" ? (p.account.displayName ?? p.account.handle) : `@${p.account.handle}`;
  return (
    <a href={p.url ?? undefined} target="_blank" rel="noreferrer" className={`${cls} row-link py-2.5 border-b border-line-2 last:border-b-0`} style={grid}>
      <div className="num text-fg-3">{i}</div>
      <div className="w-12 aspect-[4/5] rounded-[2px] overflow-hidden bg-bg-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" loading="lazy" className="w-full h-full object-cover" />}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0"><span className="font-semibold truncate">{caption}</span>{hot && <Badge tone="green">outlier</Badge>}</div>
        <div className="text-fg-3 text-xs truncate mt-0.5">{platformLabel(p.account.platform)} {p.kind}{p.durationS ? ` · ${Math.round(p.durationS)}s` : ""}</div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-fg-2">{accountColumn === "label" ? (p.account.label ?? handle) : handle}</div>
        {accountColumn === "label" && p.account.label && p.account.label !== handle && <div className="truncate text-fg-3 text-xs">{handle}</div>}
      </div>
      <div className="num text-fg-2 text-xs">{fmtDate(p.postedAt)}</div>
      <div className={`num text-right font-medium ${hot ? "text-good" : ""}`}>{p.outlier == null ? "–" : `${p.outlier.toFixed(1)}×`}</div>
      <div className="num text-right">
        {fmtCount(p.views)}
        {viewsDelta != null && viewsDelta > 0 && <div className="text-[11px] text-good" title="since the previous sync">+{compact.format(viewsDelta)}</div>}
      </div>
      {metrics.map((m) => <div key={m.key} className="num text-right text-fg-2">{fmtCount(p[m.key])}</div>)}
      <div className="num text-right text-fg-2">{p.engagement == null ? "–" : `${(p.engagement * 100).toFixed(1)}%`}</div>
    </a>
  );
}
