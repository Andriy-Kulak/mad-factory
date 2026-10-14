"use client";

import type { ReactNode } from "react";
import { useTab } from "@/lib/use-tab";
import type { parseOrganicFilters } from "@/lib/organic-filters";
import { fmtDate } from "@/lib/format";
import { Shell } from "@/components/shell";
import { OUTLIER_MIN } from "@/components/social";
import { OrganicBrowser } from "@/components/organic-browser";
import { Empty, Stat } from "@/components/ui";
import { PageSkeleton } from "@/components/skeleton";
import { TabLoadError } from "@/components/tab-load-error";

export function OrganicTab({ product, initial, panel }: { product: { id: string; slug: string }; initial: ReturnType<typeof parseOrganicFilters>; panel: ReactNode }) {
  const { data, isPending, isError, refetch } = useTab(product, "organic");
  if (isPending) return <PageSkeleton title="Organic" stats={4} body="grid" sidebar />;
  if (isError || !data) return <TabLoadError title="Organic" retry={() => void refetch()} />;
  const { accounts, posts, favorites } = data;
  const { slug } = product;
  const outliers = posts.filter((p) => (p.outlier ?? 0) >= OUTLIER_MIN).length;

  return (
    <Shell title="Organic" subtitle={`${accounts.length} accounts · ${posts.length} posts · outlier = views ÷ the account's median views`}>
      {accounts.length === 0 ? (
        <>
          {panel}
          <Empty>
            No synced accounts yet. Add Instagram, TikTok or Facebook accounts above; they are fetched on the next <code>pnpm social --product {slug}</code> run.
          </Empty>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Stat label="Accounts" value={accounts.length} />
            <Stat label="Posts tracked" value={posts.length} />
            <Stat label={`Outliers (${OUTLIER_MIN}×+)`} value={outliers} />
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
          {panel}
          <OrganicBrowser posts={posts} accounts={accounts} productId={product.id} favoriteIds={favorites} initial={initial} now={Date.now()} />
        </>
      )}
    </Shell>
  );
}
