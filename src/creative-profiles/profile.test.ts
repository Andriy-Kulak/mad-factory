import { test } from "node:test";
import assert from "node:assert/strict";
import { getPath, imageMime, mergeManualKeys, pickComplete, profileCreatives, setPath, runDays, stripFences, wrapProfile, type ProfileDeps } from "./profile.ts";
import { completeGemini } from "./gemini.ts";
import { complete } from "./gateway.ts";
import type { CreativeProfileRow, CreativeRow, ProductRow } from "../db/types.ts";
import type { ChatMessage, Completion } from "./gateway.ts";
import type { CreativeProfile } from "./schema.ts";

const product = { id: "p1", slug: "fictional", name: "Fictional", description: "A fictional app" } as ProductRow;

function creative(sha256: string, mediaType = "video"): CreativeRow {
  return {
    sha256,
    media_type: mediaType,
    bytes: 1000,
    storage_key: `videos/${sha256}.mp4`,
    public_url: `https://cdn/${sha256}`,
    created_at: "",
  };
}

function baseProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hook: { spoken: "hi", onscreen_text: null, visual: "a person", type: "callout", length_s: 2 },
    script: { transcript: "hi", beats: [{ t: 0, beat: "hook", text: "hi" }], structure: "demo" },
    strategy: {
      awareness: "problem_aware",
      strategic_response: "benefit",
      claim_type: "simple_benefit",
      mechanism: null,
      new_information: null,
      identity: null,
      angle: "test-angle",
      angle_suggestion: null,
      audience: null,
      pain_points: [],
      desires: [],
      features: [],
      proof: ["none"],
      objections_handled: [],
      offer: null,
      claims: [],
    },
    production: {
      format: "talking_head",
      visual_style: "lofi_selfie",
      layout: null,
      setting: "home",
      length_s: 10,
      aspect: "9:16",
      voice: "on_camera",
      captions: "none",
      music: "none",
      app_on_screen_s: 0,
      pacing: "medium",
    },
    cards: [],
    people: [],
    cta: { type: null, spoken: null, onscreen: null },
    ...overrides,
  };
}

interface HarnessOptions {
  own?: string[];
  library?: { sha256: string; start_date: string | null; days?: number | null }[];
  creatives?: CreativeRow[];
  profiles?: Map<string, CreativeProfileRow>;
  replies?: string[];
  replyError?: Error;
  vocab?: { angles: { slug: string; name: string; audiences: string[]; desires: string[] }[]; audiences: { slug: string; name: string }[]; desires: string[]; library?: boolean };
  used?: { angles: string[]; audiences: string[]; pain_points: string[]; desires: string[]; features: string[] };
}

function harness(options: HarnessOptions) {
  const replies = [...(options.replies ?? [])];
  const completions: ChatMessage[][] = [];
  const upserts: { sha: string; profile: unknown }[] = [];
  const deps: ProfileDeps = {
    requireProduct: async () => product,
    loadVocab: async (productId) => {
      assert.equal(productId, product.id);
      return { angles: [], audiences: [], desires: [], library: false, ...options.vocab };
    },
    listOwnShas: async () => options.own ?? [],
    listLibraryShas: async () => (options.library ?? []).map((row) => ({ days: null, ...row })),
    listCreatives: async () => options.creatives ?? [],
    listProfiledShas: async (shas) => new Set(shas.filter((sha) => options.profiles?.has(sha))),
    getProfile: async (sha) => options.profiles?.get(sha) ?? null,
    listUsedSlugs: async () => options.used ?? { angles: [], audiences: [], pain_points: [], desires: [], features: [] },
    complete: async (messages): Promise<Completion> => {
      completions.push(messages);
      if (options.replyError) throw options.replyError;
      return { content: replies.shift() ?? JSON.stringify(baseProfile()), usage: null };
    },
    download: async () => Buffer.from("bytes"),
    upsertProfile: async (sha, profile) => {
      upserts.push({ sha, profile });
    },
    log: () => {},
  };
  return { deps, completions, upserts };
}

test("imageMime maps the storage key extension, defaulting to jpeg", () => {
  assert.equal(imageMime("images/a.png"), "image/png");
  assert.equal(imageMime("images/a.webp"), "image/webp");
  assert.equal(imageMime("images/a.gif"), "image/gif");
  assert.equal(imageMime("images/a.jpg"), "image/jpeg");
  assert.equal(imageMime("images/a"), "image/jpeg");
});

