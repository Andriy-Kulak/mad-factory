"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Reused pages stay visible while their data refreshes in the background.
export const CLIENT_CACHE_SECONDS = 300;

const lastFetchedAt = new Map<string, number>();

export function RefreshOnRevisit() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const key = `${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    const now = Date.now();
    const lastFetched = lastFetchedAt.get(key);

    if (lastFetched === undefined || now - lastFetched >= CLIENT_CACHE_SECONDS * 1000) {
      lastFetchedAt.set(key, now);
      return;
    }
    if (now - lastFetched < 15_000) return;

    lastFetchedAt.set(key, now);
    router.refresh();
  }, [key]);

  return null;
}
