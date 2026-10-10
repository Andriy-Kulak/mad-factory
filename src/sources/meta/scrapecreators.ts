import type { TrackedSourceRow } from "../../db/types.ts";
import { scrapeCreatorsGet } from "../../lib/scrapecreators.ts";
import type { AdSource, CollectOptions, CollectedAd } from "../types.ts";
import { META_SOURCE, findAdNodes, normalize, validateMetaSource } from "./normalize.ts";

const ENDPOINTS = {
  page: "/v1/facebook/adLibrary/company/ads",
  keyword: "/v1/facebook/adLibrary/search/ads",
} as const;

export const scrapeCreatorsSource: AdSource = {
  name: META_SOURCE,
  collector: "scrapecreators",
  sortMode: "total_impressions",

  validate(ts) {
    validateMetaSource(ts);
  },

  async collect(ts: TrackedSourceRow, opts: CollectOptions): Promise<CollectedAd[]> {
    scrapeCreatorsSource.validate(ts);
    const kind = ts.kind as keyof typeof ENDPOINTS;
    const endpoint = ENDPOINTS[kind];
    const config = ts.config && typeof ts.config === "object" && !Array.isArray(ts.config) ? ts.config : {};
    const params: Record<string, string> = {
      country: ts.country || "ALL",
      status: typeof config.status === "string" ? config.status : "ACTIVE",
      media_type: "ALL",
      sort_by: "total_impressions",
    };
    if (kind === "page") {
      params.pageId = ts.value;
    } else {
      params.query = ts.value;
      params.search_type = "keyword_unordered";
    }

    const ads = new Map<string, CollectedAd>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    while (ads.size < opts.maxAds) {
      if (cursor) params.cursor = cursor;
      const { body, creditsCharged } = await scrapeCreatorsGet(endpoint, params);
      opts.onUsage?.(creditsCharged);

      const fresh: CollectedAd[] = [];
      const nodes = findAdNodes(body);
      for (const node of nodes) {
        if (ads.has(node.ad_archive_id as string)) continue;
        if (ads.size >= opts.maxAds) break;
        const ad = normalize(node);
        ads.set(ad.externalId, ad);
        fresh.push(ad);
      }
      await opts.onBatch?.(fresh);
      if (!nodes.length) break;
      if (ads.size >= opts.maxAds) break;

      const nextCursor = typeof body.cursor === "string" && body.cursor.length ? body.cursor : null;
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return [...ads.values()];
  },
};
