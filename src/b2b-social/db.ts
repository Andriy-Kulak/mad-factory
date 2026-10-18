import { getDb, unwrap } from "../db/client.ts";
import type { B2BCommentInsert, B2BCommentRow, B2BPersonInsert, B2BPersonRow, B2BPostInsert, B2BPostRow, Json, TrackedSourceRow } from "../db/types.ts";

/** Watched accounts are tracked_sources rows with this source; kind is the platform, value the handle. */
export const B2B_SOURCE = "b2b_social";

export type B2BGroup = "company" | "team" | "competitor";

/** What a watched account's tracked_sources.config holds. */
export interface B2BAccountConfig {
  group: B2BGroup;
  url: string;
  followers: number | null;
  employees?: number | null;
  sample?: "recent" | "popular";
  /** Whether the sync collects replies and comments on its posts (off for accounts kept for content stats only). */
  replies: boolean;
  /** X user id, resolved once. */
  x_user_id?: string;
  /** Newest post id seen; the next run asks only for newer posts. */
  last_post_id?: string;
}

const BATCH = 500;

async function upsertBatches<T extends object>(table: "b2b_posts" | "b2b_people" | "b2b_comments", input: T[], onConflict: string, ignoreDuplicates = false): Promise<void> {
  // Postgres rejects one statement touching the same key twice; keep the last row per key.
  const keys = onConflict.split(",");
  const rows = [...new Map(input.map((r) => [keys.map((k) => String((r as Record<string, unknown>)[k])).join("\u0000"), r])).values()];
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await getDb()
      .from(table)
      .upsert(rows.slice(i, i + BATCH) as never, { onConflict, ignoreDuplicates });
    if (res.error) throw new Error(`upsert ${table}: ${res.error.message}`);
  }
}

export async function listB2BSources(productId: string): Promise<TrackedSourceRow[]> {
  return unwrap(await getDb().from("tracked_sources").select("*").eq("product_id", productId).eq("source", B2B_SOURCE).order("created_at"), "listB2BSources");
}

export async function upsertB2BSource(productId: string, platform: "x" | "linkedin", handle: string, name: string, config: B2BAccountConfig): Promise<TrackedSourceRow> {
  return unwrap(
    await getDb()
      .from("tracked_sources")
      .upsert(
        { product_id: productId, source: B2B_SOURCE, kind: platform, value: handle, country: "ALL", label: name, config: config as unknown as Json },
        { onConflict: "product_id,source,kind,value,country" },
      )
      .select("*")
      .single(),
    "upsertB2BSource",
  );
}

export async function updateB2BSource(id: string, config: B2BAccountConfig): Promise<void> {
  const res = await getDb()
    .from("tracked_sources")
    .update({ config: config as unknown as Json, last_scraped_at: new Date().toISOString() })
    .eq("id", id);
  if (res.error) throw new Error(`updateB2BSource: ${res.error.message}`);
}

export const upsertB2BPosts = (rows: B2BPostInsert[]) => upsertBatches("b2b_posts", rows, "product_id,platform,external_id");
/** Known people keep their enrichment: a re-seen person only refreshes what the source returned. */
export const upsertB2BPeople = (rows: B2BPersonInsert[]) => upsertBatches("b2b_people", rows, "product_id,url");
export const insertB2BComments = (rows: B2BCommentInsert[]) => upsertBatches("b2b_comments", rows, "post_id,external_id", true);

export async function listB2BPosts(productId: string): Promise<B2BPostRow[]> {
  const out: B2BPostRow[] = [];
  for (let from = 0; ; from += 1000) {
    const page = unwrap(
      await getDb()
        .from("b2b_posts")
        .select("*")
        .eq("product_id", productId)
        .range(from, from + 999),
      "listB2BPosts",
    );
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

export async function listB2BPeople(productId: string): Promise<B2BPersonRow[]> {
  const out: B2BPersonRow[] = [];
  for (let from = 0; ; from += 1000) {
    const page = unwrap(
      await getDb()
        .from("b2b_people")
        .select("*")
        .eq("product_id", productId)
        .range(from, from + 999),
      "listB2BPeople",
    );
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

export async function listB2BComments(productId: string): Promise<B2BCommentRow[]> {
  const out: B2BCommentRow[] = [];
  for (let from = 0; ; from += 1000) {
    const page = unwrap(
      await getDb()
        .from("b2b_comments")
        .select("*")
        .eq("product_id", productId)
        .range(from, from + 999),
      "listB2BComments",
    );
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

export async function updateB2BPerson(productId: string, url: string, patch: Partial<B2BPersonRow>): Promise<void> {
  const res = await getDb().from("b2b_people").update(patch).eq("product_id", productId).eq("url", url);
  if (res.error) throw new Error(`updateB2BPerson: ${res.error.message}`);
}

export async function knownPeopleUrls(productId: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const page = unwrap(
      await getDb()
        .from("b2b_people")
        .select("url")
        .eq("product_id", productId)
        .range(from, from + 999),
      "knownPeopleUrls",
    );
    for (const p of page) out.add(p.url);
    if (page.length < 1000) return out;
  }
}

/** Comment authors (url → name) for a product, to find commenters with no person row yet. */
export async function commentAuthors(productId: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let from = 0; ; from += 1000) {
    const page = unwrap(
      await getDb()
        .from("b2b_comments")
        .select("author_url, author_name")
        .eq("product_id", productId)
        .not("author_url", "is", null)
        .range(from, from + 999),
      "commentAuthors",
    );
    for (const c of page) if (c.author_url) out.set(c.author_url, c.author_name);
    if (page.length < 1000) return out;
  }
}

/** LinkedIn people not looked up yet, oldest first. */
export async function unenrichedLinkedIn(productId: string): Promise<{ url: string; name: string | null }[]> {
  return unwrap(
    await getDb().from("b2b_people").select("url, name").eq("product_id", productId).is("enriched_at", null).like("url", "https://www.linkedin.com/in/%").order("first_seen_at"),
    "unenrichedLinkedIn",
  );
}

/**
 * Adds a watched account, or updates one: keeps what the sync learned (X user id, last post seen, followers) unless
 * `reset` clears the marker, in which case the next sync backfills again (X: the last 7 days; LinkedIn: the latest posts).
 */
export async function addB2BSource(
  productId: string,
  input: { platform: "x" | "linkedin"; handle: string; url: string; name: string | null; group: B2BGroup; replies: boolean; reset: boolean },
): Promise<{ row: TrackedSourceRow; created: boolean }> {
  const existing = (await listB2BSources(productId)).find((s) => s.kind === input.platform && s.value === input.handle);
  const prev = (existing?.config ?? {}) as unknown as Partial<B2BAccountConfig>;
  const config: B2BAccountConfig = { ...prev, group: input.group, url: input.url, followers: prev.followers ?? null, replies: input.replies };
  if (input.reset) delete config.last_post_id;
  const row = await upsertB2BSource(productId, input.platform, input.handle, input.name ?? existing?.label ?? input.handle, config);
  return { row, created: !existing };
}
