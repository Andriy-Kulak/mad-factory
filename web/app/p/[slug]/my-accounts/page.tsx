import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { parseOrganicFilters, type SearchParams } from "@/lib/organic-filters";
import { addSocialAccount } from "@/lib/source-actions";
import { listTrackedSourceItems } from "@/lib/tracked-sources";
import { SourceForm } from "@/components/source-form";
import { SocialAccountFields, TrackedSourcesPanel } from "@/components/tracked-sources";
import { MyAccountsTab } from "@/components/my-accounts-tab";

export const dynamic = "force-dynamic";

export default async function MyAccountsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const tracked = await listTrackedSourceItems(product.id, { kind: "social", relations: ["own"] });
  const panel = (
    <TrackedSourcesPanel
      productId={product.id}
      slug={slug}
      title="Your accounts"
      items={tracked}
      open={tracked.length === 0}
      form={
        <SourceForm action={addSocialAccount.bind(null, product.id, slug)} submitLabel="Add account">
          <SocialAccountFields relations={[{ value: "own", label: "Own" }]} labels={[...new Set(tracked.flatMap((t) => (t.label ? [t.label] : [])))]} />
        </SourceForm>
      }
    />
  );
  return <MyAccountsTab product={{ id: product.id, slug }} initial={parseOrganicFilters(sp)} panel={panel} />;
}
