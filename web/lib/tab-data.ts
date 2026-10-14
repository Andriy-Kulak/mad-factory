import "server-only";

import type { ProductRow } from "@db/types";
import { docName } from "../../src/lib/product-docs.ts";
import { getAppleAdsExperimentsCached, getAppleAdsOverviewCached } from "./apple-ads";
import { getAppleKeywordsCached } from "./apple-keywords";
import { competitorAdsCached, getTrackedSources } from "./queries";
import { favoriteIds } from "./favorites";
import { organicOverviewCached } from "./social";
import { getMetaAdsOverviewCached } from "./meta-ads";
import { listCreativeItemsCached } from "./creatives";
import { channelSetup } from "./setup";
import { DEFAULT_WINDOW_DAYS, formatBrief, overviewForCached } from "./overview";

const APPLE_ADS_RANGES = [2, 7, 14, 28, 90];
const META_ADS_RANGES = [7, 14, 28, 90];

function isoDay(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

function appleAdsRange(sp: URLSearchParams) {
  const today = new Date().toISOString().slice(0, 10);
  const from = isoDay(sp.get("from"));
  const to = isoDay(sp.get("to")) ?? today;
  const custom = from != null && from <= to;
  const requested = Number(sp.get("days"));
  const days = APPLE_ADS_RANGES.includes(requested) ? requested : 28;
  return {
    since: custom ? from : new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10),
    until: custom ? to : today,
  };
}

function metaAdsRange(sp: URLSearchParams) {
  const today = new Date().toISOString().slice(0, 10);
  const from = isoDay(sp.get("from"));
  const to = isoDay(sp.get("to")) ?? today;
  const custom = from != null && from <= to;
  const requested = Number(sp.get("days"));
  const days = META_ADS_RANGES.includes(requested) ? requested : 28;
  return {
    since: custom ? from : new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10),
    until: custom ? to : today,
  };
}

export const tabLoaders = {
  overview: async (product: ProductRow, sp: URLSearchParams) => {
    const requested = Number(sp.get("days"));
    const days = [7, 14, 28].includes(requested) ? requested : DEFAULT_WINDOW_DAYS;
    const [overview, sources] = await Promise.all([overviewForCached(product.id, product, { days }), getTrackedSources(product.id)]);
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
    const [{ accounts, posts }, ads, adFavorites, postFavorites] = await Promise.all([
      organicOverviewCached(product.id),
      competitorAdsCached(product.id),
      favoriteIds(product.id, "ad"),
      favoriteIds(product.id, "post"),
    ]);
    return { accounts, posts, ads, adFavorites, postFavorites };
  },
  organic: async (product: ProductRow) => {
    const [{ accounts, posts }, favorites] = await Promise.all([organicOverviewCached(product.id, { relations: ["competitor", "inspiration"] }), favoriteIds(product.id, "post")]);
    return { accounts, posts, favorites };
  },
  "my-accounts": async (product: ProductRow) => {
    const [{ accounts, posts }, favorites] = await Promise.all([organicOverviewCached(product.id, { relations: ["own"], kinds: ["reel", "video"] }), favoriteIds(product.id, "post")]);
    return { accounts, posts, favorites };
  },
  "apple-ads": async (product: ProductRow, sp: URLSearchParams) => {
    const [overview, experiments] = await Promise.all([getAppleAdsOverviewCached(product.id, appleAdsRange(sp)), getAppleAdsExperimentsCached(product.id)]);
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
    const days = [7, 14, 28, 90].includes(requested) ? requested : 28;
    return getAppleKeywordsCached(product.id, days);
  },
  "meta-ads": async (product: ProductRow, sp: URLSearchParams) => getMetaAdsOverviewCached(product.id, metaAdsRange(sp)),
  creatives: async (product: ProductRow) => listCreativeItemsCached(product.id),
};

export type TabName = keyof typeof tabLoaders;
export type TabData<K extends TabName> = Awaited<ReturnType<(typeof tabLoaders)[K]>>;
