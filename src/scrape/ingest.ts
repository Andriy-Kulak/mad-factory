import type { AdInsert, Json } from "../db/types.ts";
import {
  creativeExists,
  hasCreativesForAd,
  insertCreative,
  linkAdCreative,
  linkProductAd,
  upsertAd,
} from "../db/ads.ts";
import { download, sha256, store } from "../lib/storage.ts";
import type { CollectedAd } from "../sources/types.ts";

export interface IngestOptions {
  productId: string;
  trackedSourceId: string | null;
  downloadMedia: boolean;
  preferSd: boolean;
  log?: (msg: string) => void;
}

export interface IngestStats {
  adsSeen: number;
  adsNew: number;
  creativesNew: number;
}

export function toAdInsert(ad: CollectedAd): AdInsert {
  return {
    source: ad.source,
    external_id: ad.externalId,
    advertiser_id: ad.advertiserId,
    advertiser_name: ad.advertiserName,
    body_text: ad.bodyText,
    title: ad.title,
    link_url: ad.linkUrl,
    cta_text: ad.ctaText,
    start_date: ad.startDate?.toISOString() ?? null,
    end_date: ad.endDate?.toISOString() ?? null,
    is_active: ad.isActive,
    platforms: ad.platforms,
    collation_id: ad.collationId,
    collation_count: ad.collationCount,
    reach_estimate: (ad.reachEstimate ?? null) as Json | null,
    spend: (ad.spend ?? null) as Json | null,
    currency: ad.currency,
    total_active_time: (ad.totalActiveTime ?? null) as Json | null,
    raw: ad.raw as Json,
  };
}

/** Storage target for a collected media kind. */
export function mediaStorageTarget(kind: CollectedAd["media"][number]["kind"]): { ext: string; prefix: string } {
  return kind === "video" ? { ext: "mp4", prefix: "videos" } : { ext: "jpg", prefix: "images" };
}

/** Persist one collected ad, link it to the product, and download+store its media once. */
export async function ingestAd(ad: CollectedAd, o: IngestOptions, stats: IngestStats): Promise<string> {
  const log = o.log ?? (() => {});
  const { id: adId, isNew } = await upsertAd(toAdInsert(ad));
  stats.adsSeen++;
  if (isNew) stats.adsNew++;
  await linkProductAd(o.productId, adId, o.trackedSourceId);

  if (!o.downloadMedia || !ad.media.length || (await hasCreativesForAd(adId))) return adId;

  for (const [i, m] of ad.media.entries()) {
    const url = o.preferSd ? (m.sdUrl ?? m.hdUrl) : (m.hdUrl ?? m.sdUrl);
    if (!url) continue;
    const { ext, prefix } = mediaStorageTarget(m.kind);
    try {
      const buf = await download(url);
      const hash = sha256(buf);
      if (!(await creativeExists(hash))) {
        const stored = await store(hash, buf, ext, prefix);
        await insertCreative({
          sha256: hash,
          media_type: m.kind,
          bytes: buf.length,
          storage_key: stored.storageKey,
          public_url: stored.publicUrl,
        });
        stats.creativesNew++;
        log(`  + creative ${hash.slice(0, 12)} (${(buf.length / 1e6).toFixed(1)} MB)`);
      } else {
        log(`  = creative ${hash.slice(0, 12)} already stored`);
      }
      await linkAdCreative(adId, hash, i);
    } catch (err) {
      log(`  ! media ${i} of ${ad.externalId}: ${(err as Error).message}`);
    }
  }
  return adId;
}
