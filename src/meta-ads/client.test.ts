import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNotDestructive, MetaAdsClient } from "./client.ts";

function withEnv<T>(values: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function response(body: unknown, headers?: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

test("uses META_ADS_TOKEN as bearer auth and sanitizes proof parameters", async () =>
  withEnv({ META_ADS_TOKEN: "read-secret" }, async () => {
    const calls: { url: string; headers: HeadersInit }[] = [];
    const journal: unknown[] = [];
    const client = new MetaAdsClient(
      {
        journal: async (entry) => {
          journal.push(entry);
        },
      },
      (async (url, init) => {
        calls.push({ url: String(url), headers: init!.headers! });
        return response({ data: [] });
      }) as typeof fetch,
    );
    await client.get("/act_123/campaigns", { limit: 200, appsecret_proof: "caller-proof" });
    assert.equal(new Headers(calls[0]!.headers).get("authorization"), "Bearer read-secret");
    assert.equal(calls[0]!.url.includes("read-secret"), false);
    assert.equal(new URL(calls[0]!.url).searchParams.has("appsecret_proof"), false);
    assert.deepEqual((journal[0] as { params: unknown }).params, { limit: 200 });
  }));

test("getAll follows cursor pagination while a next page exists", async () =>
  withEnv({ META_ADS_TOKEN: "read-secret" }, async () => {
    const seen: string[] = [];
    const client = new MetaAdsClient({}, (async (input) => {
      seen.push(String(input));
      if (seen.length === 1) return response({ data: [{ id: "a" }], paging: { next: "next-url", cursors: { after: "cursor-1" } } });
      return response({ data: [{ id: "b" }] });
    }) as typeof fetch);
    assert.deepEqual(await client.getAll<{ id: string }>("/ads", { limit: 200 }), [{ id: "a" }, { id: "b" }]);
    assert.equal(new URL(seen[1]!).searchParams.get("after"), "cursor-1");
    assert.equal(seen.length, 2);
  }));

test("stops before another call after usage reaches ninety percent", async () =>
  withEnv({ META_ADS_TOKEN: "read-secret" }, async () => {
    let calls = 0;
    const client = new MetaAdsClient({}, (async () => {
      calls++;
      return response({}, { "x-ad-account-usage": JSON.stringify({ account_util_pct: 90 }) });
    }) as typeof fetch);
    await client.get("/account");
    await assert.rejects(client.get("/account"), /Meta usage at 90%; stopping/);
    assert.equal(calls, 1);
  }));

test("throttle errors include the code and estimated regain time", async () =>
  withEnv({ META_ADS_TOKEN: "read-secret" }, async () => {
    const client = new MetaAdsClient({}, (async () =>
      response(
        {
          error: { code: 4, message: "Rate limit reached", estimated_time_to_regain_access: 60 },
        },
        {},
        400,
      )) as typeof fetch);
    await assert.rejects(client.get("/account"), /code 4.*estimated_time_to_regain_access=60/);
  }));

test("enforces call ceiling and explains invalid tokens", async () =>
  withEnv({ META_ADS_TOKEN: "read-secret" }, async () => {
    let calls = 0;
    const client = new MetaAdsClient({ maxCalls: 1 }, (async () => {
      calls++;
      return response({});
    }) as typeof fetch);
    await client.get("/account");
    await assert.rejects(client.get("/account"), /call ceiling reached/);
    assert.equal(calls, 1);

    const invalid = new MetaAdsClient({}, (async () => response({ error: { code: 190, message: "Expired" } }, {}, 400)) as typeof fetch);
    await assert.rejects(invalid.get("/account"), /token invalid or expired; regenerate the system-user token/);
  }));

test("refuses method overrides and token query parameters", async () =>
  withEnv({ META_ADS_TOKEN: "read-secret" }, async () => {
    const client = new MetaAdsClient({}, (async () => response({})) as typeof fetch);
    await assert.rejects(client.get("/account", { method: "DELETE" }), /method override/);
    await assert.rejects(client.get("/account", { access_token: "bad" }), /must not be passed as a parameter/);
  }));

test("pause POSTs status=PAUSED and journals the write", async () =>
  withEnv({ META_ADS_TOKEN: "secret" }, async () => {
    const calls: { url: string; method?: string; body?: unknown; headers: HeadersInit }[] = [];
    const journal: { method: string }[] = [];
    const client = new MetaAdsClient(
      {
        journal: async (entry) => {
          journal.push(entry);
        },
      },
      (async (url, init) => {
        calls.push({ url: String(url), method: init?.method, body: init?.body, headers: init!.headers! });
        return response({ success: true });
      }) as typeof fetch,
    );
    await client.pause("12345");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, "POST");
    assert.equal(calls[0]!.url, "https://graph.facebook.com/v26.0/12345");
    assert.equal(calls[0]!.body, "status=PAUSED");
    assert.equal(journal[0]!.method, "POST");
  }));

test("assertNotDestructive refuses deletes and terminal statuses", async () =>
  withEnv({ META_ADS_TOKEN: "secret" }, async () => {
    assert.throws(() => assertNotDestructive("DELETE", {}), /Refusing to delete\/archive/);
    assert.throws(() => assertNotDestructive("POST", { status: "DELETED" }), /Refusing to delete\/archive/);
    assert.throws(() => assertNotDestructive("POST", { status: "archived" }), /Refusing to delete\/archive/);
    const client = new MetaAdsClient({}, (async () => response({})) as typeof fetch);
    await assert.rejects(client.get("/ads", { status: "DELETED" }), /Refusing to delete\/archive/);
  }));

test("updateAdset sends only allowed keys and throws when empty", async () =>
  withEnv({ META_ADS_TOKEN: "secret" }, async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const client = new MetaAdsClient({}, (async (url, init) => {
      calls.push({ url: String(url), body: init?.body });
      return response({ success: true });
    }) as typeof fetch);
    await assert.rejects(client.updateAdset("55", {}), /needs name/);
    await client.updateAdset("55", { name: "New name", dailyMinSpendCents: 1500, dailyBudgetCents: 6000 });
    assert.equal(calls.length, 1);
    const params = new URLSearchParams(String(calls[0]!.body));
    assert.equal(params.get("name"), "New name");
    assert.equal(params.get("daily_min_spend_target"), "1500");
    assert.equal(params.get("daily_budget"), "6000");
    assert.deepEqual([...params.keys()].sort(), ["daily_budget", "daily_min_spend_target", "name"]);
  }));

