import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DAYS, autoDays } from "./sync.ts";

test("autoDays widens the window to cover days missed since the last successful sync", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  assert.equal(autoDays(null, 7, now), 7);
  assert.equal(autoDays("2026-03-09T11:00:00Z", 7, now), 7);
  assert.equal(autoDays("2026-03-01T11:00:00Z", 7, now), 11);
  assert.equal(autoDays("2025-01-01T00:00:00Z", 7, now), MAX_DAYS);
});
