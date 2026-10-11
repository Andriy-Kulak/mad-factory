"use server";

import { requireOwner } from "./auth/server";
import { getDb } from "./db";
import { getCreativeProfile } from "./creatives";

/** Spoken words of a stored video, from its creative profile; null when it hasn't been transcribed. */
export async function loadMediaTranscript(sha256: string): Promise<string | null> {
  await requireOwner();
  return (await getCreativeProfile(sha256))?.script?.transcript ?? null;
}

/** An organic post's transcript: the post's own ("" = no speech), else its video's creative profile. */
export async function loadPostTranscript(postId: string): Promise<string | null> {
  await requireOwner();
  const db = getDb();
  const [post, media] = await Promise.all([
    db.from("social_posts").select("transcript").eq("id", postId).maybeSingle(),
    db.from("social_post_media").select("sha256").match({ post_id: postId, role: "media" }).order("position").limit(1).maybeSingle(),
  ]);
  if (post.error) throw new Error(`social_posts: ${post.error.message}`);
  if (media.error) throw new Error(`social_post_media: ${media.error.message}`);
  if (post.data && post.data.transcript !== null) return post.data.transcript;
  return media.data ? ((await getCreativeProfile(media.data.sha256))?.script?.transcript ?? null) : null;
}
