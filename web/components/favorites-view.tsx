"use client";

import { useMemo, useState } from "react";
import type { AdCard } from "@/lib/ad-cards";
import type { OrganicAccount, OrganicPost } from "@/lib/social";
import { AdGrid, AdPreview, type Favorites } from "@/components/ad-card";
import { PostGrid, PostPreview } from "@/components/post-grid";
import { Toggle, useFavoriteSet } from "@/components/controls";
import { setFavorite } from "@/lib/favorite-actions";
import { useInvalidateProduct } from "@/lib/use-tab";
import { Empty, SectionHead } from "@/components/ui";

type Show = "all" | "ads" | "posts";

/** Starred ads and posts side by side. Unstarring keeps the card on screen until the next visit, like the Favorites filters. */
export function FavoritesView({
  ads,
  posts,
  accounts,
  slug,
  productId,
  adFavoriteIds,
  postFavoriteIds,
  now,
}: {
  ads: AdCard[];
  posts: OrganicPost[];
  accounts: OrganicAccount[];
  slug: string;
  productId: string;
  adFavoriteIds: string[];
  postFavoriteIds: string[];
  now: number;
}) {
  const [show, setShow] = useState<Show>("all");
  const invalidateProduct = useInvalidateProduct();
  const [openAd, setOpenAd] = useState<string | null>(null);
  const [openPost, setOpenPost] = useState<string | null>(null);
  const [adFavs, setAdFavs] = useFavoriteSet(adFavoriteIds, async (ids, on) => {
    await setFavorite(productId, "ad", ids, on);
    await invalidateProduct(productId);
  });
  const [postFavs, setPostFavs] = useFavoriteSet(postFavoriteIds, async (ids, on) => {
    await setFavorite(productId, "post", ids, on);
    await invalidateProduct(productId);
  });
  const isAdFav = (a: AdCard) => a.memberIds.some((id) => adFavs.has(id));
  const adFav: Favorites<AdCard> = { has: isAdFav, toggle: (a) => (isAdFav(a) ? setAdFavs(a.memberIds, false) : setAdFavs([a.id], true)) };
  const postFav: Favorites<OrganicPost> = { has: (p) => postFavs.has(p.id), toggle: (p) => setPostFavs([p.id], !postFavs.has(p.id)) };
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const adIndex = openAd ? ads.findIndex((a) => a.id === openAd) : -1;
  const postIndex = openPost ? posts.findIndex((p) => p.id === openPost) : -1;
  const ad = adIndex >= 0 ? ads[adIndex]! : null;
  const post = postIndex >= 0 ? posts[postIndex]! : null;

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
          <SectionHead>Competitor ads ({ads.length})</SectionHead>
          {ads.length ? <AdGrid ads={ads} slug={slug} onOpen={setOpenAd} fav={adFav} /> : <Empty>No starred ads yet.</Empty>}
        </section>
      )}
      {show !== "ads" && (
        <section>
          <SectionHead>Organic posts ({posts.length})</SectionHead>
          {posts.length ? <PostGrid posts={posts} now={now} onOpen={setOpenPost} fav={postFav} /> : <Empty>No starred posts yet.</Empty>}
        </section>
      )}
      <AdPreview
        ad={ad}
        slug={slug}
        fav={adFav}
        position={ad ? `${adIndex + 1} / ${ads.length}` : ""}
        onClose={() => setOpenAd(null)}
        onPrev={adIndex > 0 ? () => setOpenAd(ads[adIndex - 1]!.id) : null}
        onNext={adIndex >= 0 && adIndex < ads.length - 1 ? () => setOpenAd(ads[adIndex + 1]!.id) : null}
      />
      <PostPreview
        post={post}
        account={post ? (accountById.get(post.account.id) ?? null) : null}
        now={now}
        fav={postFav}
        position={post ? `${postIndex + 1} / ${posts.length}` : ""}
        onClose={() => setOpenPost(null)}
        onPrev={postIndex > 0 ? () => setOpenPost(posts[postIndex - 1]!.id) : null}
        onNext={postIndex >= 0 && postIndex < posts.length - 1 ? () => setOpenPost(posts[postIndex + 1]!.id) : null}
      />
    </>
  );
}
