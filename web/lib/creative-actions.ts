"use server";

import { requireOwner } from "./auth/server";
import { getCreativeProfile } from "./creatives";
import { getDb } from "./db";

/** The creative preview's breakdown (transcript, mechanism, people…), fetched when a creative is opened. */
export async function loadCreativeProfile(sha256: string) {
  await requireOwner();
  return getCreativeProfile(sha256);
}

/** An organic post's breakdown: the creative profile of its video or image, or null when it has none yet. */
export async function loadPostProfile(postId: string) {
  await requireOwner();
  const media = await getDb().from("social_post_media").select("sha256").match({ post_id: postId, role: "media" }).order("position").limit(1).maybeSingle();
  if (media.error) throw new Error(`social_post_media: ${media.error.message}`);
  return media.data ? getCreativeProfile(media.data.sha256) : null;
}
