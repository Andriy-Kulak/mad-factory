import { test } from "node:test";
import assert from "node:assert/strict";
import { termsMissingPopularity } from "./research.ts";

test("skips known terms without regard to case or whitespace", () => {
  assert.deepEqual(
    termsMissingPopularity(
      [
        { text: "  Alpha   Phrase ", country: "US" },
        { text: "new term", country: "CA" },
      ],
      ["alpha phrase"],
      10,
    ),
    { lookups: [{ text: "new term", country: "CA" }], deferred: 0 },
  );
});

test("deduplicates normalized text and keeps the first country", () => {
  assert.deepEqual(
    termsMissingPopularity(
      [
        { text: "  Beta  phrase", country: "CA" },
        { text: "beta phrase ", country: "US" },
      ],
      [],
      10,
    ),
    { lookups: [{ text: "beta phrase", country: "CA" }], deferred: 0 },
  );
});

test("sorts lookups by normalized text", () => {
  assert.deepEqual(
    termsMissingPopularity(
      [
        { text: "zeta", country: "US" },
        { text: "Alpha", country: "US" },
        { text: "middle", country: "CA" },
      ],
      [],
      10,
    ),
    {
      lookups: [
        { text: "alpha", country: "US" },
        { text: "middle", country: "CA" },
        { text: "zeta", country: "US" },
      ],
      deferred: 0,
    },
  );
});

test("caps lookups and reports the remaining count as deferred", () => {
  assert.deepEqual(
    termsMissingPopularity(
      [
        { text: "gamma", country: "US" },
        { text: "alpha", country: "CA" },
        { text: "beta", country: "US" },
      ],
      [],
      2,
    ),
    {
      lookups: [
        { text: "alpha", country: "CA" },
        { text: "beta", country: "US" },
      ],
      deferred: 1,
    },
  );
});

test("empty input returns no lookups and no deferred terms", () => {
  assert.deepEqual(termsMissingPopularity([], [], 10), { lookups: [], deferred: 0 });
});
