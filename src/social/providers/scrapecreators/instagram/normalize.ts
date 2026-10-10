import {
  count,
  firstText,
  hashtagsFromText,
  record,
  rawWithoutKeys,
  text,
  unixTimestamp,
} from "../../../util.ts";
import type { Json, SocialPost, SocialProfile } from "../../../types.ts";

type JsonRecord = Record<string, unknown>;

function nestedCount(user: JsonRecord, key: string): number | null {
  return count(record(user[key])?.count);
}

function firstMediaUrl(value: unknown, key: string): string | null {
  const candidates = record(value)?.[key];
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return text(record(candidates[0])?.url);
}

export function normalizeInstagramProfile(body: JsonRecord): SocialProfile {
  const user = record(record(body.data)?.user);
  const externalId = text(user?.id);
  const handle = text(user?.username);
  if (!user || !externalId || !handle) {
    throw new Error("Instagram profile response is missing data.user.id or data.user.username");
  }

  const normalizedHandle = handle.toLowerCase();
  return {
    platform: "instagram",
    externalId,
    handle: normalizedHandle,
    displayName: text(user.full_name),
    bio: text(user.biography),
    avatarUrl: text(user.profile_pic_url_hd),
    url: `https://www.instagram.com/${normalizedHandle}/`,
    followers: nestedCount(user, "edge_followed_by"),
    following: nestedCount(user, "edge_follow"),
    postsCount: nestedCount(user, "edge_owner_to_timeline_media"),
    totalLikes: null,
    raw: {
      is_verified: typeof user.is_verified === "boolean" ? user.is_verified : null,
      is_professional_account: typeof user.is_professional_account === "boolean" ? user.is_professional_account : null,
      is_business_account: typeof user.is_business_account === "boolean" ? user.is_business_account : null,
      category_name: text(user.category_name),
      external_url: text(user.external_url),
    },
  };
}

export function normalizeInstagramPost(item: JsonRecord): SocialPost {
  const id = typeof item.id === "string" ? item.id.split("_")[0] : null;
  const externalId = id || (typeof item.pk === "string" ? item.pk : null);
  if (!externalId) throw new Error("Instagram reel is missing a string id");

  const code = text(item.code);
  const caption = text(record(item.caption)?.text);
  const clipsMetadata = record(item.clips_metadata);
  const musicInfo = record(clipsMetadata?.music_info);
  const musicAssetInfo = record(musicInfo?.music_asset_info);
  const originalSoundInfo = record(clipsMetadata?.original_sound_info);

  return {
    platform: "instagram",
    externalId,
    url: code ? `https://www.instagram.com/reel/${code}/` : null,
    kind: "reel",
    caption,
    postedAt: unixTimestamp(item.taken_at),
    durationS: count(item.video_duration),
    audioId: firstText(
      musicInfo?.audio_id,
      musicInfo?.music_canonical_id,
      musicAssetInfo?.audio_id,
      musicAssetInfo?.music_canonical_id,
      originalSoundInfo?.audio_asset_id,
    ),
    audioTitle: firstText(
      musicInfo?.title,
      musicInfo?.song_name,
      musicAssetInfo?.title,
      originalSoundInfo?.original_audio_title,
    ),
    hashtags: hashtagsFromText(caption),
    isPaidPartnership: typeof item.is_paid_partnership === "boolean" ? item.is_paid_partnership : null,
    thumbnailUrl: firstMediaUrl(item.image_versions2, "candidates") ?? text(item.display_uri),
    videoUrl: firstText(record(Array.isArray(item.video_versions) ? item.video_versions[0] : null)?.url),
    metrics: {
      views: count(item.play_count) ?? count(item.ig_play_count),
      likes: count(item.like_count),
      comments: count(item.comment_count),
      shares: count(item.share_count),
      saves: count(item.save_count),
      extra: {},
    },
    raw: rawWithoutKeys(item, ["video_dash_manifest", "video_versions", "image_versions2", "carousel_media"]) as Json,
  };
}
