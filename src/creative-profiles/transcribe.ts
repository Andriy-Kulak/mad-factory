import { getDb } from "../db/client.ts";
import { requireProduct } from "../db/products.ts";
import { download } from "../lib/storage.ts";
import { SOCIAL_PLATFORMS } from "../social/types.ts";
import type { ProductRow } from "../db/types.ts";
import type { ChatMessage, Completion } from "./gateway.ts";
import { pickComplete, stripFences } from "./profile.ts";

/**
 * Transcribe the spoken words of a product's tracked organic videos into `social_posts.transcript`. Posts whose video
 * already has a creative-profile transcript are skipped (the web preview falls back to it), so no file is paid for
 * twice. An empty string means the video has no speech, so it isn't retried.
 */

const MAX_BYTES = 20 * 1024 * 1024;
const PAGE = 1000;
const IN_CHUNK = 100;

export const TRANSCRIBE_PROMPT = `Transcribe every word spoken in this video, verbatim, in the language spoken. Put each speaker turn or sentence group on its own line. Leave out on-screen text, music and sound effects.
Return JSON only: {"transcript": "<the words>"}. Use an empty string when nobody speaks.`;

export interface PostVideo {
  postId: string;
  sha256: string;
  publicUrl: string;
  bytes: number;
}

export interface TranscribeOptions {
  limit?: number;
  model: string;
  concurrency: number;
  dryRun: boolean;
}

export interface TranscribeStats {
  selected: number;
  transcribed: number;
  silent: number;
  skipped: number;
  failures: number;
  promptTokens: number;
  outputTokens: number;
}

export interface TranscribeDeps {
  requireProduct(slug: string): Promise<ProductRow>;
  /** Tracked posts with a stored video and no transcript anywhere yet, newest first. */
  listUntranscribed(productId: string): Promise<PostVideo[]>;
  complete(messages: ChatMessage[], options: { model: string }): Promise<Completion>;
  download(url: string): Promise<Buffer>;
  saveTranscript(postId: string, transcript: string): Promise<void>;
  log(message: string): void;
}

export function parseTranscript(content: string): string {
  const parsed = JSON.parse(stripFences(content)) as { transcript?: unknown };
  if (typeof parsed.transcript !== "string") throw new Error("reply has no transcript string");
  return parsed.transcript.trim();
}

