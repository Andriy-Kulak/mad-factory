import { readFile, writeFile } from "node:fs/promises";
import { requireProduct } from "../db/products.ts";
import { getCreativeProfile, upsertCreativeProfile } from "../db/creative-profiles.ts";
import type { CreativeProfileRow, ProductRow } from "../db/types.ts";
import type { ChatMessage, Completion } from "./gateway.ts";
import type { ProductVocab } from "./prompt.ts";
import { buildAnglePrompt } from "./prompt.ts";
import { angleProblem, loadProductVocab } from "./vocab.ts";
import { parseCreativeProfile } from "./schema.ts";
import {
  defaultDeps as profileDefaultDeps,
  selectCandidates,
  stripFences,
  type Candidate,
  type ProfileDeps,
} from "./profile.ts";

/** Re-tag strategy.angle on stored profiles from a fixed angle library. */

export interface AnglesDeps {
  requireProduct(slug: string): Promise<ProductRow>;
  loadVocab(productId: string): Promise<ProductVocab>;
  listOwnShas(productId: string): Promise<string[]>;
  listLibraryShas(productId: string): Promise<{ sha256: string; start_date: string | null }[]>;
  getProfile(sha256: string): Promise<CreativeProfileRow | null>;
  complete(messages: ChatMessage[], options: { model: string }): Promise<Completion>;
  upsertProfile(sha256: string, profile: unknown): Promise<unknown>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, content: string): Promise<void>;
  log(message: string): void;
}

export interface AnglesOptions {
  source: "own" | "library" | "all";
  limit?: number;
  model: string;
  concurrency: number;
}

export interface AngleEntry {
  sha256: string;
  owner: "own" | "competitor";
  old_angle: string | null;
  angle: string;
  angle_suggestion: string | null;
  usage: unknown;
}

export const defaultDeps: AnglesDeps = {
  requireProduct,
  loadVocab: loadProductVocab,
  listOwnShas: profileDefaultDeps.listOwnShas,
  listLibraryShas: profileDefaultDeps.listLibraryShas,
  getProfile: getCreativeProfile,
  complete: (messages, options) => profileDefaultDeps.complete(messages, options),
  upsertProfile: (sha256, profile) => upsertCreativeProfile(sha256, profile),
  readFile,
  writeFile: (path, content) => writeFile(path, content, "utf8"),
  log: (message) => console.log(message),
};

const ANGLE_MANUAL_KEYS = new Set(["strategy.angle", "strategy.angle_suggestion"]);

function isSkipped(row: CreativeProfileRow): string | null {
  if (row.profiled_by === "manual") return "manual profile";
  const keys = (row.profile as { _meta?: { manual_keys?: unknown } })?._meta?.manual_keys;
  if (Array.isArray(keys) && keys.some((key) => typeof key === "string" && ANGLE_MANUAL_KEYS.has(key))) {
    return "angle is manual";
  }
  return null;
}

/** Validate the {"angle","angle_suggestion"} reply against the library and the other rule. */
export function angleReplyProblem(reply: unknown, vocab: ProductVocab): string | null {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return "must be an object";
  const { angle, angle_suggestion } = reply as { angle?: unknown; angle_suggestion?: unknown };
  const problem = angleProblem(typeof angle === "string" ? angle : null, vocab);
  if (problem) return problem;
  if (angle === "other") {
    if (typeof angle_suggestion !== "string" || !angle_suggestion) {
      return `angle_suggestion must be a slug when angle is "other"`;
    }
  } else if (angle_suggestion !== null && angle_suggestion !== undefined) {
    return `angle_suggestion must be null unless angle is "other"`;
  }
  return null;
}

function tokenCount(usage: unknown): number {
  const total = (usage as { total_tokens?: unknown })?.total_tokens;
  return typeof total === "number" ? total : 0;
}

async function selectProfiles(
  deps: AnglesDeps,
  productId: string,
  options: Pick<AnglesOptions, "source" | "limit">,
): Promise<(Candidate & { row: CreativeProfileRow })[]> {
  const candidates = await selectCandidates(deps as unknown as ProfileDeps, productId, { source: options.source });
  const out: (Candidate & { row: CreativeProfileRow })[] = [];
  for (const candidate of options.limit ? candidates.slice(0, options.limit) : candidates) {
    const row = await deps.getProfile(candidate.sha256);
    if (!row) {
      deps.log(`  = ${candidate.sha256.slice(0, 8)}: no profile`);
      continue;
    }
    const skip = isSkipped(row);
    if (skip) {
      deps.log(`  = ${candidate.sha256.slice(0, 8)}: ${skip}, skipped`);
      continue;
    }
    out.push({ ...candidate, row });
  }
  return out;
}

