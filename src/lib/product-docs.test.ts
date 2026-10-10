import assert from "node:assert/strict";
import { test } from "node:test";
import { docName } from "./product-docs.ts";

test("docName resolves paths to extensionless document names", () => {
  assert.equal(docName("experiments/plans/example-plan.md"), "example-plan");
  assert.equal(docName("local/example-writeup.json"), "example-writeup");
  assert.equal(docName("example-plan"), "example-plan");
});
