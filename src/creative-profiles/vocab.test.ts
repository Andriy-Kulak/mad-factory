import { test } from "node:test";
import assert from "node:assert/strict";
import { angleProblem, parseAngles, parseAudiences, vocabFromDocs } from "./vocab.ts";

const AUDIENCES_MD = `# Audiences

## A. The widget-less worker (lead)

- **Who:** fictional people.
- **What they want:** a fictional thing.

## B. Hobbyists in a hurry

- **Who:** more fictional people.

## Not the audience

People who want something else entirely.
`;

const ANGLES_MD = `# Angles

| Angle | Audience | Desire | Hook ideas | Proof | Status |
| --- | --- | --- | --- | --- | --- |
| **Do one thing well** | A | Status, control | "hook" | proof | Untested |
| **Quietly impressive** | A, B | Belonging | "hook" | proof | Untested |
| plain row, skipped | A | Status | | | |
`;

const LIBRARY_MD = `# Angle library

| Angle | Promise | Not this | Example hooks | Audience | Desire |
| --- | --- | --- | --- | --- | --- |
| **Shine on stage** | Become an impressive performer in general. | A specific situation -> that angle. | "Be dazzling by Friday" | A, B | Status |
| **Never stall** | Always know what to do next. | — | "Ever freeze mid-task?" | B | Control |
`;

test("parseAudiences reads H2 letter headings into kebab slugs", () => {
  assert.deepEqual(parseAudiences(AUDIENCES_MD), [
    { letter: "a", slug: "the-widget-less-worker", name: "The widget-less worker" },
    { letter: "b", slug: "hobbyists-in-a-hurry", name: "Hobbyists in a hurry" },
  ]);
});

test("parseAngles reads the old format: bold names, letters, desires, hook ideas as examples", () => {
  assert.deepEqual(parseAngles(ANGLES_MD), [
    {
      slug: "do-one-thing-well",
      name: "Do one thing well",
      audiences: ["a"],
      desires: ["status", "control"],
      examples: '"hook"',
    },
    {
      slug: "quietly-impressive",
      name: "Quietly impressive",
      audiences: ["a", "b"],
      desires: ["belonging"],
      examples: '"hook"',
    },
  ]);
});

test("parseAngles reads the library format: promise, not-this, examples", () => {
  assert.deepEqual(parseAngles(LIBRARY_MD), [
    {
      slug: "shine-on-stage",
      name: "Shine on stage",
      promise: "Become an impressive performer in general.",
      not: "A specific situation -> that angle.",
      examples: '"Be dazzling by Friday"',
      audiences: ["a", "b"],
      desires: ["status"],
    },
    {
      slug: "never-stall",
      name: "Never stall",
      promise: "Always know what to do next.",
      examples: '"Ever freeze mid-task?"',
      audiences: ["b"],
      desires: ["control"],
    },
  ]);
});

test("vocabFromDocs reads audience and angle docs and unions desires", () => {
  const vocab = vocabFromDocs([
    { name: "audiences", body_md: AUDIENCES_MD },
    { name: "angles", body_md: ANGLES_MD },
  ]);
  assert.equal(vocab.library, false);
  assert.equal(vocab.audiences.length, 2);
  assert.equal(vocab.audiences[0]!.slug, "the-widget-less-worker");
  assert.equal(vocab.angles.length, 2);
  // Letters in the audience column map to audience slugs.
  assert.deepEqual(vocab.angles[0]!.audiences, ["the-widget-less-worker"]);
  assert.deepEqual(vocab.angles[1]!.audiences, ["the-widget-less-worker", "hobbyists-in-a-hurry"]);
  assert.deepEqual(vocab.desires, ["belonging", "control", "status"]);
});

test("vocabFromDocs prefers the angle-library doc and sets library", () => {
  const vocab = vocabFromDocs([
    { name: "audiences", body_md: AUDIENCES_MD },
    { name: "angles", body_md: ANGLES_MD },
    { name: "angle-library", body_md: LIBRARY_MD },
  ]);
  assert.equal(vocab.library, true);
  assert.deepEqual(
    vocab.angles.map((angle) => angle.slug),
    ["shine-on-stage", "never-stall"],
  );
  assert.deepEqual(vocab.angles[0]!.audiences, ["the-widget-less-worker", "hobbyists-in-a-hurry"]);
  assert.deepEqual(vocab.desires, ["control", "status"]);
});

test("vocabFromDocs keeps raw letters when the audiences doc is missing", () => {
  const vocab = vocabFromDocs([{ name: "angles", body_md: ANGLES_MD }]);
  assert.deepEqual(vocab.angles[0]!.audiences, ["a"]);
  assert.deepEqual(vocab.angles[1]!.audiences, ["a", "b"]);
});

test("vocabFromDocs returns empty vocab without docs", () => {
  assert.deepEqual(vocabFromDocs([]), { angles: [], audiences: [], desires: [], library: false });
});

test("angleProblem only checks when a library is loaded", () => {
  const noLibrary = { angles: [], audiences: [], desires: [], library: false };
  assert.equal(angleProblem("anything", noLibrary), null);
  assert.equal(angleProblem(null, noLibrary), null);

  const library = {
    angles: [{ slug: "shine-on-stage", name: "Shine", audiences: [], desires: [] }],
    audiences: [],
    desires: [],
    library: true,
  };
  assert.equal(angleProblem("shine-on-stage", library), null);
  assert.equal(angleProblem("other", library), null);
  assert.match(angleProblem("invented", library)!, /shine-on-stage/);
  assert.match(angleProblem(null, library)!, /must be one of/);
});
