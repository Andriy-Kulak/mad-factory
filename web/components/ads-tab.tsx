"use client";

import { useState, type ReactNode } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import type { TabData } from "@/lib/tab-data";
import { adFiltersHref, type AdFilters, WINNER_MAX_RANK, WINNER_MIN_DAYS } from "@/lib/ad-cards";
import { Shell } from "@/components/shell";
import { Empty, Stat } from "@/components/ui";
import { AdBrowser } from "@/components/ad-browser";
import { PageSkeleton } from "@/components/skeleton";
import { TabLoadError } from "@/components/tab-load-error";

type AdsPage = TabData<"ads">;

/** Competitor ads, fetched a page at a time with the current filters; the server filters and sorts. */
function useAdPages(product: { id: string; slug: string }, f: AdFilters) {
  const query = adFiltersHref({ ...f, view: "cards" }).slice(1);
  return useInfiniteQuery({
    queryKey: ["product", product.id, "ads", query],
    queryFn: async ({ pageParam }) => {
      const sp = new URLSearchParams(query);
      if (pageParam) sp.set("offset", String(pageParam));
      const response = await fetch(`/api/p/${product.slug}/ads?${sp}`);
      if (!response.ok) throw new Error(`Tab request failed (${response.status})`);
      return (await response.json()) as AdsPage;
    },
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.ads.length < last.matched ? last.offset + last.ads.length : undefined),
    placeholderData: keepPreviousData,
  });
}

export function AdsTab({ product, initial, panel }: { product: { id: string; slug: string }; initial: AdFilters; panel: ReactNode }) {
  const [f, setF] = useState(initial);
  const pages = useAdPages(product, f);
  const { data, isPending, isError, refetch } = pages;
  if (isPending) return <PageSkeleton title="Competitor ads" stats={5} body="cards" sidebar />;
  if (isError || !data) return <TabLoadError title="Competitor ads" retry={() => void refetch()} />;
  const first = data.pages[0]!;
  const { stats, total } = first;
  const { slug } = product;
  return (
    <Shell
      title="Competitor ads"
      subtitle={`${total} ads from ${first.advertisers.length} advertisers · ranked by the Ad Library's total-impressions sort · winner = top ${WINNER_MAX_RANK}, running ${WINNER_MIN_DAYS}+ days`}
    >
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Stat label="Running now" value={stats.running} />
        <Stat label="Winners" value={stats.winners} />
        <Stat label="Launched in 7 days" value={stats.launched7} />
        <Stat label="Ranked by impressions" value={stats.ranked} />
        <Stat
          label="Longest running"
          value={
            stats.longest ? (
              <>
                {stats.longest}
                <span className="text-sm text-fg-3 ml-1">d</span>
              </>
            ) : (
              "–"
            )
          }
        />
      </div>
      {panel}
      {total === 0 ? (
        <Empty>
          No ads yet. Add a competitor page above; its ads are fetched on the next <code>pnpm scrape --product {slug}</code> run.
        </Empty>
      ) : (
        <AdBrowser
          slug={slug}
          productId={product.id}
          f={f}
          setF={setF}
          ads={data.pages.flatMap((p) => p.ads)}
          summary={first}
          loading={pages.isFetching && !pages.isFetchingNextPage}
          hasMore={pages.hasNextPage}
          loadMore={() => {
            if (!pages.isFetchingNextPage) void pages.fetchNextPage();
          }}
        />
      )}
    </Shell>
  );
}
