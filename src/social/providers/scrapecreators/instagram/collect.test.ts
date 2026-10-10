import assert from "node:assert/strict";
import { test } from "node:test";
import profile from "./fixtures/profile.json" with { type: "json" };
import reels from "./fixtures/reels.json" with { type: "json" };
import { scrapeCreatorsInstagramCollector } from "./collect.ts";

const profileBody = profile as Record<string, unknown>;
const reelItems = (reels as { items: Array<{ media: Record<string, unknown> }> }).items;

async function withStubbedFetch(
  responses: Array<{ body: Record<string, unknown>; status?: number }>,
  run: (requests: Array<{ url: URL; apiKey: string | null }>) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SCRAPECREATORS_API_KEY;
  const requests: Array<{ url: URL; apiKey: string | null }> = [];
  process.env.SCRAPECREATORS_API_KEY = "test-key";
  globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(String(input));
    requests.push({ url, apiKey: new Headers(init?.headers).get("x-api-key") });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected ScrapeCreators request");
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SCRAPECREATORS_API_KEY;
    else process.env.SCRAPECREATORS_API_KEY = originalKey;
  }
}

test("collects Instagram Reels by user id and follows max_id pagination", async () => {
  const usage: number[] = [];
  const ids: string[] = [];
  const responses = [
    { body: profileBody },
    {
      body: {
        items: [reelItems[0]],
        paging_info: { more_available: true, max_id: "cursor-2" },
        credits_charged: 1,
        credits_remaining: 57,
      },
    },
    {
      body: {
        items: [reelItems[1]],
        paging_info: { more_available: false },
        credits_charged: 1,
        credits_remaining: 56,
      },
    },
  ];
  await withStubbedFetch(responses, async (requests) => {
    const result = await scrapeCreatorsInstagramCollector.collect("sample_creator", {
      maxPosts: 2,
      maxCredits: 5,
      onUsage: (credits) => usage.push(credits),
      onPosts: (posts) => {
        ids.push(...posts.map((post) => post.externalId));
      },
    });

    assert.equal(result.postsSeen, 2);
    assert.equal(result.creditsUsed, 3);
    assert.equal(result.creditsRemaining, 56);
    assert.deepEqual(usage, [1, 1, 1]);
    assert.deepEqual(ids, ["3999488182834263933", "3989395279407508278"]);
    assert.deepEqual(requests.map(({ url }) => `${url.pathname}?${url.searchParams.toString()}`), [
      "/v1/instagram/profile?handle=sample_creator",
      "/v1/instagram/user/reels?user_id=1000001",
      "/v1/instagram/user/reels?user_id=1000001&max_id=cursor-2",
    ]);
    assert.ok(requests.every(({ apiKey }) => apiKey === "test-key"));
  });
});

test("stops before another Instagram request at the configured credit limit", async () => {
  await withStubbedFetch([{ body: profileBody }], async (requests) => {
    await assert.rejects(
      scrapeCreatorsInstagramCollector.collect("sample_creator", { maxPosts: 12, maxCredits: 1 }),
      /reached the 1-credit limit/,
    );
    assert.equal(requests.length, 1);
  });
});