export async function transcribePosts(productSlug: string, options: TranscribeOptions, deps: TranscribeDeps = defaultDeps): Promise<TranscribeStats> {
  const product = await deps.requireProduct(productSlug);
  const all = await deps.listUntranscribed(product.id);
  const todo = options.limit ? all.slice(0, options.limit) : all;
  const stats: TranscribeStats = { selected: todo.length, transcribed: 0, silent: 0, skipped: all.length - todo.length, failures: 0, promptTokens: 0, outputTokens: 0 };
  deps.log(`${todo.length} of ${all.length} untranscribed video(s) for ${product.slug} (model ${options.model}${options.dryRun ? ", dry-run" : ""})`);

  const one = async (item: PostVideo) => {
    const tag = `${item.postId.slice(0, 8)} (${item.sha256.slice(0, 8)})`;
    if (item.bytes > MAX_BYTES) {
      deps.log(`  ! ${tag}: ${(item.bytes / 1e6).toFixed(1)} MB exceeds 20 MB limit`);
      stats.skipped++;
      return;
    }
    try {
      const b64 = (await deps.download(item.publicUrl)).toString("base64");
      const reply = await deps.complete([{
        role: "user",
        content: [{ type: "text", text: TRANSCRIBE_PROMPT }, { type: "file", file: { filename: "post.mp4", file_data: `data:video/mp4;base64,${b64}` } }],
      }], { model: options.model });
      const usage = (reply.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
      stats.promptTokens += usage.prompt_tokens ?? 0;
      stats.outputTokens += usage.completion_tokens ?? 0;
      const transcript = parseTranscript(reply.content);
      if (options.dryRun) deps.log(`  + ${tag}: dry-run\n${transcript || "(no speech)"}`);
      else await deps.saveTranscript(item.postId, transcript);
      stats[transcript ? "transcribed" : "silent"]++;
      deps.log(`  + ${tag}: ${transcript ? `${transcript.split(/\s+/).length} words` : "no speech"}${reply.usage ? ` · tokens ${JSON.stringify(reply.usage)}` : ""}`);
    } catch (error) {
      stats.failures++;
      deps.log(`  ! ${tag}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  let index = 0;
  const worker = async () => {
    for (let item = todo[index++]; item; item = todo[index++]) await one(item);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency, todo.length)) }, worker));
  return stats;
}

async function inChunks<T>(ids: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await run(ids.slice(i, i + IN_CHUNK))));
  return out;
}

function check<T>(res: { data: T[] | null; error: { message: string } | null }, ctx: string): T[] {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  return res.data ?? [];
}

async function trackedAccountIds(productId: string): Promise<string[]> {
  const db = getDb();
  const sources = check(
    await db.from("tracked_sources").select("source,value,config").eq("product_id", productId).eq("kind", "account").eq("enabled", true).in("source", [...SOCIAL_PLATFORMS]),
    "tracked_sources",
  );
  const ids = new Set<string>();
  const byHandle = new Set<string>();
  for (const s of sources) {
    const cfg = s.config && typeof s.config === "object" && !Array.isArray(s.config) ? s.config : {};
    // The sync writes config.account_id; sources synced before that are matched on platform + handle.
    if (typeof cfg.account_id === "string") ids.add(cfg.account_id);
    else byHandle.add(`${s.source}:${s.value}`);
  }
  if (byHandle.size) {
    const handles = [...new Set([...byHandle].map((k) => k.slice(k.indexOf(":") + 1)))];
    for (const a of check(await db.from("social_accounts").select("id,platform,handle").in("handle", handles), "social_accounts")) {
      if (byHandle.has(`${a.platform}:${a.handle}`)) ids.add(a.id);
    }
  }
  return [...ids];
}

async function listUntranscribed(productId: string): Promise<PostVideo[]> {
  const db = getDb();
  const accountIds = await trackedAccountIds(productId);
  const posts = await inChunks(accountIds, async (ids) => {
    const rows: { id: string; posted_at: string | null }[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = check(await db.from("social_posts").select("id,posted_at").in("account_id", ids).is("transcript", null).order("id").range(from, from + PAGE - 1), "social_posts");
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  });
  posts.sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""));
  const media = await inChunks(posts.map((p) => p.id), async (ids) =>
    check(await db.from("social_post_media").select("post_id,sha256,position").in("post_id", ids).eq("role", "media"), "social_post_media"));
  const firstMedia = new Map<string, { sha256: string; position: number }>();
  for (const m of media) {
    const cur = firstMedia.get(m.post_id);
    if (!cur || m.position < cur.position) firstMedia.set(m.post_id, m);
  }
  const shas = [...new Set([...firstMedia.values()].map((m) => m.sha256))];
  const [creatives, profiled] = await Promise.all([
    inChunks(shas, async (chunk) => check(await db.from("creatives").select("sha256,media_type,public_url,bytes").in("sha256", chunk), "creatives")),
    inChunks(shas, async (chunk) =>
      check(await db.from("creative_profiles").select("sha256,transcript:profile->script->>transcript").in("sha256", chunk), "creative_profiles")),
  ]);
  const hasProfileTranscript = new Set(profiled.filter((p) => p.transcript).map((p) => p.sha256));
  const video = new Map(creatives.filter((c) => c.media_type === "video" && c.public_url).map((c) => [c.sha256, c]));
  return posts.flatMap((p) => {
    const m = firstMedia.get(p.id);
    const c = m && !hasProfileTranscript.has(m.sha256) ? video.get(m.sha256) : undefined;
    return c ? [{ postId: p.id, sha256: c.sha256, publicUrl: c.public_url!, bytes: c.bytes }] : [];
  });
}

async function saveTranscript(postId: string, transcript: string): Promise<void> {
  const res = await getDb().from("social_posts").update({ transcript }).eq("id", postId);
  if (res.error) throw new Error(`social_posts: ${res.error.message}`);
}

export const defaultDeps: TranscribeDeps = {
  requireProduct,
  listUntranscribed,
  complete: (messages, options) => pickComplete(options.model)(messages, options),
  download,
  saveTranscript,
  log: (message) => console.log(message),
};
