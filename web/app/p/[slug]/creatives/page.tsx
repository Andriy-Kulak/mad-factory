import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { listCreativeItemsCached } from "@/lib/creatives";
import { LONG_RUN_DAYS, parseCreativeFilters, type SearchParams } from "@/lib/creative-groups";
import { Shell } from "@/components/shell";
import { Empty, Stat } from "@/components/ui";
import { CreativeBrowser } from "@/components/creative-browser";

export const dynamic = "force-dynamic";

export default async function CreativesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const items = await listCreativeItemsCached(product.id);
  const own = items.filter((it) => it.owner === "own").length;
  return (
    <Shell title="Creatives" subtitle="AI breakdown of every stored ad video and image, ours and competitors' · competitor run length from the Ad Library">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Stat label="Ours" value={own} />
        <Stat label="Competitors" value={items.length - own} />
        <Stat label="Ran 30+ days" value={items.filter((it) => it.bucket === "long").length} hint="competitor media" />
        <Stat label="Ran 90+ days" value={items.filter((it) => it.bucket === "long" && (it.days ?? 0) >= LONG_RUN_DAYS).length} hint="competitor media" />
        <Stat label="Stopped within 14 days" value={items.filter((it) => it.bucket === "stopped").length} hint="competitor media" />
      </div>
      {items.length === 0 ? (
        <Empty>
          No profiled creatives yet. Run <code>pnpm creatives profile --product {slug}</code>.
        </Empty>
      ) : (
        <CreativeBrowser items={items} initial={parseCreativeFilters(sp)} />
      )}
    </Shell>
  );
}
