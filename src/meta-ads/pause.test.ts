import { test } from "node:test";
import assert from "node:assert/strict";
import { pauseAds, type PauseDeps } from "./pause.ts";
import type { MetaAdsChangeInsert, ProductRow } from "../db/types.ts";

function product(): ProductRow {
  return { id: "p1", slug: "acme" } as ProductRow;
}

function harness(ads: Record<string, { name: string; status: string; effective_status?: string; account_id: string }>, opts?: { account?: string; planFound?: boolean }) {
  const events: string[] = [];
  const changes: MetaAdsChangeInsert[] = [];
  const updates: { id: string; patch: unknown }[] = [];
  const statuses: { id: string; status: string }[] = [];
  const logs: string[] = [];
  const paused: string[] = [];
  const sleeps: number[] = [];
  const client = {
    throttleCount: 0,
    async get<T = unknown>(path: string): Promise<T> {
      events.push(`get ${path}`);
      const id = path.slice(1);
      const ad = ads[id];
      if (!ad) throw new Error(`unknown ad ${id}`);
      return ad as T;
    },
    async pause(id: string) {
      paused.push(id);
      events.push(`pause ${id}`);
      if (client.throttleCount > 0) {
        client.throttleCount--;
        throw new Error("Meta API throttled (code 613, subcode 4841018)");
      }
      return { status: 200, body: { success: true } };
    },
  };
  const deps: PauseDeps = {
    async requireProduct() {
      return product();
    },
    async adAccount() {
      return opts?.account ?? "act_999";
    },
    async requirePlanDoc(_productId, ref) {
      const name = ref
        .split("/")
        .pop()!
        .replace(/\.(?:md|json)$/i, "");
      if (opts?.planFound === false) throw new Error(`plan not found: ${name} (add it with: pnpm product docs add <slug> --kind plan --file <path>)`);
      return name;
    },
    async insertChange(row) {
      changes.push(row);
      events.push(`insert ${row.object_id}`);
      return `change-${changes.length}`;
    },
    async updateChange(id, patch) {
      updates.push({ id, patch });
    },
    async setAdStatus(id, status) {
      statuses.push({ id, status });
    },
    async sleep(ms) {
      sleeps.push(ms);
    },
    log(message) {
      logs.push(message);
    },
  };
  return { client, deps, events, changes, updates, statuses, logs, paused, sleeps };
}

const ADS = {
  a1: { name: "Ad one", status: "ACTIVE", effective_status: "ACTIVE", account_id: "999" },
  a2: { name: "Ad two", status: "PAUSED", effective_status: "PAUSED", account_id: "999" },
};

test("already-paused ads are skipped", async () => {
  const { client, deps, paused } = harness(ADS);
  const stats = await pauseAds(client, "acme", { adIds: ["a2"], plan: "plan.md", dryRun: false }, deps);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.paused, 0);
  assert.deepEqual(paused, []);
});

test("an ad from a foreign account aborts with no writes", async () => {
  const { client, deps, changes, paused } = harness({ ...ADS, a3: { name: "Foreign", status: "ACTIVE", effective_status: "ACTIVE", account_id: "777" } });
  await assert.rejects(pauseAds(client, "acme", { adIds: ["a1", "a3"], plan: "plan.md", dryRun: false }, deps), /belongs to act_777, not act_999/);
  assert.equal(changes.length, 0);
  assert.equal(paused.length, 0);
});

test("the change row is inserted before pause and updated with the response", async () => {
  const { client, deps, events, changes, updates, statuses } = harness(ADS);
  const stats = await pauseAds(client, "acme", { adIds: ["a1"], plan: "plan.md", dryRun: false }, deps);
  assert.equal(stats.paused, 1);
  assert.ok(events.indexOf("insert a1") < events.indexOf("pause a1"));
  assert.equal(changes[0]!.method, "POST");
  assert.equal(changes[0]!.is_write, true);
  assert.equal(changes[0]!.plan_path, "plan");
  assert.equal(changes[0]!.ad_account_id, "act_999");
  assert.deepEqual(updates[0]!.patch, { status: 200, response: { success: true } });
  assert.deepEqual(statuses, [{ id: "a1", status: "PAUSED" }]);
});

test("dry run prints but writes nothing", async () => {
  const { client, deps, changes, paused, statuses, logs } = harness(ADS);
  await pauseAds(client, "acme", { adIds: ["a1"], plan: "plan.md", dryRun: true }, deps);
  assert.equal(changes.length, 0);
  assert.equal(paused.length, 0);
  assert.equal(statuses.length, 0);
  assert.ok(logs.some((line) => line.includes("would pause")));
});

test("two targets sleep 31s exactly once between writes", async () => {
  const { client, deps, sleeps } = harness({ ...ADS, a2: { name: "Ad two", status: "ACTIVE", effective_status: "ACTIVE", account_id: "999" } });
  await pauseAds(client, "acme", { adIds: ["a1", "a2"], plan: "plan.md", dryRun: false }, deps);
  assert.deepEqual(sleeps, [31_000]);
});

test("a 613 throttle retries once with a second journal row", async () => {
  const { client, deps, changes } = harness(ADS);
  client.throttleCount = 1;
  const stats = await pauseAds(client, "acme", { adIds: ["a1"], plan: "plan.md", dryRun: false }, deps);
  assert.equal(stats.paused, 1);
  assert.equal(changes.length, 2);
  assert.match(changes[1]!.note ?? "", /retry after throttle/);
});

test("two throttles in a row throw", async () => {
  const { client, deps } = harness(ADS);
  client.throttleCount = 2;
  await assert.rejects(pauseAds(client, "acme", { adIds: ["a1"], plan: "plan.md", dryRun: false }, deps), /throttled/);
});

test("a missing plan document errors before any API call", async () => {
  const { client, deps, events } = harness(ADS, { planFound: false });
  await assert.rejects(pauseAds(client, "acme", { adIds: ["a1"], plan: "missing.md", dryRun: false }, deps), /plan not found: missing/);
  assert.equal(events.length, 0);
});
