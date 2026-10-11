import { readFile } from "node:fs/promises";
import { getDb } from "../db/client.ts";
import { creativeExists, insertCreative } from "../db/ads.ts";
import { download, sha256, store, type StoredObject } from "../lib/storage.ts";
import type { CreativeInsert, MetaAdsCreativeRow } from "../db/types.ts";
import type { MetaAdsClient } from "./client.ts";
import type { ApiObject, ApiPage } from "./types.ts";

/**
 * Download the media behind meta_ads_creatives rows whose sha256 is still null:
 * the video `source` for creatives with a video_id, else the image behind
 * image_hash via /adimages. Files are deduplicated by their Meta id, stored
 * content-addressed, and the creative's sha256 is filled in.
 */

export interface MediaDeps {
  listCreatives(productId: string): Promise<MetaAdsCreativeRow[]>;
  getCreative(productId: string, creativeId: string): Promise<MetaAdsCreativeRow | null>;
  setCreativeSha(id: string, hash: string): Promise<void>;
  creativeExists(hash: string): Promise<boolean>;
  insertCreative(row: CreativeInsert): Promise<void>;
  download(url: string): Promise<Buffer>;
  readFile(path: string): Promise<Buffer>;
  store(hash: string, buf: Buffer, ext: string, prefix: string): Promise<StoredObject>;
  log(message: string): void;
}

export interface MediaOptions {
  limit?: number;
}

export interface MediaStats {
  scanned: number;
  videos: number;
  images: number;
  skipped: number;
  failures: number;
}

export const defaultDeps: MediaDeps = {
  async listCreatives(productId) {
    const res = await getDb().from("meta_ads_creatives").select("*").eq("product_id", productId).is("sha256", null).order("id");
    if (res.error) throw new Error(`listCreatives: ${res.error.message}`);
    return res.data;
  },
  async getCreative(productId, creativeId) {
    const res = await getDb().from("meta_ads_creatives").select("*").eq("product_id", productId).eq("id", creativeId).maybeSingle();
    if (res.error) throw new Error(`getCreative: ${res.error.message}`);
    return res.data;
  },
  async setCreativeSha(id, hash) {
    const res = await getDb().from("meta_ads_creatives").update({ sha256: hash }).eq("id", id);
    if (res.error) throw new Error(`setCreativeSha: ${res.error.message}`);
  },
  creativeExists,
  insertCreative,
  download,
  readFile,
  store,
  log: (message) => console.log(message),
};

async function persist(deps: MediaDeps, hash: string, buf: Buffer, media: { ext: string; prefix: string; type: string }): Promise<StoredObject | null> {
  if (await deps.creativeExists(hash)) return null;
  const stored = await deps.store(hash, buf, media.ext, media.prefix);
  await deps.insertCreative({
    sha256: hash,
    media_type: media.type,
    bytes: buf.length,
    storage_key: stored.storageKey,
    public_url: stored.publicUrl,
  });
  return stored;
}

/**
 * Download media for a product's un-profiled creatives. Video creatives go
 * through `/<video_id>` one at a time; image creatives share one batched
 * `/<ad_account_id>/adimages` call. One failing creative is logged and skipped.
 */
