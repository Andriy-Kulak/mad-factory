import { notFound } from "next/navigation";
import { competitorAds, getProductBySlug } from "@/lib/queries";
import { favoriteIds } from "@/lib/favorites";
import { parseInsightFilters, type SearchParams } from "@/lib/insights";
import { Shell } from "@/components/shell";
import { Empty } from "@/components/ui";
import { InsightsView } from "@/components/insights-view";

export const dynamic = "force-dynamic";

export default async function InsightsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const [cards, favorites] = await Promise.all([competitorAds(product.id), favoriteIds(product.id, "ad")]);
  return (
    <Shell title="Insights" subtitle="What competitors keep paying for: angles, personas, hooks, formats and landing pages of the ads that keep running">
      {cards.length === 0 ? (
        <Empty>
          No competitor ads yet. Add an Ad Library page under Competitor ads; its ads arrive with the next <code>pnpm scrape --product {slug}</code>.
        </Empty>
      ) : (
        <InsightsView cards={cards} slug={slug} productId={product.id} favoriteIds={favorites} initial={parseInsightFilters(sp)} hasAdjacent={cards.some((c) => c.relation === "inspiration")} />
      )}
    </Shell>
  );
}
