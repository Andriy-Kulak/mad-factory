"use client";

import type { ReactNode } from "react";
import { useTab } from "@/lib/use-tab";
import { median, sumKnown } from "@/lib/social-score";
import type { parseOrganicFilters } from "@/lib/organic-filters";
import { fmtDate } from "@/lib/format";
import { Shell } from "@/components/shell";
import { fmtCount } from "@/components/social";
import { OrganicBrowser } from "@/components/organic-browser";
import { Card, Empty, SectionHead, Stat } from "@/components/ui";
import { OrganicDailyChart, type OrganicDay } from "@/components/organic-daily-chart";
import { PageSkeleton } from "@/components/skeleton";
import { TabLoadError } from "@/components/tab-load-error";

const CHART_TZ = "America/New_York";
const CHART_MAX_DAYS = 90;
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: CHART_TZ }).format(d);

/** One entry per calendar day (New York) from the first post to today, zero-filled; views are each post's latest count, credited to its publish day. */
function dailySeries(posts: { postedAt: string | null; views: number | null }[]): OrganicDay[] {
  const byDay = new Map<string, OrganicDay>();
  for (const p of posts) {
    if (!p.postedAt) continue;
    const date = dayKey(new Date(p.postedAt));
    const d = byDay.get(date) ?? { date, posts: 0, views: 0 };
    d.posts++;
    d.views += p.views ?? 0;
    byDay.set(date, d);
  }
  if (!byDay.size) return [];
  const today = dayKey(new Date());
  const first = [...byDay.keys()].sort()[0]!;
  const days: OrganicDay[] = [];
  for (let t = Date.parse(`${first}T12:00:00Z`); ; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (date > today) break;
    days.push(byDay.get(date) ?? { date, posts: 0, views: 0 });
  }
  return days.slice(-CHART_MAX_DAYS);
}

export function MyAccountsTab({ product, initial, panel }: { product: { id: string; slug: string }; initial: ReturnType<typeof parseOrganicFilters>; panel: ReactNode }) {
  const { data, isPending, isError, refetch } = useTab(product, "my-accounts");
  if (isPending) return <PageSkeleton title="My accounts" stats={5} body="chart" />;
  if (isError || !data) return <TabLoadError title="My accounts" retry={() => void refetch()} />;
  const { accounts, posts, favorites } = data;
  const { slug } = product;
  return (
    <Shell title="My accounts" subtitle={`${accounts.length} accounts · ${posts.length} reels and videos · Instagram reels, TikTok videos and Facebook reels only`}>
      {accounts.length === 0 ? (
        <>
          {panel}
          <Empty>
            No synced accounts yet. Add your Instagram, TikTok or Facebook accounts above; they are fetched on the next <code>pnpm social --product {slug}</code> run.
          </Empty>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            <Stat label="Total views" value={fmtCount(sumKnown(posts.map((p) => p.views)))} />
            <Stat label="Reels & videos" value={posts.length} />
            <Stat label="Followers" value={fmtCount(sumKnown(accounts.map((a) => a.followers)))} />
            <Stat label="Median views" value={fmtCount(median(posts.flatMap((p) => (p.views == null ? [] : [p.views]))))} />
            <Stat
              label="Last synced"
              value={
                <span className="text-[18px]">
                  {fmtDate(
                    accounts
                      .map((a) => a.lastSyncedAt ?? "")
                      .sort()
                      .at(-1) || null,
                  )}
                </span>
              }
            />
          </div>

          <SectionHead right={<span className="text-fg-3 text-xs">views are each post&apos;s current total, counted on the day it was posted (ET)</span>}>Posts and views by day</SectionHead>
          <Card className="p-4 mb-5">
            <OrganicDailyChart days={dailySeries(posts)} />
          </Card>

          {panel}
          <OrganicBrowser posts={posts} accounts={accounts} productId={product.id} favoriteIds={favorites} initial={initial} now={Date.now()} />
        </>
      )}
    </Shell>
  );
}
