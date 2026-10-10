import { notFound } from "next/navigation";
import { BrandMarkdown } from "@/components/brand-markdown";
import { Shell } from "@/components/shell";
import { Badge, ButtonLink, Card, Field, List, SectionHead, Segmented } from "@/components/ui";
import { listBrandDocs } from "@/lib/brand";
import { getProductBySlug, getTrackedSources } from "@/lib/queries";
import type { ProductRow, TrackedSourceRow } from "@db/types";

/** The database profile (description, audience, positioning, sources) sits next to the brand docs. */
const PROFILE = "profile";

export const dynamic = "force-dynamic";

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const [{ slug }, { doc: selectedName }] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const [docs, sources] = await Promise.all([listBrandDocs(product.id), getTrackedSources(product.id)]);
  const showProfile = selectedName === PROFILE || docs.length === 0;
  const selectedDoc = showProfile ? undefined : (docs.find((doc) => doc.name === selectedName) ?? docs[0]);
  const tabs = [
    ...docs.map((doc) => ({ key: doc.name, label: doc.name === "readme" ? "Overview" : doc.title, href: `/p/${slug}/brand?doc=${encodeURIComponent(doc.name)}` })),
    { key: PROFILE, label: "Profile & sources", href: `/p/${slug}/brand?doc=${PROFILE}` },
  ];

  return (
    <Shell title="Brand" subtitle={product.name} action={showProfile ? <ButtonLink href={`/p/${slug}/edit`}>Edit profile</ButtonLink> : undefined}>
      <div className="mb-4 overflow-x-auto">
        <Segmented label="Brand documents" active={showProfile ? PROFILE : (selectedDoc?.name ?? null)} items={tabs} />
      </div>
      {docs.length === 0 && (
        <p className="mb-4 text-fg-3 text-[13px]">
          No brand docs yet. Load them with <code>pnpm product docs import &lt;slug&gt; --dir &lt;folder&gt;</code>.
        </p>
      )}
      {showProfile ? (
        <Profile product={product} sources={sources} />
      ) : (
        selectedDoc && (
          <Card className="overflow-hidden p-5 md:p-7">
            <BrandMarkdown slug={slug} document={selectedDoc} docs={docs} />
          </Card>
        )
      )}
    </Shell>
  );
}

function Profile({ product, sources }: { product: ProductRow; sources: TrackedSourceRow[] }) {
  return (
    <div className="grid lg:grid-cols-3 gap-3">
      <Card className="lg:col-span-2 p-5 grid sm:grid-cols-2 gap-x-8 gap-y-5 content-start">
        <div className="sm:col-span-2"><Field label="Description">{product.description}</Field></div>
        <Field label="Target audience">{product.target_audience}</Field>
        <Field label="Positioning">{product.positioning}</Field>
        <Field label="Customer desires"><List items={product.customer_desires} /></Field>
        <Field label="Pain points"><List items={product.pain_points} /></Field>
        <Field label="Competitors"><List items={product.competitors} /></Field>
        <Field label="Tone">{product.tone}</Field>
      </Card>
      <Card className="p-4 self-start">
        <SectionHead>Tracked sources</SectionHead>
        {sources.length === 0 && <p className="text-fg-3 text-[13px]">None yet. <code className="num">pnpm product add-source</code></p>}
        <ul className="flex flex-col">
          {sources.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 py-2 border-t border-line first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <div className="truncate text-[13px]">{s.label ?? s.value}</div>
                <div className="num text-xs text-fg-3 mt-0.5 truncate">{s.source} · {s.kind}={s.value} · {s.country}</div>
              </div>
              <Badge tone={s.enabled ? "green" : "neutral"}>{s.enabled ? "on" : "off"}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
