import { listTrackedSourcesBySource, requireProduct } from "../db/index.ts";
import { addMetaAdsChange, setMetaAdsAdStatus, updateMetaAdsChange } from "../db/meta-ads.ts";
import { requirePlanDoc } from "../db/products.ts";
import type { Json, MetaAdsChangeInsert, ProductRow } from "../db/types.ts";
import type { MetaAdsClient } from "./client.ts";
import { SOURCE } from "./sync.ts";

// OWNER RULE — the only write this module performs is `status=PAUSED` on ads.
// NEVER delete or archive a Meta ad, ad set, campaign or creative — not even if the
// owner asks. Pausing is reversible; deleting is not. See AGENTS.md and client.ts.

// Meta allows ~1 status change per 30 s; space consecutive writes and retry once
// after a 613 throttle (seen live: subcode 4841018 on the second of five writes).
export const STATUS_WRITE_GAP_MS = 31_000;
export const STATUS_WRITE_WAIT = "waiting 31s (Meta allows 1 status change per 30s)";

export function isThrottleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("code 613") || message.toLowerCase().includes("throttl");
}

// Journal-then-write for one attempt: insert the meta_ads_changes row BEFORE the
// Meta call, then update it with the HTTP status and response (or the error).
export async function journaledWrite(
  deps: {
    insertChange(row: MetaAdsChangeInsert): Promise<string>;
    updateChange(id: string, patch: { status?: number | null; response?: Json | null }): Promise<void>;
  },
  row: MetaAdsChangeInsert,
  write: () => Promise<unknown>,
): Promise<void> {
  const changeId = await deps.insertChange(row);
  try {
    const result = (await write()) as { status?: number; body?: unknown };
    await deps.updateChange(changeId, { status: result?.status ?? null, response: (result?.body ?? null) as Json });
  } catch (error) {
    await deps.updateChange(changeId, { response: { error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

export interface PauseDeps {
  requireProduct(slug: string): Promise<ProductRow>;
  adAccount(productId: string): Promise<string>;
  requirePlanDoc(productId: string, ref: string): Promise<string>;
  insertChange(row: MetaAdsChangeInsert): Promise<string>;
  updateChange(id: string, patch: { status?: number | null; response?: Json | null }): Promise<void>;
  setAdStatus(id: string, status: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
}

export interface PauseOptions {
  adIds: string[];
  plan: string;
  dryRun: boolean;
}

export interface PauseStats {
  paused: number;
  skipped: number;
}

export const defaultDeps: PauseDeps = {
  requireProduct,
  async adAccount(productId) {
    const rows = await listTrackedSourcesBySource(SOURCE, productId);
    const accounts = rows.filter((row) => row.kind === "ad_account");
    if (!accounts.length) throw new Error(`product has no ${SOURCE} ad_account tracked source`);
    const value = accounts[0]!.value;
    if (!/^act_\d+$/.test(value)) throw new Error(`tracked source value must match act_<digits>, got ${value}`);
    return value;
  },
  requirePlanDoc,
  insertChange: addMetaAdsChange,
  updateChange: updateMetaAdsChange,
  setAdStatus: setMetaAdsAdStatus,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (message) => console.log(message),
};

interface AdState {
  id: string;
  name: string;
  status: string;
}

// Pauses ads in the product's ad account. Journal-then-write order: the
// meta_ads_changes row is inserted BEFORE the Meta call and updated with the HTTP
// status and response afterwards, so every attempted write has an audit row even
// when the call fails. Stops on the first failure.
export async function pauseAds(
  client: Pick<MetaAdsClient, "get" | "pause">,
  productSlug: string,
  options: PauseOptions,
  deps: PauseDeps = defaultDeps,
): Promise<PauseStats> {
  if (!options.adIds.length) throw new Error("pause needs at least one --ad <id>");
  const product = await deps.requireProduct(productSlug);
  const accountId = await deps.adAccount(product.id);
  const planName = await deps.requirePlanDoc(product.id, options.plan);

  const ads: AdState[] = [];
  for (const id of options.adIds) {
    const ad = await client.get<{ id?: string; name?: string; status?: string; effective_status?: string; account_id?: string }>(
      `/${id}`,
      { fields: "name,status,effective_status,account_id" },
    );
    const adAccount = `act_${ad.account_id ?? ""}`;
    if (adAccount !== accountId) {
      throw new Error(`ad ${id} (${ad.name ?? "?"}) belongs to ${adAccount}, not ${accountId}; refusing to write to another account`);
    }
    ads.push({ id, name: ad.name ?? "", status: ad.effective_status ?? ad.status ?? "" });
  }

  const stats: PauseStats = { paused: 0, skipped: 0 };
  let wrote = false;
  for (const ad of ads) {
    if (ad.status === "PAUSED") {
      deps.log(`  = ${ad.id} ${ad.name}: already PAUSED, skipping`);
      stats.skipped++;
      continue;
    }
    if (options.dryRun) {
      deps.log(`  + ${ad.id} ${ad.name}: would pause (was ${ad.status})`);
      continue;
    }
    if (wrote) {
      deps.log(STATUS_WRITE_WAIT);
      await deps.sleep(STATUS_WRITE_GAP_MS);
    }
    const row: MetaAdsChangeInsert = {
      at: new Date().toISOString(),
      actor: "devin",
      product_id: product.id,
      ad_account_id: accountId,
      object_type: "ad",
      object_id: ad.id,
      method: "POST",
      path: `/${ad.id}`,
      is_write: true,
      request: { status: "PAUSED" },
      plan_path: planName,
      note: `pause ${ad.name} (was ${ad.status})`,
    };
    try {
      await journaledWrite(deps, row, () => client.pause(ad.id));
    } catch (error) {
      if (!isThrottleError(error)) throw error;
      deps.log(STATUS_WRITE_WAIT);
      await deps.sleep(STATUS_WRITE_GAP_MS);
      await journaledWrite(deps, { ...row, at: new Date().toISOString(), note: `${row.note} (retry after throttle)` }, () => client.pause(ad.id));
    }
    wrote = true;
    await deps.setAdStatus(ad.id, "PAUSED");
    deps.log(`  + ${ad.id} ${ad.name}: PAUSED (was ${ad.status})`);
    stats.paused++;
  }
  return stats;
}
