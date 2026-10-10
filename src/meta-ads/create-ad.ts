import { listTrackedSourcesBySource, requireProduct } from "../db/index.ts";
import { addMetaAdsChange, updateMetaAdsChange } from "../db/meta-ads.ts";
import type { Json, MetaAdsChangeInsert, ProductRow } from "../db/types.ts";
import type { MetaAdsClient } from "./client.ts";
import { defaultDeps as sharedDeps } from "./pause.ts";
import { SOURCE } from "./sync.ts";

// OWNER RULE — writes in this module create PAUSED ads only. NEVER delete or
// archive a Meta ad, ad set, campaign or creative — not even if the owner asks.
// Pausing is reversible; deleting is not. See AGENTS.md and client.ts.

type ApiObject = Record<string, unknown>;

export type TextMode = "feed" | "single";

export interface AdText {
  titles: string[];
  bodies: string[];
}

interface TemplateCreative extends ApiObject {}

export type MediaRef =
  | { kind: "video"; videoId: string; thumbnailUrl: string | null }
  | { kind: "image"; imageHash: string };

// Builds the creative spec for a new ad from a template ad's creative.
// Feed mode keeps the template's asset_feed_spec (body/title variants); single
// mode collapses to the first body + title onto the media. The template's
// image_hash/image_url are dropped — the new thumbnail URL is used instead.
export function buildCreativeFromTemplate(
  template: TemplateCreative,
  options: { media: MediaRef; textMode: TextMode; text?: AdText },
): Record<string, unknown> {
  const spec = (template.object_story_spec ?? {}) as ApiObject;
  const videoData = (spec.video_data ?? {}) as ApiObject;
  const linkData = (spec.link_data ?? {}) as ApiObject;
  const feed = (template.asset_feed_spec ?? {}) as ApiObject;
  const bodies: ApiObject[] = options.text ? options.text.bodies.map((text) => ({ text })) : Array.isArray(feed.bodies) ? (feed.bodies as ApiObject[]) : [];
  const titles: ApiObject[] = options.text ? options.text.titles.map((text) => ({ text })) : Array.isArray(feed.titles) ? (feed.titles as ApiObject[]) : [];
  const firstText = (entries: ApiObject[]) => (entries[0]?.text ?? entries[0]?.name ?? null) as string | null;

  let story: ApiObject;
  if (options.media.kind === "video") {
    const newVideoData: ApiObject = {
      video_id: options.media.videoId,
      call_to_action: videoData.call_to_action,
    };
    if (options.media.thumbnailUrl) newVideoData.image_url = options.media.thumbnailUrl;
    if (options.textMode === "single") {
      const message = firstText(bodies);
      const title = firstText(titles);
      if (message) newVideoData.message = message;
      if (title) newVideoData.title = title;
    }
    story = {
      page_id: spec.page_id,
      ...(spec.instagram_user_id !== undefined ? { instagram_user_id: spec.instagram_user_id } : {}),
      video_data: newVideoData,
    };
  } else {
    const callToAction = (videoData.call_to_action ?? linkData.call_to_action) as ApiObject | undefined;
    const ctaLink = (callToAction?.value as ApiObject | undefined)?.link;
    const link = (linkData.link ?? ctaLink) as string | undefined;
    if (!link) throw new Error("template creative has no link for an image ad (link_data.link or call_to_action.value.link)");
    const newLinkData: ApiObject = {
      link,
      image_hash: options.media.imageHash,
      call_to_action: callToAction,
    };
    if (options.textMode === "single") {
      const message = firstText(bodies);
      const title = firstText(titles);
      if (message) newLinkData.message = message;
      if (title) newLinkData.name = title;
    }
    story = {
      page_id: spec.page_id,
      ...(spec.instagram_user_id !== undefined ? { instagram_user_id: spec.instagram_user_id } : {}),
      link_data: newLinkData,
    };
  }

  const creative: ApiObject = {
    object_story_spec: story,
    // Meta rejects new creatives that carry standard_enhancements (subcode
    // 3858504, deprecated); deep-copy and strip it, keeping every other
    // individual feature's OPT_IN/OPT_OUT choice. Never mutate the template.
    ...(template.degrees_of_freedom_spec !== undefined
      ? { degrees_of_freedom_spec: stripStandardEnhancements(template.degrees_of_freedom_spec as ApiObject) }
      : {}),
  };
  if (options.textMode === "feed" && (bodies.length || titles.length)) {
    creative.asset_feed_spec = {
      ...(bodies.length ? { bodies } : {}),
      ...(titles.length ? { titles } : {}),
      ...(feed.optimization_type !== undefined ? { optimization_type: feed.optimization_type } : {}),
    };
  }
  return creative;
}

