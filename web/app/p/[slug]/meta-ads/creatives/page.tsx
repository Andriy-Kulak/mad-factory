import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { getMetaAdsOverview } from "@/lib/meta-ads";
import { attributeKeys } from "@/lib/meta-ads-rollup";
import { Shell } from "@/components/shell";
import { MetaTabs, RangePicker, parseRange } from "@/components/meta-ads";
import { MetaCreativesBody, NotSynced } from "@/components/meta-ads-views";

export const dynamic = "force-dynamic";

export default async function MetaCreativesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ days?: string; from?: string; to?: string; by?: string; then?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const range = parseRange(sp);
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
  const keys = attributeKeys(o.ads);
  const by = sp.by && keys.includes(sp.by) ? sp.by : "hook";
  const then = sp.then && sp.then !== by && keys.includes(sp.then) ? sp.then : null;
  return (
    <Shell
      title="Meta ads"
      subtitle="performance by creative attribute"
      action={<RangePicker href={`/p/${slug}/meta-ads/creatives`} range={range} extra={{ by, ...(then ? { then } : {}) }} />}
      tabs={<MetaTabs slug={slug} active="attributes" range={range} />}
    >
      <MetaCreativesBody o={o} slug={slug} range={range} by={by} then={then} />
    </Shell>
  );
}
