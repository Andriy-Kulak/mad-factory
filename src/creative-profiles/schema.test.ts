import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCreativeProfile } from "./schema.ts";
import type { CreativeProfile } from "./schema.ts";

/** The illustrative example from docs/creative-profile.md. */
const EXAMPLE: CreativeProfile = {
  schema_version: 1,
  media_type: "video",
  hook: {
    spoken: "Your plant wilts before you notice what it needs?",
    onscreen_text: "POV: you spot your plant wilting",
    visual: "close-up of drooping leaves beside a phone with care tips",
    type: "callout",
    length_s: 3,
  },
  script: {
    transcript: "…",
    beats: [
      { t: 0, beat: "hook", text: "…" },
      { t: 3, beat: "problem", text: "…" },
      { t: 15, beat: "demo", text: "…" },
      { t: 26, beat: "cta", text: "…" },
    ],
    structure: "problem_solution",
  },
  strategy: {
    awareness: "problem_aware",
    strategic_response: "mechanism",
    claim_type: "mechanism",
    mechanism: "one-minute daily plant check-ins with instant tips",
    new_information: null,
    identity: null,
    angle: "daily-plant-care-check-ins",
    angle_suggestion: null,
    audience: "new-plant-owners",
    pain_points: ["uncertain-plant-needs"],
    desires: ["healthy-plants", "less-guesswork"],
    features: ["plant-id", "watering-reminders"],
    proof: ["app_demo", "score_screen"],
    objections_handled: ["no time"],
    offer: "free trial",
    claims: ["help your plants thrive with simple daily care"],
  },
  production: {
    format: "talking_head",
    visual_style: "lofi_selfie",
    layout: null,
    setting: "home",
    length_s: 32,
    aspect: "9:16",
    voice: "on_camera",
    captions: "word_by_word",
    music: "background",
    app_on_screen_s: 8,
    pacing: "fast",
  },
  cards: [],
  people: [{ role: "actor", gender: "male", age_band: "25_34", ethnicity: "white", vibe: "relatable, casual" }],
  cta: { type: "try_free", spoken: "Try it free", onscreen: "Download now" },
  _meta: { by: "llm", model: "…", at: "2026-10-05T12:00:00Z", manual_keys: [] },
};

function example(): Record<string, unknown> {
  return structuredClone(EXAMPLE) as unknown as Record<string, unknown>;
}

function problems(input: unknown): string {
  try {
    parseCreativeProfile(input);
  } catch (error) {
    return (error as Error).message;
  }
  assert.fail("expected parseCreativeProfile to throw");
}

test("the spec's example parses", () => {
  assert.deepEqual(parseCreativeProfile(example()), EXAMPLE);
});

test("a missing angle_suggestion normalizes to null", () => {
  const input = example();
  delete (input.strategy as Record<string, unknown>).angle_suggestion;
  assert.equal(parseCreativeProfile(input).strategy.angle_suggestion, null);
});

test("angle \"other\" requires a suggestion; other angles require null", () => {
  const other = example();
  (other.strategy as Record<string, unknown>).angle = "other";
  assert.match(problems(other), /strategy\.angle_suggestion: must be a slug when angle is "other"/);
  (other.strategy as Record<string, unknown>).angle_suggestion = "new-angle-idea";
  assert.equal(parseCreativeProfile(other).strategy.angle_suggestion, "new-angle-idea");

  const suggested = example();
  (suggested.strategy as Record<string, unknown>).angle_suggestion = "new-angle-idea";
  assert.match(problems(suggested), /strategy\.angle_suggestion: must be null unless angle is "other"/);

  const nullAngle = example();
  (nullAngle.strategy as Record<string, unknown>).angle = null;
  (nullAngle.strategy as Record<string, unknown>).angle_suggestion = "new-angle-idea";
  assert.match(problems(nullAngle), /strategy\.angle_suggestion: must be null unless angle is "other"/);
});

test("enum fields reject values outside the list", () => {
  const bad = example();
  (bad.hook as Record<string, unknown>).type = "shocking";
  assert.match(problems(bad), /hook\.type: must be one of/);
});

