import assert from "node:assert/strict";
import { test } from "node:test";
import { scrapeCreatorsGet } from "./scrapecreators.ts";

process.env.SCRAPECREATORS_API_KEY = "test-scrapecreators-key";

async function withFetch(replies: (() => Response)[], run: () => Promise<void>): Promise<number> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => replies[Math.min(calls++, replies.length - 1)]!()) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

const ok = () => Response.json({ success: true, credits_charged: 1 });
const dropped = (): Response => {
  throw new TypeError("fetch failed");
};
const fast = { delayMs: 0 };

test("a dropped connection and a 5xx are retried until the request works", async () => {
  const calls = await withFetch([dropped, () => Response.json({ message: "upstream" }, { status: 500 }), ok], async () => {
    assert.equal((await scrapeCreatorsGet("/v1/x", {}, fast)).creditsCharged, 1);
  });
  assert.equal(calls, 3);
});

test("retries stop after the limit and the last error surfaces", async () => {
  const calls = await withFetch([dropped], async () => {
    await assert.rejects(scrapeCreatorsGet("/v1/x", {}, fast), /fetch failed/);
  });
  assert.equal(calls, 3);
  const calls5xx = await withFetch([() => Response.json({ message: "upstream" }, { status: 502 })], async () => {
    await assert.rejects(scrapeCreatorsGet("/v1/x", {}, fast), /HTTP 502\): upstream/);
  });
  assert.equal(calls5xx, 3);
});

test("a 4xx is not retried", async () => {
  const calls = await withFetch([() => Response.json({ message: "Credit limit reached" }, { status: 429 })], async () => {
    await assert.rejects(scrapeCreatorsGet("/v1/x", {}, fast), /HTTP 429\): Credit limit reached/);
  });
  assert.equal(calls, 1);
});