function stripStandardEnhancements(spec: ApiObject): ApiObject {
  const copy = JSON.parse(JSON.stringify(spec)) as ApiObject;
  const features = copy.creative_features_spec as ApiObject | undefined;
  if (features && "standard_enhancements" in features) delete features.standard_enhancements;
  return copy;
}

export interface CreateAdOptions {
  adsetId: string;
  templateAdId: string;
  file?: string;
  videoId?: string;
  imageHash?: string;
  name: string;
  plan: string;
  validateOnly: boolean;
  textMode: TextMode;
  titles?: string[];
  bodies?: string[];
  // Already-fetched ad set and template ad (a batch fetches them once).
  fetched?: { adset: ApiObject; templateAd: ApiObject };
}

export interface CreateAdDeps {
  requireProduct(slug: string): Promise<ProductRow>;
  adAccount(productId: string): Promise<string>;
  requirePlanDoc(productId: string, ref: string): Promise<string>;
  insertChange(row: MetaAdsChangeInsert): Promise<string>;
  updateChange(id: string, patch: { status?: number | null; response?: Json | null }): Promise<void>;
  log(message: string): void;
}

export const defaultDeps: CreateAdDeps = {
  requireProduct,
  adAccount: sharedDeps.adAccount,
  requirePlanDoc: sharedDeps.requirePlanDoc,
  insertChange: addMetaAdsChange,
  updateChange: updateMetaAdsChange,
  log: (message) => console.log(message),
};

// Creates one PAUSED ad in the product's ad account from a template ad. The
// meta_ads_changes row is inserted BEFORE each write (upload and create) and
// updated with the HTTP status and response afterwards — journal-then-write, so
// every attempted write has an audit row even when the call fails. No DB mirror;
// the daily sync picks the ad up.
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg"]);
const VIDEO_EXTS = new Set(["mp4", "mov"]);

