import { notFound } from "next/navigation";
import { competitorAdsCached, getProductBySlug } from "@/lib/queries";
import { parseAdFilters, WINNER_MAX_RANK, WINNER_MIN_DAYS, type SearchParams } from "@/lib/ad-cards";
import { Shell } from "@/components/shell";
import { Empty, Stat } from "@/components/ui";
import { AdBrowser } from "@/components/ad-browser";
import { addAdLibrarySource } from "@/lib/source-actions";
import { favoriteIds } from "@/lib/favorites";
import { listTrackedSourceItems } from "@/lib/tracked-sources";
import { SourceForm } from "@/components/source-form";
import { AdLibraryFields, TrackedSourcesPanel } from "@/components/tracked-sources";

export const dynamic = "force-dynamic";

export default async function CompetitorAdsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const [ads, tracked, favorites] = await Promise.all([competitorAdsCached(product.id), listTrackedSourceItems(product.id, { kind: "ad_library" }), favoriteIds(product.id, "ad")]);
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
      <TrackedSourcesPanel
        productId={product.id}
        slug={slug}
        title="Ad Library pages"
        items={tracked}
        open={tracked.length === 0}
        form={
          <SourceForm action={addAdLibrarySource.bind(null, product.id, slug)} submitLabel="Add page">
            <AdLibraryFields />
          </SourceForm>
        }
      />
      {ads.length === 0 ? (
        <Empty>
          No ads yet. Add a competitor page above; its ads are fetched on the next <code>pnpm scrape --product {slug}</code> run.
        </Empty>
      ) : (
        <AdBrowser ads={ads} slug={slug} productId={product.id} favoriteIds={favorites} initial={parseAdFilters(sp)} />
      )}
    </Shell>
  );
}
