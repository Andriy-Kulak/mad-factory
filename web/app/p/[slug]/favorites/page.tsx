import { notFound } from "next/navigation";
import { competitorAdsCached, getProductBySlug } from "@/lib/queries";
import { organicOverviewCached } from "@/lib/social";
import { favoriteIds } from "@/lib/favorites";
import { saveFavoriteLink } from "@/lib/favorite-actions";
import { Shell } from "@/components/shell";
import { Card } from "@/components/ui";
import { SourceForm } from "@/components/source-form";
import { FavoritesView } from "@/components/favorites-view";

export const dynamic = "force-dynamic";

/** Every starred competitor ad and organic post in one place, plus saving one more by link. */
export default async function FavoritesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const [ads, { accounts, posts }, adFavs, postFavs] = await Promise.all([
    competitorAdsCached(product.id),
    organicOverviewCached(product.id),
    favoriteIds(product.id, "ad"),
    favoriteIds(product.id, "post"),
  ]);
  const starredAds = new Set(adFavs);
  const starredPosts = new Set(postFavs);
  const favAds = ads.filter((a) => a.memberIds.some((id) => starredAds.has(id)));
  const favPosts = posts.filter((p) => starredPosts.has(p.id));

  return (
    <Shell title="Favorites" subtitle={`${favAds.length} ads · ${favPosts.length} posts · star an ad or post anywhere in Research and it shows here`}>
      <Card className="p-4 mb-6">
        <div className="text-[14px] font-semibold mb-1">Save by link</div>
        <p className="text-fg-3 text-[13px] mb-3">
          Paste one Ad Library ad (its Library ID or a facebook.com/ads/library/?id= link) or an Instagram, TikTok or Facebook post link. It is stored and starred without following the page or
          account. About 1 ScrapeCreators credit when it isn't stored yet.
        </p>
        <SourceForm action={saveFavoriteLink.bind(null, product.id, slug)} submitLabel="Save">
          <input name="url" required placeholder="e.g. 1234567890123456 or https://www.instagram.com/reel/…" aria-label="Ad ID or post link" className="control flex-1 min-w-[260px]" />
        </SourceForm>
      </Card>
      <FavoritesView ads={favAds} posts={favPosts} accounts={accounts} slug={slug} productId={product.id} adFavoriteIds={adFavs} postFavoriteIds={postFavs} now={Date.now()} />
    </Shell>
  );
}
