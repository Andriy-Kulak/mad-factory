import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPlan, type VerifyDeps } from "./verify.ts";
import type { MetaAdsChangeRow, ProductRow } from "../db/types.ts";

function product(): ProductRow {
  return { id: "p1", slug: "acme" } as ProductRow;
}

let seq = 0;
function writeRow(input: Partial<MetaAdsChangeRow> & { path: string; request?: unknown; response?: unknown }): MetaAdsChangeRow {
  seq++;
  return {
    id: `c${seq}`,
    at: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
    actor: "devin",
    ad_account_id: "act_999",
    product_id: "p1",
    experiment_id: null,
    object_type: null,
    object_id: null,
    method: "POST",
    is_write: true,
    status: 200,
    usage: null,
    plan_path: "plan.md",
    note: null,
    ...input,
    request: (input.request ?? null) as MetaAdsChangeRow["request"],
    response: (input.response ?? null) as MetaAdsChangeRow["response"],
  };
}

function harness(rows: MetaAdsChangeRow[], objects: Record<string, Record<string, unknown>>, opts?: { account?: string }) {
  const calls: { path: string; ids: string[]; fields: string }[] = [];
  const planRefs: string[] = [];
  const client = {
    calls: 0,
    async get<T = unknown>(path: string, params: Record<string, string>): Promise<T> {
      client.calls++;
      const ids = (JSON.parse(params.filtering!) as { value: string[] }[])[0]!.value;
      calls.push({ path, ids, fields: params.fields! });
      return { data: ids.filter((id) => objects[id]).map((id) => ({ id, ...objects[id] })) } as T;
    },
  };
  const deps: VerifyDeps = {
    async requireProduct() { return product(); },
    async adAccount() { return opts?.account ?? "act_999"; },
    async listPlanWrites(_productId, planPath) { planRefs.push(planPath); return rows; },
  };
  return { client, deps, calls, planRefs };
}

const AD = (status: string, extra: Record<string, unknown> = {}) => ({
  name: "Ad", status, effective_status: status, adset_id: "s1", account_id: "999", updated_time: "2026-01-02T00:00:00+0000", ...extra,
});
const ADSET = (status: string, extra: Record<string, unknown> = {}) => ({
  name: "Adset", status, effective_status: status, account_id: "999", campaign_id: "camp1", ...extra,
});
const pauseAd = (id: string) => writeRow({ object_type: "ad", object_id: id, path: `/${id}`, request: { status: "PAUSED" } });
const activateAdset = (id: string) => writeRow({ object_type: "adset", object_id: id, path: `/${id}`, request: { status: "ACTIVE" } });

test("(a) pause on 2 ads + activate on 1 adset costs exactly 2 GETs and passes", async () => {
  const rows = [pauseAd("a1"), pauseAd("a2"), activateAdset("s1")];
  const objects = { a1: AD("PAUSED"), a2: AD("PAUSED"), s1: ADSET("ACTIVE") };
  const { client, deps, planRefs } = harness(rows, objects);
  const report = await verifyPlan(client, "acme", { plan: "experiments/plans/plan.md" }, deps);
  assert.deepEqual(planRefs, ["plan"]);
  assert.equal(client.calls, 2);
  assert.ok(report.checks.every((c) => c.ok));
  assert.equal(report.warnings.length, 0);
  assert.equal(report.failed.length, 0);
});

test("(b) a status mismatch is reported as not ok", async () => {
  const { client, deps } = harness([pauseAd("a1")], { a1: AD("ACTIVE"), s1: ADSET("ACTIVE") });
  const report = await verifyPlan(client, "acme", { plan: "plan.md" }, deps);
  const check = report.checks.find((c) => c.field === "status")!;
  assert.equal(check.ok, false);
  assert.equal(check.actual, "ACTIVE");
});

