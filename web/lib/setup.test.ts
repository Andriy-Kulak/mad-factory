import assert from "node:assert/strict";
import { test } from "node:test";
import { channelSetup, navNeedingSetup } from "./setup.ts";

const src = (source: string, kind: string, config: { [key: string]: string } = {}, enabled = true) => ({ source, kind, config, enabled });

test("a new product has every channel unconnected", () => {
  const channels = channelSetup("example", []);
  assert.ok(channels.every((c) => !c.connected));
  assert.deepEqual(navNeedingSetup(channels), ["meta", "organic", "my-accounts", "meta-ads", "apple", "apple-keywords"]);
  assert.ok(channels.every((c) => c.steps.some((s) => s.includes("example"))));
});

test("tracked sources connect their channel; disabled ones do not", () => {
  const channels = channelSetup("example", [
    src("meta", "keyword"),
    src("instagram", "account", { relation: "own" }),
    src("tiktok", "account"),
    src("apple_ads", "app", {}, false),
    src("revenuecat", "project"),
  ]);
  const on = Object.fromEntries(channels.map((c) => [c.key, c.connected]));
  assert.deepEqual(on, { meta: true, organic: true, "my-accounts": true, "meta-ads": false, apple: false, revenuecat: true });
  assert.deepEqual(navNeedingSetup(channels), ["meta-ads", "apple", "apple-keywords"]);
});

test("an own account alone does not connect Organic", () => {
  const on = channelSetup("example", [src("facebook", "account", { relation: "own" })]).find((c) => c.key === "organic");
  assert.equal(on?.connected, false);
});
