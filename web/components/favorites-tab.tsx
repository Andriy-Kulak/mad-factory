"use client";

import type { ReactNode } from "react";
import { useTab } from "@/lib/use-tab";
import { Shell } from "@/components/shell";
import { PageSkeleton } from "@/components/skeleton";
import { TabLoadError } from "@/components/tab-load-error";
import { FavoritesView } from "@/components/favorites-view";

/** Every starred competitor ad and organic post in one place, plus saving one more by link. */
export function FavoritesTab({ product, panel }: { product: { id: string; slug: string }; panel: ReactNode }) {
  const { data, isPending, isError, refetch } = useTab(product, "favorites");
  if (isPending) return <PageSkeleton title="Favorites" stats={0} body="cards" />;
  if (isError || !data) return <TabLoadError title="Favorites" retry={() => void refetch()} />;
  const { ads, accounts, posts, adStarredAt, postStarredAt } = data;
  const { slug } = product;
  const starredAds = new Set(Object.keys(adStarredAt));
  const starredPosts = new Set(Object.keys(postStarredAt));
  const favAds = ads.filter((a) => a.memberIds.some((id) => starredAds.has(id)));
  const favPosts = posts.filter((p) => starredPosts.has(p.id));

  return (
    <Shell title="Favorites" subtitle={`${favAds.length} ads · ${favPosts.length} posts · star an ad or post anywhere in Research and it shows here`}>
      {panel}
      <FavoritesView ads={favAds} posts={favPosts} accounts={accounts} slug={slug} productId={product.id} adStarredAt={adStarredAt} postStarredAt={postStarredAt} now={Date.now()} />
    </Shell>
  );
}
