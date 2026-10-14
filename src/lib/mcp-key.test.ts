import assert from "node:assert/strict";
import { test } from "node:test";
import { hashMcpKey, isMcpKeyScope, MCP_KEY_SCOPES, newMcpKey } from "./mcp-key.ts";

test("keys are long, random and stored only as a stable hash", () => {
  const a = newMcpKey();
  const b = newMcpKey();
  assert.match(a, /^mf_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(hashMcpKey(a), hashMcpKey(a));
  assert.match(hashMcpKey(a), /^[0-9a-f]{64}$/);
  assert.notEqual(hashMcpKey(a), hashMcpKey(b));
});

test("only read and research are key scopes", () => {
  assert.deepEqual(MCP_KEY_SCOPES, ["read", "research"]);
  assert.equal(isMcpKeyScope("research"), true);
  for (const bad of ["write", "admin", "", undefined, null]) assert.equal(isMcpKeyScope(bad), false, String(bad));
});
