/**
 * Convenience aliases over the generated Database type.
 * Regenerate the source of truth with `pnpm db:types` after editing migrations.
 */
import type { Database, Json } from "./database.types.ts";

export type { Database, Json };

type Tables = Database["public"]["Tables"];
export type Row<T extends keyof Tables> = Tables[T]["Row"];
export type Insert<T extends keyof Tables> = Tables[T]["Insert"];
export type Update<T extends keyof Tables> = Tables[T]["Update"];

export type ProductRow = Row<"products">;
export type ProductInsert = Insert<"products">;
export type ProductUpdate = Update<"products">;

export type ProductDocRow = Row<"product_docs">;
export type ProductDocInsert = Insert<"product_docs">;
export type { ProductDocKind } from "../lib/product-docs.ts";

export type TrackedSourceRow = Row<"tracked_sources">;
export type TrackedSourceInsert = Insert<"tracked_sources">;
export type TrackedSourceUpdate = Update<"tracked_sources">;

export type AdRow = Row<"ads">;
export type AdInsert = Insert<"ads">;
export type AdUpdate = Update<"ads">;

export type CreativeRow = Row<"creatives">;
export type CreativeInsert = Insert<"creatives">;

export type AdCreativeRow = Row<"ad_creatives">;
export type AdCreativeInsert = Insert<"ad_creatives">;

export type CreativeProfileRow = Row<"creative_profiles">;
export type CreativeProfileInsert = Insert<"creative_profiles">;

export type ProductAdRow = Row<"product_ads">;
export type ProductAdInsert = Insert<"product_ads">;

export type ScrapeRunRow = Row<"scrape_runs">;
export type ScrapeRunInsert = Insert<"scrape_runs">;
export type ScrapeRunUpdate = Update<"scrape_runs">;

export type AdLibraryObservationRow = Row<"ad_library_observations">;
export type AdLibraryObservationInsert = Insert<"ad_library_observations">;

export type ExperimentRow = Row<"experiments">;
export type ExperimentInsert = Insert<"experiments">;
export type ExperimentCampaignRow = Row<"experiment_campaigns">;
export type ExperimentCampaignInsert = Insert<"experiment_campaigns">;
export type ExperimentLogRow = Row<"experiment_log">;
export type McpApiKeyRow = Row<"mcp_api_keys">;
export type ExperimentLogInsert = Insert<"experiment_log">;

export type AppleAdsCampaignRow = Row<"apple_ads_campaigns">;
export type AppleAdsCampaignInsert = Insert<"apple_ads_campaigns">;
export type AppleAdsKeywordRow = Row<"apple_ads_keywords">;
export type AppleAdsKeywordInsert = Insert<"apple_ads_keywords">;
export type AppleAdsKeywordDailyRow = Row<"apple_ads_keyword_daily">;
export type AppleAdsKeywordDailyInsert = Insert<"apple_ads_keyword_daily">;
export type AppleAdsSearchTermDailyRow = Row<"apple_ads_search_terms_daily">;
export type AppleAdsSearchTermDailyInsert = Insert<"apple_ads_search_terms_daily">;
export type AppleAdsChangeRow = Row<"apple_ads_changes">;
export type AppleAdsChangeInsert = Insert<"apple_ads_changes">;

export type RevenueCatKeywordDailyRow = Row<"revenuecat_keyword_daily">;
export type RevenueCatKeywordDailyInsert = Insert<"revenuecat_keyword_daily">;
export type AppleAdsTermPopularityRow = Row<"apple_ads_term_popularity">;
export type AppleAdsTermPopularityInsert = Insert<"apple_ads_term_popularity">;

export type SocialAccountRow = Row<"social_accounts">;
export type SocialAccountInsert = Insert<"social_accounts">;
export type SocialAccountSnapshotRow = Row<"social_account_snapshots">;
export type SocialAccountSnapshotInsert = Insert<"social_account_snapshots">;
export type SocialPostRow = Row<"social_posts">;
export type SocialPostInsert = Insert<"social_posts">;
export type SocialPostMediaRow = Row<"social_post_media">;
export type SocialPostMediaInsert = Insert<"social_post_media">;
export type SocialPostSnapshotRow = Row<"social_post_snapshots">;
export type SocialPostSnapshotInsert = Insert<"social_post_snapshots">;

export type MetaAdsCampaignRow = Row<"meta_ads_campaigns">;
export type MetaAdsCampaignInsert = Insert<"meta_ads_campaigns">;
export type MetaAdsAdsetRow = Row<"meta_ads_adsets">;
export type MetaAdsAdsetInsert = Insert<"meta_ads_adsets">;
export type MetaAdsCreativeRow = Row<"meta_ads_creatives">;
export type MetaAdsCreativeInsert = Insert<"meta_ads_creatives">;
export type MetaAdsAdRow = Row<"meta_ads_ads">;
export type MetaAdsAdInsert = Insert<"meta_ads_ads">;
export type MetaAdsAdDailyRow = Row<"meta_ads_ad_daily">;
export type MetaAdsAdDailyInsert = Insert<"meta_ads_ad_daily">;
export type MetaAdsAdDailyBreakdownRow = Row<"meta_ads_ad_daily_breakdowns">;
export type MetaAdsAdDailyBreakdownInsert = Insert<"meta_ads_ad_daily_breakdowns">;
export type MetaAdsChangeRow = Row<"meta_ads_changes">;
export type MetaAdsChangeInsert = Insert<"meta_ads_changes">;

export type ProductGoalRow = Row<"product_goals">;
export type ProductGoalInsert = Insert<"product_goals">;
