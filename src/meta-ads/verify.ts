import { listTrackedSourcesBySource, requireProduct } from "../db/index.ts";
import { listMetaAdsPlanWrites } from "../db/meta-ads.ts";
import { docName } from "../lib/product-docs.ts";
import type { MetaAdsChangeRow, ProductRow } from "../db/types.ts";
import type { MetaAdsClient } from "./client.ts";
import { defaultDeps as sharedDeps } from "./pause.ts";
import { SOURCE } from "./sync.ts";

// Proof step after a batch of journaled writes: re-read the affected objects
// once, grouped (ads in chunks of 50, then their ad sets), never one read per
// write. Compares the configured `status`, not effective_status — Meta objects
// sit in IN_PROCESS/PENDING_REVIEW right after a write and that is normal.

type ApiObject = Record<string, unknown>;

const CHUNK = 50;
export const AD_FIELDS = "name,status,effective_status,adset_id,account_id,updated_time";
export const ADSET_FIELDS = "name,status,effective_status,daily_min_spend_target,account_id,campaign_id";

export interface VerifyCheck {
  type: "ad" | "adset";
  id: string;
  name: string;
  field: string;
  expected: string;
  actual: string;
  ok: boolean;
}

export interface VerifySkipped {
  id: string | null;
  path: string;
  reason: string;
}

export interface VerifyFailed {
  id: string | null;
  path: string;
  status: number | null;
  note: string;
}

export interface VerifyReport {
  checks: VerifyCheck[];
  warnings: string[];
  skipped: VerifySkipped[];
  failed: VerifyFailed[];
}

export interface VerifyDeps {
  requireProduct(slug: string): Promise<ProductRow>;
  adAccount(productId: string): Promise<string>;
  listPlanWrites(productId: string, planPath: string): Promise<MetaAdsChangeRow[]>;
}

export interface VerifyOptions {
  plan: string;
}

export const defaultDeps: VerifyDeps = {
  requireProduct,
  adAccount: sharedDeps.adAccount,
  listPlanWrites: listMetaAdsPlanWrites,
};

function isSkipped(row: MetaAdsChangeRow): string | null {
  const request = (row.request ?? {}) as ApiObject;
  const options = request.execution_options;
  if (Array.isArray(options) && options.includes("validate_only")) return "validate_only";
  if (/\/act_\d+\/(advideos|adimages)$/.test(row.path)) return "media upload";
  return null;
}

function isFailed(row: MetaAdsChangeRow): boolean {
  return row.status === null || row.status < 200 || row.status > 299;
}

function objType(row: MetaAdsChangeRow): "ad" | "adset" {
  return row.object_type === "adset" ? "adset" : "ad";
}

interface Expected {
  type: "ad" | "adset";
  id: string;
  fields: Map<string, string>;
}

// Reads objects in chunks of CHUNK through the account's /<type>s edge — the
// graph root `?ids=` multi-get is deprecated in v26, so the grouped read is an
// IN filter on the edge instead (still one GET per chunk).
async function readBatch(
  client: Pick<MetaAdsClient, "get">,
  accountId: string,
  edge: "ads" | "adsets",
  ids: string[],
  fields: string,
): Promise<Map<string, ApiObject>> {
  const field = edge === "ads" ? "ad.id" : "adset.id";
  const out = new Map<string, ApiObject>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const filtering = JSON.stringify([{ field, operator: "IN", value: ids.slice(i, i + CHUNK) }]);
    let after: string | undefined;
    for (;;) {
      const params: Record<string, string | number> = { fields, filtering, limit: CHUNK };
      if (after) params.after = after;
      const page = await client.get<{ data?: ApiObject[]; paging?: { next?: string; cursors?: { after?: string } } }>(`/${accountId}/${edge}`, params);
      for (const object of page.data ?? []) {
        if (object && typeof object.id === "string") out.set(object.id, object);
      }
      if (!page.paging?.next || !page.paging.cursors?.after) break;
      after = page.paging.cursors.after;
    }
  }
  return out;
}

