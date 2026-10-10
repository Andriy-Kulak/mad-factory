import type { TrackedSourceRow } from "../db/types.ts";

/** A downloadable media asset attached to an ad. */
export interface CollectedMedia {
  kind: "video" | "image";
  hdUrl: string | null;
  sdUrl: string | null;
  previewUrl: string | null;
}

/** Source-agnostic ad shape produced by every collector. Maps 1:1 onto the `ads` table. */
export interface CollectedAd {
  source: string;
  externalId: string;
  advertiserId: string | null;
  advertiserName: string | null;
  bodyText: string | null;
  title: string | null;
  linkUrl: string | null;
  ctaText: string | null;
  startDate: Date | null;
  endDate: Date | null;
  isActive: boolean | null;
  platforms: string[];
  collationId: string | null;
  collationCount: number | null;
  reachEstimate: unknown;
  spend: unknown;
  currency: string | null;
  totalActiveTime: unknown;
  media: CollectedMedia[];
  raw: unknown;
}

export interface CollectOptions {
  maxAds: number;
  headless: boolean;
  proxyUrl?: string;
  /** Called as soon as new ads are seen so downloads start before CDN URLs expire. */
  onBatch?: (ads: CollectedAd[]) => Promise<void> | void;
  onUsage?: (credits: number) => void;
  log?: (msg: string) => void;
}

/** Contract every ad source (meta now, others later) implements. */
export interface AdSource {
  readonly name: string;
  readonly collector: string;
  readonly sortMode: string;
  /** Validate a tracked source row belongs to this source and is well-formed. */
  validate(ts: TrackedSourceRow): void;
  /** Collect ads for a tracked source. Resolves with everything seen. */
  collect(ts: TrackedSourceRow, opts: CollectOptions): Promise<CollectedAd[]>;
}
