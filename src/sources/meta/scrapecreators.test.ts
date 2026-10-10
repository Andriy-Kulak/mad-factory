import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scrapeCreatorsSource } from "./scrapecreators.ts";
import type { TrackedSourceRow } from "../../db/types.ts";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/scrapecreators-company.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const fixtureResults = fixture.results as Record<string, unknown>[];
const base: TrackedSourceRow = {
  id: "tracked-source",
  product_id: "product",
  source: "meta",
  kind: "page",
  value: "fixture-page-1",
  country: "US",
  label: null,
  enabled: true,
  config: {},
  last_scraped_at: null,
  created_at: "",
};

interface MockResponse {
  status?: number;
  statusText?: string;
  body: Record<string, unknown>;
}

async function withFetch(
  handler: (url: URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SCRAPECREATORS_API_KEY;
  process.env.SCRAPECREATORS_API_KEY = "test-scrapecreators-key";
  globalThis.fetch = ((input: URL | RequestInfo, init?: RequestInit) => handler(new URL(String(input)), init)) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SCRAPECREATORS_API_KEY;
    else process.env.SCRAPECREATORS_API_KEY = originalKey;
  }
}

function response({ status = 200, statusText = "OK", body }: MockResponse): Response {
  return new Response(JSON.stringify(body), { status, statusText });
}

function options(maxAds: number, onBatch?: (ads: Array<{ externalId: string }>) => void, onUsage?: (credits: number) => void) {
  return { maxAds, headless: true, onBatch, onUsage };
}

test("page collection requests company ads with total-impressions sorting", async () => {
  await withFetch(async (url, init) => {
    assert.equal(url.pathname, "/v1/facebook/adLibrary/company/ads");
    assert.equal(url.searchParams.get("pageId"), "fixture-page-1");
    assert.equal(url.searchParams.get("sort_by"), "total_impressions");
    assert.equal(url.searchParams.get("status"), "ACTIVE");
    assert.equal(url.searchParams.get("media_type"), "ALL");
    assert.equal(url.searchParams.get("country"), "US");
    assert.equal(new Headers(init?.headers).get("x-api-key"), "test-scrapecreators-key");
    return response({ body: { ...fixture, cursor: null, results: fixtureResults.slice(0, 1) } });
  }, async () => {
    const ads = await scrapeCreatorsSource.collect(base, options(10));
    assert.deepEqual(ads.map((ad) => ad.externalId), ["fixture-ad-1"]);
  });
});

test("page collection passes through an explicit tracked-source status", async () => {
  await withFetch(async (url) => {
    assert.equal(url.searchParams.get("status"), "ALL");
    return response({ body: { ...fixture, cursor: null, results: fixtureResults.slice(0, 1) } });
  }, async () => {
    await scrapeCreatorsSource.collect({ ...base, config: { status: "ALL" } }, options(10));
  });
});

test("keyword collection requests search ads and reads searchResults", async () => {
  await withFetch(async (url) => {
    assert.equal(url.pathname, "/v1/facebook/adLibrary/search/ads");
    assert.equal(url.searchParams.get("query"), "example phrase");
    assert.equal(url.searchParams.get("search_type"), "keyword_unordered");
    return response({ body: { success: true, credits_charged: 1, cursor: null, searchResults: fixtureResults.slice(0, 1) } });
  }, async () => {
    const ads = await scrapeCreatorsSource.collect(
      { ...base, kind: "keyword", value: "example phrase", country: "" },
      options(10),
    );
    assert.deepEqual(ads.map((ad) => ad.externalId), ["fixture-ad-1"]);
  });
});

test("pagination follows cursors and stops when maxAds is reached", async () => {
  const calls: URL[] = [];
  await withFetch(async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      return response({ body: { success: true, credits_charged: 1, cursor: "cursor-two", results: fixtureResults.slice(0, 2) } });
    }
    return response({ body: { success: true, credits_charged: 2, cursor: "cursor-three", results: fixtureResults.slice(2) } });
  }, async () => {
    const ads = await scrapeCreatorsSource.collect(base, options(3));
    assert.deepEqual(ads.map((ad) => ad.externalId), ["fixture-ad-1", "fixture-ad-2", "fixture-ad-3"]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.searchParams.get("cursor"), "cursor-two");
  });
});

test("collection preserves order and drops duplicate archive ids", async () => {
  let page = 0;
  await withFetch(async () => {
    page++;
    return page === 1
      ? response({ body: { success: true, credits_charged: 1, cursor: "next", results: fixtureResults.slice(0, 2) } })
      : response({ body: { success: true, credits_charged: 1, cursor: null, results: [fixtureResults[0], fixtureResults[2]] } });
  }, async () => {
    const ads = await scrapeCreatorsSource.collect(base, options(10));
    assert.deepEqual(ads.map((ad) => ad.externalId), ["fixture-ad-1", "fixture-ad-2", "fixture-ad-3"]);
  });
});

test("onUsage receives credits charged for each API call", async () => {
  let page = 0;
  const usage: number[] = [];
  await withFetch(async () => {
    page++;
    return response({
      body: {
        success: true,
        credits_charged: page,
        cursor: page === 1 ? "next" : null,
        results: page === 1 ? fixtureResults.slice(0, 1) : fixtureResults.slice(1, 2),
      },
    });
  }, async () => {
    await scrapeCreatorsSource.collect(base, options(10, undefined, (credits) => usage.push(credits)));
    assert.deepEqual(usage, [1, 2]);
  });
});

test("success:false and non-2xx responses surface status/message without leaking the key", async () => {
  const cases = [
    {
      status: 200,
      body: { success: false, message: "Request rejected test-scrapecreators-key" },
      expected: "ScrapeCreators request failed (HTTP 200): Request rejected",
    },
    {
      status: 429,
      statusText: "Too Many Requests",
      body: { message: "Credit limit reached" },
      expected: "ScrapeCreators request failed (HTTP 429): Credit limit reached",
    },
  ];
  for (const item of cases) {
    await withFetch(async () => response(item), async () => {
      await assert.rejects(
        scrapeCreatorsSource.collect(base, options(1)),
        (error: Error) => {
          assert.ok(error.message.includes(item.expected));
          assert.doesNotMatch(error.message, /test-scrapecreators-key/);
          return true;
        },
      );
    });
  }
});
