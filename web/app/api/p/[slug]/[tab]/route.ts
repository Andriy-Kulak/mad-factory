import { getProductBySlug } from "@/lib/queries";
import { tabLoaders, type TabName } from "@/lib/tab-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; tab: string }> }) {
  const { slug, tab } = await params;
  if (!Object.hasOwn(tabLoaders, tab)) return Response.json({ error: "Unknown tab" }, { status: 404 });

  const product = await getProductBySlug(slug);
  if (!product) return Response.json({ error: "Unknown product" }, { status: 404 });

  return Response.json(await tabLoaders[tab as TabName](product, new URL(request.url).searchParams));
}
