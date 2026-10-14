import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { saveFavoriteLink } from "@/lib/favorite-actions";
import { Card } from "@/components/ui";
import { SourceForm } from "@/components/source-form";
import { FavoritesTab } from "@/components/favorites-tab";

export const dynamic = "force-dynamic";

export default async function FavoritesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const panel = (
    <Card className="p-4 mb-6">
      <div className="text-[14px] font-semibold mb-1">Save by link</div>
      <p className="text-fg-3 text-[13px] mb-3">
        Paste one Ad Library ad (its Library ID or a facebook.com/ads/library/?id= link) or an Instagram, TikTok or Facebook post link. It is stored and starred without following the page or account.
        About 1 ScrapeCreators credit when it isn't stored yet.
      </p>
      <SourceForm action={saveFavoriteLink.bind(null, product.id, slug)} submitLabel="Save">
        <input name="url" required placeholder="e.g. 1234567890123456 or https://www.instagram.com/reel/…" aria-label="Ad ID or post link" className="control flex-1 min-w-[260px]" />
      </SourceForm>
    </Card>
  );
  return <FavoritesTab product={{ id: product.id, slug }} panel={panel} />;
}
