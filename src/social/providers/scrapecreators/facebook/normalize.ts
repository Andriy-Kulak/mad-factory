import { count, record, rawWithoutKeys, text } from "../../../util.ts";
import type { Json, SocialPost, SocialProfile } from "../../../types.ts";

type JsonRecord = Record<string, unknown>;

export function normalizeFacebookProfile(body: JsonRecord): SocialProfile {
  const externalId = text(body.id);
  if (!externalId) throw new Error("Facebook profile response is missing id");

  const profileUrl = text(body.url);
  return {
    platform: "facebook",
    externalId,
    handle: externalId,
    displayName: text(body.name),
    bio: text(body.pageIntro),
    avatarUrl: text(body.profilePicLarge),
    url: profileUrl,
    followers: count(body.followerCount),
    following: null,
    postsCount: null,
    totalLikes: count(body.likeCount),
    raw: {
      category: text(body.category),
      talkingAboutCount: count(body.talkingAboutCount),
    },
  };
}

export function normalizeFacebookReel(item: JsonRecord): SocialPost {
  const externalId = text(item.video_id);
  if (!externalId) throw new Error("Facebook reel is missing video_id");

  const music = record(item.music);
  const durationMs = count(item.play_time_in_ms);
  return {
    platform: "facebook",
    externalId,
    url: text(item.url),
    kind: "reel",
    caption: text(item.description),
    postedAt: text(item.creation_time),
    durationS: durationMs === null ? null : durationMs / 1000,
    audioId: text(music?.id),
    audioTitle: text(music?.track_title),
    hashtags: [],
    isPaidPartnership: null,
    thumbnailUrl: text(item.thumbnail),
    videoUrl: text(item.video_url),
    metrics: {
      views: count(item.view_count),
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      extra: {},
    },
    raw: rawWithoutKeys(item, ["thumbnail", "video_url", "author"]) as Json,
  };
}
