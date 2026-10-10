import { ATTRIBUTE_KEYS } from "../../src/meta-ads/attributes.ts";
import type { MetaAdsAdDailyBreakdownRow, MetaAdsAdDailyRow, MetaAdsAdRow, MetaAdsAdsetRow, MetaAdsCampaignRow, MetaAdsCreativeRow } from "@db/types";

export interface MetaTotals {
  impressions: number;
  clicks: number;
  spend: number;
  installs: number;
  trials: number;
  purchases: number;
}

export const zeroMeta = (): MetaTotals => ({ impressions: 0, clicks: 0, spend: 0, installs: 0, trials: 0, purchases: 0 });

export function addMeta(t: MetaTotals, r: { impressions: number; clicks: number; spend: number | string; installs: number | null; trials: number | null; purchases: number | null }): void {
  t.impressions += r.impressions;
  t.clicks += r.clicks;
  t.spend += Number(r.spend);
  t.installs += r.installs ?? 0;
  t.trials += r.trials ?? 0;
  t.purchases += r.purchases ?? 0;
}

const bump = <K,>(m: Map<K, MetaTotals>, k: K) => m.get(k) ?? m.set(k, zeroMeta()).get(k)!;

export type Attributes = Record<string, string | number>;

export function attributesOf(c: Pick<MetaAdsCreativeRow, "attributes"> | undefined): Attributes {
  const a = c?.attributes;
  if (!a || typeof a !== "object" || Array.isArray(a)) return {};
  const out: Attributes = {};
  for (const [k, v] of Object.entries(a)) if (typeof v === "string" || typeof v === "number") out[k] = v;
  return out;
}

export interface MetaAdSummary {
  id: string;
  name: string;
  status: string;
  campaignId: string;
  campaignName: string;
  adsetName: string;
  creative: MetaAdsCreativeRow | null;
  attributes: Attributes;
  totals: MetaTotals;
}

export interface MetaAdsRollup {
  campaigns: (MetaAdsCampaignRow & { totals: MetaTotals; adsets: number; ads: number })[];
  adsets: (MetaAdsAdsetRow & { totals: MetaTotals; campaignName: string })[];
  ads: MetaAdSummary[];
  countries: ({ country: string } & MetaTotals)[];
  days: ({ date: string } & MetaTotals)[];
  totals: MetaTotals;
  currency: string | null;
}

/** Sums daily ad rows by campaign, ad set, ad, day and country. Ads that only appear in daily rows (archived in Meta) are kept, named by id. */
export function rollup(
  campaigns: MetaAdsCampaignRow[],
  adsets: MetaAdsAdsetRow[],
  ads: MetaAdsAdRow[],
  creatives: MetaAdsCreativeRow[],
  daily: MetaAdsAdDailyRow[],
  countries: MetaAdsAdDailyBreakdownRow[],
): MetaAdsRollup {
  const byCampaign = new Map<string, MetaTotals>();
  const byAdset = new Map<string, MetaTotals>();
  const byAd = new Map<string, MetaTotals>();
  const byDay = new Map<string, MetaTotals>();
  const byCountry = new Map<string, MetaTotals>();
  const totals = zeroMeta();
  const seen = new Map<string, MetaAdsAdDailyRow>();
  for (const r of daily) {
    addMeta(bump(byCampaign, r.campaign_id), r);
    addMeta(bump(byAdset, r.adset_id), r);
    addMeta(bump(byAd, r.ad_id), r);
    addMeta(bump(byDay, r.date), r);
    addMeta(totals, r);
    seen.set(r.ad_id, r);
  }
  for (const r of countries) addMeta(bump(byCountry, r.value), r);

  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const adsetName = new Map(adsets.map((a) => [a.id, a.name]));
  const creativeById = new Map(creatives.map((c) => [c.id, c]));
  const adSummaries: MetaAdSummary[] = ads.map((a) => {
    const creative = a.creative_id ? creativeById.get(a.creative_id) ?? null : null;
    return { id: a.id, name: a.name, status: a.effective_status ?? a.status, campaignId: a.campaign_id, campaignName: campaignName.get(a.campaign_id) ?? a.campaign_id, adsetName: adsetName.get(a.adset_id) ?? a.adset_id, creative, attributes: attributesOf(creative ?? undefined), totals: byAd.get(a.id) ?? zeroMeta() };
  });
  const known = new Set(ads.map((a) => a.id));
  for (const [id, r] of seen) {
    if (known.has(id)) continue;
    adSummaries.push({ id, name: `ad ${id}`, status: "NOT SYNCED", campaignId: r.campaign_id, campaignName: campaignName.get(r.campaign_id) ?? r.campaign_id, adsetName: adsetName.get(r.adset_id) ?? r.adset_id, creative: null, attributes: {}, totals: byAd.get(id)! });
  }
  adSummaries.sort((a, b) => b.totals.spend - a.totals.spend || a.name.localeCompare(b.name));

  return {
    campaigns: campaigns
      .map((c) => ({ ...c, totals: byCampaign.get(c.id) ?? zeroMeta(), adsets: adsets.filter((a) => a.campaign_id === c.id).length, ads: ads.filter((a) => a.campaign_id === c.id).length }))
      .sort((a, b) => b.totals.spend - a.totals.spend || a.name.localeCompare(b.name)),
    adsets: adsets
      .map((a) => ({ ...a, totals: byAdset.get(a.id) ?? zeroMeta(), campaignName: campaignName.get(a.campaign_id) ?? a.campaign_id }))
      .sort((a, b) => b.totals.spend - a.totals.spend || a.name.localeCompare(b.name)),
    ads: adSummaries,
    countries: [...byCountry].map(([country, t]) => ({ country, ...t })).sort((a, b) => b.spend - a.spend),
    days: [...byDay].map(([date, t]) => ({ date, ...t })).sort((a, b) => a.date.localeCompare(b.date)),
    totals,
    currency: daily[0]?.currency ?? campaigns.find((c) => c.currency)?.currency ?? null,
  };
}

export const UNTAGGED = "(untagged)";

export interface AttributeGroup {
  /** One value per grouped key, UNTAGGED when the creative has no value for it. */
  values: string[];
  ads: number;
  totals: MetaTotals;
}

/** Ad performance grouped by creative attribute values, e.g. keys ["hook"] or ["hook", "avatar"]. */
export function groupByAttributes(ads: MetaAdSummary[], keys: string[]): AttributeGroup[] {
  const groups = new Map<string, AttributeGroup>();
  for (const ad of ads) {
    const values = keys.map((k) => (ad.attributes[k] == null ? UNTAGGED : String(ad.attributes[k])));
    const id = JSON.stringify(values);
    const g = groups.get(id) ?? groups.set(id, { values, ads: 0, totals: zeroMeta() }).get(id)!;
    g.ads++;
    for (const k of Object.keys(g.totals) as (keyof MetaTotals)[]) g.totals[k] += ad.totals[k];
  }
  return [...groups.values()].sort((a, b) => b.totals.spend - a.totals.spend);
}

/** Every attribute key used on at least one creative, known keys first. */
export function attributeKeys(ads: MetaAdSummary[], known: readonly string[] = ATTRIBUTE_KEYS): string[] {
  const used = new Set(ads.flatMap((a) => Object.keys(a.attributes)));
  return [...known, ...[...used].filter((k) => !known.includes(k)).sort()];
}
