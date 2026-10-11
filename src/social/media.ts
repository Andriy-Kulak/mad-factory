import { download, r2Enabled, sha256, store } from "../lib/storage.ts";
import type { SocialStore } from "./types.ts";

export interface StoredSocialMedia {
  sha256: string;
  isNew: boolean;
}

export class SocialMediaDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialMediaDownloadError";
  }
}

export async function storeSocialMedia(
  url: string,
  prefix: "images" | "videos",
  extension: "jpg" | "mp4",
  mediaType: "image" | "video",
  socialStore: Pick<SocialStore, "creativeExists" | "insertCreative">,
): Promise<StoredSocialMedia | null> {
  if (!r2Enabled) return null;

  let bytes: Buffer;
  try {
    bytes = await download(url);
  } catch (error) {
    const status = error instanceof Error ? error.message.match(/download (\d+)/)?.[1] : null;
    throw new SocialMediaDownloadError(status ? `Social media download failed with HTTP ${status}` : "Social media download failed");
  }
  const hash = sha256(bytes);
  const isNew = !(await socialStore.creativeExists(hash));
  if (isNew) {
    const stored = await store(hash, bytes, extension, prefix);
    await socialStore.insertCreative({
      sha256: hash,
      mediaType,
      bytes: bytes.length,
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
    });
  }
  return { sha256: hash, isNew };
}
