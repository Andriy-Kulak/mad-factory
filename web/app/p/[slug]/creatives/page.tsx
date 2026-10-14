import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { parseCreativeFilters, type SearchParams } from "@/lib/creative-groups";
import { CreativesTab } from "@/components/creatives-tab";

export const dynamic = "force-dynamic";

export default async function CreativesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  return <CreativesTab product={{ id: product.id, slug }} initial={parseCreativeFilters(sp)} />;
}
