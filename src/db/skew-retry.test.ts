import assert from "node:assert/strict";
import { test } from "node:test";
import { skewRetryFetch } from "./skew-retry.ts";

const response = (status: number, body: string) => new Response(body, { status });

function scripted(...replies: Response[]) {
  let calls = 0;
  const f = (async () => replies[Math.min(calls++, replies.length - 1)]!) as typeof fetch;
  return { f, calls: () => calls };
}

test("retries a clock-skew 401 and returns the next good response", async () => {
  const s = scripted(response(401, '{"message":"JWT issued at future"}'), response(200, "[]"));
  const res = await skewRetryFetch(s.f, { delayMs: 0 })("https://x");
  assert.equal(res.status, 200);
  assert.equal(s.calls(), 2);
});

test("gives up after the retry budget and returns the last response", async () => {
  const s = scripted(response(401, "JWT issued at future"));
  const res = await skewRetryFetch(s.f, { retries: 2, delayMs: 0 })("https://x");
  assert.equal(res.status, 401);
  assert.equal(s.calls(), 3);
});

test("passes other failures straight through", async () => {
  const s = scripted(response(401, '{"message":"Invalid API key"}'));
  const res = await skewRetryFetch(s.f, { delayMs: 0 })("https://x");
  assert.equal(res.status, 401);
  assert.equal(await res.text(), '{"message":"Invalid API key"}');
  assert.equal(s.calls(), 1);
});
