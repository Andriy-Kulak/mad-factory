"use client";

import { useTab } from "@/lib/use-tab";
import type { parseInsightFilters } from "@/lib/insights";
import { Shell } from "@/components/shell";
import { Empty } from "@/components/ui";
import { InsightsView } from "@/components/insights-view";
import { PageSkeleton } from "@/components/skeleton";
import { TabLoadError } from "@/components/tab-load-error";

export const dynamic = "force-dynamic";

export function InsightsTab({ product, initial }: { product: { id: string; slug: string }; initial: ReturnType<typeof parseInsightFilters> }) {
  const { data, isPending, isError, refetch } = useTab(product, "insights");
  if (isPending) return <PageSkeleton title="Insights" stats={4} body="table" />;
  if (isError || !data) return <TabLoadError title="Insights" retry={() => void refetch()} />;
  const { cards, favorites } = data;
  const { slug } = product;
  return (
    <Shell title="Insights" subtitle="What competitors keep paying for: angles, personas, hooks, formats and landing pages of the ads that keep running">
      {cards.length === 0 ? (
        <Empty>
          No competitor ads yet. Add an Ad Library page under Competitor ads; its ads arrive with the next <code>pnpm scrape --product {slug}</code>.
        </Empty>
      ) : (
        <InsightsView cards={cards} slug={slug} productId={product.id} favoriteIds={favorites} initial={initial} hasAdjacent={cards.some((c) => c.relation === "inspiration")} />
      )}
    </Shell>
  );
}
