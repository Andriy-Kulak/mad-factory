import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAngles, tagAngles, type AnglesDeps } from "./angles.ts";
import type { CreativeProfileRow, ProductRow } from "../db/types.ts";
import type { ChatMessage, Completion } from "./gateway.ts";
import type { ProductVocab } from "./prompt.ts";

const product = { id: "p1", slug: "fictional", name: "Fictional", description: "A fictional app" } as ProductRow;

const VOCAB: ProductVocab = {
  angles: [
    { slug: "shine-on-stage", name: "Shine on stage", promise: "Be dazzling.", audiences: [], desires: [] },
    { slug: "never-stall", name: "Never stall", promise: "Keep moving.", audiences: [], desires: [] },
  ],
  audiences: [],
  desires: [],
  library: true,
};

function profile(angle: string | null, manualKeys: string[] = []): Record<string, unknown> {
  return {
    schema_version: 1,
    media_type: "video",
    hook: { spoken: "hi", onscreen_text: null, visual: "a person", type: "callout", length_s: 2 },
    script: { transcript: "hi", beats: [{ t: 0, beat: "hook", text: "hi" }], structure: "demo" },
    strategy: {
      awareness: "problem_aware",
      strategic_response: "benefit",
      claim_type: "simple_benefit",
      mechanism: null,
      new_information: null,
      identity: null,
      angle,
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
    _meta: { by: "llm", model: "m", at: "2026-01-01T00:00:00Z", manual_keys: manualKeys },
  };
}

function row(sha256: string, p: Record<string, unknown>, profiledBy = "llm"): CreativeProfileRow {
  return { sha256, profiled_by: profiledBy, media_type: "video", profile: p } as CreativeProfileRow;
}

interface HarnessOptions {
  own?: string[];
  library?: { sha256: string; start_date: string | null }[];
  profiles?: Map<string, CreativeProfileRow>;
  replies?: string[];
  files?: Map<string, string>;
  vocab?: ProductVocab;
}

function harness(options: HarnessOptions) {
  const replies = [...(options.replies ?? [])];
  const completions: ChatMessage[][] = [];
  const upserts: { sha: string; profile: unknown }[] = [];
  const written = new Map<string, string>();
  const deps: AnglesDeps = {
    requireProduct: async () => product,
    loadVocab: async (productId) => {
      assert.equal(productId, product.id);
      return options.vocab ?? VOCAB;
    },
    listOwnShas: async () => options.own ?? [],
    listLibraryShas: async () => options.library ?? [],
    getProfile: async (sha) => options.profiles?.get(sha) ?? null,
    complete: async (messages): Promise<Completion> => {
      completions.push(messages);
      return { content: replies.shift() ?? '{"angle":"never-stall","angle_suggestion":null}', usage: { total_tokens: 10 } };
    },
    upsertProfile: async (sha, p) => { upserts.push({ sha, profile: p }); },
    readFile: async (path) => Buffer.from(options.files?.get(path) ?? "[]"),
    writeFile: async (path, content) => { written.set(path, content); },
    log: () => {},
  };
  return { deps, completions, upserts, written };
}

const tagOptions = { source: "all" as const, model: "m", concurrency: 1, out: "out.json" };

test("--out writes tagged entries, makes no upserts, and strips old angle and _meta from the prompt", async () => {
  const profiles = new Map([
    ["sha1", row("sha1", profile("invented-old"))],
    ["manual-sha", row("manual-sha", profile(null), "manual")],
    ["keyed-sha", row("keyed-sha", profile("keep-me", ["strategy.angle"]))],
  ]);
  const { deps, completions, upserts, written } = harness({
    own: ["sha1", "manual-sha", "keyed-sha"],
    profiles,
    replies: ['{"angle":"shine-on-stage","angle_suggestion":null}'],
  });
  const results = await tagAngles("fictional", tagOptions, deps);
  assert.equal(upserts.length, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.sha256, "sha1");
  assert.equal(results[0]!.old_angle, "invented-old");
  assert.equal(results[0]!.angle, "shine-on-stage");
  // The prompt must not anchor on the previous label.
  const prompt = String(completions[0]![0]!.content);
  assert.ok(!prompt.includes("invented-old"));
  assert.ok(!prompt.includes("_meta"));
  assert.ok(prompt.includes("shine-on-stage"));
  const file = JSON.parse(written.get("out.json")!);
  assert.equal(file.length, 1);
});

test("--out rejects a bad angle once, repairs it, and reports failures", async () => {
  const profiles = new Map([["sha1", row("sha1", profile(null))]]);
  const { deps, completions } = harness({
    own: ["sha1"],
    profiles,
    replies: [
      '{"angle":"made-up","angle_suggestion":null}',
      '{"angle":"other","angle_suggestion":"new-idea"}',
    ],
  });
  const results = await tagAngles("fictional", tagOptions, deps);
  assert.equal(completions.length, 2);
  assert.match(String(completions[1]!.at(-1)!.content), /failed validation/);
  assert.equal(results[0]!.angle, "other");
  assert.equal(results[0]!.angle_suggestion, "new-idea");
});

test("--out errors when no angle library is loaded", async () => {
  const { deps } = harness({ vocab: { angles: [], audiences: [], desires: [], library: false } });
  await assert.rejects(
    () => tagAngles("fictional", tagOptions, deps),
    /no angle-library doc for product "fictional" \(pnpm product docs import\)/,
  );
});

test("--apply updates only angle and angle_suggestion, skipping manual rows", async () => {
  const original = profile("invented-old");
  const profiles = new Map([
    ["sha1", row("sha1", original)],
    ["keyed", row("keyed", profile("keep", ["strategy.angle_suggestion"]))],
    ["manual", row("manual", profile("x"), "manual")],
  ]);
  const entries = [
    { sha256: "sha1", owner: "own", old_angle: "invented-old", angle: "never-stall", angle_suggestion: null },
    { sha256: "keyed", owner: "own", old_angle: "keep", angle: "never-stall", angle_suggestion: null },
    { sha256: "manual", owner: "own", old_angle: "x", angle: "never-stall", angle_suggestion: null },
    { sha256: "sha1", owner: "own", old_angle: "dup", angle: "made-up", angle_suggestion: null },
    { sha256: "gone", owner: "own", old_angle: "x", angle: "never-stall", angle_suggestion: null },
  ];
  const { deps, upserts } = harness({
    own: ["sha1"],
    profiles,
    files: new Map([["in.json", JSON.stringify(entries)]]),
  });
  const applied = await applyAngles("fictional", { file: "in.json" }, deps);
  assert.equal(applied, 1);
  assert.equal(upserts.length, 1);
  const updated = upserts[0]!.profile as { strategy: { angle: string; angle_suggestion: string | null }; _meta: unknown };
  assert.equal(updated.strategy.angle, "never-stall");
  assert.equal(updated.strategy.angle_suggestion, null);
  assert.deepEqual(updated._meta, original._meta);
});