test("slug fields must be lowercase slugs", () => {
  const bad = example();
  (bad.strategy as Record<string, unknown>).angle = "Not A Slug!";
  (bad.strategy as Record<string, unknown>).pain_points = ["fine", "Also-Bad!"];
  const message = problems(bad);
  assert.match(message, /strategy\.angle: must be a lowercase slug or null/);
  assert.match(message, /strategy\.pain_points\[1\]: must be a lowercase slug/);
});

test("nullable fields accept null and required lists accept []", () => {
  const profile = example();
  (profile.script as Record<string, unknown>).transcript = null;
  (profile.script as Record<string, unknown>).structure = null;
  (profile.strategy as Record<string, unknown>).angle = null;
  (profile.strategy as Record<string, unknown>).pain_points = [];
  profile.people = [];
  assert.ok(parseCreativeProfile(profile));
});

test("missing required lists are errors", () => {
  const bad = example();
  delete (bad.strategy as Record<string, unknown>).desires;
  delete (bad as Record<string, unknown>).people;
  const message = problems(bad);
  assert.match(message, /strategy\.desires: must be an array/);
  assert.match(message, /people: must be an array/);
});

test("unknown keys at any level are errors", () => {
  const bad = example();
  (bad as Record<string, unknown>).strategyy = {};
  (bad.strategy as Record<string, unknown>).awarness = "unaware";
  ((bad.script as Record<string, unknown>).beats as Record<string, unknown>[])[0]!.tempo = "fast";
  const message = problems(bad);
  assert.match(message, /strategyy: unknown key/);
  assert.match(message, /strategy\.awarness: unknown key/);
  assert.match(message, /script\.beats\[0\]\.tempo: unknown key/);
});

test("schema_version must be 1", () => {
  const bad = example();
  bad.schema_version = 2;
  assert.match(problems(bad), /schema_version: must be 1/);
});

test("image profiles must null out video-only fields", () => {
  const bad = example();
  bad.media_type = "image";
  const message = problems(bad);
  assert.match(message, /script: must be null for image/);
  assert.match(message, /hook\.length_s: must be null for image/);
  for (const key of ["voice", "captions", "music", "app_on_screen_s", "pacing", "length_s"]) {
    assert.match(message, new RegExp(`production\\.${key}: must be null for image`));
  }

  const good = example();
  good.media_type = "image";
  good.script = null;
  (good.hook as Record<string, unknown>).length_s = null;
  const production = good.production as Record<string, unknown>;
  for (const key of ["voice", "captions", "music", "app_on_screen_s", "pacing", "length_s"]) production[key] = null;
  production.layout = "product_shot";
  assert.ok(parseCreativeProfile(good));
});

test("cards must be [] unless media_type is carousel", () => {
  const bad = example();
  bad.cards = [{ position: 0, text: "a", visual: "b" }];
  assert.match(problems(bad), /cards: must be \[\] unless media_type is carousel/);

  const good = example();
  good.media_type = "carousel";
  good.cards = [{ position: 0, text: "a", visual: "b" }];
  assert.ok(parseCreativeProfile(good));
});

test("_meta.at must parse as a date and manual_keys must be field paths", () => {
  const bad = example();
  (bad._meta as Record<string, unknown>).at = "not a date";
  (bad._meta as Record<string, unknown>).manual_keys = ["strategy.angle", "media_type", "people[0].gender", "not a path"];
  const message = problems(bad);
  assert.match(message, /_meta\.at: must be a parseable date-time string/);
  assert.match(message, /_meta\.manual_keys\[3\]: must be a field path/);
});

test("the error lists multiple problems at once", () => {
  const bad = example();
  bad.schema_version = 7;
  (bad.hook as Record<string, unknown>).type = "bogus";
  (bad.cta as Record<string, unknown>).type = "bogus";
  const message = problems(bad);
  const lines = message.split("\n").filter((line) => line.includes(": "));
  assert.ok(lines.length >= 3, message);
});
