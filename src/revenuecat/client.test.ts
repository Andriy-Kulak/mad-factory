import { test } from "node:test";
import assert from "node:assert/strict";
import { RevenueCatClient } from "./client.ts";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test("client retries a 429 after backoff_ms and never puts the key in errors", async () => {
  const waits: number[] = [];
  const calls: string[] = [];
  const responses = [reply(429, { type: "rate_limit_error", backoff_ms: 1200 }), reply(200, { ok: 1 })];
  const client = new RevenueCatClient(
    "sk_secret",
    0,
    async (ms) => void waits.push(ms),
    async (url) => (calls.push(String(url)), responses.shift()!),
  );
  assert.deepEqual(await client.get("/projects/p/charts/revenue", { segment: "attribution_keyword", skip: undefined }), { ok: 1 });
  assert.deepEqual(waits, [1200]);
  assert.equal(calls[0], "https://api.revenuecat.com/v2/projects/p/charts/revenue?segment=attribution_keyword");
  assert.equal(client.calls, 2);

  const failing = new RevenueCatClient(
    "sk_secret",
    0,
    async () => {},
    async () => reply(403, { type: "authorization_error", message: "missing permission" }),
  );
  await assert.rejects(failing.get("/projects/p/charts/revenue"), (e: Error) => /403 authorization_error missing permission/.test(e.message) && !e.message.includes("sk_secret"));
});