export async function tagAngles(
  productSlug: string,
  options: AnglesOptions & { out: string },
  deps: AnglesDeps = defaultDeps,
): Promise<AngleEntry[]> {
  const product = await deps.requireProduct(productSlug);
  const vocab = await deps.loadVocab(product.id);
  if (!vocab.library) throw new Error(`no angle-library doc for product "${product.slug}" (pnpm product docs import)`);
  const items = await selectProfiles(deps, product.id, options);
  deps.log(`${items.length} profile(s) to re-tag for ${product.slug} (${options.source}, model ${options.model})`);

  const results: AngleEntry[] = [];
  let index = 0;
  const worker = async () => {
    for (;;) {
      const item = items[index++];
      if (!item) return;
      const tag = `${item.sha256.slice(0, 8)} (${item.owner})`;
      const profile = item.row.profile as Record<string, unknown>;
      const oldAngle = (profile.strategy as { angle?: string | null })?.angle ?? null;
      try {
        const messages: ChatMessage[] = [
          {
            role: "user",
            content: buildAnglePrompt({
              productName: product.name,
              productDescription: product.description,
              owner: item.owner,
              vocab,
              profile,
            }),
          },
        ];
        let reply = await deps.complete(messages, { model: options.model });
        let parsed: unknown;
        let error: string | null;
        try {
          parsed = JSON.parse(stripFences(reply.content));
          error = angleReplyProblem(parsed, vocab);
        } catch {
          parsed = null;
          error = "reply is not valid JSON";
        }
        if (error) {
          messages.push({ role: "assistant", content: reply.content });
          messages.push({
            role: "user",
            content: `Your JSON failed validation:\n${error}\nReturn the corrected JSON object only.`,
          });
          reply = await deps.complete(messages, { model: options.model });
          try {
            parsed = JSON.parse(stripFences(reply.content));
            error = angleReplyProblem(parsed, vocab);
          } catch {
            parsed = null;
            error = "reply is not valid JSON";
          }
          if (error) {
            deps.log(`  ! ${tag}: ${error}`);
            continue;
          }
        }
        const answer = parsed as { angle: string; angle_suggestion?: string | null };
        results.push({
          sha256: item.sha256,
          owner: item.owner,
          old_angle: oldAngle,
          angle: answer.angle,
          angle_suggestion: answer.angle_suggestion ?? null,
          usage: reply.usage,
        });
        deps.log(`  + ${tag}: ${oldAngle ?? "-"} -> ${answer.angle}`);
      } catch (itemError) {
        deps.log(`  ! ${tag}: ${itemError instanceof Error ? itemError.message : String(itemError)}`);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(options.concurrency, items.length)) }, worker),
  );

  results.sort((a, b) => items.findIndex((item) => item.sha256 === a.sha256) - items.findIndex((item) => item.sha256 === b.sha256));
  await deps.writeFile(options.out, JSON.stringify(results, null, 2) + "\n");

  const tally = new Map<string, number>();
  let tokens = 0;
  for (const entry of results) {
    tally.set(entry.angle, (tally.get(entry.angle) ?? 0) + 1);
    tokens += tokenCount(entry.usage);
  }
  deps.log(`Wrote ${results.length} entries to ${options.out}`);
  for (const [angle, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    deps.log(`  ${angle}: ${count}`);
  }
  deps.log(`  total tokens: ${tokens}`);
  return results;
}

export async function applyAngles(
  productSlug: string,
  options: { file: string },
  deps: AnglesDeps = defaultDeps,
): Promise<number> {
  const product = await deps.requireProduct(productSlug);
  const vocab = await deps.loadVocab(product.id);
  if (!vocab.library) throw new Error(`no angle-library doc for product "${product.slug}" (pnpm product docs import)`);
  const entries = JSON.parse((await deps.readFile(options.file)).toString("utf8")) as AngleEntry[];
  if (!Array.isArray(entries)) throw new Error(`${options.file} is not a JSON array`);

  let applied = 0;
  for (const entry of entries) {
    const tag = entry.sha256.slice(0, 8);
    const row = await deps.getProfile(entry.sha256);
    if (!row) {
      deps.log(`  = ${tag}: no profile`);
      continue;
    }
    const skip = isSkipped(row);
    if (skip) {
      deps.log(`  = ${tag}: ${skip}, skipped`);
      continue;
    }
    const problem = angleReplyProblem({ angle: entry.angle, angle_suggestion: entry.angle_suggestion }, vocab);
    if (problem) {
      deps.log(`  ! ${tag}: ${problem}`);
      continue;
    }
    const profile = structuredClone(row.profile) as Record<string, unknown>;
    const strategy = profile.strategy as Record<string, unknown>;
    const oldAngle = strategy.angle ?? null;
    strategy.angle = entry.angle;
    strategy.angle_suggestion = entry.angle_suggestion;
    try {
      const validated = parseCreativeProfile(profile);
      await deps.upsertProfile(entry.sha256, validated);
      applied++;
      deps.log(`  + ${tag}: ${oldAngle ?? "-"} -> ${entry.angle}`);
    } catch (error) {
      deps.log(`  ! ${tag}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
  deps.log(`Applied ${applied} of ${entries.length} entries`);
  return applied;
}
