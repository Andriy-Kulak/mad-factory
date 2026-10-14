import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { parseAdFilters, type SearchParams } from "@/lib/ad-cards";
import { addAdLibrarySource } from "@/lib/source-actions";
import { listTrackedSourceItems } from "@/lib/tracked-sources";
import { SourceForm } from "@/components/source-form";
import { AdLibraryFields, TrackedSourcesPanel } from "@/components/tracked-sources";
import { AdsTab } from "@/components/ads-tab";

export const dynamic = "force-dynamic";

export default async function CompetitorAdsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const tracked = await listTrackedSourceItems(product.id, { kind: "ad_library" });
  const panel = (
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
  );
  return <AdsTab product={{ id: product.id, slug }} initial={parseAdFilters(sp)} panel={panel} />;
}
