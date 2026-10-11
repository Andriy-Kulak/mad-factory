import { getDb } from "../db/client.ts";
import { requireProduct } from "../db/products.ts";
import { getCreativeProfile, upsertCreativeProfile } from "../db/creative-profiles.ts";
import { download } from "../lib/storage.ts";
import type { CreativeProfileRow, CreativeRow, ProductRow } from "../db/types.ts";
import { complete, type ChatMessage, type Completion } from "./gateway.ts";
import { completeGemini } from "./gemini.ts";
import { angleProblem, loadProductVocab } from "./vocab.ts";
import { buildProfilePrompt } from "./prompt.ts";
import type { ProductVocab, UsedSlugs } from "./prompt.ts";
import { parseCreativeProfile, SCHEMA_VERSION, type CreativeProfile } from "./schema.ts";

/** Profile each stored media file with an LLM and save the validated document. */

const MAX_BYTES = 20 * 1024 * 1024;

export interface ProfileOptions {
  source: "own" | "library" | "all";
  limit?: number;
  /** Ad Library media only: skip files whose longest-running ad ran fewer days (one-day tests never cost a call). */
  minDays?: number;
  model: string;
  force: boolean;
  concurrency: number;
  dryRun: boolean;
}

export interface ProfileStats {
  selected: number;
  profiled: number;
  skipped: number;
  failures: number;
}

/** One Ad Library ad's media file; `days` is how long that ad ran (to today while it is active). */
export interface LibraryMedia {
  sha256: string;
  start_date: string | null;
  days: number | null;
}

export interface ProfileDeps {
  requireProduct(slug: string): Promise<ProductRow>;
  loadVocab(productId: string): Promise<ProductVocab>;
  listOwnShas(productId: string): Promise<string[]>;
  listLibraryShas(productId: string): Promise<LibraryMedia[]>;
  listCreatives(shas: string[]): Promise<CreativeRow[]>;
  /** Which of these files already have a profile (llm or manual). */
  listProfiledShas(shas: string[]): Promise<Set<string>>;
  getProfile(sha256: string): Promise<CreativeProfileRow | null>;
  listUsedSlugs(): Promise<UsedSlugs>;
  complete(messages: ChatMessage[], options: { model: string }): Promise<Completion>;
  download(url: string): Promise<Buffer>;
  upsertProfile(sha256: string, profile: unknown): Promise<unknown>;
  log(message: string): void;
}

/** Read `a.b` / `a[0].b` style paths out of a profile object. */
export function getPath(obj: unknown, path: string): unknown {
  const segments = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Set `a.b` / `a[0].b` style paths on a profile object. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: Record<string, unknown> = obj;
  for (const [i, segment] of segments.slice(0, -1).entries()) {
    const next = current[segment];
    if (next === null || typeof next !== "object") {
      const following = segments[i + 1]!;
      current[segment] = /^\d+$/.test(following) ? [] : {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]!] = value;
}

/** Strip a leading/trailing code fence from model output. */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
}

/**
 * Wrap raw model JSON into a profile document; our schema_version,
 * media_type and _meta always win over whatever the model wrote.
 */
export function wrapProfile(modelJson: unknown, mediaType: "video" | "image", model: string): unknown {
  const body = modelJson && typeof modelJson === "object" && !Array.isArray(modelJson) ? modelJson : {};
  return {
    ...body,
    schema_version: SCHEMA_VERSION,
    media_type: mediaType,
    _meta: { by: "llm", model, at: new Date().toISOString(), manual_keys: [] },
  };
}

/** Copy manually-set paths from an old profile into a new one. */
export function mergeManualKeys(newProfile: Record<string, unknown>, oldProfile: Record<string, unknown>): Record<string, unknown> {
  const oldMeta = oldProfile._meta as { manual_keys?: unknown } | undefined;
  const manualKeys = Array.isArray(oldMeta?.manual_keys) ? oldMeta.manual_keys.filter((key): key is string => typeof key === "string") : [];
  for (const key of manualKeys) {
    setPath(newProfile, key, getPath(oldProfile, key));
  }
  (newProfile._meta as Record<string, unknown>).manual_keys = manualKeys;
  return newProfile;
}

export interface Candidate {
  sha256: string;
  owner: "own" | "competitor";
}

