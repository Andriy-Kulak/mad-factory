import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, launchCallCeiling, MAX_LAUNCH_ADS, parseLaunchSpec, type LaunchDeps } from "./launch.ts";
import { MetaAdsClient } from "./client.ts";
import { createAdFromTemplate } from "./create-ad.ts";
import { activateObjects } from "./activate.ts";
import type { MetaAdsAdsetInsert, ProductRow } from "../db/types.ts";

const VALID = JSON.stringify({
  adset_id: "as1",
  template_ad_id: "tpl",
  plan: "plan.md",
  ads: [
    { name: "ad-one", video_id: "v1", titles: ["t"], bodies: ["b"] },
    { name: "ad-two", image_hash: "h2" },
  ],
});

test("parseLaunchSpec rejects bad shapes with named fields", () => {
  assert.throws(() => parseLaunchSpec("not json"), /not valid JSON/);
  assert.throws(() => parseLaunchSpec("{}"), /adset_id/);
  const base = { adset_id: "a", template_ad_id: "t", plan: "p" };
  assert.throws(() => parseLaunchSpec(JSON.stringify({ ...base, ads: [] })), /ads/);
  assert.throws(() => parseLaunchSpec(JSON.stringify({ ...base, ads: [{ name: "x" }] })), /exactly one/);
  assert.throws(() => parseLaunchSpec(JSON.stringify({ ...base, ads: [{ name: "x", file: "f.mp4", video_id: "v" }] })), /exactly one/);
  assert.throws(
    () =>
      parseLaunchSpec(
        JSON.stringify({
          ...base,
          ads: [
            { name: "x", video_id: "v" },
            { name: "x", image_hash: "h" },
          ],
        }),
      ),
    /duplicate/,
  );
  assert.throws(() => parseLaunchSpec(JSON.stringify({ ...base, ads: [{ name: "x", video_id: "v", titles: ["t"] }] })), /together/);
  assert.throws(() => parseLaunchSpec(JSON.stringify({ ...base, ads: [{ name: "x", video_id: "v", titles: [""], bodies: ["b"] }] })), /non-empty/);
});

function specWith(count: number): string {
  return JSON.stringify({
    adset_id: "as1",
    template_ad_id: "tpl",
    plan: "plan.md",
    ads: Array.from({ length: count }, (_, i) => ({ name: `ad-${i + 1}`, video_id: `v${i + 1}` })),
  });
}

test("parseLaunchSpec caps a spec at MAX_LAUNCH_ADS", () => {
  assert.equal(MAX_LAUNCH_ADS, 10);
  assert.equal(parseLaunchSpec(specWith(MAX_LAUNCH_ADS)).ads.length, MAX_LAUNCH_ADS);
  assert.throws(() => parseLaunchSpec(specWith(MAX_LAUNCH_ADS + 1)), /11 ads.*split it into specs of at most 10 ads/);
});

