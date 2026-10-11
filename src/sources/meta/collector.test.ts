import { test } from "node:test";
import assert from "node:assert/strict";
import { metaSource } from "./collector.ts";
import type { TrackedSourceRow } from "../../db/types.ts";

const base: TrackedSourceRow = {
  id: "t",
  product_id: "p",
  source: "meta",
  kind: "page",
  value: "1",
  country: "US",
  label: null,
  enabled: true,
  config: {},
  last_scraped_at: null,
  created_at: "",
};

test("validate rejects wrong source and kinds", () => {
  assert.throws(() => metaSource.validate({ ...base, source: "other" }));
  assert.throws(() => metaSource.validate({ ...base, kind: "hashtag" }));
  assert.throws(() => metaSource.validate({ ...base, value: "" }));
  metaSource.validate(base);
  metaSource.validate({ ...base, kind: "keyword", value: "x" });
});
