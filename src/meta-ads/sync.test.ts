import { test } from "node:test";
import assert from "node:assert/strict";
import { autoDays } from "./sync.ts";

test("autoDays uses account-local Monday refresh and defaults to 28 days", () => {
  assert.equal(autoDays(null, new Date("2026-10-05T12:00:00Z"), "UTC"), 28);
  assert.equal(autoDays("2026-10-04T12:00:00Z", new Date("2026-10-05T12:00:00Z"), "UTC"), 28);
});

test("autoDays widens for missed days but stays between seven and twenty-eight", () => {
  assert.equal(autoDays("2026-10-01T12:00:00Z", new Date("2026-10-03T12:00:00Z"), "UTC"), 7);
  assert.equal(autoDays("2026-09-25T12:00:00Z", new Date("2026-10-03T12:00:00Z"), "UTC"), 9);
  assert.equal(autoDays("2026-08-01T12:00:00Z", new Date("2026-10-03T12:00:00Z"), "UTC"), 28);
});

test("autoDays evaluates Monday in the account time zone", () => {
  assert.equal(autoDays("2026-10-04T12:00:00Z", new Date("2026-10-05T01:00:00Z"), "America/Los_Angeles"), 7);
});