export async function downloadMedia(client: MetaAdsClient, accountId: string, productId: string, options: MediaOptions, deps: MediaDeps = defaultDeps): Promise<MediaStats> {
  const stats: MediaStats = { scanned: 0, videos: 0, images: 0, skipped: 0, failures: 0 };
  const all = await deps.listCreatives(productId);
  const creatives = options.limit ? all.slice(0, options.limit) : all;
  stats.scanned = creatives.length;
  if (!creatives.length) return stats;

  // Dedupe: one video_id or image_hash may back several creatives.
  const byVideo = new Map<string, MetaAdsCreativeRow[]>();
  const byImage = new Map<string, MetaAdsCreativeRow[]>();
  for (const creative of creatives) {
    if (creative.video_id) {
      const list = byVideo.get(creative.video_id) ?? [];
      list.push(creative);
      byVideo.set(creative.video_id, list);
    } else if (creative.image_hash) {
      const list = byImage.get(creative.image_hash) ?? [];
      list.push(creative);
      byImage.set(creative.image_hash, list);
    } else {
      stats.skipped++;
      deps.log(`  ! creative ${creative.id}: no video_id or image_hash`);
    }
  }

  const shaByVideo = new Map<string, string | null>();
  for (const [videoId, owners] of byVideo) {
    try {
      const video = await client.get<ApiObject>(`/${videoId}`, { fields: "source" });
      const source = typeof video.source === "string" && video.source ? video.source : null;
      if (!source) {
        shaByVideo.set(videoId, null);
        stats.failures += owners.length;
        deps.log(`  ! video ${videoId}: no source URL returned`);
        continue;
      }
      const buf = await deps.download(source);
      const hash = sha256(buf);
      await persist(deps, hash, buf, { ext: "mp4", prefix: "videos", type: "video" });
      shaByVideo.set(videoId, hash);
      stats.videos++;
      deps.log(`  + video ${videoId} -> ${hash.slice(0, 12)} (${(buf.length / 1e6).toFixed(1)} MB, ${owners.length} creative(s))`);
    } catch (error) {
      shaByVideo.set(videoId, null);
      stats.failures += owners.length;
      deps.log(`  ! video ${videoId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const shaByImage = new Map<string, string | null>();
  if (byImage.size) {
    try {
      const page = await client.get<ApiPage<ApiObject>>(`/${accountId}/adimages`, {
        hashes: JSON.stringify([...byImage.keys()]),
        fields: "hash,url",
      });
      const urlByHash = new Map<string, string>();
      for (const image of page.data ?? []) {
        const hash = typeof image.hash === "string" ? image.hash : null;
        const url = typeof image.url === "string" ? image.url : null;
        if (hash && url) urlByHash.set(hash, url);
      }
      for (const [imageHash, owners] of byImage) {
        const url = urlByHash.get(imageHash);
        if (!url) {
          shaByImage.set(imageHash, null);
          stats.failures += owners.length;
          deps.log(`  ! image ${imageHash.slice(0, 12)}: no URL returned`);
          continue;
        }
        try {
          const buf = await deps.download(url);
          const hash = sha256(buf);
          await persist(deps, hash, buf, { ext: "jpg", prefix: "images", type: "image" });
          shaByImage.set(imageHash, hash);
          stats.images++;
          deps.log(`  + image ${imageHash.slice(0, 12)} -> ${hash.slice(0, 12)} (${owners.length} creative(s))`);
        } catch (error) {
          shaByImage.set(imageHash, null);
          stats.failures += owners.length;
          deps.log(`  ! image ${imageHash.slice(0, 12)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      stats.failures += [...byImage.values()].reduce((n, owners) => n + owners.length, 0);
      deps.log(`  ! adimages lookup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const [videoId, owners] of byVideo) {
    const hash = shaByVideo.get(videoId);
    if (!hash) continue;
    for (const owner of owners) await deps.setCreativeSha(owner.id, hash);
  }
  for (const [imageHash, owners] of byImage) {
    const hash = shaByImage.get(imageHash);
    if (!hash) continue;
    for (const owner of owners) await deps.setCreativeSha(owner.id, hash);
  }

  return stats;
}

const FILE_MEDIA: Record<string, { ext: string; prefix: string; type: string }> = {
  mp4: { ext: "mp4", prefix: "videos", type: "video" },
  mov: { ext: "mov", prefix: "videos", type: "video" },
  jpg: { ext: "jpg", prefix: "images", type: "image" },
  jpeg: { ext: "jpg", prefix: "images", type: "image" },
  png: { ext: "png", prefix: "images", type: "image" },
  webp: { ext: "webp", prefix: "images", type: "image" },
};

/**
 * Import a media file the owner provided by hand (e.g. a video Meta will not
 * let us download) for one meta_ads_creatives row. No Meta API call.
 */
export async function importMediaFile(productId: string, creativeId: string, filePath: string, options: { force?: boolean } = {}, deps: MediaDeps = defaultDeps): Promise<void> {
  const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  const media = FILE_MEDIA[ext];
  if (!media) throw new Error(`unsupported file extension ".${ext}" (mp4, mov, jpg, jpeg, png, webp)`);
  const creative = await deps.getCreative(productId, creativeId);
  if (!creative) throw new Error(`meta_ads_creatives row ${creativeId} not found for product ${productId}`);
  const buf = await deps.readFile(filePath);
  const hash = sha256(buf);
  if (creative.sha256 && creative.sha256 !== hash && !options.force) {
    throw new Error(`creative ${creativeId} already has sha256 ${creative.sha256.slice(0, 12)}; pass --force to replace`);
  }
  const stored = await persist(deps, hash, buf, media);
  await deps.setCreativeSha(creativeId, hash);
  deps.log(`  + creative ${creativeId} -> ${hash} (${stored?.publicUrl ?? stored?.storageKey ?? "already stored"})`);
}
