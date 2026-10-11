import { test } from "node:test";
import assert from "node:assert/strict";
import { launch, parseLaunchSpec, type LaunchDeps } from "./launch.ts";
import type { ProductRow } from "../db/types.ts";

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

function harness(opts?: { failCreateAt?: number; failActivate?: boolean }) {
  const events: string[] = [];
  const gets: string[] = [];
  const objects: Record<string, Record<string, unknown>> = {
    as1: { name: "Set", account_id: "999", campaign_id: "c1" },
    tpl: { name: "Template", account_id: "999", creative: { object_story_spec: { page_id: "pg1" } } },
  };
  let createCount = 0;
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
      return { status: 200, body: {} };
    },
    async createAd() {
      return { status: 200, body: { id: "x" } };
    },
    async uploadVideo() {
      return { videoId: "v", thumbnailUrl: null };
    },
    async uploadImage() {
      return { hash: "h" };
    },
    async videoThumbnail() {
      return null;
    },
  };
  const upserted: { creatives: number; ads: number } = { creatives: 0, ads: 0 };
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
      return VALID;
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
    async upsertCreatives(rows) {
      upserted.creatives = rows.length;
      events.push("upsertCreatives");
      return rows.length;
    },
    async upsertAds(rows) {
      upserted.ads = rows.length;
      events.push("upsertAds");
      return rows.length;
    },
    async importMedia() {},
    log() {},
  };
  return { client, deps, events, gets, upserted };
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
