"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TabData, TabName } from "./tab-data";

export function useTab<K extends TabName>(product: { id: string; slug: string }, tab: K, params: Record<string, string | undefined> = {}) {
  const cleanParams = Object.fromEntries(
    Object.entries(params)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const search = new URLSearchParams(cleanParams).toString();
  return useQuery({
    queryKey: ["product", product.id, tab, cleanParams],
    queryFn: async () => {
      const response = await fetch(`/api/p/${product.slug}/${tab}${search ? `?${search}` : ""}`);
      if (!response.ok) throw new Error(`Tab request failed (${response.status})`);
      return (await response.json()) as TabData<K>;
    },
    placeholderData: keepPreviousData,
  });
}

export function useInvalidateProduct() {
  const queryClient = useQueryClient();
  return (productId: string) => queryClient.invalidateQueries({ queryKey: ["product", productId] });
}
