import { getProductBySlug } from "@/lib/queries";
import { commentersCsv, leads } from "@/lib/b2b-social";
import { loadB2BSocial } from "@/lib/b2b-social-data";

export const dynamic = "force-dynamic";

/** Outside commenters' comments, best leads first, with title, seniority, employer and company tier, for an enrichment tool. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  const data = product ? await loadB2BSocial(slug) : null;
  if (!data) return new Response("No social reach snapshot for this product", { status: 404 });
  return new Response(
    commentersCsv(
      leads(data).flatMap((lead) => lead.touches),
      data.companies,
    ),
    {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${slug}-leads-${data.capturedAt}.csv"` },
    },
  );
}