export async function createAdFromTemplate(
  client: Pick<MetaAdsClient, "get" | "createAd" | "uploadVideo" | "uploadImage" | "videoThumbnail">,
  productSlug: string,
  options: CreateAdOptions,
  deps: CreateAdDeps = defaultDeps,
): Promise<{ adId: string | null; videoId: string | null; imageHash: string | null }> {
  const mediaSource = [options.file, options.videoId, options.imageHash].filter(Boolean).length;
  if (mediaSource !== 1) {
    throw new Error("create-ad needs exactly one of --file <mp4|image>, --video-id <id> or --image-hash <hash>");
  }
  if (Boolean(options.titles?.length) !== Boolean(options.bodies?.length)) {
    throw new Error("--title and --body must be passed together");
  }
  const text: AdText | undefined = options.titles?.length ? { titles: options.titles, bodies: options.bodies! } : undefined;
  const product = await deps.requireProduct(productSlug);
  const accountId = await deps.adAccount(product.id);
  const planName = await deps.requirePlanDoc(product.id, options.plan);

  const adset = options.fetched?.adset ?? await client.get<ApiObject>(`/${options.adsetId}`, { fields: "name,account_id" });
  if (`act_${adset.account_id ?? ""}` !== accountId) {
    throw new Error(`ad set ${options.adsetId} belongs to act_${adset.account_id}, not ${accountId}; refusing to write to another account`);
  }
  const templateAd = options.fetched?.templateAd ?? await client.get<ApiObject>(`/${options.templateAdId}`, {
    fields: "name,account_id,creative{object_story_spec,asset_feed_spec,degrees_of_freedom_spec}",
  });
  if (`act_${templateAd.account_id ?? ""}` !== accountId) {
    throw new Error(`template ad ${options.templateAdId} belongs to act_${templateAd.account_id}, not ${accountId}; refusing to write to another account`);
  }
  const creativeTemplate = (templateAd.creative ?? {}) as ApiObject;

  let videoId = options.videoId ?? null;
  let imageHash = options.imageHash ?? null;
  let thumbnailUrl: string | null = null;
  if (options.file) {
    const ext = options.file.slice(options.file.lastIndexOf(".") + 1).toLowerCase();
    const isImage = IMAGE_EXTS.has(ext);
    if (!isImage && !VIDEO_EXTS.has(ext)) {
      throw new Error(`unsupported media extension ".${ext}" (png, jpg, jpeg, mp4, mov)`);
    }
    const objectType = isImage ? "image" : "video";
    const endpoint = isImage ? "adimages" : "advideos";
    const changeId = await deps.insertChange({
      at: new Date().toISOString(),
      actor: "devin",
      product_id: product.id,
      ad_account_id: accountId,
      object_type: objectType,
      object_id: null,
      method: "POST",
      path: `/${accountId}/${endpoint}`,
      is_write: true,
      request: { title: options.name, file: options.file },
      plan_path: planName,
      note: `upload ${objectType} ${options.file} for ${options.name}`,
    });
    try {
      if (isImage) {
        const uploaded = await client.uploadImage(accountId, options.file);
        imageHash = uploaded.hash;
        await deps.updateChange(changeId, { status: 200, response: { hash: imageHash } });
      } else {
        const uploaded = await client.uploadVideo(accountId, options.file, options.name);
        videoId = uploaded.videoId;
        thumbnailUrl = uploaded.thumbnailUrl;
        await deps.updateChange(changeId, { status: 200, response: { id: videoId, thumbnail_url: thumbnailUrl } });
      }
    } catch (error) {
      await deps.updateChange(changeId, { response: { error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  let media: MediaRef;
  if (imageHash) {
    media = { kind: "image", imageHash };
  } else {
    if (!thumbnailUrl && videoId) thumbnailUrl = await client.videoThumbnail(videoId);
    if (!thumbnailUrl) throw new Error(`no thumbnail for video ${videoId}; Meta requires image_url`);
    media = { kind: "video", videoId: videoId!, thumbnailUrl };
  }

  const creative = buildCreativeFromTemplate(creativeTemplate, { media, textMode: options.textMode, text });
  const changeId = await deps.insertChange({
    at: new Date().toISOString(),
    actor: "devin",
    product_id: product.id,
    ad_account_id: accountId,
    object_type: "ad",
    object_id: null,
    method: "POST",
    path: `/${accountId}/ads`,
    is_write: true,
    request: { name: options.name, adset_id: options.adsetId, creative, status: "PAUSED", ...(options.validateOnly ? { execution_options: ["validate_only"] } : {}) } as Json,
    plan_path: planName,
    note: `create ad ${options.name} in adset ${options.adsetId} (PAUSED${options.validateOnly ? ", validate_only" : ""})`,
  });
  let adId: string | null = null;
  try {
    const result = (await client.createAd(accountId, {
      name: options.name,
      adsetId: options.adsetId,
      creative,
      validateOnly: options.validateOnly,
    })) as { status?: number; body?: { id?: string } };
    adId = result?.body?.id ?? null;
    await deps.updateChange(changeId, { status: result?.status ?? null, response: (result?.body ?? null) as Json });
  } catch (error) {
    await deps.updateChange(changeId, { response: { error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
  deps.log(options.validateOnly ? `validated: ad ${options.name} would create (validate_only)` : `created ad ${adId ?? "?"} ${options.name} (PAUSED)`);
  return { adId, videoId, imageHash };
}
