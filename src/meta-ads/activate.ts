import { listTrackedSourcesBySource, requireProduct } from "../db/index.ts";
import { addMetaAdsChange, updateMetaAdsChange } from "../db/meta-ads.ts";
import { getDb } from "../db/client.ts";
import type { Json, MetaAdsChangeInsert, ProductRow } from "../db/types.ts";
import type { MetaAdsClient } from "./client.ts";
import { defaultDeps as sharedDeps, isThrottleError, journaledWrite, STATUS_WRITE_GAP_MS, STATUS_WRITE_WAIT } from "./pause.ts";
import { SOURCE } from "./sync.ts";

// OWNER RULE — writes in this module set status=ACTIVE only. NEVER delete or
// archive a Meta ad, ad set, campaign or creative — not even if the owner asks.
// Status changes are reversible; deleting is not. See AGENTS.md and client.ts.
export interface ActivateDeps {
  requireProduct(slug: string): Promise<ProductRow>;
  adAccount(productId: string): Promise<string>;
  requirePlanDoc(productId: string, ref: string): Promise<string>;
  insertChange(row: MetaAdsChangeInsert): Promise<string>;
  updateChange(id: string, patch: { status?: number | null; response?: Json | null }): Promise<void>;
  setAdStatus(id: string, status: string): Promise<void>;
  setAdsetStatus(id: string, status: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
}

export interface ActivateOptions {
  adIds: string[];
  adsetIds: string[];
  plan: string;
  dryRun: boolean;
}

export interface ActivateStats {
  activated: number;
  skipped: number;
}

export const defaultDeps: ActivateDeps = {
  requireProduct,
  adAccount: sharedDeps.adAccount,
  requirePlanDoc: sharedDeps.requirePlanDoc,
  insertChange: addMetaAdsChange,
  updateChange: updateMetaAdsChange,
  setAdStatus: sharedDeps.setAdStatus,
  async setAdsetStatus(id, status) {
    const { error } = await getDb().from("meta_ads_adsets").update({ status }).eq("id", id);
    if (error) throw new Error(`setAdsetStatus: ${error.message}`);
  },
  sleep: sharedDeps.sleep,
  log: (message) => console.log(message),
};

interface Target {
  id: string;
  type: "ad" | "adset";
  name: string;
  status: string;
}

// Activates ads and ad sets in the product's ad account. Account-checked before
// any write; journal-then-write order like pause.ts: the meta_ads_changes row is
// inserted BEFORE the Meta call and updated with the HTTP status and response
// afterwards. Stops on the first failure.
export async function activateObjects(client: Pick<MetaAdsClient, "get" | "activate">, productSlug: string, options: ActivateOptions, deps: ActivateDeps = defaultDeps): Promise<ActivateStats> {
  if (!options.adIds.length && !options.adsetIds.length) throw new Error("activate needs at least one --ad or --adset");
  const product = await deps.requireProduct(productSlug);
  const accountId = await deps.adAccount(product.id);
  const planName = await deps.requirePlanDoc(product.id, options.plan);

  const targets: Target[] = [];
  for (const [id, type] of [...options.adIds.map((id): [string, "ad" | "adset"] => [id, "ad"]), ...options.adsetIds.map((id): [string, "ad" | "adset"] => [id, "adset"])]) {
    const object = await client.get<{ name?: string; status?: string; effective_status?: string; account_id?: string }>(`/${id}`, { fields: "name,status,effective_status,account_id" });
    const objectAccount = `act_${object.account_id ?? ""}`;
    if (objectAccount !== accountId) {
      throw new Error(`${type} ${id} (${object.name ?? "?"}) belongs to ${objectAccount}, not ${accountId}; refusing to write to another account`);
    }
    targets.push({ id, type, name: object.name ?? "", status: object.effective_status ?? object.status ?? "" });
  }

  const stats: ActivateStats = { activated: 0, skipped: 0 };
  let wrote = false;
  for (const target of targets) {
    if (target.status === "ACTIVE") {
      deps.log(`  = ${target.id} ${target.name}: already ACTIVE, skipping`);
      stats.skipped++;
      continue;
    }
    if (options.dryRun) {
      deps.log(`  + ${target.id} ${target.name}: would activate (was ${target.status})`);
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
      object_type: target.type === "ad" ? "ad" : "adset",
      object_id: target.id,
      method: "POST",
      path: `/${target.id}`,
      is_write: true,
      request: { status: "ACTIVE" },
      plan_path: planName,
      note: `activate ${target.type} ${target.name} (was ${target.status})`,
    };
    try {
      await journaledWrite(deps, row, () => client.activate(target.id));
    } catch (error) {
      if (!isThrottleError(error)) throw error;
      deps.log(STATUS_WRITE_WAIT);
      await deps.sleep(STATUS_WRITE_GAP_MS);
      await journaledWrite(deps, { ...row, at: new Date().toISOString(), note: `${row.note} (retry after throttle)` }, () => client.activate(target.id));
    }
    wrote = true;
    if (target.type === "ad") await deps.setAdStatus(target.id, "ACTIVE");
    else await deps.setAdsetStatus(target.id, "ACTIVE");
    deps.log(`  + ${target.id} ${target.name}: ACTIVE (was ${target.status})`);
    stats.activated++;
  }
  return stats;
}