test("(c) a failed write is reported FAILED and never read", async () => {
  const failed = { ...pauseAd("a9"), status: 500, response: { error: "boom" } };
  const { client, deps, calls } = harness([pauseAd("a1"), failed], { a1: AD("PAUSED"), s1: ADSET("PAUSED") });
  const report = await verifyPlan(client, "acme", { plan: "plan.md" }, deps);
  assert.equal(report.failed.length, 1);
  assert.equal(report.failed[0]!.id, "a9");
  assert.ok(!calls.some((c) => c.ids.includes("a9")));
});

test("(d) validate_only and upload rows are skipped; nothing left means no GET", async () => {
  const rows = [
    writeRow({ object_type: "ad", object_id: "a1", path: "/a1", request: { creative: {}, execution_options: ["validate_only"] } }),
    writeRow({ object_type: "video", path: "/act_999/advideos", request: { title: "t", file: "v.mp4" }, response: { id: "v1" } }),
    writeRow({ object_type: "image", path: "/act_999/adimages", request: { file: "i.png" }, response: { hash: "h" } }),
  ];
  const { client, deps } = harness(rows, {});
  const report = await verifyPlan(client, "acme", { plan: "plan.md" }, deps);
  assert.equal(report.skipped.length, 3);
  assert.equal(client.calls, 0);
  assert.equal(report.checks.length, 0);
});

test("(e) create-ad followed by activate expects ACTIVE on the new id", async () => {
  const rows = [
    writeRow({ object_type: "ad", path: "/act_999/ads", request: { name: "New ad", adset_id: "s1", status: "PAUSED" }, response: { id: "a7" } }),
    writeRow({ object_type: "ad", object_id: "a7", path: "/a7", request: { status: "ACTIVE" } }),
  ];
  const objects = { a7: AD("ACTIVE", { name: "New ad", adset_id: "s1" }), s1: ADSET("ACTIVE") };
  const { client, deps } = harness(rows, objects);
  const report = await verifyPlan(client, "acme", { plan: "plan.md" }, deps);
  const fields = new Map(report.checks.filter((c) => c.id === "a7").map((c) => [c.field, c]));
  assert.equal(fields.get("status")!.expected, "ACTIVE");
  assert.equal(fields.get("name")!.expected, "New ad");
  assert.equal(fields.get("adset_id")!.expected, "s1");
  assert.ok(report.checks.every((c) => c.ok));
});

test("(f) 51 ad ids cost 2 ad GETs", async () => {
  const ids = Array.from({ length: 51 }, (_, i) => `a${i}`);
  const rows = ids.map(pauseAd);
  const objects: Record<string, Record<string, unknown>> = { s1: ADSET("PAUSED") };
  for (const id of ids) objects[id] = AD("PAUSED");
  const { client, deps, calls } = harness(rows, objects);
  await verifyPlan(client, "acme", { plan: "plan.md" }, deps);
  const adCalls = calls.filter((c) => c.path === "/act_999/ads");
  assert.equal(adCalls.length, 2);
  assert.equal(client.calls, 3);
});

test("(g) an ACTIVE ad under a paused ad set warns but still passes", async () => {
  const rows = [writeRow({ object_type: "ad", object_id: "a1", path: "/a1", request: { status: "ACTIVE" } })];
  const { client, deps } = harness(rows, { a1: AD("ACTIVE"), s1: ADSET("PAUSED") });
  const report = await verifyPlan(client, "acme", { plan: "plan.md" }, deps);
  assert.ok(report.checks.every((c) => c.ok));
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0]!, /ad set s1/);
});

test("(h) an object from another account throws", async () => {
  const { client, deps } = harness([pauseAd("a1")], { a1: AD("PAUSED", { account_id: "777" }) });
  await assert.rejects(
    verifyPlan(client, "acme", { plan: "plan.md" }, deps),
    /act_777, not act_999/,
  );
});

test("(i) no journaled writes for the plan is an error", async () => {
  const { client, deps } = harness([], {});
  await assert.rejects(verifyPlan(client, "acme", { plan: "plan.md" }, deps), /no journaled writes/);
});
