import { requireProduct } from "../db/index.ts";
import { addMetaAdsChange, updateMetaAdsChange } from "../db/meta-ads.ts";
import type { Json, MetaAdsChangeInsert, ProductRow } from "../db/types.ts";
import type { MetaAdsClient } from "./client.ts";
import { buildCreativeFromTemplate, type AdText, type TextMode } from "./create-ad.ts";
import { defaultDeps as sharedDeps } from "./pause.ts";

// OWNER RULE — writes in this module swap an ad's creative only (Meta creates
// the new creative itself). NEVER delete or archive a Meta ad, ad set, campaign
// or creative — not even if the owner asks. See AGENTS.md and client.ts.

type ApiObject = Record<string, unknown>;

export interface UpdateAdTextDeps {
  requireProduct(slug: string): Promise<ProductRow>;
  adAccount(productId: string): Promise<string>;
  requirePlanDoc(productId: string, ref: string): Promise<string>;
  insertChange(row: MetaAdsChangeInsert): Promise<string>;
  updateChange(id: string, patch: { status?: number | null; response?: Json | null }): Promise<void>;
  log(message: string): void;
}

export interface UpdateAdTextOptions {
  adId: string;
  titles: string[];
  bodies: string[];
  plan: string;
  validateOnly: boolean;
  textMode: TextMode;
}

export const defaultDeps: UpdateAdTextDeps = {
  requireProduct,
  adAccount: sharedDeps.adAccount,
  requirePlanDoc: sharedDeps.requirePlanDoc,
  insertChange: addMetaAdsChange,
  updateChange: updateMetaAdsChange,
  log: (message) => console.log(message),
};

const textOf = (entries: unknown): string[] => (Array.isArray(entries) ? (entries as ApiObject[]).map((entry) => String(entry.text ?? entry.name ?? "")).filter(Boolean) : []);

// Swaps an ad's headlines/primary text by POSTing a rebuilt inline creative
// (Meta creates the creative itself). Account-checked before any write;
// journal-then-write like pause.ts: the meta_ads_changes row records the old
// titles/bodies in its note, is inserted BEFORE the Meta call, then updated
// with the HTTP status and response.
export async function updateAdText(
  client: Pick<MetaAdsClient, "get" | "updateAdCreative" | "videoThumbnail">,
  productSlug: string,
  options: UpdateAdTextOptions,
  deps: UpdateAdTextDeps = defaultDeps,
): Promise<void> {
  if (!options.titles.length || !options.bodies.length) {
    throw new Error("ad-text needs at least one --title and one --body");
  }
  const product = await deps.requireProduct(productSlug);
  const accountId = await deps.adAccount(product.id);
  const planName = await deps.requirePlanDoc(product.id, options.plan);

  const ad = await client.get<ApiObject>(`/${options.adId}`, {
    fields: "name,account_id,creative{object_story_spec,asset_feed_spec,degrees_of_freedom_spec}",
  });
  if (`act_${ad.account_id ?? ""}` !== accountId) {
    throw new Error(`ad ${options.adId} belongs to act_${ad.account_id}, not ${accountId}; refusing to write to another account`);
  }
  const current = (ad.creative ?? {}) as ApiObject;
  const spec = (current.object_story_spec ?? {}) as ApiObject;
  const videoData = (spec.video_data ?? {}) as ApiObject;
  const videoId = videoData.video_id as string | undefined;
  if (!videoId) throw new Error(`ad ${options.adId} creative has no video_data.video_id`);

  let thumbnailUrl = (videoData.image_url ?? null) as string | null;
  if (!thumbnailUrl) thumbnailUrl = await client.videoThumbnail(videoId);
  if (!thumbnailUrl) throw new Error(`no thumbnail for video ${videoId}; Meta requires image_url`);

  const feed = (current.asset_feed_spec ?? {}) as ApiObject;
  const oldTitles = textOf(feed.titles);
  const oldBodies = textOf(feed.bodies);
  const text: AdText = { titles: options.titles, bodies: options.bodies };
  const creative = buildCreativeFromTemplate(current, { media: { kind: "video", videoId, thumbnailUrl }, textMode: options.textMode, text });

  const changeId = await deps.insertChange({
    at: new Date().toISOString(),
    actor: "devin",
    product_id: product.id,
    ad_account_id: accountId,
    object_type: "ad",
    object_id: options.adId,
    method: "POST",
    path: `/${options.adId}`,
    is_write: true,
    request: { creative, ...(options.validateOnly ? { execution_options: ["validate_only"] } : {}) } as Json,
    plan_path: planName,
    note: `update ad text ${ad.name ?? options.adId} (was titles=${JSON.stringify(oldTitles)} bodies=${JSON.stringify(oldBodies)})`,
  });
  try {
    const result = (await client.updateAdCreative(options.adId, creative, options.validateOnly)) as { status?: number; body?: unknown };
    await deps.updateChange(changeId, { status: result?.status ?? null, response: (result?.body ?? null) as Json });
  } catch (error) {
    await deps.updateChange(changeId, { response: { error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
  deps.log(options.validateOnly ? `validated: ad ${options.adId} text swap` : `updated text on ad ${options.adId}`);
}
