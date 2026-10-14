import { count, firstText, hashtagsFromText, record, rawWithoutKeys, text, unixTimestamp, type JsonRecord } from "../../util.ts";
import type { Json, SocialPlatform, SocialPost, SocialPostKind } from "../../types.ts";
import { normalizeTikTokPost } from "./tiktok/normalize.ts";

/** ScrapeCreators detail endpoint for one post, per platform; each takes `url`. */
export const SINGLE_POST_PATHS: Record<SocialPlatform, string> = {
  instagram: "/v1/instagram/post",
  tiktok: "/v2/tiktok/video",
  facebook: "/v1/facebook/post",
};

export interface SinglePostAuthor {
  platform: SocialPlatform;
  externalId: string | null;
  /** Same handle the account sync stores (Facebook: the numeric profile id). */
  handle: string;
  displayName: string | null;
  raw: Json;
}

export interface ParsedPostUrl {
  platform: SocialPlatform;
  url: string;
  /** Known before fetching: TikTok video id, Facebook reel/video id, or the Instagram shortcode. */
  externalId: string | null;
  shortcode: string | null;
}

const BAD_URL = "Give a link to one Instagram post or reel, TikTok video, or Facebook post or reel";

/** Accepts a single post URL; throws a short user-readable Error otherwise. */
export function parsePostUrl(input: string): ParsedPostUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(BAD_URL);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(BAD_URL);
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const href = url.toString();
  if (host === "instagram.com") {
    const code = url.pathname.match(/^\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([\w-]+)/)?.[1];
    if (!code) throw new Error(BAD_URL);
    return { platform: "instagram", url: href, externalId: null, shortcode: code };
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const id = url.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1] ?? null;
    if (!id && !/^(vm|vt)\./.test(host)) throw new Error(BAD_URL);
    return { platform: "tiktok", url: href, externalId: id, shortcode: null };
  }
  if (host === "facebook.com" || host === "fb.watch") {
    if (url.pathname.startsWith("/ads/library")) throw new Error("That is an Ad Library link; save it as an ad");
    if (host === "facebook.com" && !/^\/(?:reel|videos|watch|share|posts|permalink\.php|story\.php|photo|[^/]+\/(?:posts|videos|photos))\b/.test(url.pathname)) throw new Error(BAD_URL);
    const id = url.pathname.match(/^\/(?:reel|videos)\/(\d+)/)?.[1] ?? url.pathname.match(/^\/[^/]+\/videos\/(\d+)/)?.[1] ?? (url.pathname.startsWith("/watch") ? url.searchParams.get("v") : null);
    return { platform: "facebook", url: href, externalId: id && /^\d+$/.test(id) ? id : null, shortcode: null };
  }
  throw new Error(BAD_URL);
}

function igKind(media: JsonRecord): SocialPostKind {
  if (text(media.product_type) === "clips") return "reel";
  if (text(media.__typename)?.includes("Sidecar")) return "carousel";
  return media.is_video === true ? "video" : "photo";
}

export function normalizeInstagramPostDetail(body: JsonRecord): { author: SinglePostAuthor; post: SocialPost } {
  const media = record(record(body.data)?.xdt_shortcode_media);
  const owner = record(media?.owner);
  const externalId = text(media?.id);
  const handle = text(owner?.username);
  if (!media || !externalId || !handle) throw new Error("Instagram post response has no post");
  const code = text(media.shortcode);
  const caption = text(record(record((record(media.edge_media_to_caption)?.edges as unknown[] | undefined)?.[0])?.node)?.text);
  const music = record(media.clips_music_attribution_info);
  const kind = igKind(media);
  return {
    author: { platform: "instagram", externalId: text(owner?.id), handle, displayName: text(owner?.full_name), raw: {} },
    post: {
      platform: "instagram",
      externalId,
      url: code ? `https://www.instagram.com/${kind === "reel" ? "reel" : "p"}/${code}/` : null,
      kind,
      caption,
      postedAt: unixTimestamp(media.taken_at_timestamp),
      durationS: count(media.video_duration),
      audioId: text(music?.audio_id),
      audioTitle: text(music?.song_name),
      hashtags: hashtagsFromText(caption),
      isPaidPartnership: typeof media.is_paid_partnership === "boolean" ? media.is_paid_partnership : null,
      thumbnailUrl: firstText(media.thumbnail_src, media.display_url),
      videoUrl: text(media.video_url),
      metrics: {
        views: count(media.video_play_count) ?? count(media.video_view_count),
        likes: count(record(media.edge_media_preview_like)?.count),
        comments: count(media.comment_count) ?? count(record(media.edge_media_to_parent_comment)?.count),
        shares: null,
        saves: null,
        extra: {},
      },
      raw: rawWithoutKeys(media, ["video_url", "display_url", "thumbnail_src", "display_resources", "edge_media_to_parent_comment", "edge_media_preview_comment", "owner"]),
    },
  };
}

export function normalizeTikTokPostDetail(body: JsonRecord): { author: SinglePostAuthor; post: SocialPost } {
  const item = record(body.aweme_detail);
  const author = record(item?.author);
  const handle = text(author?.unique_id);
  if (!item || !handle) throw new Error("TikTok video response has no video");
  return {
    author: { platform: "tiktok", externalId: firstText(author?.uid, item.author_user_id), handle, displayName: text(author?.nickname), raw: {} },
    post: normalizeTikTokPost(item, handle),
  };
}

export function normalizeFacebookPostDetail(body: JsonRecord): { author: SinglePostAuthor; post: SocialPost } {
  const video = record(body.video);
  const author = record(body.author);
  const authorId = text(author?.id);
  const externalId = firstText(video?.id, body.post_id);
  if (!externalId || !authorId) throw new Error("Facebook post response has no post");
  const url = text(body.url);
  const length = Number(text(video?.length_in_second) ?? video?.length_in_second);
  const music = record(body.music);
  const caption = text(body.description);
  return {
    author: { platform: "facebook", externalId: authorId, handle: authorId, displayName: text(author?.name), raw: {} },
    post: {
      platform: "facebook",
      externalId,
      url,
      kind: video ? (url?.includes("/reel/") ? "reel" : "video") : "post",
      caption,
      postedAt: text(body.creation_time),
      durationS: Number.isFinite(length) && length > 0 ? length : null,
      audioId: text(music?.id),
      audioTitle: text(music?.track_title),
      hashtags: hashtagsFromText(caption),
      isPaidPartnership: null,
      thumbnailUrl: firstText(video?.thumbnail, body.image_url),
      videoUrl: firstText(video?.hd_url, video?.sd_url),
      metrics: {
        views: count(body.view_count),
        likes: count(body.like_count),
        comments: count(body.comment_count),
        shares: count(body.share_count),
        saves: null,
        extra: {},
      },
      raw: rawWithoutKeys(body, ["success", "credits_remaining", "credits_charged", "video", "author", "music"]),
    },
  };
}

export const normalizePostDetail: Record<SocialPlatform, (body: JsonRecord) => { author: SinglePostAuthor; post: SocialPost }> = {
  instagram: normalizeInstagramPostDetail,
  tiktok: normalizeTikTokPostDetail,
  facebook: normalizeFacebookPostDetail,
};
