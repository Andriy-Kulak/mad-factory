import assert from "node:assert/strict";
import { test } from "node:test";
import profile from "./fixtures/profile.json" with { type: "json" };
import reels from "./fixtures/reels.json" with { type: "json" };
import { scrapeCreatorsFacebookCollector } from "./collect.ts";

const profileBody = profile as Record<string, unknown>;
const reelItems = (reels as { reels: Array<Record<string, unknown>> }).reels;

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

test("passes both Facebook reel pagination values on later pages", async () => {
  const firstPage = {
    reels: [reelItems[0]],
    next_page_id: "next-page-2",
    cursor: "cursor-2",
    credits_charged: 1,
    credits_remaining: 57,
  };
  const secondPage = {
    reels: reelItems.slice(1),
    credits_charged: 1,
    credits_remaining: 56,
  };

  await withStubbedFetch([{ body: profileBody }, { body: firstPage }, { body: secondPage }], async (requests) => {
    const ids: string[] = [];
    const result = await scrapeCreatorsFacebookCollector.collect("https://www.facebook.com/samplepage", {
      maxPosts: 3,
      maxCredits: 5,
      onPosts: (posts) => {
        ids.push(...posts.map((post) => post.externalId));
      },
    });

    assert.equal(result.postsSeen, 3);
    assert.equal(result.creditsUsed, 3);
    assert.deepEqual(ids, ["2000001", "2000002", "2000003"]);
    assert.deepEqual(
      requests.map(({ url }) => `${url.pathname}?${url.searchParams.toString()}`),
      [
        "/v1/facebook/profile?url=https%3A%2F%2Fwww.facebook.com%2Fsamplepage",
        "/v1/facebook/profile/reels?url=https%3A%2F%2Fwww.facebook.com%2Fsamplepage",
        "/v1/facebook/profile/reels?url=https%3A%2F%2Fwww.facebook.com%2Fsamplepage&next_page_id=next-page-2&cursor=cursor-2",
      ],
    );
    assert.ok(requests.every(({ apiKey }) => apiKey === "test-key"));
  });
});

test("validates Facebook profile URLs as HTTPS facebook.com links", () => {
  assert.equal(scrapeCreatorsFacebookCollector.validateValue("https://www.facebook.com/profile.php?id=1000001"), "https://www.facebook.com/profile.php?id=1000001");
  assert.throws(() => scrapeCreatorsFacebookCollector.validateValue("http://facebook.com/samplepage"));
  assert.throws(() => scrapeCreatorsFacebookCollector.validateValue("https://example.com/profile"));
});

test("since skips older reels and stops paging once a page ends before it", async () => {
  const reel = (id: string, at: string) => ({ ...reelItems[0], video_id: id, creation_time: at });
  const firstPage = {
    reels: [reel("pinned-old", "2025-01-01T00:00:00Z"), reel("new", "2026-09-01T00:00:00Z"), reel("mid", "2026-03-01T00:00:00Z")],
    next_page_id: "next-page-2",
    cursor: "cursor-2",
    credits_charged: 1,
  };
  const secondPage = {
    reels: [reel("in-range", "2025-11-01T00:00:00Z"), reel("too-old", "2025-09-01T00:00:00Z")],
    next_page_id: "next-page-3",
    cursor: "cursor-3",
    credits_charged: 1,
  };

  await withStubbedFetch([{ body: profileBody }, { body: firstPage }, { body: secondPage }], async (requests) => {
    const ids: string[] = [];
    const result = await scrapeCreatorsFacebookCollector.collect("https://www.facebook.com/samplepage", {
      maxPosts: 100,
      maxCredits: 10,
      since: "2025-10-01",
      onPosts: (posts) => {
        ids.push(...posts.map((post) => post.externalId));
      },
    });
    assert.deepEqual(ids, ["new", "mid", "in-range"]);
    assert.equal(result.postsSeen, 3);
    assert.equal(requests.length, 3);
  });
});
