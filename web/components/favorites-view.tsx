"use client";

import { useMemo, useState } from "react";
import { sortAdCards, type AdCard, type AdSort } from "@/lib/ad-cards";
import type { OrganicAccount, OrganicPost, OrganicSort } from "@/lib/social";
import { sortPosts } from "@/lib/organic-filters";
import { byRecentlyStarred } from "@/lib/favorite-sort";
import { AdGrid, AdPreview, type Favorites } from "@/components/ad-card";
import { PostGrid, PostPreview } from "@/components/post-grid";
import { Toggle, useFavoriteSet } from "@/components/controls";
import { setFavorite } from "@/lib/favorite-actions";
import { useInvalidateProduct } from "@/lib/use-tab";
import { Empty, SectionHead } from "@/components/ui";
import { AD_SORTS } from "@/components/ad-browser";
import { ORGANIC_SORTS } from "@/components/organic-browser";

type Show = "all" | "ads" | "posts";
type AdSortKey = "starred" | AdSort;
type PostSortKey = "starred" | OrganicSort;

const AD_SORT_ITEMS: { key: AdSortKey; label: string }[] = [{ key: "starred", label: "Recently starred" }, ...AD_SORTS];
const POST_SORT_ITEMS: { key: PostSortKey; label: string }[] = [{ key: "starred", label: "Recently starred" }, ...ORGANIC_SORTS];

/** Starred ads and posts side by side. Unstarring keeps the card on screen until the next visit, like the Favorites filters. */
export function FavoritesView({
  ads,
  posts,
  accounts,
  slug,
  productId,
  adStarredAt,
  postStarredAt,
  now,
}: {
  ads: AdCard[];
  posts: OrganicPost[];
  accounts: OrganicAccount[];
  slug: string;
  productId: string;
  adStarredAt: Record<string, string>;
  postStarredAt: Record<string, string>;
  now: number;
}) {
  const [show, setShow] = useState<Show>("all");
  const [adSort, setAdSort] = useState<AdSortKey>("starred");
  const [postSort, setPostSort] = useState<PostSortKey>("starred");
  const invalidateProduct = useInvalidateProduct();
  const [openAd, setOpenAd] = useState<string | null>(null);
  const [openPost, setOpenPost] = useState<string | null>(null);
  const [adFavs, setAdFavs] = useFavoriteSet(Object.keys(adStarredAt), async (ids, on) => {
    await setFavorite(productId, "ad", ids, on);
    await invalidateProduct(productId);
  });
  const [postFavs, setPostFavs] = useFavoriteSet(Object.keys(postStarredAt), async (ids, on) => {
    await setFavorite(productId, "post", ids, on);
    await invalidateProduct(productId);
  });
  const isAdFav = (a: AdCard) => a.memberIds.some((id) => adFavs.has(id));
  const adFav: Favorites<AdCard> = { has: isAdFav, toggle: (a) => (isAdFav(a) ? setAdFavs(a.memberIds, false) : setAdFavs([a.id], true)) };
  const postFav: Favorites<OrganicPost> = { has: (p) => postFavs.has(p.id), toggle: (p) => setPostFavs([p.id], !postFavs.has(p.id)) };
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const sortedAds = useMemo(() => (adSort === "starred" ? byRecentlyStarred(ads, (a) => a.memberIds, adStarredAt) : sortAdCards(ads, adSort)), [ads, adSort, adStarredAt]);
  const sortedPosts = useMemo(() => (postSort === "starred" ? byRecentlyStarred(posts, (p) => [p.id], postStarredAt) : sortPosts(posts, postSort)), [posts, postSort, postStarredAt]);

  const adIndex = openAd ? sortedAds.findIndex((a) => a.id === openAd) : -1;
  const postIndex = openPost ? sortedPosts.findIndex((p) => p.id === openPost) : -1;
  const ad = adIndex >= 0 ? sortedAds[adIndex]! : null;
  const post = postIndex >= 0 ? sortedPosts[postIndex]! : null;

  if (!ads.length && !posts.length) return <Empty>Nothing starred yet. Star an ad on Competitor ads or a post on Organic, or save one by link above.</Empty>;

  return (
    <>
      <div className="mb-5">
        <Toggle
          label="Show"
          items={[
            { key: "all", label: "All" },
            { key: "ads", label: `Ads (${ads.length})` },
            { key: "posts", label: `Posts (${posts.length})` },
          ]}
          active={show}
          onChange={setShow}
        />
      </div>
      {show !== "posts" && (
        <section className="mb-8">
          <SectionHead right={ads.length ? <Toggle size="sm" label="Sort ads" items={AD_SORT_ITEMS} active={adSort} onChange={setAdSort} /> : null}>Competitor ads ({ads.length})</SectionHead>
          {sortedAds.length ? <AdGrid ads={sortedAds} slug={slug} onOpen={setOpenAd} fav={adFav} /> : <Empty>No starred ads yet.</Empty>}
        </section>
      )}
      {show !== "ads" && (
        <section>
          <SectionHead right={posts.length ? <Toggle size="sm" label="Sort posts" items={POST_SORT_ITEMS} active={postSort} onChange={setPostSort} /> : null}>
            Organic posts ({posts.length})
          </SectionHead>
          {sortedPosts.length ? <PostGrid posts={sortedPosts} now={now} onOpen={setOpenPost} fav={postFav} /> : <Empty>No starred posts yet.</Empty>}
        </section>
      )}
      <AdPreview
        ad={ad}
        slug={slug}
        fav={adFav}
        position={ad ? `${adIndex + 1} / ${sortedAds.length}` : ""}
        onClose={() => setOpenAd(null)}
        onPrev={adIndex > 0 ? () => setOpenAd(sortedAds[adIndex - 1]!.id) : null}
        onNext={adIndex >= 0 && adIndex < sortedAds.length - 1 ? () => setOpenAd(sortedAds[adIndex + 1]!.id) : null}
      />
      <PostPreview
        post={post}
        account={post ? (accountById.get(post.account.id) ?? null) : null}
        now={now}
        fav={postFav}
        position={post ? `${postIndex + 1} / ${sortedPosts.length}` : ""}
        onClose={() => setOpenPost(null)}
        onPrev={postIndex > 0 ? () => setOpenPost(sortedPosts[postIndex - 1]!.id) : null}
        onNext={postIndex >= 0 && postIndex < sortedPosts.length - 1 ? () => setOpenPost(sortedPosts[postIndex + 1]!.id) : null}
      />
    </>
  );
}
