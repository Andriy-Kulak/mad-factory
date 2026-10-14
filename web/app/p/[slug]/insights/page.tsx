import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { parseInsightFilters, type SearchParams } from "@/lib/insights";
import { InsightsTab } from "@/components/insights-tab";

export const dynamic = "force-dynamic";

export default async function InsightsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  return <InsightsTab product={{ id: product.id, slug }} initial={parseInsightFilters(sp)} />;
}
