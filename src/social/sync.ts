import { finishScrapeRun, startScrapeRun } from "../db/ads.ts";
import { markSourceScraped, updateTrackedSourceConfig } from "../db/products.ts";
import type { Json as DatabaseJson, TrackedSourceRow } from "../db/types.ts";
import { SocialMediaDownloadError as SocialMediaDownloadErrorClass, storeSocialMedia } from "./media.ts";
import { r2Enabled } from "../lib/storage.ts";
import type { SocialAccountSnapshotUpsert, SocialCollector, SocialPost, SocialPostMediaUpsert, SocialStore } from "./types.ts";

export interface SocialSyncOptions {
  maxPosts: number;
  maxCredits: number;
  since?: string;
  downloadMedia: boolean;
}

export interface SocialSyncResult {
  followers: number | null;
  postsSeen: number;
  postsNew: number;
  creditsUsed: number;
  creditsRemaining: number | null;
  mediaStored: number;
  creativesNew: number;
  mediaFailures: string[];
}

interface SyncStats {
  postsSeen: number;
  postsNew: number;
  mediaStored: number;
  creativesNew: number;
  mediaFailures: string[];
}

function relationConfig(source: TrackedSourceRow): { relation: string; config: Record<string, DatabaseJson> } {
  const config = source.config !== null && typeof source.config === "object" && !Array.isArray(source.config) ? (source.config as Record<string, DatabaseJson>) : {};
  const relation = config.relation;
  if (relation !== "own" && relation !== "competitor" && relation !== "inspiration") {
    throw new Error(`${source.source} account config.relation must be own, competitor, or inspiration`);
  }
  return { relation, config };
}

function dateTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function storeMedia(
  url: string,
  prefix: "images" | "videos",
  extension: "jpg" | "mp4",
  mediaType: "image" | "video",
  description: string,
  store: SocialStore,
  stats: SyncStats,
): Promise<{ sha256: string; isNew: boolean } | null> {
  try {
    return await storeSocialMedia(url, prefix, extension, mediaType, store);
  } catch (error) {
    if (!(error instanceof SocialMediaDownloadErrorClass)) throw error;
    const failure = `${description}: ${error.message}`;
    stats.mediaFailures.push(failure);
    console.error(`  ! ${failure}`);
    return null;
  }
}

async function savePostMedia(postId: string, post: SocialPost, store: SocialStore, stats: SyncStats): Promise<void> {
  const assets: Array<{
    url: string;
    prefix: "images" | "videos";
    extension: "jpg" | "mp4";
    mediaType: "image" | "video";
    role: SocialPostMediaUpsert["role"];
  }> = [];
  if (post.thumbnailUrl) {
    assets.push({
      url: post.thumbnailUrl,
      prefix: "images",
      extension: "jpg",
      mediaType: "image",
      role: "thumbnail",
    });
  }
  if ((post.kind === "reel" || post.kind === "video") && post.videoUrl) {
    assets.push({
      url: post.videoUrl,
      prefix: "videos",
      extension: "mp4",
      mediaType: "video",
      role: "media",
    });
  }

  for (const asset of assets) {
    if (await store.hasPostMedia(postId, asset.role)) continue;
    const stored = await storeMedia(asset.url, asset.prefix, asset.extension, asset.mediaType, `post ${post.externalId} ${asset.role}`, store, stats);
    if (!stored) continue;
    await store.upsertPostMedia({
      postId,
      sha256: stored.sha256,
      position: 0,
      role: asset.role,
    });
    stats.mediaStored++;
    if (stored.isNew) stats.creativesNew++;
    console.log(`  + ${asset.role} ${stored.sha256.slice(0, 12)}`);
  }
}

