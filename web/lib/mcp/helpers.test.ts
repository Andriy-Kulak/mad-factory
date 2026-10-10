import assert from "node:assert/strict";
import { test } from "node:test";
import { dayRange, DOC_DIRS, docPath } from "./helpers.ts";

test("dayRange is the last N complete days unless from/to are given", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  assert.deepEqual(dayRange({ days: 7 }, now), { since: "2026-10-02", until: "2026-10-08" });
  assert.deepEqual(dayRange({ days: 30, to: "2026-09-30" }, now), { since: "2026-09-01", until: "2026-09-30" });
  assert.deepEqual(dayRange({ from: "2026-09-01", to: "2026-09-03" }, now), { since: "2026-09-01", until: "2026-09-03" });
});

test("docPath only opens docs inside the allowed folders", () => {
  assert.deepEqual(DOC_DIRS, ["playbooks", "docs"]);
  assert.equal(docPath("playbooks/apple-ads.md", "/repo"), "/repo/playbooks/apple-ads.md");
  for (const bad of [".env", "../etc/passwd", "/etc/passwd", "playbooks/../.env", "docs/../../x.md", "src/db/client.ts", "web/lib/db.ts", "docs", "products/x/readme.md", "experiments/plans/x.json"]) {
    assert.equal(docPath(bad, "/repo"), null, bad);
  }
});
