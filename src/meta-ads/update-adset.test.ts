import { test } from "node:test";
import assert from "node:assert/strict";
import { copyAdset, updateAdset, type UpdateAdsetDeps } from "./update-adset.ts";
import type { MetaAdsChangeInsert, ProductRow } from "../db/types.ts";

function harness(opts: { account?: string; copyBody?: unknown } = {}) {
  const changes: MetaAdsChangeInsert[] = [];
  const patches: unknown[] = [];
  const writes: { kind: string; id: string; options?: unknown }[] = [];
  const logs: string[] = [];
  const client = {
    async get<T = unknown>(path: string): Promise<T> {
      return { name: `name of ${path.slice(1)}`, account_id: opts.account ?? "999", campaign_id: "c1", daily_budget: "6000" } as T;
    },
    async copyAdset(id: string) {
      writes.push({ kind: "copy", id });
      return { status: 200, body: opts.copyBody ?? { copied_adset_id: "s9" } };
    },
    async updateAdset(id: string, options: unknown) {
      writes.push({ kind: "update", id, options });
      return { status: 200, body: { success: true } };
    },
  };
  const deps: UpdateAdsetDeps = {
    async requireProduct() {
      return { id: "p1", slug: "acme" } as ProductRow;
    },
    async adAccount() {
      return "act_999";
    },
    async requirePlanDoc(_productId, ref) {
      return ref;
    },
    async insertChange(row) {
      changes.push(row);
      return `c${changes.length}`;
    },
    async updateChange(_id, patch) {
      patches.push(patch);
    },
    log: (line) => logs.push(line),
  };
  return { client, deps, changes, patches, writes, logs };
}

test("copyAdset journals the copy, then names the new ad set and sets its budget", async () => {
  const { client, deps, changes, writes } = harness();
  const id = await copyAdset(client, "acme", { fromAdsetId: "s1", name: "New set", dailyBudgetCents: 6000, plan: "plan", dryRun: false }, deps);
  assert.equal(id, "s9");
  assert.deepEqual(writes, [
    { kind: "copy", id: "s1" },
    { kind: "update", id: "s9", options: { name: "New set", dailyMinSpendCents: undefined, dailyBudgetCents: 6000 } },
  ]);
  assert.deepEqual(
    changes.map((c) => [c.path, c.request]),
    [
      ["/s1/copies", { deep_copy: false, status_option: "PAUSED" }],
      ["/s9", { name: "New set", daily_budget: 6000 }],
    ],
  );
  assert.ok(changes.every((c) => c.is_write && c.plan_path === "plan" && c.object_type === "adset"));
});

test("copyAdset --dry-run writes nothing", async () => {
  const { client, deps, changes, writes, logs } = harness();
  assert.equal(await copyAdset(client, "acme", { fromAdsetId: "s1", name: "New set", plan: "plan", dryRun: true }, deps), null);
  assert.equal(changes.length + writes.length, 0);
  assert.match(logs[0]!, /would copy without ads, PAUSED, as "New set" \(keeps daily_budget=6000\)/);
});

test("copyAdset refuses another account's ad set before any write", async () => {
  const { client, deps, changes, writes } = harness({ account: "111" });
  await assert.rejects(copyAdset(client, "acme", { fromAdsetId: "s1", name: "New set", plan: "plan", dryRun: false }, deps), /refusing to write to another account/);
  assert.equal(changes.length + writes.length, 0);
});

test("copyAdset fails loudly when Meta returns no new id, and does not rename anything", async () => {
  const { client, deps, writes } = harness({ copyBody: {} });
  await assert.rejects(copyAdset(client, "acme", { fromAdsetId: "s1", name: "New set", plan: "plan", dryRun: false }, deps), /no copied_adset_id/);
  assert.deepEqual(writes, [{ kind: "copy", id: "s1" }]);
});

test("updateAdset sends daily_budget and records the old budget", async () => {
  const { client, deps, changes, writes } = harness();
  await updateAdset(client, "acme", { adsetId: "s1", dailyBudgetCents: 4000, plan: "plan", dryRun: false }, deps);
  assert.deepEqual(changes[0]!.request, { daily_budget: 4000 });
  assert.match(changes[0]!.note!, /daily_budget=6000/);
  assert.equal(writes.length, 1);
});