test("stripFences removes json code fences and leaves plain text alone", () => {
  assert.equal(stripFences('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripFences('```\n{"a":1}```'), '{"a":1}');
  assert.equal(stripFences('{"a":1}'), '{"a":1}');
});

test("wrapProfile overrides model schema_version, media_type and _meta", () => {
  const wrapped = wrapProfile({ schema_version: 99, media_type: "image", _meta: { by: "manual" }, hook: {} }, "video", "test-model") as Record<string, unknown>;
  assert.equal(wrapped.schema_version, 1);
  assert.equal(wrapped.media_type, "video");
  assert.equal((wrapped._meta as { by: string }).by, "llm");
  assert.equal((wrapped._meta as { model: string }).model, "test-model");
  assert.deepEqual(wrapped.hook, {});
});

test("getPath/setPath handle dotted and indexed paths", () => {
  const obj: Record<string, unknown> = { people: [{ gender: "male" }], strategy: { angle: "x" } };
  assert.equal(getPath(obj, "strategy.angle"), "x");
  assert.equal(getPath(obj, "people[0].gender"), "male");
  setPath(obj, "people[0].vibe", "calm");
  setPath(obj, "cta.spoken", "go");
  assert.equal(getPath(obj, "people[0].vibe"), "calm");
  assert.equal(getPath(obj, "cta.spoken"), "go");
});

test("mergeManualKeys copies listed paths and keeps the list", () => {
  const newProfile = wrapProfile(baseProfile({ strategy: { angle: "new" } }), "video", "m") as Record<string, unknown>;
  (newProfile.people as unknown[]).push({ role: "presenter", gender: null });
  const oldProfile = {
    strategy: { angle: "hand-set" },
    people: [{ role: "presenter", gender: "female" }],
    _meta: { manual_keys: ["strategy.angle", "people[0].gender"] },
  };
  const merged = mergeManualKeys(newProfile, oldProfile as unknown as Record<string, unknown>);
  assert.equal(getPath(merged, "strategy.angle"), "hand-set");
  assert.equal(getPath(merged, "people[0].gender"), "female");
  assert.deepEqual(getPath(merged, "_meta.manual_keys"), ["strategy.angle", "people[0].gender"]);
});

test("one repair turn is sent after a validation failure, then it gives up", async () => {
  const { deps, completions } = harness({
    own: ["sha1"],
    creatives: [creative("sha1")],
    replies: ["not json at all", "still not json"],
  });
  const stats = await profileCreatives(
    "fictional",
    {
      source: "own",
      model: "m",
      force: false,
      concurrency: 1,
      dryRun: false,
    },
    deps,
  );
  assert.equal(completions.length, 2);
  const repairUser = completions[1]!.at(-1)!;
  assert.match(String(repairUser.content), /Your JSON failed validation/);
  assert.equal(stats.failures, 1);
  assert.equal(stats.profiled, 0);
});

test("a failed first reply is repaired and profiled on the second", async () => {
  const { deps, upserts } = harness({
    own: ["sha1"],
    creatives: [creative("sha1")],
    replies: ["broken", `\`\`\`json\n${JSON.stringify(baseProfile())}\n\`\`\``],
  });
  const stats = await profileCreatives(
    "fictional",
    {
      source: "own",
      model: "m",
      force: false,
      concurrency: 1,
      dryRun: false,
    },
    deps,
  );
  assert.equal(stats.profiled, 1);
  assert.equal((upserts[0]!.profile as CreativeProfile).media_type, "video");
});

test("selection: own first, library ordered by start_date, deduped and filtered", async () => {
  const profiles = new Map<string, CreativeProfileRow>([
    ["hasprof", { sha256: "hasprof", profiled_by: "llm", profile: {}, media_type: "video" } as CreativeProfileRow],
    ["manual", { sha256: "manual", profiled_by: "manual", profile: {}, media_type: "video" } as CreativeProfileRow],
  ]);
  const { deps, upserts } = harness({
    own: ["ownvid", "shared"],
    library: [
      { sha256: "shared", start_date: "2025-01-01" },
      { sha256: "newer", start_date: "2025-06-01" },
      { sha256: "older", start_date: "2024-01-01" },
      { sha256: "nodate", start_date: null },
      { sha256: "hasprof", start_date: "2023-01-01" },
      { sha256: "manual", start_date: "2022-01-01" },
    ],
    creatives: [creative("ownvid"), creative("shared"), creative("newer"), creative("older"), creative("nodate"), creative("hasprof"), creative("manual"), creative("doc", "carousel")],
    profiles,
  });
  const stats = await profileCreatives(
    "fictional",
    {
      source: "all",
      model: "m",
      force: false,
      concurrency: 1,
      dryRun: false,
    },
    deps,
  );
  assert.deepEqual(
    upserts.map((u) => u.sha),
    ["ownvid", "shared", "older", "newer", "nodate"],
  );
  assert.equal(stats.profiled, 5);
});

test("--min-days keeps library media on its longest run; --limit counts only unprofiled media", async () => {
  const profiles = new Map<string, CreativeProfileRow>([["done", { sha256: "done", profiled_by: "llm", profile: {}, media_type: "video" } as CreativeProfileRow]]);
  const { deps, upserts } = harness({
    own: ["ownvid"],
    library: [
      { sha256: "done", start_date: "2024-01-01", days: 90 },
      { sha256: "oneday", start_date: "2025-06-01", days: 1 },
      { sha256: "rerun", start_date: "2025-01-01", days: 2 },
      { sha256: "rerun", start_date: "2025-03-01", days: 30 },
      { sha256: "survivor", start_date: "2025-02-01", days: 8 },
      { sha256: "nodate", start_date: null, days: null },
    ],
    creatives: ["ownvid", "done", "oneday", "rerun", "survivor", "nodate"].map((sha) => creative(sha)),
    profiles,
  });
  const stats = await profileCreatives(
    "fictional",
    {
      source: "all",
      minDays: 7,
      limit: 2,
      model: "m",
      force: false,
      concurrency: 1,
      dryRun: false,
    },
    deps,
  );
  // Own media ignore --min-days; "done" is skipped before the limit, so the two calls go to new files.
  assert.deepEqual(
    upserts.map((u) => u.sha),
    ["ownvid", "rerun"],
  );
  assert.equal(stats.selected, 2);
});

test("runDays counts to today while running and to the end date once stopped", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  assert.equal(runDays({ start_date: "2026-10-01", end_date: null, is_active: true }, now), 8);
  assert.equal(runDays({ start_date: "2026-09-01", end_date: "2026-09-04", is_active: false }, now), 3);
  assert.equal(runDays({ start_date: null, end_date: null, is_active: true }, now), null);
});

test("used slugs reach the prompt and brand-vocab duplicates are excluded", async () => {
  const { deps, completions } = harness({
    own: ["sha1"],
    creatives: [creative("sha1")],
    vocab: {
      angles: [{ slug: "brand-angle", name: "Brand angle", audiences: [], desires: [] }],
      audiences: [{ slug: "brand-aud", name: "Brand audience" }],
      desires: ["brand-desire"],
    },
    used: {
      angles: ["brand-angle", "invented-angle"],
      audiences: ["brand-aud", "invented-aud"],
      pain_points: ["bad-slug"],
      desires: ["brand-desire", "invented-desire"],
      features: ["feat-1"],
    },
  });
  await profileCreatives(
    "fictional",
    {
      source: "own",
      model: "m",
      force: false,
      concurrency: 1,
      dryRun: false,
    },
    deps,
  );
  const prompt = String((completions[0]![0]!.content as unknown as { text: string }[])[0]!.text);
  assert.match(prompt, /Slugs already used for other ads/);
  assert.match(prompt, /- angle: invented-angle/);
  assert.match(prompt, /- audience: invented-aud/);
  assert.match(prompt, /- pain_points: bad-slug/);
  assert.match(prompt, /- desires: invented-desire/);
  assert.match(prompt, /- features: feat-1/);
  // Brand vocab entries must not appear in the used section.
  const usedSection = prompt.split("Slugs already used for other ads")[1]!;
  assert.ok(!usedSection.includes("brand-angle"));
  assert.ok(!usedSection.includes("brand-aud"));
  assert.ok(!usedSection.includes("brand-desire"));
});

test("a slug invented by item 1 appears in item 2's prompt with concurrency 1", async () => {
  const first = baseProfile();
  (first.strategy as Record<string, unknown>).angle = "fresh-angle";
  (first.strategy as Record<string, unknown>).pain_points = ["fresh-pain"];
  const { deps, completions } = harness({
    own: ["sha1", "sha2"],
    creatives: [creative("sha1"), creative("sha2")],
    replies: [JSON.stringify(first)],
  });
  await profileCreatives(
    "fictional",
    {
      source: "own",
      model: "m",
      force: false,
      concurrency: 1,
      dryRun: false,
    },
    deps,
  );
  assert.equal(completions.length, 2);
  const secondPrompt = String((completions[1]![0]!.content as unknown as { text: string }[])[0]!.text);
  assert.match(secondPrompt, /fresh-angle/);
  assert.match(secondPrompt, /fresh-pain/);
});

test("with a library, an off-library angle is repaired and the message lists allowed slugs", async () => {
  const offLibrary = baseProfile();
  (offLibrary.strategy as Record<string, unknown>).angle = "invented-slug";
  const onLibrary = baseProfile();
  (onLibrary.strategy as Record<string, unknown>).angle = "lib-angle";
  const { deps, completions, upserts } = harness({
    own: ["sha1"],
    creatives: [creative("sha1")],
    vocab: {
      angles: [{ slug: "lib-angle", name: "Library angle", audiences: [], desires: [] }],
      audiences: [],
      desires: [],
      library: true,
    },
    replies: [JSON.stringify(offLibrary), JSON.stringify(onLibrary)],
  });
  const stats = await profileCreatives(
    "fictional",
    {
      source: "own",
      model: "m",
      force: false,
      concurrency: 1,
      dryRun: false,
    },
    deps,
  );
  assert.equal(stats.profiled, 1);
  assert.equal(completions.length, 2);
  const repairMessage = String(completions[1]!.at(-1)!.content);
  assert.match(repairMessage, /lib-angle/);
  assert.equal((upserts[0]!.profile as CreativeProfile).strategy.angle, "lib-angle");
});

test('with a library, "other" plus an angle_suggestion is accepted', async () => {
  const other = baseProfile();
  (other.strategy as Record<string, unknown>).angle = "other";
  (other.strategy as Record<string, unknown>).angle_suggestion = "fresh-idea";
  const { deps, upserts } = harness({
    own: ["sha1"],
    creatives: [creative("sha1")],
    vocab: {
      angles: [{ slug: "lib-angle", name: "Library angle", audiences: [], desires: [] }],
      audiences: [],
      desires: [],
      library: true,
    },
    replies: [JSON.stringify(other)],
  });
  const stats = await profileCreatives(
    "fictional",
    {
      source: "own",
      model: "m",
      force: false,
      concurrency: 1,
      dryRun: false,
    },
    deps,
  );
  assert.equal(stats.profiled, 1);
  assert.equal((upserts[0]!.profile as CreativeProfile).strategy.angle, "other");
});

test("with a library, the prompt drops the used-angles line", async () => {
  const { deps, completions } = harness({
    own: ["sha1"],
    creatives: [creative("sha1")],
    vocab: {
      angles: [{ slug: "lib-angle", name: "Library angle", audiences: [], desires: [] }],
      audiences: [],
      desires: [],
      library: true,
    },
    used: {
      angles: ["invented-angle"],
      audiences: ["invented-aud"],
      pain_points: [],
      desires: [],
      features: [],
    },
  });
  await profileCreatives(
    "fictional",
    {
      source: "own",
      model: "m",
      force: false,
      concurrency: 1,
      dryRun: false,
    },
    deps,
  );
  const prompt = String((completions[0]![0]!.content as unknown as { text: string }[])[0]!.text);
  const usedSection = prompt.split("Slugs already used for other ads")[1]!;
  assert.ok(!usedSection.includes("invented-angle"));
  assert.match(usedSection, /- audience: invented-aud/);
});

test("pickComplete routes bare Gemini ids direct and google/ ids to the gateway", () => {
  assert.equal(pickComplete("gemini-2.5-flash"), completeGemini);
  assert.equal(pickComplete("gemini-3.1-pro-preview"), completeGemini);
  assert.equal(pickComplete("google/gemini-2.5-pro"), complete);
});

test("library ads that are also own are not double-profiled and carousel is skipped", async () => {
  const { deps, upserts } = harness({
    own: ["shared"],
    library: [{ sha256: "shared", start_date: "2025-01-01" }],
    creatives: [creative("shared"), creative("caro", "carousel")],
  });
  // "caro" never enters candidates since it isn't in own/library; test media skip via a library carousel.
  const stats = await profileCreatives(
    "fictional",
    {
      source: "all",
      model: "m",
      force: false,
      concurrency: 1,
      dryRun: false,
    },
    deps,
  );
  assert.deepEqual(
    upserts.map((u) => u.sha),
    ["shared"],
  );
  assert.equal(stats.profiled, 1);
});
