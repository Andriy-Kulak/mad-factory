import "server-only";
import { getDb } from "./db";

export type BrandDoc = {
  name: string;
  title: string;
  markdown: string;
};

export async function listBrandDocs(productId: string): Promise<BrandDoc[]> {
  const result = await getDb().from("product_docs").select("name, title, body_md").eq("product_id", productId).in("kind", ["brand", "research"]).order("sort").order("name");
  if (result.error) throw new Error(`product_docs: ${result.error.message}`);
  return (result.data ?? []).map((doc) => ({
    name: doc.name,
    title: doc.title ?? (doc.name === "readme" ? "Overview" : doc.name),
    markdown: doc.body_md,
  }));
}