test("copyAdset POSTs /copies without ads and always PAUSED", async () =>
  withEnv({ META_ADS_TOKEN: "secret" }, async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const client = new MetaAdsClient({}, (async (url, init) => {
      calls.push({ url: String(url), body: init?.body });
      return response({ copied_adset_id: "77" });
    }) as typeof fetch);
    await assert.rejects(client.copyAdset("55/copies"), /bare ad set id/);
    const result = await client.copyAdset("55");
    assert.deepEqual(result.body, { copied_adset_id: "77" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://graph.facebook.com/v26.0/55/copies");
    const params = new URLSearchParams(String(calls[0]!.body));
    assert.deepEqual(Object.fromEntries(params), { deep_copy: "false", status_option: "PAUSED" });
  }));

test("createAd always sends status=PAUSED, plus validate_only when requested", async () =>
  withEnv({ META_ADS_TOKEN: "secret" }, async () => {
    const bodies: URLSearchParams[] = [];
    const client = new MetaAdsClient({}, (async (_url, init) => {
      bodies.push(new URLSearchParams(String(init?.body)));
      return response({ id: "ad-1" });
    }) as typeof fetch);
    await client.createAd("act_999", { name: "n", adsetId: "as1", creative: { object_story_spec: {} } });
    assert.equal(bodies[0]!.get("status"), "PAUSED");
    assert.equal(bodies[0]!.has("execution_options"), false);
    await client.createAd("act_999", { name: "n", adsetId: "as1", creative: {}, validateOnly: true });
    assert.equal(bodies[1]!.get("execution_options"), '["validate_only"]');
    assert.equal(bodies[1]!.get("status"), "PAUSED");
  }));

test("activate sends status=ACTIVE and write methods stay non-destructive", async () =>
  withEnv({ META_ADS_TOKEN: "secret" }, async () => {
    const calls: string[] = [];
    const client = new MetaAdsClient({}, (async (_url, init) => {
      calls.push(String(init?.body));
      return response({ success: true });
    }) as typeof fetch);
    await client.activate("77");
    assert.equal(calls[0], "status=ACTIVE");
    assert.throws(() => assertNotDestructive("DELETE", {}), /Refusing/);
    await assert.rejects(client.get("/x", { status: "ARCHIVED" }), /Refusing/);
  }));

test("uploadVideo posts multipart, polls until ready and picks the preferred thumbnail", async () =>
  withEnv({ META_ADS_TOKEN: "secret" }, async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const filePath = join(tmpdir(), "meta-ads-test-upload.mp4");
    writeFileSync(filePath, Buffer.from("fake video bytes"));
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    let statusPolls = 0;
    const client = new MetaAdsClient({}, (async (url, init) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body });
      if (u.includes("/advideos")) return response({ id: "vid-1" });
      if (u.includes("/vid-1/thumbnails")) {
        return response({
          data: [
            { uri: "https://t.example/a.jpg", is_preferred: false },
            { uri: "https://t.example/b.jpg", is_preferred: true },
          ],
        });
      }
      if (u.includes("/vid-1")) {
        statusPolls++;
        return response({ status: { video_status: "ready" } });
      }
      return response({});
    }) as typeof fetch);
    const result = await client.uploadVideo("act_999", filePath, "My ad video");
    assert.equal(result.videoId, "vid-1");
    assert.equal(result.thumbnailUrl, "https://t.example/b.jpg");
    const upload = calls.find((call) => call.url.includes("advideos"));
    assert.equal(upload!.method, "POST");
    assert.ok(upload!.body instanceof FormData);
    assert.equal((upload!.body as FormData).get("title"), "My ad video");
    assert.ok(statusPolls >= 1);
  }));

