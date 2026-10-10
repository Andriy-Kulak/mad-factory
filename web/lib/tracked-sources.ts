import "server-only";
import { getDb } from "./db";
import { SOCIAL_PLATFORMS } from "./social";
import { adRelationOf } from "../../src/lib/tracked-source-input.ts";

export interface TrackedSourceItem {
  id: string;
  source: string;
  kind: string;
  value: string;
  country: string;
  label: string | null;
  enabled: boolean;
  relation: string | null;
  /** Social: the first sync links the source to a stored account. Ads: set after the first scrape. */
  synced: boolean;
  lastScrapedAt: string | null;
}

export type TrackedSourceScope = { kind: "social"; relations: string[] } | { kind: "ad_library" };

/** Tracked sources a tab manages, paused ones included. */
export async function listTrackedSourceItems(productId: string, scope: TrackedSourceScope): Promise<TrackedSourceItem[]> {
  let q = getDb()
    .from("tracked_sources")
    .select("id,source,kind,value,country,label,enabled,config,last_scraped_at")
    .eq("product_id", productId)
    .order("created_at");
  q = scope.kind === "social" ? q.eq("kind", "account").in("source", [...SOCIAL_PLATFORMS]) : q.eq("source", "meta").in("kind", ["page", "keyword"]);
  const res = await q;
  if (res.error) throw new Error(`tracked_sources: ${res.error.message}`);
  return (res.data ?? []).flatMap((s) => {
    const cfg = s.config && typeof s.config === "object" && !Array.isArray(s.config) ? s.config : {};
    const relation = scope.kind === "social" ? (typeof cfg.relation === "string" ? cfg.relation : "inspiration") : adRelationOf(cfg);
    if (scope.kind === "social" && !scope.relations.includes(relation!)) return [];
    return [{
      id: s.id,
      source: s.source,
      kind: s.kind,
      value: s.value,
      country: s.country,
      label: s.label,
      enabled: s.enabled,
      relation,
      synced: scope.kind === "social" ? typeof cfg.account_id === "string" : s.last_scraped_at != null,
      lastScrapedAt: s.last_scraped_at,
    }];
  });
}

/** Public page for a tracked source, for linking out from the manage list. */
export function trackedSourceUrl(s: Pick<TrackedSourceItem, "source" | "kind" | "value" | "country">): string | null {
  if (s.source === "instagram") return `https://www.instagram.com/${s.value}/`;
  if (s.source === "tiktok") return `https://www.tiktok.com/@${s.value}`;
  if (s.source === "facebook") return s.value;
  if (s.source === "meta") {
    const p = new URLSearchParams({ active_status: "all", ad_type: "all", country: s.country, media_type: "all" });
    if (s.kind === "page") p.set("view_all_page_id", s.value), p.set("search_type", "page");
    else p.set("q", s.value), p.set("search_type", "keyword_unordered");
    p.set("sort_data[mode]", "total_impressions");
    p.set("sort_data[direction]", "desc");
    return `https://www.facebook.com/ads/library/?${p}`;
  }
  return null;
}
