import { listTrackedSourcesBySource, requireProduct } from "../db/index.ts";
import { addMetaAdsChange, updateMetaAdsChange } from "../db/meta-ads.ts";
import type { Json, MetaAdsChangeInsert, ProductRow } from "../db/types.ts";
import type { MetaAdsClient } from "./client.ts";
import { defaultDeps as sharedDeps } from "./pause.ts";
import { SOURCE } from "./sync.ts";

// OWNER RULE — writes in this module update an ad set's name, daily_min_spend_target
// and daily_budget, or copy an ad set (PAUSED, without its ads). NEVER delete or
// archive a Meta ad, ad set, campaign or creative — not even if the owner asks.
// See AGENTS.md and client.ts.
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
  dailyBudgetCents?: number;
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

type AdsetState = { name?: string; daily_min_spend_target?: string; daily_budget?: string; account_id?: string; campaign_id?: string };
const ADSET_STATE_FIELDS = "name,daily_min_spend_target,daily_budget,account_id,campaign_id";

async function readOwnAdset(client: Pick<MetaAdsClient, "get">, adsetId: string, accountId: string): Promise<AdsetState> {
  const current = await client.get<AdsetState>(`/${adsetId}`, { fields: ADSET_STATE_FIELDS });
  if (`act_${current.account_id ?? ""}` !== accountId) {
    throw new Error(`ad set ${adsetId} belongs to act_${current.account_id}, not ${accountId}; refusing to write to another account`);
  }
  return current;
}

// Updates an ad set's name, daily_min_spend_target and/or daily_budget (cents).
// Journal-then-write: the meta_ads_changes row records the old values in the note
// and is inserted BEFORE the Meta call, then updated with status and response.
export async function updateAdset(client: Pick<MetaAdsClient, "get" | "updateAdset">, productSlug: string, options: UpdateAdsetOptions, deps: UpdateAdsetDeps = defaultDeps): Promise<void> {
  if (options.name === undefined && options.dailyMinSpendCents === undefined && options.dailyBudgetCents === undefined) {
    throw new Error("adset-update needs --name, --min-spend and/or --daily-budget");
  }
  const product = await deps.requireProduct(productSlug);
  const accountId = await deps.adAccount(product.id);
  const planName = await deps.requirePlanDoc(product.id, options.plan);

  const current = await readOwnAdset(client, options.adsetId, accountId);
  const oldName = current.name ?? "";
  const was = `was name="${oldName}", daily_min_spend_target=${current.daily_min_spend_target ?? "none"}, daily_budget=${current.daily_budget ?? "none"}`;
  const request: Record<string, string | number> = {};
  if (options.name !== undefined) request.name = options.name;
  if (options.dailyMinSpendCents !== undefined) request.daily_min_spend_target = options.dailyMinSpendCents;
  if (options.dailyBudgetCents !== undefined) request.daily_budget = options.dailyBudgetCents;

  if (options.dryRun) {
    deps.log(`  + ${options.adsetId} ${oldName}: would update ${JSON.stringify(request)} (${was})`);
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
    note: `update adset ${oldName} (${was})`,
  });
  try {
    const result = (await client.updateAdset(options.adsetId, {
      name: options.name,
      dailyMinSpendCents: options.dailyMinSpendCents,
      dailyBudgetCents: options.dailyBudgetCents,
    })) as { status?: number; body?: unknown };
    await deps.updateChange(changeId, { status: result?.status ?? null, response: (result?.body ?? null) as Json });
  } catch (error) {
    await deps.updateChange(changeId, { response: { error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
  deps.log(`  + ${options.adsetId}: updated ${JSON.stringify(request)}`);
}

export interface CopyAdsetOptions {
  fromAdsetId: string;
  name: string;
  dailyBudgetCents?: number;
  plan: string;
  dryRun: boolean;
}

// Copies an ad set into its own campaign without its ads, PAUSED, then names it
// (and optionally sets its daily budget) with updateAdset. Copying is how a new
// ad set gets the campaign's attribution settings; Meta rejects a from-scratch one.
// Both writes are journaled. Resolves to the new ad set id (null on --dry-run).
export async function copyAdset(
  client: Pick<MetaAdsClient, "get" | "copyAdset" | "updateAdset">,
  productSlug: string,
  options: CopyAdsetOptions,
  deps: UpdateAdsetDeps = defaultDeps,
): Promise<string | null> {
  if (!options.name.trim()) throw new Error("adset-copy needs --name");
  const product = await deps.requireProduct(productSlug);
  const accountId = await deps.adAccount(product.id);
  const planName = await deps.requirePlanDoc(product.id, options.plan);
  const source = await readOwnAdset(client, options.fromAdsetId, accountId);
  const request = { deep_copy: false, status_option: "PAUSED" };

  if (options.dryRun) {
    const budget = options.dailyBudgetCents !== undefined ? `, daily_budget=${options.dailyBudgetCents}` : ` (keeps daily_budget=${source.daily_budget ?? "none"})`;
    deps.log(`  + ${options.fromAdsetId} ${source.name ?? ""}: would copy without ads, PAUSED, as "${options.name}"${budget}`);
    return null;
  }
  const changeId = await deps.insertChange({
    at: new Date().toISOString(),
    actor: "devin",
    product_id: product.id,
    ad_account_id: accountId,
    object_type: "adset",
    object_id: options.fromAdsetId,
    method: "POST",
    path: `/${options.fromAdsetId}/copies`,
    is_write: true,
    request: request as Json,
    plan_path: planName,
    note: `copy adset ${source.name ?? ""} (campaign ${source.campaign_id ?? "?"}) without ads, PAUSED, to be named "${options.name}"`,
  });
  let newId: string | undefined;
  try {
    const result = await client.copyAdset(options.fromAdsetId);
    await deps.updateChange(changeId, { status: result.status, response: (result.body ?? null) as Json });
    newId = (result.body as { copied_adset_id?: string } | null)?.copied_adset_id;
  } catch (error) {
    await deps.updateChange(changeId, { response: { error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
  if (!newId) throw new Error(`Meta POST /${options.fromAdsetId}/copies: response has no copied_adset_id`);
  deps.log(`  + ${options.fromAdsetId}: copied to ${newId} (PAUSED, no ads)`);

  await updateAdset(client, productSlug, { adsetId: newId, name: options.name, dailyBudgetCents: options.dailyBudgetCents, plan: options.plan, dryRun: false }, deps);
  return newId;
}
