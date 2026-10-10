/** Shapes of the Apple Ads v1 API as observed on the live API (see playbooks/apple-ads.md). */

export interface Money {
  amount: string;
  currency: string;
}

export interface ApiCampaign {
  id: number;
  adAccountId: number;
  name: string;
  status: string;
  displayStatus?: string;
  deleted?: boolean;
  promotedObjectId: string;
  dailyBudget?: { value?: Money };
  targeting?: { countryOrRegion?: { include?: string[] } };
  creationTime?: string;
  modificationTime?: string;
}

export interface ApiAdGroup {
  id: number;
  campaignId: number;
  name: string;
  deleted?: boolean;
}

/** Targeting and negative keywords share this shape; negatives have no bid or displayStatus. */
export interface ApiKeyword {
  id: number;
  campaignId: number;
  adGroupId: number;
  text: string;
  matchType: string;
  status: string;
  displayStatus?: string;
  bid?: Money;
  deleted?: boolean;
  creationTime?: string;
  modificationTime?: string;
}

export interface ApiMetrics {
  impressions?: number;
  taps?: number;
  tapInstalls?: number;
  viewInstalls?: number;
  totalNewDownloads?: number;
  totalRedownloads?: number;
  localSpend?: Money;
}

/** A day without activity comes back as `{ date }` with no metric fields. */
export type ApiGranularMetrics = ApiMetrics & { date: string };

export interface ApiReportRow<M> {
  metadata: M;
  totalMetrics?: ApiMetrics;
  granularMetrics?: ApiGranularMetrics[];
  insights?: { bidRecommendation?: Record<string, unknown> };
}

export interface KeywordReportMeta {
  id: number;
  campaignId: number;
  countryOrRegion?: string;
}

export interface SearchTermReportMeta {
  campaignId: number;
  /** null when Apple withholds a low-volume term. */
  searchTermText: string | null;
  searchTermSource?: string;
  keyword?: { id?: number } | null;
  countryOrRegion?: string;
}

export interface CampaignReportMeta {
  id: number;
}

/** `result` is `{}` (no `rows`) when the report has no data. */
export interface ApiReportResult<M> {
  rows?: ApiReportRow<M>[];
}
