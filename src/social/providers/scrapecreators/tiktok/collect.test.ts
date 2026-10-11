import assert from "node:assert/strict";
import { test } from "node:test";
import profile from "./fixtures/profile.json" with { type: "json" };
import videos from "./fixtures/videos.json" with { type: "json" };
import { scrapeCreatorsTikTokCollector } from "./collect.ts";

const profileBody = profile as Record<string, unknown>;
const videoItems = (videos as { aweme_list: Array<Record<string, unknown>> }).aweme_list;

async function withStubbedFetch(responses: Array<{ body: Record<string, unknown>; status?: number }>, run: (requests: Array<{ url: URL; apiKey: string | null }>) => Promise<void>): Promise<void> {
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

test("skips TikTok photo posts without counting them toward maxPosts and passes US region", async () => {
  const firstPage = {
    aweme_list: [videoItems[0]],
    has_more: true,
    max_cursor: "cursor-2",
    credits_charged: 1,
    credits_remaining: 57,
  };
  const secondPage = {
    aweme_list: [videoItems[1]],
    has_more: false,
    credits_charged: 1,
    credits_remaining: 56,
  };

  await withStubbedFetch([{ body: profileBody }, { body: firstPage }, { body: secondPage }], async (requests) => {
    const ids: string[] = [];
    const result = await scrapeCreatorsTikTokCollector.collect("sample_creator", {
      maxPosts: 1,
      maxCredits: 5,
      onPosts: (posts) => {
        ids.push(...posts.map((post) => post.externalId));
      },
    });

    assert.equal(result.postsSeen, 1);
    assert.equal(result.creditsUsed, 3);
    assert.equal(result.creditsRemaining, 56);
    assert.deepEqual(ids, ["7687100769052495134"]);
    assert.deepEqual(
      requests.map(({ url }) => `${url.pathname}?${url.searchParams.toString()}`),
      [
        "/v1/tiktok/profile?handle=sample_creator",
        "/v3/tiktok/profile/videos?handle=sample_creator&user_id=1000001&sort_by=latest&region=US",
        "/v3/tiktok/profile/videos?handle=sample_creator&user_id=1000001&sort_by=latest&region=US&max_cursor=cursor-2",
      ],
    );
    assert.ok(requests.every(({ apiKey }) => apiKey === "test-key"));
  });
});

test("keeps paging TikTok videos when has_more is the number 1", async () => {
  const firstPage = { aweme_list: [videoItems[1]], has_more: 1, max_cursor: 1790714054768, credits_charged: 1 };
  const secondPage = { aweme_list: [videoItems[2]], has_more: 0, credits_charged: 1 };

  await withStubbedFetch([{ body: profileBody }, { body: firstPage }, { body: secondPage }], async (requests) => {
    const result = await scrapeCreatorsTikTokCollector.collect("sample_creator", { maxPosts: 10, maxCredits: 5 });

    assert.equal(result.postsSeen, 2);
    assert.equal(requests.at(-1)?.url.searchParams.get("max_cursor"), "1790714054768");
  });
});