export async function selectCandidates(deps: ProfileDeps, productId: string, options: Pick<ProfileOptions, "source" | "minDays">): Promise<Candidate[]> {
  const own = options.source === "library" ? [] : await deps.listOwnShas(productId);
  const ownSet = new Set(own);
  const candidates: Candidate[] = own.map((sha256) => ({ sha256, owner: "own" as const }));

  if (options.source !== "own") {
    const seen = new Set(ownSet);
    const library = await deps.listLibraryShas(productId);
    // A file can back several ads; it qualifies on its longest run.
    const longest = new Map<string, number>();
    for (const row of library) longest.set(row.sha256, Math.max(longest.get(row.sha256) ?? 0, row.days ?? 0));
    const sorted = [...library]
      .filter((row) => !options.minDays || (longest.get(row.sha256) ?? 0) >= options.minDays)
      .sort((a, b) => {
        if (a.start_date === null) return b.start_date === null ? 0 : 1;
        if (b.start_date === null) return -1;
        return a.start_date.localeCompare(b.start_date);
      });
    for (const row of sorted) {
      if (seen.has(row.sha256)) continue;
      seen.add(row.sha256);
      candidates.push({ sha256: row.sha256, owner: "competitor" });
    }
  }
  return candidates;
}

/** Image mime from the stored file's extension. */
export function imageMime(storageKey: string): string {
  const ext = storageKey.slice(storageKey.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

async function profileOne(
  item: Candidate & { creative: CreativeRow; existing: CreativeProfileRow | null },
  ctx: {
    deps: ProfileDeps;
    options: ProfileOptions;
    product: ProductRow;
    vocab: ProductVocab;
    used: {
      angles: Set<string>;
      audiences: Set<string>;
      pain_points: Set<string>;
      desires: Set<string>;
      features: Set<string>;
    };
  },
): Promise<"profiled" | "failed" | "skipped"> {
  const { deps, options, product, vocab } = ctx;
  const { sha256, owner, creative, existing } = item;
  const tag = `${sha256.slice(0, 8)} (${owner} ${creative.media_type})`;

  if (existing && existing.profiled_by === "manual") {
    deps.log(`  = ${tag}: manual profile, skipped`);
    return "skipped";
  }
  if (existing && !options.force) {
    deps.log(`  = ${tag}: already profiled, skipped`);
    return "skipped";
  }
  if (!creative.public_url) {
    deps.log(`  ! ${tag}: no public_url`);
    return "skipped";
  }
  if (creative.bytes > MAX_BYTES) {
    deps.log(`  ! ${tag}: ${(creative.bytes / 1e6).toFixed(1)} MB exceeds 20 MB limit`);
    return "skipped";
  }

  const mediaType = creative.media_type as "video" | "image";
  const manualKeys = new Set(((existing?.profile as { _meta?: { manual_keys?: unknown } } | undefined)?._meta?.manual_keys ?? []) as string[]);
  const checkProfile = (candidate: unknown): void => {
    parseCreativeProfile(candidate);
    // strategy.angle will be overwritten by the manual-key merge, so don't check it.
    if (!manualKeys.has("strategy.angle")) {
      const angle = (candidate as { strategy?: { angle?: string | null } }).strategy?.angle ?? null;
      const problem = angleProblem(angle, vocab);
      if (problem) throw new Error(`Invalid creative profile:\n${problem}`);
    }
  };
  try {
    const buf = await deps.download(creative.public_url);
    const b64 = buf.toString("base64");
    const mediaPart =
      mediaType === "video"
        ? { type: "file", file: { filename: "ad.mp4", file_data: `data:video/mp4;base64,${b64}` } }
        : { type: "image_url", image_url: { url: `data:${imageMime(creative.storage_key)};base64,${b64}` } };
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildProfilePrompt({
              productName: product.name,
              productDescription: product.description,
              mediaType,
              owner,
              vocab: {
                ...vocab,
                used: {
                  angles: [...ctx.used.angles].sort(),
                  audiences: [...ctx.used.audiences].sort(),
                  pain_points: [...ctx.used.pain_points].sort(),
                  desires: [...ctx.used.desires].sort(),
                  features: [...ctx.used.features].sort(),
                },
              },
            }),
          },
          mediaPart,
        ],
      },
    ];

    let reply = await deps.complete(messages, { model: options.model });
    let parsed: unknown;
    let error: Error | null = null;
    try {
      parsed = wrapProfile(JSON.parse(stripFences(reply.content)), mediaType, options.model);
      checkProfile(parsed);
    } catch (firstFailure) {
      error = firstFailure as Error;
    }

    if (error) {
      // One repair turn, then give up.
      messages.push({ role: "assistant", content: reply.content });
      messages.push({
        role: "user",
        content: `Your JSON failed validation:\n${error.message}\nReturn the corrected full JSON object only.`,
      });
      reply = await deps.complete(messages, { model: options.model });
      error = null;
      try {
        parsed = wrapProfile(JSON.parse(stripFences(reply.content)), mediaType, options.model);
        checkProfile(parsed);
      } catch (secondFailure) {
        deps.log(`  ! ${tag}: profile invalid after repair turn: ${(secondFailure as Error).message.split("\n")[0]}`);
        return "failed";
      }
      deps.log(`  ~ ${tag}: repaired after one turn`);
    }

    let profile = parsed as Record<string, unknown>;
    if (options.force && existing) {
      profile = mergeManualKeys(profile, existing.profile as Record<string, unknown>);
    }
    const validated = parseCreativeProfile(profile);

    // Later items in this run see slugs invented here.
    const strategy = validated.strategy;
    if (strategy.angle && !vocab.library) ctx.used.angles.add(strategy.angle);
    if (strategy.audience) ctx.used.audiences.add(strategy.audience);
    for (const slug of strategy.pain_points) ctx.used.pain_points.add(slug);
    for (const slug of strategy.desires) ctx.used.desires.add(slug);
    for (const slug of strategy.features) ctx.used.features.add(slug);

    if (options.dryRun) {
      deps.log(`  + ${tag}: dry-run\n${JSON.stringify(validated, null, 2)}`);
    } else {
      await deps.upsertProfile(sha256, validated);
      const usage = reply.usage ? ` · tokens ${JSON.stringify(reply.usage)}` : "";
      deps.log(`  + ${tag}: profiled${usage}`);
    }
    return "profiled";
  } catch (itemError) {
    deps.log(`  ! ${tag}: ${itemError instanceof Error ? itemError.message : String(itemError)}`);
    return "failed";
  }
}

