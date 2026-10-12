"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "./auth/server";
import { getDb } from "./db";
import { insertTrackedSource, type TrackedSourceInsert } from "./research-writes";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "./social";
import { isAdRelation, parseAdLibraryInput, parseSocialAccountInput, type AdRelation } from "../../src/lib/tracked-source-input.ts";

export type SourceFormState = { error?: string; ok?: string } | null;

const RELATIONS = ["own", "competitor", "inspiration"];
/** Sources the web manage lists may pause or remove; other integrations (Apple Ads, RevenueCat…) stay CLI-only. */
const MANAGED_SOURCES = ["meta", ...SOCIAL_PLATFORMS];

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function insertSource(slug: string, row: TrackedSourceInsert, what: string): Promise<SourceFormState> {
  const result = await insertTrackedSource(row, what);
  if (result.ok) revalidatePath(`/p/${slug}`, "layout");
  return result;
}

export async function addSocialAccount(productId: string, slug: string, _prev: SourceFormState, form: FormData): Promise<SourceFormState> {
  await requireOwner();
  const platform = field(form, "platform") as SocialPlatformKey;
  const relation = field(form, "relation");
  if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) return { error: "Pick a platform." };
  if (!RELATIONS.includes(relation)) return { error: "Pick what kind of account this is." };
  let value: string;
  try {
    value = parseSocialAccountInput(platform, field(form, "value"));
  } catch (e) {
    return { error: message(e) };
  }
  return insertSource(
    slug,
    { product_id: productId, source: platform, kind: "account", value, country: "ALL", label: field(form, "label") || null, config: { relation } },
    platform === "facebook" ? "That Facebook page" : `@${value}`,
  );
}

export async function addAdLibrarySource(productId: string, slug: string, _prev: SourceFormState, form: FormData): Promise<SourceFormState> {
  await requireOwner();
  const relation = field(form, "relation");
  if (!isAdRelation(relation)) return { error: "Pick whether this is a direct competitor or an adjacent niche." };
  let parsed: ReturnType<typeof parseAdLibraryInput>;
  try {
    parsed = parseAdLibraryInput(field(form, "value"));
  } catch (e) {
    return { error: message(e) };
  }
  return insertSource(
    slug,
    { product_id: productId, source: "meta", kind: parsed.kind, value: parsed.value, country: parsed.country, label: field(form, "label") || null, config: { ...parsed.config, relation } },
    parsed.kind === "page" ? `Page ${parsed.value}` : `"${parsed.value}"`,
  );
}

/** Marks an Ad Library source as a direct competitor or an adjacent niche (inspiration); other config is kept. */
export async function setAdSourceRelation(productId: string, slug: string, id: string, relation: AdRelation): Promise<void> {
  await requireOwner();
  if (!isAdRelation(relation)) throw new Error(`Unknown relation: ${relation}`);
  const db = getDb();
  const cur = await db.from("tracked_sources").select("config").match({ id, product_id: productId, source: "meta" }).single();
  if (cur.error) throw new Error(cur.error.message);
  const config = cur.data.config && typeof cur.data.config === "object" && !Array.isArray(cur.data.config) ? cur.data.config : {};
  const res = await db
    .from("tracked_sources")
    .update({ config: { ...config, relation } })
    .match({ id, product_id: productId, source: "meta" });
  if (res.error) throw new Error(res.error.message);
  revalidatePath(`/p/${slug}`, "layout");
}

export async function setSourceEnabled(productId: string, slug: string, id: string, enabled: boolean): Promise<void> {
  await requireOwner();
  const res = await getDb().from("tracked_sources").update({ enabled }).match({ id, product_id: productId }).in("source", MANAGED_SOURCES);
  if (res.error) throw new Error(res.error.message);
  revalidatePath(`/p/${slug}`, "layout");
}

/** Stops tracking; stored accounts, posts, ads and their history are kept. */
export async function removeSource(productId: string, slug: string, id: string): Promise<void> {
  await requireOwner();
  const res = await getDb().from("tracked_sources").delete().match({ id, product_id: productId }).in("source", MANAGED_SOURCES);
  if (res.error) throw new Error(res.error.message);
  revalidatePath(`/p/${slug}`, "layout");
}
