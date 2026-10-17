import { getProductBySlug } from "@/lib/queries";
import { commenterRows, commentersCsv } from "@/lib/social-reach";
import { loadSocialReach } from "@/lib/social-reach-data";

export const dynamic = "force-dynamic";

/** Every LinkedIn comment with its kind, the commenter's employer and the post, for an enrichment tool. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  const data = product ? await loadSocialReach(slug) : null;
  if (!data) return new Response("No social reach snapshot for this product", { status: 404 });
  return new Response(commentersCsv(commenterRows(data)), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${slug}-commenters-${data.capturedAt}.csv"` },
  });
}
