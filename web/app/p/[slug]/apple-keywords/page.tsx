import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/queries";
import { AppleKeywordsTab } from "@/components/apple-keywords-tab";

export const dynamic = "force-dynamic";

export default async function AppleKeywordsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ days?: string }> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const requested = Number(sp.days);
  const days = [7, 14, 28, 90].includes(requested) ? requested : 28;
  return <AppleKeywordsTab product={{ id: product.id, slug }} days={days} />;
}