export async function profileCreatives(productSlug: string, options: ProfileOptions, deps: ProfileDeps = defaultDeps): Promise<ProfileStats> {
  const product = await deps.requireProduct(productSlug);
  const vocab = await deps.loadVocab(product.id);
  // Slugs already used across all profiles, minus what the brand docs define,
  // so the prompt can steer new profiles to reuse them.
  const stored = await deps.listUsedSlugs();
  const brandAngles = new Set(vocab.angles.map((angle) => angle.slug));
  const brandAudiences = new Set(vocab.audiences.map((audience) => audience.slug));
  const brandDesires = new Set(vocab.desires);
  const used = {
    angles: new Set(vocab.library ? [] : stored.angles.filter((slug) => !brandAngles.has(slug))),
    audiences: new Set(stored.audiences.filter((slug) => !brandAudiences.has(slug))),
    pain_points: new Set(stored.pain_points),
    desires: new Set(stored.desires.filter((slug) => !brandDesires.has(slug))),
    features: new Set(stored.features),
  };
  const candidates = await selectCandidates(deps, product.id, options);
  const stats: ProfileStats = { selected: 0, profiled: 0, skipped: 0, failures: 0 };

  const shas = candidates.map((candidate) => candidate.sha256);
  const creatives = new Map((await deps.listCreatives(shas)).map((row) => [row.sha256, row]));

  const eligible: (Candidate & { creative: CreativeRow; existing: CreativeProfileRow | null })[] = [];
  for (const candidate of candidates) {
    const creative = creatives.get(candidate.sha256);
    if (!creative || (creative.media_type !== "video" && creative.media_type !== "image")) {
      deps.log(`  = ${candidate.sha256.slice(0, 8)}: media_type ${creative?.media_type ?? "missing"}, skipped`);
      stats.skipped++;
      continue;
    }
    eligible.push({ ...candidate, creative, existing: null });
  }
  // Drop files that already have a profile before --limit, so a capped daily run spends its calls on new media.
  const profiled = options.force ? new Set<string>() : await deps.listProfiledShas(eligible.map((e) => e.sha256));
  const todo = eligible.filter((e) => !profiled.has(e.sha256));
  stats.skipped += eligible.length - todo.length;
  if (profiled.size) deps.log(`  = ${eligible.length - todo.length} already profiled, skipped`);
  const limited = options.limit ? todo.slice(0, options.limit) : todo;
  stats.skipped += todo.length - limited.length;
  stats.selected = limited.length;
  deps.log(`${limited.length} creative(s) to profile for ${product.slug} (${options.source}, model ${options.model}${options.dryRun ? ", dry-run" : ""})`);

  const ctx = { deps, options, product, vocab, used };
  let index = 0;
  const worker = async () => {
    for (;;) {
      const item = limited[index++];
      if (!item) return;
      item.existing = await deps.getProfile(item.sha256);
      const outcome = await profileOne(item, ctx);
      stats[outcome === "failed" ? "failures" : outcome]++;
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency, limited.length)) }, worker);
  await Promise.all(workers);
  return stats;
}

const PAGE = 1000;
// sha256 lists go in the request URL; 100 hashes keep it well under PostgREST's URL limit.
const IN_CHUNK = 100;

async function listOwnShas(productId: string): Promise<string[]> {
  const db = getDb();
  const shas = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const res = await db
      .from("meta_ads_creatives")
      .select("sha256")
      .eq("product_id", productId)
      .not("sha256", "is", null)
      .range(from, from + PAGE - 1);
    if (res.error) throw new Error(`listOwnShas: ${res.error.message}`);
    for (const row of res.data ?? []) if (row.sha256) shas.add(row.sha256);
    if ((res.data ?? []).length < PAGE) return [...shas];
  }
}

