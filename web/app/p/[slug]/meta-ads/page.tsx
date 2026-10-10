import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { getMetaAdsOverview } from "@/lib/meta-ads";
import { fmtDateTime } from "@/lib/format";
import { Shell } from "@/components/shell";
import { MetaTabs, RangePicker, parseRange } from "@/components/meta-ads";
import { MetaAdsOverviewBody, NotSynced } from "@/components/meta-ads-views";

export const dynamic = "force-dynamic";

export default async function MetaAdsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ days?: string; from?: string; to?: string }> }) {
  const { slug } = await params;
  const range = parseRange(await searchParams);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const o = await getMetaAdsOverview(product.id, range);

  if (!o || !o.campaigns.length) {
    return (
      <Shell title="Meta ads" subtitle={product.slug}>
        <NotSynced slug={slug} missingTables={!o} />
      </Shell>
    );
  }
  return (
    <Shell title="Meta ads" subtitle={`since ${o.since} · last sync ${fmtDateTime(o.lastRun?.finished_at ?? null)}`} action={<RangePicker href={`/p/${slug}/meta-ads`} range={range} />} tabs={<MetaTabs slug={slug} active="ads" range={range} />}>
      <MetaAdsOverviewBody o={o} slug={slug} range={range} />
    </Shell>
  );
}
