import "server-only";
import { cachedByProduct } from "./cache";
import { fetchAll } from "./apple-ads";
import { getDb } from "./db";
import { favoriteIds } from "./favorites";
import { engagementRate, median, outlierScore, snapshotPair } from "./social-score.ts";

export const SOCIAL_PLATFORMS = ["instagram", "tiktok", "facebook"] as const;
export type SocialPlatformKey = (typeof SOCIAL_PLATFORMS)[number];
export type OrganicSort = "outlier" | "views" | "newest" | "engagement";

export interface OrganicAccount {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  /** tracked_sources.label, used to group one person's or brand's accounts across platforms. */
  label: string | null;
  relation: string;
  profileUrl: string | null;
  avatarUrl: string | null;
  followers: number | null;
  followersPrev: number | null;
  prevCapturedOn: string | null;
  postsTracked: number;
  medianViews: number | null;
  lastSyncedAt: string | null;
}

export interface OrganicPost {
  id: string;
  account: Pick<OrganicAccount, "id" | "handle" | "displayName" | "label" | "platform" | "relation">;
  url: string | null;
  kind: string;
  caption: string | null;
  postedAt: string | null;
  durationS: number | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  views: number | null;
  viewsPrev: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  engagement: number | null;
  outlier: number | null;
}

export interface OrganicFilter {
  /** tracked_sources config.relation values to include, e.g. ["own"]; all when omitted. */
  relations?: string[];
  /** social_posts.kind values to include, e.g. ["reel", "video"]; all when omitted. */
  kinds?: string[];
}

function fail(ctx: string, e: { message: string } | null): never {
  throw new Error(`${ctx}: ${e?.message ?? "unknown error"}`);
}

/** Runs `fn` over `.in()`-sized slices so URLs stay short and each request stays under PostgREST's 1000-row cap. */
async function starredPostIds(productId: string): Promise<string[]> {
  return favoriteIds(productId, "post");
}

