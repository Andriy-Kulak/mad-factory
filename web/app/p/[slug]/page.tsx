import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { DEFAULT_WINDOW_DAYS } from "@/lib/overview";
import { OVERVIEW_WINDOWS } from "@/lib/tab-constants";
import { OverviewTab } from "@/components/overview-tab";

export const dynamic = "force-dynamic";

export default async function ProductOverview({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ days?: string; present?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const requested = Number(sp.days);
  const days = OVERVIEW_WINDOWS.includes(requested) ? requested : DEFAULT_WINDOW_DAYS;
  return <OverviewTab product={{ id: product.id, slug: product.slug }} days={days} present={sp.present === "1"} />;
}
