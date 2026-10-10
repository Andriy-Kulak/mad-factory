export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export const SOCIAL_PLATFORMS = ["instagram", "tiktok", "facebook"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export type SocialPostKind = "reel" | "video" | "carousel" | "post" | "photo";

export interface SocialPostMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  extra: Record<string, number>;
}

export interface SocialProfile {
  platform: SocialPlatform;
  externalId: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  url: string | null;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  totalLikes: number | null;
  raw: Json;
}

export interface SocialPost {
  platform: SocialPlatform;
  externalId: string;
  url: string | null;
  kind: SocialPostKind;
  caption: string | null;
  postedAt: string | null;
  durationS: number | null;
  audioId: string | null;
  audioTitle: string | null;
  hashtags: string[];
  isPaidPartnership: boolean | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  metrics: SocialPostMetrics;
  raw: Json;
}

export interface SocialCollectOptions {
  maxPosts: number;
  maxCredits: number;
  /** ISO date; skip posts older than this and stop paging once a page ends before it. */
  since?: string;
  onUsage?: (credits: number) => void;
  onProfile?: (profile: SocialProfile) => Promise<void> | void;
  onPosts?: (posts: SocialPost[]) => Promise<void> | void;
}

export interface SocialCollectResult {
  profile: SocialProfile;
  postsSeen: number;
  creditsUsed: number;
  creditsRemaining: number | null;
}

export interface SocialCollector {
  provider: string;
  platform: SocialPlatform;
  validateValue(value: string): string;
  collect(value: string, options: SocialCollectOptions): Promise<SocialCollectResult>;
}

export interface SocialAccountUpsert {
  profile: SocialProfile;
  lastSyncedAt: string;
}

export interface SocialAccountSnapshotUpsert {
  accountId: string;
  capturedOn: string;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  totalLikes: number | null;
  scrapeRunId: string | null;
}

export interface SocialPostUpsert {
  accountId: string;
  post: SocialPost;
  lastSyncedAt: string;
}

export interface SocialPostSnapshotUpsert {
  postId: string;
  capturedOn: string;
  source: string;
  metrics: SocialPostMetrics;
  scrapeRunId: string | null;
}

export interface SocialPostMediaUpsert {
  postId: string;
  sha256: string;
  position: number;
  role: "thumbnail" | "media";
}

export interface SocialCreativeUpsert {
  sha256: string;
  mediaType: "image" | "video";
  bytes: number;
  storageKey: string;
  publicUrl: string | null;
}

export interface SocialStore {
  upsertAccount(input: SocialAccountUpsert): Promise<{ id: string }>;
  updateAccountAvatar(accountId: string, sha256: string): Promise<void>;
  upsertAccountSnapshot(input: SocialAccountSnapshotUpsert): Promise<void>;
  upsertPost(input: SocialPostUpsert): Promise<{ id: string; isNew: boolean }>;
  upsertPostSnapshot(input: SocialPostSnapshotUpsert): Promise<void>;
  hasPostMedia(postId: string, role: SocialPostMediaUpsert["role"]): Promise<boolean>;
  upsertPostMedia(input: SocialPostMediaUpsert): Promise<void>;
  creativeExists(sha256: string): Promise<boolean>;
  insertCreative(input: SocialCreativeUpsert): Promise<void>;
}
