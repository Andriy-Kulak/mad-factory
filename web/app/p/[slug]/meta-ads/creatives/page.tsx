import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { parseRange } from "@/components/meta-ads";
import { MetaAdsTab } from "@/components/meta-ads-tab";

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
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const range = parseRange(sp);
  return <MetaAdsTab product={{ id: product.id, slug }} view="attributes" range={range} params={{ days: sp.days, from: sp.from, to: sp.to }} by={sp.by} then={sp.then} />;
}
