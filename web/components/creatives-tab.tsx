"use client";

import { useTab } from "@/lib/use-tab";
import { LONG_RUN_DAYS, type parseCreativeFilters } from "@/lib/creative-groups";
import { Shell } from "@/components/shell";
import { Empty, Stat } from "@/components/ui";
import { CreativeBrowser } from "@/components/creative-browser";
import { PageSkeleton } from "@/components/skeleton";
import { TabLoadError } from "@/components/tab-load-error";

export function CreativesTab({ product, initial }: { product: { id: string; slug: string }; initial: ReturnType<typeof parseCreativeFilters> }) {
  const { data: items, isPending, isError, refetch } = useTab(product, "creatives");
  if (isPending) return <PageSkeleton title="Creatives" stats={5} body="grid" sidebar />;
  if (isError || !items) return <TabLoadError title="Creatives" retry={() => void refetch()} />;
  const { slug } = product;
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
        <CreativeBrowser items={items} initial={initial} />
      )}
    </Shell>
  );
}
