import "server-only";

import type { ProductRow } from "@db/types";
import { docName } from "../../src/lib/product-docs.ts";
import { getAppleAdsExperimentsCached, getAppleAdsOverviewCached } from "./apple-ads";
import { getAppleKeywordsCached } from "./apple-keywords";
import { competitorAdsCached, getTrackedSources } from "./queries";
import { favoriteIds, favoriteStars } from "./favorites";
import { organicOverviewCached } from "./social";
import { getMetaAdsOverviewCached } from "./meta-ads";
import { listCreativeItemsCached } from "./creatives";
import { channelSetup } from "./setup";
import { DEFAULT_WINDOW_DAYS, formatBrief, isExcludable, overviewForCached } from "./overview";
import { parseRange } from "@/components/meta-ads";
import { parseAppleRange } from "./apple-ads-math";
import { APPLE_KEYWORD_RANGES, OVERVIEW_WINDOWS, SHORT_FORM_KINDS } from "./tab-constants";

export const tabLoaders = {
  overview: async (product: ProductRow, sp: URLSearchParams) => {
    const requested = Number(sp.get("days"));
    const days = OVERVIEW_WINDOWS.includes(requested) ? requested : DEFAULT_WINDOW_DAYS;
    const exclude = (sp.get("without") ?? "").split(",").filter(isExcludable);
    const [overview, sources] = await Promise.all([overviewForCached(product.id, product, { days, exclude }), getTrackedSources(product.id)]);
    return {
      overview,
      brief: formatBrief(overview),
      channels: channelSetup(product.slug, sources),
    };
  },
  insights: async (product: ProductRow) => {
    const [cards, favorites] = await Promise.all([competitorAdsCached(product.id), favoriteIds(product.id, "ad")]);
    return { cards, favorites };
  },
  ads: async (product: ProductRow) => {
    const [ads, favorites] = await Promise.all([competitorAdsCached(product.id), favoriteIds(product.id, "ad")]);
    return { ads, favorites };
  },
  favorites: async (product: ProductRow) => {
    const [{ accounts, posts }, ads, adStarredAt, postStarredAt] = await Promise.all([
      organicOverviewCached(product.id),
      competitorAdsCached(product.id),
      favoriteStars(product.id, "ad"),
      favoriteStars(product.id, "post"),
    ]);
    return { accounts, posts, ads, adStarredAt, postStarredAt };
  },
  organic: async (product: ProductRow) => {
    const [{ accounts, posts }, favorites] = await Promise.all([organicOverviewCached(product.id, { relations: ["competitor", "inspiration"] }), favoriteIds(product.id, "post")]);
    return { accounts, posts, favorites };
  },
  "my-accounts": async (product: ProductRow) => {
    const [{ accounts, posts }, favorites] = await Promise.all([organicOverviewCached(product.id, { relations: ["own"], kinds: SHORT_FORM_KINDS }), favoriteIds(product.id, "post")]);
    return { accounts, posts, favorites };
  },
  "apple-ads": async (product: ProductRow, sp: URLSearchParams) => {
    const range = parseAppleRange(Object.fromEntries(sp));
    const [overview, experiments] = await Promise.all([getAppleAdsOverviewCached(product.id, { since: range.since, until: range.until }), getAppleAdsExperimentsCached(product.id)]);
    return {
      overview,
      experiments: experiments.map((entry) => ({
        ...entry,
        experiment: {
          ...entry.experiment,
          writeupName: entry.experiment.writeup_path ? docName(entry.experiment.writeup_path) : null,
        },
        log: entry.log.map((line) => ({
          ...line,
          planName: line.plan_path ? docName(line.plan_path) : null,
        })),
        links: entry.links,
      })),
    };
  },
  "apple-keywords": async (product: ProductRow, sp: URLSearchParams) => {
    const requested = Number(sp.get("days"));
    const days = APPLE_KEYWORD_RANGES.includes(requested) ? requested : 28;
    return getAppleKeywordsCached(product.id, days);
  },
  "meta-ads": async (product: ProductRow, sp: URLSearchParams) => {
    const range = parseRange(Object.fromEntries(sp));
    return getMetaAdsOverviewCached(product.id, { since: range.since, until: range.until });
  },
  creatives: async (product: ProductRow) => listCreativeItemsCached(product.id),
};

export type TabName = keyof typeof tabLoaders;
export type TabData<K extends TabName> = Awaited<ReturnType<(typeof tabLoaders)[K]>>;
