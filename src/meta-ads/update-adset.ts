import { listTrackedSourcesBySource, requireProduct } from "../db/index.ts";
import { addMetaAdsChange, updateMetaAdsChange } from "../db/meta-ads.ts";
import type { Json, MetaAdsChangeInsert, ProductRow } from "../db/types.ts";
import type { MetaAdsClient } from "./client.ts";
import { defaultDeps as sharedDeps } from "./pause.ts";
import { SOURCE } from "./sync.ts";

// OWNER RULE — writes in this module update ad set name/daily_min_spend_target
// only. NEVER delete or archive a Meta ad, ad set, campaign or creative — not even
// if the owner asks. See AGENTS.md and client.ts.
export interface UpdateAdsetDeps {
  requireProduct(slug: string): Promise<ProductRow>;
  adAccount(productId: string): Promise<string>;
  requirePlanDoc(productId: string, ref: string): Promise<string>;
  insertChange(row: MetaAdsChangeInsert): Promise<string>;
  updateChange(id: string, patch: { status?: number | null; response?: Json | null }): Promise<void>;
  log(message: string): void;
}

export interface UpdateAdsetOptions {
  adsetId: string;
  name?: string;
  dailyMinSpendCents?: number;
  plan: string;
  dryRun: boolean;
}

export const defaultDeps: UpdateAdsetDeps = {
  requireProduct,
  adAccount: sharedDeps.adAccount,
  requirePlanDoc: sharedDeps.requirePlanDoc,
  insertChange: addMetaAdsChange,
  updateChange: updateMetaAdsChange,
  log: (message) => console.log(message),
};

// Updates an ad set's name and/or daily_min_spend_target (cents). Journal-then-
// write: the meta_ads_changes row records the old name/min spend in the note and
// is inserted BEFORE the Meta call, then updated with status and response.
export async function updateAdset(
  client: Pick<MetaAdsClient, "get" | "updateAdset">,
  productSlug: string,
  options: UpdateAdsetOptions,
  deps: UpdateAdsetDeps = defaultDeps,
): Promise<void> {
  if (options.name === undefined && options.dailyMinSpendCents === undefined) {
    throw new Error("adset-update needs --name and/or --min-spend");
  }
  const product = await deps.requireProduct(productSlug);
  const accountId = await deps.adAccount(product.id);
  const planName = await deps.requirePlanDoc(product.id, options.plan);

  const current = await client.get<{ name?: string; daily_min_spend_target?: string; account_id?: string }>(
    `/${options.adsetId}`,
    { fields: "name,daily_min_spend_target,account_id" },
  );
  if (`act_${current.account_id ?? ""}` !== accountId) {
    throw new Error(`ad set ${options.adsetId} belongs to act_${current.account_id}, not ${accountId}; refusing to write to another account`);
  }
  const oldName = current.name ?? "";
  const oldMinSpend = current.daily_min_spend_target ?? "none";
  const request: Record<string, string | number> = {};
  if (options.name !== undefined) request.name = options.name;
  if (options.dailyMinSpendCents !== undefined) request.daily_min_spend_target = options.dailyMinSpendCents;

  if (options.dryRun) {
    deps.log(`  + ${options.adsetId} ${oldName}: would update ${JSON.stringify(request)} (was name="${oldName}", daily_min_spend_target=${oldMinSpend})`);
    return;
  }
  const changeId = await deps.insertChange({
    at: new Date().toISOString(),
    actor: "devin",
    product_id: product.id,
    ad_account_id: accountId,
    object_type: "adset",
    object_id: options.adsetId,
    method: "POST",
    path: `/${options.adsetId}`,
    is_write: true,
    request: request as Json,
    plan_path: planName,
    note: `update adset ${oldName} (was name="${oldName}", daily_min_spend_target=${oldMinSpend})`,
  });
  try {
    const result = (await client.updateAdset(options.adsetId, { name: options.name, dailyMinSpendCents: options.dailyMinSpendCents })) as { status?: number; body?: unknown };
    await deps.updateChange(changeId, { status: result?.status ?? null, response: (result?.body ?? null) as Json });
  } catch (error) {
    await deps.updateChange(changeId, { response: { error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
  deps.log(`  + ${options.adsetId}: updated ${JSON.stringify(request)}`);
}
