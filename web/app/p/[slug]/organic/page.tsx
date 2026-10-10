import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { organicOverview } from "@/lib/social";
import { parseOrganicFilters, type SearchParams } from "@/lib/organic-filters";
import { fmtDate } from "@/lib/format";
import { Shell } from "@/components/shell";
import { OUTLIER_MIN } from "@/components/social";
import { OrganicBrowser } from "@/components/organic-browser";
import { Empty, Stat } from "@/components/ui";
import { addSocialAccount } from "@/lib/source-actions";
import { listTrackedSourceItems } from "@/lib/tracked-sources";
import { SourceForm } from "@/components/source-form";
import { SocialAccountFields, TrackedSourcesPanel } from "@/components/tracked-sources";

export const dynamic = "force-dynamic";

export default async function OrganicPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const [{ accounts, posts }, tracked] = await Promise.all([
    organicOverview(product.id, { relations: ["competitor", "inspiration"] }),
    listTrackedSourceItems(product.id, { kind: "social", relations: ["competitor", "inspiration"] }),
  ]);
  const panel = (
    <TrackedSourcesPanel productId={product.id} slug={slug} title="Tracked accounts" items={tracked} showRelation open={tracked.length === 0}
      form={<SourceForm action={addSocialAccount.bind(null, product.id, slug)} submitLabel="Add account"><SocialAccountFields relations={[{ value: "inspiration", label: "Inspiration" }, { value: "competitor", label: "Competitor" }]} labels={[...new Set(tracked.flatMap((t) => (t.label ? [t.label] : [])))]} /></SourceForm>} />
  );
  const outliers = posts.filter((p) => (p.outlier ?? 0) >= OUTLIER_MIN).length;

  return (
    <Shell title="Organic" subtitle={`${accounts.length} accounts · ${posts.length} posts · outlier = views ÷ the account's median views`}>
      {accounts.length === 0 ? (
        <>
          {panel}
          <Empty>No synced accounts yet. Add Instagram, TikTok or Facebook accounts above; they are fetched on the next <code>pnpm social --product {slug}</code> run.</Empty>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Stat label="Accounts" value={accounts.length} />
            <Stat label="Posts tracked" value={posts.length} />
            <Stat label={`Outliers (${OUTLIER_MIN}×+)`} value={outliers} />
            <Stat label="Last synced" value={<span className="text-[18px]">{fmtDate(accounts.map((a) => a.lastSyncedAt ?? "").sort().at(-1) || null)}</span>} />
          </div>
          {panel}
          <OrganicBrowser posts={posts} accounts={accounts} initial={parseOrganicFilters(sp)} now={Date.now()} />
        </>
      )}
    </Shell>
  );
}
