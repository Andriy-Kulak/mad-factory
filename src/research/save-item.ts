import { getDb } from "../db/client.ts";
import { getAd } from "../db/ads.ts";
import { upsertSocialAccount, upsertSocialPost, upsertSocialPostSnapshot } from "../db/social.ts";
import { scrapeCreatorsGet } from "../lib/scrapecreators.ts";
import { r2Enabled } from "../lib/storage.ts";
import { ingestAd } from "../scrape/ingest.ts";
import { normalizeAdDetail, parseAdIdInput } from "../sources/meta/normalize.ts";
import { normalizePostDetail, parsePostUrl, SINGLE_POST_PATHS } from "../social/providers/scrapecreators/single-post.ts";
import { getSocialStore } from "../social/store.ts";
import { savePostMedia, type SyncStats } from "../social/sync.ts";

/** One ad or post saved without following its page or account. `credits` is what ScrapeCreators charged (0 when it was already stored). */
export interface SavedItem {
  kind: "ad" | "post";
  id: string;
  credits: number;
  /** false when R2 isn't configured or the media download failed; the text and numbers are saved either way. */
  mediaStored: boolean;
  alreadyStored: boolean;
}

/** Saves one Ad Library ad by id or link and links it to the product with no tracked source (it shows in competitor ads). */
export async function saveAd(productId: string, input: string): Promise<SavedItem> {
  const adId = parseAdIdInput(input);
  const existing = await getAd("meta", adId);
  if (existing) {
    // Keep any tracked-source link the daily sync already made.
    const link = await getDb().from("product_ads").select("ad_id").match({ product_id: productId, ad_id: existing.id }).maybeSingle();
    if (link.error) throw new Error(`product_ads: ${link.error.message}`);
    if (!link.data) {
      const res = await getDb().from("product_ads").insert({ product_id: productId, ad_id: existing.id, tracked_source_id: null });
      if (res.error) throw new Error(`product_ads: ${res.error.message}`);
    }
    return { kind: "ad", id: existing.id, credits: 0, mediaStored: true, alreadyStored: true };
  }
  const { body, creditsCharged } = await scrapeCreatorsGet("/v1/facebook/adLibrary/ad", { id: adId });
  const ad = normalizeAdDetail(body);
  const stats = { adsSeen: 0, adsNew: 0, creativesNew: 0 };
  const id = await ingestAd(ad, { productId, trackedSourceId: null, downloadMedia: r2Enabled, preferSd: false }, stats);
  return { kind: "ad", id, credits: creditsCharged, mediaStored: r2Enabled && ad.media.length > 0, alreadyStored: false };
}

async function storedPostId(platform: string, externalId: string | null, shortcode: string | null): Promise<string | null> {
  if (!externalId && !shortcode) return null;
  let q = getDb().from("social_posts").select("id").eq("platform", platform);
  q = externalId ? q.eq("external_id", externalId) : q.like("url", `%/${shortcode!.replace(/[\\%_]/g, "\\$&")}/%`);
  const res = await q.limit(1).maybeSingle();
  if (res.error) throw new Error(`social_posts: ${res.error.message}`);
  return res.data?.id ?? null;
}

/** Saves one Instagram, TikTok or Facebook post by link. Its account row is created if missing, but no tracked source is added. */
export async function savePost(input: string): Promise<SavedItem> {
  const parsed = parsePostUrl(input);
  const known = await storedPostId(parsed.platform, parsed.externalId, parsed.shortcode);
  if (known) return { kind: "post", id: known, credits: 0, mediaStored: true, alreadyStored: true };

  const { body, creditsCharged } = await scrapeCreatorsGet(SINGLE_POST_PATHS[parsed.platform], { url: parsed.url });
  const { author, post } = normalizePostDetail[parsed.platform](body);
  const db = getDb();
  const acc = await db.from("social_accounts").select("id").match({ platform: author.platform, handle: author.handle }).maybeSingle();
  if (acc.error) throw new Error(`social_accounts: ${acc.error.message}`);
  // An existing account keeps its synced profile; only a new one gets this minimal row.
  const accountId =
    acc.data?.id ?? (await upsertSocialAccount({ platform: author.platform, external_id: author.externalId, handle: author.handle, display_name: author.displayName, raw: author.raw })).id;
  const saved = await upsertSocialPost({
    account_id: accountId,
    platform: post.platform,
    external_id: post.externalId,
    url: post.url,
    kind: post.kind,
    caption: post.caption,
    posted_at: post.postedAt,
    duration_s: post.durationS,
    audio_id: post.audioId,
    audio_title: post.audioTitle,
    hashtags: post.hashtags,
    is_paid_partnership: post.isPaidPartnership,
    raw: post.raw,
    last_synced_at: new Date().toISOString(),
  });
  await upsertSocialPostSnapshot({
    post_id: saved.id,
    captured_on: new Date().toISOString().slice(0, 10),
    source: "scrape",
    views: post.metrics.views,
    likes: post.metrics.likes,
    comments: post.metrics.comments,
    shares: post.metrics.shares,
    saves: post.metrics.saves,
    metrics: post.metrics.extra,
  });
  const stats: SyncStats = { postsSeen: 1, postsNew: 1, mediaStored: 0, creativesNew: 0, mediaFailures: [] };
  if (r2Enabled) await savePostMedia(saved.id, post, getSocialStore(), stats);
  return { kind: "post", id: saved.id, credits: creditsCharged, mediaStored: stats.mediaStored > 0, alreadyStored: !saved.isNew };
}