test("error messages include subcode and user fields", async () =>
  withEnv({ META_ADS_TOKEN: "secret" }, async () => {
    const client = new MetaAdsClient({}, (async () =>
      response(
        {
          error: {
            message: "Invalid parameter",
            type: "OAuthException",
            code: 100,
            error_subcode: 3858504,
            error_user_title: "Creative should not include standard enhancements",
            error_user_msg: "Including standard enhancements field in creative has been deprecated. Please choose to set individual features instead.",
          },
        },
        {},
        400,
      )) as typeof fetch);
    await assert.rejects(client.get("/ads"), /Invalid parameter \(subcode 3858504: Creative should not include standard enhancements: Including standard enhancements field/);
  }));

test("updateAdCreative sends only creative (+ execution_options), never status", async () =>
  withEnv({ META_ADS_TOKEN: "secret" }, async () => {
    const bodies: URLSearchParams[] = [];
    const client = new MetaAdsClient({}, (async (_url, init) => {
      bodies.push(new URLSearchParams(String(init?.body)));
      return response({ success: true });
    }) as typeof fetch);
    await client.updateAdCreative("ad-1", { object_story_spec: { page_id: "p" } }, false);
    assert.deepEqual([...bodies[0]!.keys()], ["creative"]);
    await client.updateAdCreative("ad-1", { object_story_spec: {} }, true);
    assert.deepEqual([...bodies[1]!.keys()].sort(), ["creative", "execution_options"]);
    assert.equal(bodies[1]!.get("execution_options"), '["validate_only"]');
    for (const body of bodies) assert.equal(body.has("status"), false);
  }));

test("uploadImage posts multipart and returns the first image hash", async () =>
  withEnv({ META_ADS_TOKEN: "secret" }, async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const filePath = join(tmpdir(), "meta-ads-test-upload.png");
    writeFileSync(filePath, Buffer.from("fake png bytes"));
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    const client = new MetaAdsClient({}, (async (url, init) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body });
      return response({ images: { "ad.png": { hash: "abc123", url: "https://i.example" } } });
    }) as typeof fetch);
    const result = await client.uploadImage("act_999", filePath);
    assert.equal(result.hash, "abc123");
    assert.equal(calls[0]!.method, "POST");
    assert.ok(calls[0]!.url.endsWith("/act_999/adimages"));
    assert.ok(calls[0]!.body instanceof FormData);
    assert.ok((calls[0]!.body as FormData).get("filename") instanceof Blob);
  }));

test("uploadImage throws when the response has no image", async () =>
  withEnv({ META_ADS_TOKEN: "secret" }, async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const filePath = join(tmpdir(), "meta-ads-test-empty.png");
    writeFileSync(filePath, Buffer.from("fake png bytes"));
    const client = new MetaAdsClient({}, (async () => response({ images: {} })) as typeof fetch);
    await assert.rejects(client.uploadImage("act_999", filePath), /no image hash/);
  }));
