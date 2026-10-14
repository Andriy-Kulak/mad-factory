import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { AppleAdsTab } from "@/components/apple-ads-tab";

export const dynamic = "force-dynamic";

export default async function AppleAdsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ days?: string; from?: string; to?: string; view?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  return <AppleAdsTab product={{ id: product.id, slug }} params={{ days: sp.days, from: sp.from, to: sp.to }} view={sp.view} />;
}