export async function verifyPlan(
  client: Pick<MetaAdsClient, "get">,
  productSlug: string,
  options: VerifyOptions,
  deps: VerifyDeps = defaultDeps,
): Promise<VerifyReport> {
  const product = await deps.requireProduct(productSlug);
  const accountId = await deps.adAccount(product.id);
  const plan = docName(options.plan.replace(/^\.\//, ""));
  const rows = await deps.listPlanWrites(product.id, plan);
  if (!rows.length) throw new Error(`no journaled writes for this plan: ${plan}`);

  const report: VerifyReport = { checks: [], warnings: [], skipped: [], failed: [] };
  const expected = new Map<string, Expected>();
  const expect = (type: "ad" | "adset", id: string): Expected => {
    let entry = expected.get(id);
    if (!entry) {
      entry = { type, id, fields: new Map() };
      expected.set(id, entry);
    }
    return entry;
  };
  const adTextChecks: { id: string; at: string }[] = [];

  for (const row of rows) {
    const skip = isSkipped(row);
    if (skip) {
      report.skipped.push({ id: row.object_id, path: row.path, reason: skip });
      continue;
    }
    if (isFailed(row)) {
      report.failed.push({
        id: row.object_id,
        path: row.path,
        status: row.status,
        note: ((row.response as ApiObject | null)?.error ?? row.note ?? "write failed") as string,
      });
      continue;
    }
    const request = (row.request ?? {}) as ApiObject;
    const response = (row.response ?? {}) as ApiObject;
    if (/\/act_\d+\/ads$/.test(row.path)) {
      const id = typeof response.id === "string" ? response.id : null;
      if (!id) {
        report.failed.push({ id: null, path: row.path, status: row.status, note: "create-ad response has no id" });
        continue;
      }
      const entry = expect("ad", id);
      if (typeof request.name === "string") entry.fields.set("name", request.name);
      if (typeof request.adset_id === "string") entry.fields.set("adset_id", request.adset_id);
      if (!entry.fields.has("status")) entry.fields.set("status", "PAUSED");
      continue;
    }
    const singleObject = row.path.match(/^\/([^/]+)$/);
    if (singleObject && typeof request.status === "string") {
      expect(objType(row), singleObject[1]!).fields.set("status", request.status);
      continue;
    }
    if (singleObject && objType(row) === "adset" && (request.name !== undefined || request.daily_min_spend_target !== undefined)) {
      const entry = expect("adset", singleObject[1]!);
      if (request.name !== undefined) entry.fields.set("name", String(request.name));
      if (request.daily_min_spend_target !== undefined) entry.fields.set("daily_min_spend_target", String(request.daily_min_spend_target));
      continue;
    }
    if (singleObject && request.creative !== undefined) {
      adTextChecks.push({ id: singleObject[1]!, at: row.at });
      expect("ad", singleObject[1]!);
      continue;
    }
    report.skipped.push({ id: row.object_id, path: row.path, reason: "unrecognised write shape" });
  }

  const adIds = [...expected.values()].filter((e) => e.type === "ad").map((e) => e.id);
  const adsetIds = new Set([...expected.values()].filter((e) => e.type === "adset").map((e) => e.id));

  const ads = await readBatch(client, accountId, "ads", adIds, AD_FIELDS);
  for (const ad of ads.values()) {
    const parent = ad.adset_id;
    if (typeof parent === "string" && parent) adsetIds.add(parent);
  }
  const adsets = await readBatch(client, accountId, "adsets", [...adsetIds], ADSET_FIELDS);

  const all = new Map<string, { type: "ad" | "adset"; object: ApiObject }>();
  for (const [id, object] of ads) all.set(id, { type: "ad", object });
  for (const [id, object] of adsets) all.set(id, { type: "adset", object });
  for (const { type, object } of all.values()) {
    if (`act_${object.account_id ?? ""}` !== accountId) {
      throw new Error(`object belongs to act_${object.account_id ?? "?"}, not ${accountId}; refusing to report on another account`);
    }
  }

  const check = (type: "ad" | "adset", id: string, field: string, want: string, actual: string, ok: boolean) => {
    const name = String(all.get(id)?.object.name ?? "");
    report.checks.push({ type, id, name, field, expected: want, actual, ok });
  };

  for (const entry of expected.values()) {
    const object = all.get(entry.id)?.object;
    if (!object) {
      check(entry.type, entry.id, "exists", "present", "missing", false);
      continue;
    }
    for (const [field, want] of entry.fields) {
      const actual = String(object[field] ?? "");
      check(entry.type, entry.id, field, want, actual, actual === want);
    }
  }
  for (const { id, at } of adTextChecks) {
    const object = ads.get(id);
    if (!object) {
      check("ad", id, "updated_time", `>= ${at}`, "missing", false);
      continue;
    }
    const actual = String(object.updated_time ?? "");
    check("ad", id, "updated_time", `>= ${at}`, actual, actual >= at);
  }

  for (const entry of expected.values()) {
    if (entry.type !== "ad" || entry.fields.get("status") !== "ACTIVE") continue;
    const ad = ads.get(entry.id);
    if (!ad) continue;
    const parent = typeof ad.adset_id === "string" ? adsets.get(ad.adset_id) : undefined;
    if (parent && parent.effective_status !== "ACTIVE") {
      report.warnings.push(`ad ${entry.id} (${ad.name ?? "?"}) is ACTIVE but its ad set ${ad.adset_id} effective_status is ${parent.effective_status ?? "?"}`);
    }
  }
  return report;
}

export function formatVerifyTable(report: VerifyReport): string[] {
  const lines: string[] = [];
  const checks = report.checks;
  if (checks.length) {
    const rows = [
      ["object", "id", "name", "field", "expected", "actual", "ok"],
      ...checks.map((c) => [c.type, c.id, c.name, c.field, c.expected, c.actual, c.ok ? "yes" : "NO"]),
    ];
    const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
    const render = (r: string[]) => `| ${r.map((cell, i) => cell.padEnd(widths[i]!)).join(" | ")} |`;
    lines.push(render(rows[0]!));
    lines.push(`|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`);
    for (const row of rows.slice(1)) lines.push(render(row));
  }
  return lines;
}
