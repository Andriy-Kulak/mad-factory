"use client";

import type { ReactNode } from "react";
import { useTab } from "@/lib/use-tab";
import type { parseAdFilters } from "@/lib/ad-cards";
import { WINNER_MAX_RANK, WINNER_MIN_DAYS } from "@/lib/ad-cards";
import { Shell } from "@/components/shell";
import { Empty, Stat } from "@/components/ui";
import { AdBrowser } from "@/components/ad-browser";
import { PageSkeleton } from "@/components/skeleton";
import { TabLoadError } from "@/components/tab-load-error";

export const dynamic = "force-dynamic";

export function AdsTab({ product, initial, panel }: { product: { id: string; slug: string }; initial: ReturnType<typeof parseAdFilters>; panel: ReactNode }) {
  const { data, isPending, isError, refetch } = useTab(product, "ads");
  if (isPending) return <PageSkeleton title="Competitor ads" stats={5} body="cards" sidebar />;
  if (isError || !data) return <TabLoadError title="Competitor ads" retry={() => void refetch()} />;
  const { ads, favorites } = data;
  const { slug } = product;
  const running = ads.filter((a) => a.isActive);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const longest = Math.max(0, ...running.map((a) => a.days ?? 0));
  return (
    <Shell
      title="Competitor ads"
      subtitle={`${ads.length} ads from ${new Set(ads.map((a) => a.advertiserId)).size} advertisers · ranked by the Ad Library's total-impressions sort · winner = top ${WINNER_MAX_RANK}, running ${WINNER_MIN_DAYS}+ days`}
    >
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Stat label="Running now" value={running.length} />
        <Stat label="Winners" value={ads.filter((a) => a.winner).length} />
        <Stat label="Launched in 7 days" value={ads.filter((a) => (a.startDate ?? "") >= weekAgo).length} />
        <Stat label="Ranked by impressions" value={ads.filter((a) => a.rank).length} />
        <Stat
          label="Longest running"
          value={
            longest ? (
              <>
                {longest}
                <span className="text-sm text-fg-3 ml-1">d</span>
              </>
            ) : (
              "–"
            )
          }
        />
      </div>
      {panel}
      {ads.length === 0 ? (
        <Empty>
          No ads yet. Add a competitor page above; its ads are fetched on the next <code>pnpm scrape --product {slug}</code> run.
        </Empty>
      ) : (
        <AdBrowser ads={ads} slug={slug} productId={product.id} favoriteIds={favorites} initial={initial} />
      )}
    </Shell>
  );
}