function harness(opts?: { failCreateAt?: number; failActivate?: boolean; spec?: string; knownAdsets?: string[] }) {
  const events: string[] = [];
  const gets: string[] = [];
  const objects: Record<string, Record<string, unknown>> = {
    as1: { name: "Set", account_id: "999", campaign_id: "c1" },
    tpl: { name: "Template", account_id: "999", creative: { object_story_spec: { page_id: "pg1" } } },
  };
  let createCount = 0;
  let writes = 0;
  const client = {
    async get<T = unknown>(path: string): Promise<T> {
      gets.push(path);
      const id = path.slice(1);
      if (id === "ad-1" || id === "ad-2") {
        return { id, name: id, adset_id: "as1", campaign_id: "c1", status: "ACTIVE", creative: { id: `cr-${id}` } } as T;
      }
      const object = objects[id];
      if (!object) throw new Error(`unknown ${path}`);
      return object as T;
    },
    async activate() {
      writes++;
      return { status: 200, body: {} };
    },
    async createAd() {
      writes++;
      return { status: 200, body: { id: "x" } };
    },
    async uploadVideo() {
      writes++;
      return { videoId: "v", thumbnailUrl: null };
    },
    async uploadImage() {
      writes++;
      return { hash: "h" };
    },
    async videoThumbnail() {
      return null;
    },
  };
  const upserted: { adsets: MetaAdsAdsetInsert[]; creatives: number; ads: number } = { adsets: [], creatives: 0, ads: 0 };
  // meta_ads_ads.adset_id references meta_ads_adsets(id); mimic the foreign key.
  const adsetsInDb = new Set(opts?.knownAdsets ?? ["as1"]);
  const deps: LaunchDeps = {
    async requireProduct() {
      return { id: "p1", slug: "acme" } as ProductRow;
    },
    async adAccount() {
      return "act_999";
    },
    async requirePlanDoc(_productId, ref) {
      return ref
        .split("/")
        .pop()!
        .replace(/\.(?:md|json)$/i, "");
    },
    async pathExists() {
      return true;
    },
    async readFile() {
      return opts?.spec ?? VALID;
    },
    async createAd() {
      createCount++;
      events.push(`create ${createCount}`);
      if (opts?.failCreateAt === createCount) throw new Error("create failed");
      return { adId: `ad-${createCount}` };
    },
    async activate(_c, _s, activateOpts) {
      events.push(`activate ${activateOpts.adIds.join(",")}`);
      if (opts?.failActivate) throw new Error("activate failed");
      return { activated: activateOpts.adIds.length, skipped: 0 };
    },
    async upsertAdsets(rows) {
      upserted.adsets.push(...rows);
      for (const row of rows) adsetsInDb.add(row.id);
      events.push("upsertAdsets");
      return rows.length;
    },
    async upsertCreatives(rows) {
      upserted.creatives = rows.length;
      events.push("upsertCreatives");
      return rows.length;
    },
    async upsertAds(rows) {
      const missing = rows.find((row) => !adsetsInDb.has(row.adset_id));
      if (missing) throw new Error(`upsertMetaAdsAds: insert or update on table "meta_ads_ads" violates foreign key constraint "meta_ads_ads_adset_id_fkey"`);
      upserted.ads = rows.length;
      events.push("upsertAds");
      return rows.length;
    },
    async importMedia() {},
    log() {},
  };
  return { client, deps, events, gets, upserted, writes: () => writes };
}

test("launch creates all, activates once, then GET+upsert per ad", async () => {
  const { client, deps, events, gets, upserted } = harness();
  const results = await launch(client, "acme", { specPath: "spec.json", validateOnly: false }, deps);
  assert.deepEqual(
    results.map((r) => r.status),
    ["ACTIVE", "ACTIVE"],
  );
  assert.ok(events.indexOf("create 1") < events.indexOf("activate ad-1,ad-2"));
  assert.ok(events.indexOf("activate ad-1,ad-2") < events.indexOf("upsertCreatives"));
  assert.ok(events.indexOf("upsertCreatives") < events.indexOf("upsertAds"));
  assert.equal(gets.filter((p) => p === "/as1").length, 1);
  assert.equal(gets.filter((p) => p === "/tpl").length, 1);
  assert.equal(gets.filter((p) => p === "/ad-1" || p === "/ad-2").length, 2);
  assert.equal(upserted.ads, 2);
});

test("create failure on ad 2 → no activate, no DB", async () => {
  const { client, deps, events, upserted } = harness({ failCreateAt: 2 });
  await assert.rejects(launch(client, "acme", { specPath: "s.json", validateOnly: false }, deps), /create failed/);
  assert.ok(!events.some((e) => e.startsWith("activate")));
  assert.equal(upserted.ads, 0);
});

test("activate failure → no DB upsert", async () => {
  const { client, deps, upserted } = harness({ failActivate: true });
  await assert.rejects(launch(client, "acme", { specPath: "s.json", validateOnly: false }, deps), /activate failed/);
  assert.equal(upserted.ads, 0);
});

test("--validate-only creates but never activates or writes the DB", async () => {
  const { client, deps, events, upserted } = harness();
  const results = await launch(client, "acme", { specPath: "s.json", validateOnly: true }, deps);
  assert.deepEqual(
    results.map((r) => r.status),
    ["validated", "validated"],
  );
  assert.ok(!events.some((e) => e.startsWith("activate")));
  assert.equal(upserted.ads, 0);
});

test("an 11-ad spec is rejected before any Meta call", async () => {
  const { client, deps, events, gets, writes } = harness({ spec: specWith(MAX_LAUNCH_ADS + 1) });
  await assert.rejects(launch(client, "acme", { specPath: "s.json", validateOnly: false }, deps), /split it into specs of at most 10 ads/);
  assert.equal(gets.length, 0);
  assert.equal(writes(), 0);
  assert.deepEqual(events, []);
});

