import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTRIBUTE_KEYS, attributeValue } from "./attributes.ts";

test("manual creative attributes validate slugs and positive integer lengths", () => {
  assert.deepEqual(ATTRIBUTE_KEYS, ["angle", "hook", "format", "length_s", "version", "avatar"]);
  assert.equal(attributeValue("hook", "opening-line"), "opening-line");
  assert.equal(attributeValue("length_s", "15"), 15);
  assert.equal(attributeValue("future-key", "short-form"), "short-form");
  assert.throws(() => attributeValue("hook", "Opening-Line"), /lowercase slug/);
  assert.throws(() => attributeValue("length_s", "0"), /positive integer/);
});