async function inChunks<T>(ids: string[], fn: (ids: string[]) => Promise<T[]>, size = 50): Promise<T[]> {
  const out: Promise<T[]>[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(fn(ids.slice(i, i + size)));
  return (await Promise.all(out)).flat();
}

function profileUrl(platform: string, handle: string, trackedValue: string): string | null {
  if (/^https?:\/\//.test(trackedValue)) return trackedValue;
  if (platform === "instagram") return `https://www.instagram.com/${handle}/`;
  if (platform === "tiktok") return `https://www.tiktok.com/@${handle}`;
  return null;
}

interface TrackedAccount {
  platform: string;
  value: string;
  label: string | null;
  relation: string;
  accountId: string | null;
}

/**
 * Social accounts tracked by a product (tracked_sources kind='account' on a social platform) and their stored posts,
 * each scored against its own account's median views.
 */
export async function organicOverview(productId: string, filter: OrganicFilter = {}): Promise<{ accounts: OrganicAccount[]; posts: OrganicPost[] }> {
  const db = getDb();
  const srcRes = await db
    .from("tracked_sources")
    .select("source,value,label,config")
    .eq("product_id", productId)
    .eq("kind", "account")
    .eq("enabled", true)
    .in("source", [...SOCIAL_PLATFORMS]);
  if (srcRes.error) fail("tracked_sources", srcRes.error);
  const tracked: TrackedAccount[] = [];
  for (const s of srcRes.data ?? []) {
    const cfg = s.config && typeof s.config === "object" && !Array.isArray(s.config) ? s.config : {};
    const relation = typeof cfg.relation === "string" ? cfg.relation : "inspiration";
    if (filter.relations && !filter.relations.includes(relation)) continue;
    tracked.push({
      platform: s.source,
      value: s.value,
      label: s.label,
      relation,
      accountId: typeof cfg.account_id === "string" ? cfg.account_id : null,
    });
  }
  // Starred posts from accounts nobody follows (saved one at a time) count as competitor posts, like saved ads.
  const savedPostIds = !filter.relations || filter.relations.includes("competitor") ? await starredPostIds(productId) : [];
  if (!tracked.length && !savedPostIds.length) return { accounts: [], posts: [] };

  // The sync writes config.account_id; sources synced before that are matched on platform + handle.
  const byId = new Map(tracked.filter((t) => t.accountId).map((t) => [t.accountId!, t]));
  const byHandle = new Map(tracked.filter((t) => !t.accountId).map((t) => [`${t.platform}:${t.value}`, t]));
  const cols = "id,platform,handle,display_name,last_synced_at,avatar_sha256";
  const [idRows, handleRows] = await Promise.all([
    byId.size
      ? db
          .from("social_accounts")
          .select(cols)
          .in("id", [...byId.keys()])
      : Promise.resolve({ data: [], error: null }),
    byHandle.size
      ? db
          .from("social_accounts")
          .select(cols)
          .in("handle", [...new Set([...byHandle.values()].map((t) => t.value))])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (idRows.error) fail("social_accounts", idRows.error);
  if (handleRows.error) fail("social_accounts", handleRows.error);
  const accRows = [
    ...(idRows.data ?? []).map((a) => ({ a, t: byId.get(a.id)! })),
    ...(handleRows.data ?? []).flatMap((a) => {
      const t = byHandle.get(`${a.platform}:${a.handle}`);
      return t && !byId.has(a.id) ? [{ a, t }] : [];
    }),
  ];
  const savedOnly = new Set<string>();
  if (savedPostIds.length) {
    const seen = new Set(accRows.map(({ a }) => a.id));
    const owners = await inChunks(savedPostIds, async (ids) => {
      const r = await db.from("social_posts").select("account_id").in("id", ids);
      if (r.error) fail("social_posts", r.error);
      return r.data ?? [];
    });
    const missing = [...new Set(owners.map((o) => o.account_id))].filter((id) => !seen.has(id));
    const extra = await inChunks(missing, async (ids) => {
      const r = await db.from("social_accounts").select(cols).in("id", ids);
      if (r.error) fail("social_accounts", r.error);
      return r.data ?? [];
    });
    for (const a of extra) {
      savedOnly.add(a.id);
      accRows.push({ a, t: { platform: a.platform, value: a.handle, label: null, relation: "competitor", accountId: a.id } });
    }
  }
  if (!accRows.length) return { accounts: [], posts: [] };
  const accIds = accRows.map(({ a }) => a.id);
  const savedSet = new Set(savedPostIds);

  const [accSnaps, postRows] = await Promise.all([
    inChunks(accIds, async (ids) => {
      return fetchAll(
        (from, to) => db.from("social_account_snapshots").select("account_id,captured_on,followers").in("account_id", ids).order("account_id").order("captured_on").range(from, to),
        "social_account_snapshots",
      );
    }),
    inChunks(accIds, async (ids) => {
      let q = db.from("social_posts").select("id,account_id,url,kind,caption,posted_at,duration_s").in("account_id", ids);
      if (filter.kinds) q = q.in("kind", filter.kinds);
      return fetchAll((from, to) => q.order("posted_at", { ascending: false }).order("id").range(from, to), "social_posts");
    }),
  ]);
  const keptPosts = postRows.filter((p) => !savedOnly.has(p.account_id) || savedSet.has(p.id));
  const postIds = keptPosts.map((p) => p.id);
  const [postSnaps, media] = await Promise.all([
    inChunks(postIds, async (ids) => {
      return fetchAll(
        (from, to) => db.from("social_post_snapshots").select("post_id,captured_on,source,views,likes,comments,shares,saves").in("post_id", ids).order("post_id").order("captured_on").range(from, to),
        "social_post_snapshots",
      );
    }),
    inChunks(postIds, async (ids) => {
      return fetchAll((from, to) => db.from("social_post_media").select("post_id,role,sha256").in("post_id", ids).order("post_id").order("role").range(from, to), "social_post_media");
    }),
  ]);
  const shas = [...new Set([...media.map((m) => m.sha256), ...accRows.flatMap(({ a }) => (a.avatar_sha256 ? [a.avatar_sha256] : []))])];
  const creatives = await inChunks(shas, async (ids) => {
    const r = await db.from("creatives").select("sha256,public_url").in("sha256", ids);
    if (r.error) fail("creatives", r.error);
    return r.data ?? [];
  });
  const publicUrl = new Map(creatives.map((c) => [c.sha256, c.public_url]));

  const accounts = new Map<string, OrganicAccount>();
  for (const { a, t } of accRows) {
    const snaps = accSnaps.filter((x) => x.account_id === a.id).sort((x, y) => y.captured_on.localeCompare(x.captured_on));
    accounts.set(a.id, {
      id: a.id,
      platform: a.platform,
      handle: a.handle,
      displayName: a.display_name,
      label: t.label,
      relation: t.relation,
      profileUrl: profileUrl(a.platform, a.handle, t.value),
      avatarUrl: a.avatar_sha256 ? (publicUrl.get(a.avatar_sha256) ?? null) : null,
      followers: snaps[0]?.followers ?? null,
      followersPrev: snaps[1]?.followers ?? null,
      prevCapturedOn: snaps[1]?.captured_on ?? null,
      postsTracked: 0,
      medianViews: null,
      lastSyncedAt: a.last_synced_at,
    });
  }

  const raw = keptPosts.map((p) => {
    const { latest, previous } = snapshotPair(postSnaps.filter((x) => x.post_id === p.id));
    const url = (role: string) => {
      const m = media.find((x) => x.post_id === p.id && x.role === role);
      return m ? (publicUrl.get(m.sha256) ?? null) : null;
    };
    return { p, snap: latest, prev: previous, thumb: url("thumbnail"), video: url("media") };
  });
  const viewsByAccount = new Map<string, number[]>();
  for (const { p, snap } of raw) {
    accounts.get(p.account_id)!.postsTracked++;
    if (snap?.views != null) viewsByAccount.set(p.account_id, [...(viewsByAccount.get(p.account_id) ?? []), snap.views]);
  }
  // A few hand-picked posts are no baseline for an account's normal views.
  for (const [id, views] of viewsByAccount) if (!savedOnly.has(id)) accounts.get(id)!.medianViews = median(views);

  const posts: OrganicPost[] = raw.map(({ p, snap, prev, thumb, video }) => {
    const acc = accounts.get(p.account_id)!;
    const views = snap?.views ?? null;
    const likes = snap?.likes ?? null;
    const comments = snap?.comments ?? null;
    const shares = snap?.shares ?? null;
    const saves = snap?.saves ?? null;
    return {
      id: p.id,
      account: { id: acc.id, handle: acc.handle, displayName: acc.displayName, label: acc.label, platform: acc.platform, relation: acc.relation },
      url: p.url,
      kind: p.kind,
      caption: p.caption,
      postedAt: p.posted_at,
      durationS: p.duration_s,
      thumbnailUrl: thumb,
      videoUrl: video,
      views,
      viewsPrev: prev?.views ?? null,
      likes,
      comments,
      shares,
      saves,
      engagement: engagementRate(views, likes, comments, shares, saves),
      outlier: outlierScore(views, acc.medianViews),
    };
  });

  return { accounts: [...accounts.values()].filter((a) => !savedOnly.has(a.id)).sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0)), posts };
}

export const organicOverviewCached = cachedByProduct("organicOverview", organicOverview);