test("mirror upserts an ad set missing from the DB (fresh adset-copy) before its ads", async () => {
  const { client, deps, events, upserted } = harness({ knownAdsets: [] });
  const results = await launch(client, "acme", { specPath: "s.json", validateOnly: false }, deps);
  assert.deepEqual(
    results.map((r) => r.status),
    ["ACTIVE", "ACTIVE"],
  );
  assert.equal(upserted.adsets.length, 1);
  assert.equal(upserted.adsets[0]!.id, "as1");
  assert.equal(upserted.adsets[0]!.campaign_id, "c1");
  assert.ok(events.indexOf("upsertAdsets") < events.indexOf("upsertAds"));
  assert.equal(upserted.ads, 2);
});

// Real client + real create/activate against a fake Graph API: a full spec of
// video files, each needing several status polls, must finish under the ceiling.
test("a 10-video spec finishes under its call ceiling", async (t) => {
  const POLLS_BEFORE_READY = 4; // a 6-video launch averaged about this many
  const dir = await mkdtemp(join(tmpdir(), "launch-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ads = [];
  for (let i = 1; i <= MAX_LAUNCH_ADS; i++) {
    const file = join(dir, `clip-${i}.mp4`);
    await writeFile(file, "fake video");
    ads.push({ name: `ad-${i}`, file, titles: [`t${i}`], bodies: [`b${i}`] });
  }
  const spec = JSON.stringify({ adset_id: "as1", template_ad_id: "tpl", plan: "plan.md", ads });

  let videos = 0;
  let adsMade = 0;
  const polls = new Map<string, number>();
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v[\d.]+/, "");
    if (init?.method === "POST") {
      if (path === "/act_999/advideos") return json({ id: `vid-${++videos}` });
      if (path === "/act_999/ads") return json({ id: `ad-${++adsMade}` });
      if (/^\/ad-\d+$/.test(path)) return json({ success: true });
      throw new Error(`unexpected POST ${path}`);
    }
    if (path === "/as1") return json({ id: "as1", name: "Set", account_id: "999", campaign_id: "c1", status: "PAUSED" });
    if (path === "/tpl") return json({ name: "Template", account_id: "999", creative: { object_story_spec: { page_id: "pg1", video_data: { call_to_action: { type: "INSTALL_MOBILE_APP" } } } } });
    if (/^\/vid-\d+\/thumbnails$/.test(path)) return json({ data: [{ uri: "https://example.test/t.jpg", is_preferred: true }] });
    if (/^\/vid-\d+$/.test(path)) {
      const n = (polls.get(path) ?? 0) + 1;
      polls.set(path, n);
      return json({ status: { video_status: n > POLLS_BEFORE_READY ? "ready" : "processing" } });
    }
    const ad = path.match(/^\/(ad-\d+)$/);
    if (ad) return json({ id: ad[1], name: ad[1], account_id: "999", adset_id: "as1", campaign_id: "c1", status: "PAUSED", creative: { id: `cr-${ad[1]}` } });
    throw new Error(`unexpected GET ${path}`);
  }) as typeof fetch;

  const previousToken = process.env.META_ADS_TOKEN;
  process.env.META_ADS_TOKEN = "test-token";
  t.after(() => {
    if (previousToken === undefined) delete process.env.META_ADS_TOKEN;
    else process.env.META_ADS_TOKEN = previousToken;
  });
  const ceiling = launchCallCeiling(MAX_LAUNCH_ADS);
  const client = new MetaAdsClient({ maxCalls: ceiling }, fakeFetch);

  const { deps } = harness({ spec, knownAdsets: [] });
  const product = { id: "p1", slug: "acme" } as ProductRow;
  const shared = {
    requireProduct: async () => product,
    adAccount: async () => "act_999",
    requirePlanDoc: async () => "plan",
    insertChange: async () => "chg",
    updateChange: async () => {},
    log: () => {},
  };
  deps.createAd = (c, slug, options) => createAdFromTemplate(c, slug, options, shared);
  deps.activate = (c, slug, options) => activateObjects(c, slug, options, { ...shared, setAdStatus: async () => {}, setAdsetStatus: async () => {}, sleep: async () => {} });

  // uploadVideo waits 5 s between polls; run those timers instantly.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let done = false;
  const run = launch(client, "acme", { specPath: "s.json", validateOnly: false }, deps).finally(() => {
    done = true;
  });
  while (!done) {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(5_000);
  }
  const results = await run;

  assert.equal(results.length, MAX_LAUNCH_ADS);
  assert.ok(results.every((r) => r.status === "ACTIVE"));
  // Per video: upload, 5 polls, thumbnail, create, activate GET + POST, mirror GET = 11.
  assert.equal(client.calls, 2 + MAX_LAUNCH_ADS * (6 + POLLS_BEFORE_READY + 1));
  assert.ok(client.calls < ceiling, `${client.calls} calls vs ceiling ${ceiling}`);
});
