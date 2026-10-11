import { test } from "node:test";
import assert from "node:assert/strict";
import { activateObjects, type ActivateDeps } from "./activate.ts";
import { updateAdset, type UpdateAdsetDeps } from "./update-adset.ts";
import type { MetaAdsChangeInsert, ProductRow } from "../db/types.ts";

function harness(objects: Record<string, Record<string, unknown>>, opts?: { account?: string }) {
  const events: string[] = [];
  const changes: MetaAdsChangeInsert[] = [];
  const activated: string[] = [];
  const adsetStatuses: { id: string; status: string }[] = [];
  const adStatuses: { id: string; status: string }[] = [];
  const updates: Record<string, unknown>[] = [];
  const client = {
    async get<T = unknown>(path: string): Promise<T> {
      events.push(`get ${path}`);
      const object = objects[path.slice(1)];
      if (!object) throw new Error(`unknown ${path}`);
      return object as T;
    },
    async activate(id: string) {
      activated.push(id);
      events.push(`activate ${id}`);
      return { status: 200, body: { success: true } };
    },
    async updateAdset(_id: string, options: Record<string, unknown>) {
      updates.push(options);
      events.push("updateAdset");
      return { status: 200, body: { success: true } };
    },
  };
  const base = {
    async requireProduct() {
      return { id: "p1", slug: "acme" } as ProductRow;
    },
    async adAccount() {
      return opts?.account ?? "act_999";
    },
    async requirePlanDoc(_productId: string, ref: string) {
      return ref
        .split("/")
        .pop()!
        .replace(/\.(?:md|json)$/i, "");
    },
    async insertChange(row: MetaAdsChangeInsert) {
      changes.push(row);
      events.push(`insert ${row.object_id}`);
      return `change-${changes.length}`;
    },
    async updateChange() {},
    log() {},
  };
  const activateDeps: ActivateDeps = {
    ...base,
    async setAdStatus(id, status) {
      adStatuses.push({ id, status });
    },
    async setAdsetStatus(id, status) {
      adsetStatuses.push({ id, status });
    },
    async sleep() {},
  };
  return { client, deps: activateDeps, updateDeps: base as UpdateAdsetDeps, events, changes, activated, adStatuses, adsetStatuses, updates };
}

const OBJECTS = {
  a1: { name: "Ad one", status: "PAUSED", effective_status: "PAUSED", account_id: "999" },
  a2: { name: "Ad two", status: "ACTIVE", effective_status: "ACTIVE", account_id: "999" },
  s1: { name: "Set one", status: "PAUSED", effective_status: "PAUSED", account_id: "999" },
};

test("activate skips objects that are already ACTIVE", async () => {
  const { client, deps, activated } = harness(OBJECTS);
  const stats = await activateObjects(client, "acme", { adIds: ["a2"], adsetIds: [], plan: "plan.md", dryRun: false }, deps);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.activated, 0);
  assert.deepEqual(activated, []);
});

test("a foreign ad set aborts activation with no writes", async () => {
  const { client, deps, changes } = harness({ ...OBJECTS, s1: { name: "Set", account_id: "777", status: "PAUSED" } });
  await assert.rejects(activateObjects(client, "acme", { adIds: [], adsetIds: ["s1"], plan: "plan.md", dryRun: false }, deps), /belongs to act_777/);
  assert.equal(changes.length, 0);
});

test("activation journals before the write and mirrors statuses", async () => {
  const { client, deps, events, changes, adStatuses, adsetStatuses } = harness(OBJECTS);
  await activateObjects(client, "acme", { adIds: ["a1"], adsetIds: ["s1"], plan: "plan.md", dryRun: false }, deps);
  assert.ok(events.indexOf("insert a1") < events.indexOf("activate a1"));
  assert.ok(events.indexOf("insert s1") < events.indexOf("activate s1"));
  assert.equal(changes[0]!.is_write, true);
  assert.deepEqual(adStatuses, [{ id: "a1", status: "ACTIVE" }]);
  assert.deepEqual(adsetStatuses, [{ id: "s1", status: "ACTIVE" }]);
});

test("updateAdset refuses a foreign account and journals before the write", async () => {
  const foreign = harness({ s1: { name: "Set", daily_min_spend_target: "1000", account_id: "777" } });
  await assert.rejects(updateAdset(foreign.client, "acme", { adsetId: "s1", name: "New", plan: "plan.md", dryRun: false }, foreign.updateDeps), /belongs to act_777/);
  const { client, updateDeps, events, changes, updates } = harness({ s1: { name: "Old name", daily_min_spend_target: "1000", account_id: "999" } });
  await updateAdset(client, "acme", { adsetId: "s1", name: "New", dailyMinSpendCents: 2500, plan: "plan.md", dryRun: false }, updateDeps);
  assert.ok(events.indexOf("insert s1") < events.indexOf("updateAdset"));
  assert.match(changes[0]!.note ?? "", /Old name/);
  assert.deepEqual(updates, [{ name: "New", dailyMinSpendCents: 2500 }]);
});
