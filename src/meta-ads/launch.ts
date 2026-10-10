import { access, readFile } from "node:fs/promises";
import { listTrackedSourcesBySource, requireProduct } from "../db/index.ts";
import { requirePlanDoc } from "../db/products.ts";
import { upsertMetaAdsAds, upsertMetaAdsCreatives } from "../db/meta-ads.ts";
import type { MetaAdsAdInsert, MetaAdsCreativeInsert, ProductRow } from "../db/types.ts";
import type { MetaAdsClient } from "./client.ts";
import { activateObjects, type ActivateStats } from "./activate.ts";
import { createAdFromTemplate, type TextMode } from "./create-ad.ts";
import { adRow, creativeRow } from "./map.ts";
import { importMediaFile } from "./media.ts";
import { defaultDeps as sharedDeps } from "./pause.ts";
import { AD_FIELDS } from "./sync.ts";

// OWNER RULE — this module only composes the allowlisted writes (create PAUSED
// ads, upload media, activate). NEVER delete or archive a Meta ad, ad set,
// campaign or creative — not even if the owner asks. See AGENTS.md and client.ts.

type ApiObject = Record<string, unknown>;

export interface LaunchAdSpec {
  name: string;
  file?: string;
  video_id?: string;
  image_hash?: string;
  titles?: string[];
  bodies?: string[];
}

export interface LaunchSpec {
  adset_id: string;
  template_ad_id: string;
  plan: string;
  text_mode?: TextMode;
  ads: LaunchAdSpec[];
}

const MEDIA_EXTS = new Set(["png", "jpg", "jpeg", "mp4", "mov"]);

function fieldError(name: string, field: string, problem: string): Error {
  return new Error(`spec ad "${name}" field "${field}": ${problem}`);
}

// Validates the JSON shape only — file/plan existence is checked by launch().
export function parseLaunchSpec(text: string): LaunchSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("spec file is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("spec must be a JSON object");
  const spec = raw as Record<string, unknown>;
  if (typeof spec.adset_id !== "string" || !spec.adset_id) throw new Error('spec field "adset_id": required non-empty string');
  if (typeof spec.template_ad_id !== "string" || !spec.template_ad_id) throw new Error('spec field "template_ad_id": required non-empty string');
  if (typeof spec.plan !== "string" || !spec.plan) throw new Error('spec field "plan": required non-empty string');
  if (spec.text_mode !== undefined && spec.text_mode !== "feed" && spec.text_mode !== "single") {
    throw new Error('spec field "text_mode": must be "feed" or "single"');
  }
  if (!Array.isArray(spec.ads) || !spec.ads.length) throw new Error('spec field "ads": required non-empty array');

  const names = new Set<string>();
  const ads: LaunchAdSpec[] = [];
  for (const entry of spec.ads) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("spec ads[] entries must be objects");
    const ad = entry as Record<string, unknown>;
    if (typeof ad.name !== "string" || !ad.name.trim()) throw new Error('spec ads[] field "name": required non-empty string');
    const name = ad.name;
    if (names.has(name)) throw fieldError(name, "name", "duplicate ad name");
    names.add(name);
    for (const key of ["file", "video_id", "image_hash"] as const) {
      if (ad[key] !== undefined && (typeof ad[key] !== "string" || !ad[key])) throw fieldError(name, key, "must be a non-empty string");
    }
    const mediaCount = [ad.file, ad.video_id, ad.image_hash].filter(Boolean).length;
    if (mediaCount !== 1) throw fieldError(name, "file|video_id|image_hash", "exactly one is required");
    for (const key of ["titles", "bodies"] as const) {
      if (ad[key] !== undefined && (!Array.isArray(ad[key]) || !(ad[key] as unknown[]).length || !(ad[key] as unknown[]).every((v) => typeof v === "string" && v.trim()))) {
        throw fieldError(name, key, "must be a non-empty array of non-empty strings");
      }
    }
    if (Boolean(ad.titles) !== Boolean(ad.bodies)) throw fieldError(name, "titles|bodies", "must be passed together");
    ads.push({
      name,
      ...(ad.file !== undefined ? { file: ad.file as string } : {}),
      ...(ad.video_id !== undefined ? { video_id: ad.video_id as string } : {}),
      ...(ad.image_hash !== undefined ? { image_hash: ad.image_hash as string } : {}),
      ...(ad.titles !== undefined ? { titles: ad.titles as string[] } : {}),
      ...(ad.bodies !== undefined ? { bodies: ad.bodies as string[] } : {}),
    });
  }
  return {
    adset_id: spec.adset_id,
    template_ad_id: spec.template_ad_id,
    plan: spec.plan,
    ...(spec.text_mode !== undefined ? { text_mode: spec.text_mode as TextMode } : {}),
    ads,
  };
}

