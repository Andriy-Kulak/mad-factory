import assert from "node:assert/strict";
import { test } from "node:test";
import { fitOf, gradeRank, intentOf, personaOf, routeOf } from "./b2b-social-grade.ts";

test("personaOf: buyers sign, champions use", () => {
  assert.equal(personaOf("exec"), "buyer");
  assert.equal(personaOf("vp"), "buyer");
  assert.equal(personaOf("director"), "buyer");
  assert.equal(personaOf("manager"), "champion");
  assert.equal(personaOf("ic"), "champion");
  assert.equal(personaOf("unknown"), "unknown");
});

test("fitOf: big company with a known role is A, a smaller-company buyer is B, the rest C", () => {
  assert.equal(fitOf("fortune500", "champion", true), "A");
  assert.equal(fitOf("enterprise", "buyer", true), "A");
  assert.equal(fitOf("fortune500", "unknown", true), "B");
  assert.equal(fitOf("yc", "buyer", true), "B");
  assert.equal(fitOf("other", "buyer", true), "B");
  assert.equal(fitOf("other", "champion", true), "C");
  assert.equal(fitOf("other", "buyer", false), "C");
});

test("intentOf: the signal sets the level, repeats and colleagues raise it, age lowers it", () => {
  const base = { signals: 1, colleagues: 1, lastAt: "2026-01-09T00:00:00.000Z", capturedAt: "2026-01-10" };
  assert.equal(intentOf({ ...base, kind: "using" }), 1);
  assert.equal(intentOf({ ...base, kind: "pain" }), 1);
  assert.equal(intentOf({ ...base, kind: "evaluating" }), 2);
  assert.equal(intentOf({ ...base, kind: "cheer" }), 3);
  assert.equal(intentOf({ ...base, kind: "evaluating", signals: 2 }), 1);
  assert.equal(intentOf({ ...base, kind: "cheer", colleagues: 3 }), 2);
  assert.equal(intentOf({ ...base, kind: "using", lastAt: "2025-12-01T00:00:00.000Z" }), 2);
  assert.equal(intentOf({ ...base, kind: "cheer", lastAt: "2025-12-01T00:00:00.000Z" }), 3);
});

test("routeOf and gradeRank", () => {
  assert.deepEqual(
    (["A", "B", "C"] as const).flatMap((f) => ([1, 2, 3] as const).map((i) => `${f}${i}:${routeOf(f, i)}`)),
    ["A1:now", "A2:now", "A3:nurture", "B1:now", "B2:selfserve", "B3:nurture", "C1:selfserve", "C2:selfserve", "C3:nurture"],
  );
  assert.ok(gradeRank("A", 3) < gradeRank("B", 1));
  assert.ok(gradeRank("B", 1) < gradeRank("B", 2));
});