export async function syncSource(source: TrackedSourceRow, productId: string, collector: SocialCollector, store: SocialStore, options: SocialSyncOptions): Promise<SocialSyncResult> {
  if (source.source !== collector.platform || source.kind !== "account") {
    throw new Error(`Unsupported social source ${source.source}/${source.kind}`);
  }
  if (source.country !== "ALL") {
    throw new Error(`${collector.platform} account ${source.value} must use country ALL`);
  }
  const { config } = relationConfig(source);
  const value = collector.validateValue(source.value);
  const stats: SyncStats = {
    postsSeen: 0,
    postsNew: 0,
    mediaStored: 0,
    creativesNew: 0,
    mediaFailures: [],
  };
  const capturedOn = dateTodayUtc();
  let creditsUsed = 0;
  let runId: string | null = null;
  let accountId: string | null = null;

  try {
    runId = await startScrapeRun({
      product_id: productId,
      tracked_source_id: source.id,
      source: collector.platform,
      collector: collector.provider,
    });
    const activeRunId = runId;
    const result = await collector.collect(value, {
      maxPosts: options.maxPosts,
      maxCredits: options.maxCredits,
      since: options.since,
      onUsage: (credits) => {
        creditsUsed += credits;
      },
      onProfile: async (profile) => {
        const account = await store.upsertAccount({
          profile,
          lastSyncedAt: new Date().toISOString(),
        });
        accountId = account.id;
        config.account_id = account.id;
        await updateTrackedSourceConfig(source.id, config as DatabaseJson);
        const accountSnapshot: SocialAccountSnapshotUpsert = {
          accountId: account.id,
          capturedOn,
          followers: profile.followers,
          following: profile.following,
          postsCount: profile.postsCount,
          totalLikes: profile.totalLikes,
          scrapeRunId: activeRunId,
        };
        await store.upsertAccountSnapshot(accountSnapshot);

        if (options.downloadMedia && r2Enabled && profile.avatarUrl) {
          const avatar = await storeMedia(profile.avatarUrl, "images", "jpg", "image", "profile avatar", store, stats);
          if (avatar) {
            await store.updateAccountAvatar(account.id, avatar.sha256);
            stats.mediaStored++;
            if (avatar.isNew) stats.creativesNew++;
            console.log(`  + avatar ${avatar.sha256.slice(0, 12)}`);
          }
        }
      },
      onPosts: async (posts) => {
        if (!accountId) throw new Error("Social profile must be collected before posts");
        for (const post of posts) {
          const saved = await store.upsertPost({
            accountId,
            post,
            lastSyncedAt: new Date().toISOString(),
          });
          stats.postsSeen++;
          if (saved.isNew) stats.postsNew++;
          await store.upsertPostSnapshot({
            postId: saved.id,
            capturedOn,
            source: "scrape",
            metrics: post.metrics,
            scrapeRunId: activeRunId,
          });
          if (options.downloadMedia && r2Enabled) {
            await savePostMedia(saved.id, post, store, stats);
          }
        }
      },
    });

    if (!accountId) throw new Error("Social profile sync did not create an account");
    await markSourceScraped(source.id);
    // scrape_runs.ads_seen and ads_new are generic count columns reused for social posts.
    await finishScrapeRun(activeRunId, {
      status: "done",
      ads_seen: stats.postsSeen,
      ads_new: stats.postsNew,
      creatives_new: stats.creativesNew,
      credits_used: result.creditsUsed,
    });
    console.log(
      `-- done: ${collector.platform} ${value} (${result.profile.followers ?? "?"} followers), ${stats.postsSeen} posts (${stats.postsNew} new), ${stats.mediaStored} media, ${stats.mediaFailures.length} media failures, ${result.creditsUsed} credits${result.creditsRemaining === null ? "" : `, ${result.creditsRemaining} credits remaining`}`,
    );
    return {
      followers: result.profile.followers,
      postsSeen: stats.postsSeen,
      postsNew: stats.postsNew,
      creditsUsed: result.creditsUsed,
      creditsRemaining: result.creditsRemaining,
      mediaStored: stats.mediaStored,
      creativesNew: stats.creativesNew,
      mediaFailures: stats.mediaFailures,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      try {
        await finishScrapeRun(runId, {
          status: "error",
          error: message,
          ads_seen: stats.postsSeen,
          ads_new: stats.postsNew,
          creatives_new: stats.creativesNew,
          credits_used: creditsUsed,
        });
      } catch (finishError) {
        console.error(`-- failed to update scrape run: ${finishError instanceof Error ? finishError.message : String(finishError)}`);
      }
    }
    throw new Error(`${message} (credits used: ${creditsUsed})`, { cause: error });
  }
}