export interface LaunchDeps {
  requireProduct(slug: string): Promise<ProductRow>;
  adAccount(productId: string): Promise<string>;
  requirePlanDoc(productId: string, ref: string): Promise<string>;
  pathExists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  createAd(client: Pick<MetaAdsClient, "get" | "createAd" | "uploadVideo" | "uploadImage" | "videoThumbnail">, slug: string, options: Parameters<typeof createAdFromTemplate>[2]): Promise<{ adId: string | null }>;
  activate(client: Pick<MetaAdsClient, "get" | "activate">, slug: string, options: { adIds: string[]; adsetIds: string[]; plan: string; dryRun: boolean }): Promise<ActivateStats>;
  upsertCreatives(rows: MetaAdsCreativeInsert[]): Promise<number>;
  upsertAds(rows: MetaAdsAdInsert[]): Promise<number>;
  importMedia(productId: string, creativeId: string, filePath: string): Promise<void>;
  log(message: string): void;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export const defaultDeps: LaunchDeps = {
  requireProduct,
  adAccount: sharedDeps.adAccount,
  requirePlanDoc,
  pathExists: exists,
  readFile: (path) => readFile(path, "utf8"),
  createAd: async (client, slug, options) => createAdFromTemplate(client, slug, options),
  activate: activateObjects,
  upsertCreatives: upsertMetaAdsCreatives,
  upsertAds: upsertMetaAdsAds,
  importMedia: async (productId, creativeId, filePath) => importMediaFile(productId, creativeId, filePath),
  log: (message) => console.log(message),
};

export interface LaunchOptions {
  specPath: string;
  validateOnly: boolean;
}

export interface LaunchedAd {
  name: string;
  adId: string | null;
  status: string;
}

// One command: create every spec ad PAUSED, activate them all (paced), then
// mirror them into meta_ads_ads/meta_ads_creatives only after activation
// succeeds — and link each local file into creatives. The DB is written only
// after Meta returns success.
export async function launch(
  client: Pick<MetaAdsClient, "get" | "activate" | "createAd" | "uploadVideo" | "uploadImage" | "videoThumbnail">,
  productSlug: string,
  options: LaunchOptions,
  deps: LaunchDeps = defaultDeps,
): Promise<LaunchedAd[]> {
  const spec = parseLaunchSpec(await deps.readFile(options.specPath));
  const textMode = spec.text_mode ?? "feed";
  const product = await deps.requireProduct(productSlug);
  const planName = await deps.requirePlanDoc(product.id, spec.plan);

  // Validate everything before ANY Meta call.
  for (const ad of spec.ads) {
    if (ad.file) {
      const ext = ad.file.slice(ad.file.lastIndexOf(".") + 1).toLowerCase();
      if (!MEDIA_EXTS.has(ext)) throw fieldError(ad.name, "file", `unsupported extension ".${ext}" (png, jpg, jpeg, mp4, mov)`);
      if (!(await deps.pathExists(ad.file))) throw fieldError(ad.name, "file", `file not found: ${ad.file}`);
    }
  }

  const accountId = await deps.adAccount(product.id);
  // Fetch the ad set and template once for the whole batch; createAdFromTemplate
  // still runs the account check on them per ad.
  const adset = await client.get<ApiObject>(`/${spec.adset_id}`, { fields: "name,account_id" });
  if (`act_${adset.account_id ?? ""}` !== accountId) {
    throw new Error(`ad set ${spec.adset_id} belongs to act_${adset.account_id}, not ${accountId}; refusing to write to another account`);
  }
  const templateAd = await client.get<ApiObject>(`/${spec.template_ad_id}`, {
    fields: "name,account_id,creative{object_story_spec,asset_feed_spec,degrees_of_freedom_spec}",
  });
  if (`act_${templateAd.account_id ?? ""}` !== accountId) {
    throw new Error(`template ad ${spec.template_ad_id} belongs to act_${templateAd.account_id}, not ${accountId}; refusing to write to another account`);
  }

  const created: { spec: LaunchAdSpec; adId: string | null }[] = [];
  for (const ad of spec.ads) {
    if (options.validateOnly && ad.file) {
      deps.log(`  = ${ad.name}: skipped — uploads are real writes; validate_only covers video_id/image_hash ads only`);
      continue;
    }
    try {
      const result = await deps.createAd(client, productSlug, {
        adsetId: spec.adset_id,
        templateAdId: spec.template_ad_id,
        ...(ad.file ? { file: ad.file } : {}),
        ...(ad.video_id ? { videoId: ad.video_id } : {}),
        ...(ad.image_hash ? { imageHash: ad.image_hash } : {}),
        name: ad.name,
        plan: planName,
        validateOnly: options.validateOnly,
        textMode,
        titles: ad.titles,
        bodies: ad.bodies,
        fetched: { adset, templateAd },
      });
      created.push({ spec: ad, adId: result.adId });
    } catch (error) {
      if (created.length) {
        deps.log(`  ! failed after ${created.length} ad(s); already created PAUSED: ${created.map((c) => `${c.spec.name} (${c.adId ?? "?"})`).join(", ")}`);
      }
      throw error;
    }
  }

  const results: LaunchedAd[] = [];
  if (options.validateOnly) {
    for (const c of created) {
      results.push({ name: c.spec.name, adId: c.adId, status: "validated" });
      deps.log(`  ~ ${c.spec.name}: validated`);
    }
    return results;
  }

  const adIds = created.map((c) => c.adId).filter((id): id is string => Boolean(id));
  await deps.activate(client, productSlug, { adIds, adsetIds: [], plan: planName, dryRun: false });

  // DB mirror — only after activation succeeds. One GET per ad with the same
  // AD_FIELDS as the sync, so the rows match what the morning sync writes.
  const syncedAt = new Date().toISOString();
  const creativeRows: MetaAdsCreativeInsert[] = [];
  const adRows: MetaAdsAdInsert[] = [];
  const creativeById = new Map<string, ApiObject>();
  const creativeIdByAd = new Map<string, string>();
  for (const c of created) {
    if (!c.adId) continue;
    const ad = await client.get<ApiObject>(`/${c.adId}`, { fields: AD_FIELDS });
    const creative = ad.creative && typeof ad.creative === "object" ? ad.creative as ApiObject : null;
    if (creative?.id !== undefined) {
      creativeById.set(String(creative.id), creative);
      creativeIdByAd.set(c.adId, String(creative.id));
    }
    adRows.push(adRow({ ...ad, campaign_id: ad.campaign_id ?? (adset.campaign_id as string | undefined) }, syncedAt));
  }
  for (const creative of creativeById.values()) creativeRows.push(creativeRow(creative, product.id, accountId, syncedAt));
  if (creativeRows.length) await deps.upsertCreatives(creativeRows);
  if (adRows.length) await deps.upsertAds(adRows);

  // Link each local file into creatives + meta_ads_creatives.sha256.
  for (const c of created) {
    if (!c.adId) continue;
    const creativeId = creativeIdByAd.get(c.adId);
    if (c.spec.file && creativeId) {
      await deps.importMedia(product.id, creativeId, c.spec.file);
    }
    results.push({ name: c.spec.name, adId: c.adId, status: "ACTIVE" });
    deps.log(`  + ${c.spec.name}: ad ${c.adId} ACTIVE`);
  }
  return results;
}