const DAY_MS = 86_400_000;

/** Days an ad ran: start to end, or to `now` while it is still active. */
export function runDays(ad: { start_date: string | null; end_date: string | null; is_active: boolean | null }, now = Date.now()): number | null {
  if (!ad.start_date) return null;
  const end = ad.is_active || !ad.end_date ? now : Date.parse(ad.end_date);
  return Math.max(0, Math.floor((end - Date.parse(ad.start_date)) / DAY_MS));
}

async function listLibraryShas(productId: string): Promise<LibraryMedia[]> {
  const db = getDb();
  const out: LibraryMedia[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await db
      .from("product_ads")
      .select("ads!inner(start_date, end_date, is_active, ad_creatives!inner(sha256))")
      .eq("product_id", productId)
      .range(from, from + PAGE - 1);
    if (res.error) throw new Error(`listLibraryShas: ${res.error.message}`);
    for (const row of res.data ?? []) {
      const ad = row.ads as unknown as { start_date: string | null; end_date: string | null; is_active: boolean | null; ad_creatives: { sha256: string }[] };
      const days = runDays(ad);
      for (const creative of ad.ad_creatives ?? []) {
        out.push({ sha256: creative.sha256, start_date: ad.start_date, days });
      }
    }
    if ((res.data ?? []).length < PAGE) return out;
  }
}

async function listUsedSlugs(): Promise<UsedSlugs> {
  const db = getDb();
  const used: UsedSlugs = { angles: [], audiences: [], pain_points: [], desires: [], features: [] };
  const sets = {
    angles: new Set<string>(),
    audiences: new Set<string>(),
    pain_points: new Set<string>(),
    desires: new Set<string>(),
    features: new Set<string>(),
  };
  for (let from = 0; ; from += PAGE) {
    const res = await db
      .from("creative_profiles")
      .select("profile")
      .range(from, from + PAGE - 1);
    if (res.error) throw new Error(`listUsedSlugs: ${res.error.message}`);
    for (const row of res.data ?? []) {
      const strategy = (row.profile as { strategy?: Record<string, unknown> } | null)?.strategy;
      if (!strategy) continue;
      if (typeof strategy.angle === "string") sets.angles.add(strategy.angle);
      if (typeof strategy.audience === "string") sets.audiences.add(strategy.audience);
      for (const key of ["pain_points", "desires", "features"] as const) {
        const values = strategy[key];
        if (Array.isArray(values)) for (const value of values) if (typeof value === "string") sets[key].add(value);
      }
    }
    if ((res.data ?? []).length < PAGE) break;
  }
  used.angles = [...sets.angles].sort();
  used.audiences = [...sets.audiences].sort();
  used.pain_points = [...sets.pain_points].sort();
  used.desires = [...sets.desires].sort();
  used.features = [...sets.features].sort();
  return used;
}

async function listProfiledShas(shas: string[]): Promise<Set<string>> {
  const db = getDb();
  const out = new Set<string>();
  for (let i = 0; i < shas.length; i += IN_CHUNK) {
    const res = await db
      .from("creative_profiles")
      .select("sha256")
      .in("sha256", shas.slice(i, i + IN_CHUNK));
    if (res.error) throw new Error(`listProfiledShas: ${res.error.message}`);
    for (const row of res.data ?? []) out.add(row.sha256);
  }
  return out;
}

async function listCreatives(shas: string[]): Promise<CreativeRow[]> {
  if (!shas.length) return [];
  const db = getDb();
  const rows: CreativeRow[] = [];
  for (let i = 0; i < shas.length; i += IN_CHUNK) {
    const res = await db
      .from("creatives")
      .select("*")
      .in("sha256", shas.slice(i, i + IN_CHUNK));
    if (res.error) throw new Error(`listCreatives: ${res.error.message}`);
    rows.push(...(res.data ?? []));
  }
  return rows;
}

/** Gateway-style `google/…` ids go to the Vercel AI Gateway; anything else is a bare Gemini id. */
export function pickComplete(model: string): (messages: ChatMessage[], options: { model: string }) => Promise<Completion> {
  return model.startsWith("google/") ? complete : completeGemini;
}

export const defaultDeps: ProfileDeps = {
  requireProduct,
  loadVocab: loadProductVocab,
  listOwnShas,
  listLibraryShas,
  listCreatives,
  listProfiledShas,
  getProfile: getCreativeProfile,
  listUsedSlugs,
  complete: (messages, options) => pickComplete(options.model)(messages, options),
  download,
  upsertProfile: (sha256, profile) => upsertCreativeProfile(sha256, profile),
  log: (message) => console.log(message),
};
