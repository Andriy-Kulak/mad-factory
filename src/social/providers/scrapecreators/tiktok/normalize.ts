import { count, firstText, hashtagsFromText, record, rawWithoutKeys, text, unixTimestamp } from "../../../util.ts";
import type { Json, SocialPost, SocialProfile } from "../../../types.ts";

type JsonRecord = Record<string, unknown>;

export function normalizeTikTokProfile(body: JsonRecord): SocialProfile {
  const user = record(body.user);
  const stats = record(body.stats);
  const externalId = text(user?.id);
  const handle = text(user?.uniqueId);
  if (!user || !externalId || !handle) {
    throw new Error("TikTok profile response is missing user.id or user.uniqueId");
  }

  const normalizedHandle = handle.toLowerCase();
  return {
    platform: "tiktok",
    externalId,
    handle: normalizedHandle,
    displayName: text(user.nickname),
    bio: text(user.signature),
    avatarUrl: text(user.avatarLarger),
    url: `https://www.tiktok.com/@${normalizedHandle}`,
    followers: count(stats?.followerCount),
    following: count(stats?.followingCount),
    postsCount: count(stats?.videoCount),
    totalLikes: count(stats?.heartCount),
    raw: {
      verified: typeof user.verified === "boolean" ? user.verified : null,
    },
  };
}

function extraCount(source: JsonRecord, key: string): Record<string, number> {
  const value = count(source[key]);
  return value === null ? {} : { [key]: value };
}

function firstUrl(parent: unknown, key: string): string | null {
  const list = record(parent)?.[key];
  return Array.isArray(list) && list.length ? text(list[0]) : null;
}

function firstImageUrl(parent: unknown, key: string): string | null {
  const list = record(parent)?.[key];
  if (!Array.isArray(list)) return null;
  const urls = list.map(text).filter((url): url is string => url !== null);
  return urls.find((url) => /\.(?:jpeg|jpg|webp|png)$/i.test(url.split("?", 1)[0] ?? "")) ?? urls[0] ?? null;
}

export function normalizeTikTokPost(item: JsonRecord, handle: string): SocialPost {
  const externalId = text(item.aweme_id);
  if (!externalId) throw new Error("TikTok video is missing aweme_id");

  const video = record(item.video);
  const statistics = record(item.statistics) ?? {};
  const music = record(item.music);
  const caption = text(item.desc);
  const durationMs = count(video?.duration);

  return {
    platform: "tiktok",
    externalId,
    url: `https://www.tiktok.com/@${handle}/video/${externalId}`,
    kind: "video",
    caption,
    postedAt: unixTimestamp(item.create_time),
    durationS: durationMs === null ? null : durationMs / 1000,
    audioId: firstText(music?.id_str, music?.id),
    audioTitle: text(music?.title),
    hashtags: hashtagsFromText(caption),
    isPaidPartnership: null,
    thumbnailUrl: firstImageUrl(record(video?.cover), "url_list"),
    videoUrl: firstUrl(record(video?.play_addr), "url_list"),
    metrics: {
      views: count(statistics.play_count),
      likes: count(statistics.digg_count),
      comments: count(statistics.comment_count),
      shares: count(statistics.share_count),
      saves: count(statistics.collect_count),
      extra: {
        ...extraCount(statistics, "repost_count"),
        ...extraCount(statistics, "download_count"),
        ...extraCount(statistics, "whatsapp_share_count"),
      },
    },
    raw: rawWithoutKeys(item, ["video", "image_post_info", "music", "author"]) as Json,
  };
}
