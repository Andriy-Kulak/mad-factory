"use client";

import { useTab } from "@/lib/use-tab";
import { fmtDateTime } from "@/lib/format";
import { Shell } from "@/components/shell";
import { MetaTabs, RangePicker, type MetaRange } from "@/components/meta-ads";
import { MetaAdsOverviewBody, MetaCreativesBody, NotSynced } from "@/components/meta-ads-views";
import { attributeKeys } from "@/lib/meta-ads-rollup";
import { PageSkeleton } from "@/components/skeleton";
import { TabLoadError } from "@/components/tab-load-error";

export function MetaAdsTab({
  product,
  view,
  range,
  params,
  by: requestedBy,
  then: requestedThen,
}: {
  product: { id: string; slug: string };
  view: "ads" | "attributes";
  range: MetaRange;
  params: { days?: string; from?: string; to?: string };
  by?: string;
  then?: string;
}) {
  const { data: o, isPending, isError, refetch } = useTab(product, "meta-ads", params);
  if (isPending) return <PageSkeleton title="Meta ads" stats={6} body="table" />;
  if (isError) return <TabLoadError title="Meta ads" retry={() => void refetch()} />;
  const { slug } = product;

  if (!o || !o.campaigns.length) {
    return (
      <Shell title="Meta ads" subtitle={product.slug}>
        <NotSynced slug={slug} missingTables={!o} />
      </Shell>
    );
  }
  if (view === "ads") {
    return (
      <Shell
        title="Meta ads"
        subtitle={`since ${o.since} · last sync ${fmtDateTime(o.lastRun?.finished_at ?? null)}`}
        action={<RangePicker href={`/p/${slug}/meta-ads`} range={range} />}
        tabs={<MetaTabs slug={slug} active="ads" range={range} />}
      >
        <MetaAdsOverviewBody o={o} slug={slug} range={range} />
      </Shell>
    );
  }

  const keys = attributeKeys(o.ads);
  const by = requestedBy && keys.includes(requestedBy) ? requestedBy : "hook";
  const then = requestedThen && requestedThen !== by && keys.includes(requestedThen) ? requestedThen : null;
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
