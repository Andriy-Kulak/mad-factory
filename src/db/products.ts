import { getDb, unwrap } from "./client.ts";
import { docName } from "../lib/product-docs.ts";
import type { Json, ProductDocInsert, ProductDocRow, ProductInsert, ProductRow, ProductUpdate, TrackedSourceInsert, TrackedSourceRow } from "./types.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listProducts(): Promise<ProductRow[]> {
  return unwrap(await getDb().from("products").select("*").order("created_at"), "listProducts");
}

/** Resolve a product by UUID or slug. */
export async function findProduct(ref: string): Promise<ProductRow | null> {
  const q = getDb().from("products").select("*");
  const res = UUID_RE.test(ref) ? await q.eq("id", ref).maybeSingle() : await q.eq("slug", ref).maybeSingle();
  if (res.error) throw new Error(`findProduct: ${res.error.message}`);
  return res.data;
}

export async function requireProduct(ref: string): Promise<ProductRow> {
  const p = await findProduct(ref);
  if (!p) throw new Error(`Product not found: ${ref}`);
  return p;
}

export async function createProduct(input: ProductInsert): Promise<ProductRow> {
  return unwrap(await getDb().from("products").insert(input).select("*").single(), "createProduct");
}

export async function updateProduct(id: string, patch: ProductUpdate): Promise<ProductRow> {
  return unwrap(await getDb().from("products").update(patch).eq("id", id).select("*").single(), "updateProduct");
}

export async function deleteProduct(id: string): Promise<void> {
  const res = await getDb().from("products").delete().eq("id", id);
  if (res.error) throw new Error(`deleteProduct: ${res.error.message}`);
}

export async function listProductDocs(productId: string, kinds?: string[]): Promise<ProductDocRow[]> {
  let query = getDb().from("product_docs").select("*").eq("product_id", productId);
  if (kinds !== undefined) query = query.in("kind", kinds);
  return unwrap(await query.order("sort").order("name"), "listProductDocs");
}

export async function getProductDoc(productId: string, name: string): Promise<ProductDocRow | null> {
  const result = await getDb().from("product_docs").select("*").eq("product_id", productId).eq("name", name).maybeSingle();
  if (result.error) throw new Error(`getProductDoc: ${result.error.message}`);
  return result.data;
}

export async function requirePlanDoc(productId: string, ref: string): Promise<string> {
  const name = docName(ref);
  const doc = await getProductDoc(productId, name);
  if (!doc || doc.kind !== "plan") {
    throw new Error(`plan not found: ${name} (add it with: pnpm product docs add <slug> --kind plan --file <path>)`);
  }
  return name;
}

export async function upsertProductDocs(rows: ProductDocInsert[]): Promise<void> {
  if (!rows.length) return;
  const updatedAt = new Date().toISOString();
  unwrap(
    await getDb()
      .from("product_docs")
      .upsert(
        rows.map((row) => ({ ...row, updated_at: updatedAt })),
        { onConflict: "product_id,name" },
      )
      .select("*"),
    "upsertProductDocs",
  );
}

export async function listTrackedSources(productId: string, onlyEnabled = false): Promise<TrackedSourceRow[]> {
  let q = getDb().from("tracked_sources").select("*").eq("product_id", productId).order("created_at");
  if (onlyEnabled) q = q.eq("enabled", true);
  return unwrap(await q, "listTrackedSources");
}

export async function getTrackedSource(id: string): Promise<TrackedSourceRow | null> {
  const res = await getDb().from("tracked_sources").select("*").eq("id", id).maybeSingle();
  if (res.error) throw new Error(`getTrackedSource: ${res.error.message}`);
  return res.data;
}

/** Idempotent on (product, source, kind, value, country). */
export async function addTrackedSource(input: TrackedSourceInsert): Promise<TrackedSourceRow> {
  return unwrap(await getDb().from("tracked_sources").upsert(input, { onConflict: "product_id,source,kind,value,country" }).select("*").single(), "addTrackedSource");
}

export async function setTrackedSourceEnabled(id: string, enabled: boolean): Promise<void> {
  const res = await getDb().from("tracked_sources").update({ enabled }).eq("id", id);
  if (res.error) throw new Error(`setTrackedSourceEnabled: ${res.error.message}`);
}

export async function removeTrackedSource(id: string): Promise<void> {
  const res = await getDb().from("tracked_sources").delete().eq("id", id);
  if (res.error) throw new Error(`removeTrackedSource: ${res.error.message}`);
}

export async function markSourceScraped(id: string): Promise<void> {
  const res = await getDb().from("tracked_sources").update({ last_scraped_at: new Date().toISOString() }).eq("id", id);
  if (res.error) throw new Error(`markSourceScraped: ${res.error.message}`);
}

export async function updateTrackedSourceConfig(id: string, config: Json): Promise<void> {
  const res = await getDb().from("tracked_sources").update({ config }).eq("id", id);
  if (res.error) throw new Error(`updateTrackedSourceConfig: ${res.error.message}`);
}
