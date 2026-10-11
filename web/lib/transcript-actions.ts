"use server";

import { requireOwner } from "./auth/server";
import { getDb } from "./db";
import { getCreativeProfile } from "./creatives";
import { completeGemini, latestFlashModel } from "../../src/creative-profiles/gemini.ts";
import { stripFences } from "../../src/creative-profiles/profile.ts";
import { download } from "../../src/lib/storage.ts";

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

const MAX_BYTES = 20 * 1024 * 1024;
const PROMPT = `Transcribe every word spoken in this video, verbatim, in the language spoken. Put each speaker turn or sentence group on its own line. Leave out on-screen text, music and sound effects.
Return JSON only: {"transcript": "<the words>"}. Use an empty string when nobody speaks.`;
let flashModel: Promise<string> | null = null;

/** Transcribes an organic post's video with Gemini Flash (one call) and saves it to `social_posts.transcript`. */
export async function transcribePost(postId: string): Promise<{ transcript: string } | { error: string }> {
  await requireOwner();
  if (!process.env.GEMINI_API_KEY) return { error: "Add GEMINI_API_KEY to the web host to transcribe." };
  const db = getDb();
  const media = await db.from("social_post_media").select("sha256").match({ post_id: postId, role: "media" }).order("position").limit(1).maybeSingle();
  if (media.error) throw new Error(`social_post_media: ${media.error.message}`);
  if (!media.data) return { error: "This post has no stored video." };
  const creative = await db.from("creatives").select("media_type,public_url,bytes").eq("sha256", media.data.sha256).maybeSingle();
  if (creative.error) throw new Error(`creatives: ${creative.error.message}`);
  const c = creative.data;
  if (!c || c.media_type !== "video" || !c.public_url) return { error: "This post has no stored video." };
  if (c.bytes > MAX_BYTES) return { error: "The video is over 20 MB, too big to transcribe." };
  try {
    flashModel ??= latestFlashModel().catch((e) => {
      flashModel = null;
      throw e;
    });
    const b64 = (await download(c.public_url)).toString("base64");
    const reply = await completeGemini(
      [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "file", file: { filename: "post.mp4", file_data: `data:video/mp4;base64,${b64}` } }] }],
      { model: await flashModel },
    );
    const parsed = JSON.parse(stripFences(reply.content)) as { transcript?: unknown };
    if (typeof parsed.transcript !== "string") return { error: "Gemini didn't return a transcript. Try again." };
    const transcript = parsed.transcript.trim();
    const saved = await db.from("social_posts").update({ transcript }).eq("id", postId);
    if (saved.error) throw new Error(`social_posts: ${saved.error.message}`);
    return { transcript };
  } catch (error) {
    console.error("transcribePost", postId, error);
    return { error: "Transcription failed. Try again." };
  }
}
