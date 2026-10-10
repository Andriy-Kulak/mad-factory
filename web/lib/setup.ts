import type { TrackedSourceRow } from "@db/types";
import type { NavKey } from "../components/nav.ts";
import type { IntegrationKey } from "../../src/lib/integrations.ts";

/**
 * Which channels a product has connected, read from its enabled tracked sources, and how to connect the rest.
 * The web host does not hold the sync keys, so "connected" means "a source is tracked", not "a key is set".
 */

export type ChannelKey = "meta" | "organic" | "my-accounts" | "meta-ads" | "apple" | "revenuecat";

export interface ChannelSetup {
  key: ChannelKey;
  label: string;
  /** Under /p/<slug>; null when the channel has no page of its own. */
  path: string | null;
  /** What it adds, in a few words. */
  gives: string;
  integration: IntegrationKey;
  connected: boolean;
  /** Commands that connect it, first to last. */
  steps: string[];
}

type Source = Pick<TrackedSourceRow, "source" | "kind" | "config" | "enabled">;

const SOCIAL = ["instagram", "tiktok", "facebook"];

function relation(s: Source): string {
  const cfg = s.config && typeof s.config === "object" && !Array.isArray(s.config) ? (s.config as Record<string, unknown>) : {};
  return typeof cfg.relation === "string" ? cfg.relation : "inspiration";
}

export function channelSetup(slug: string, sources: Source[]): ChannelSetup[] {
  const on = sources.filter((s) => s.enabled);
  const has = (test: (s: Source) => boolean) => on.some(test);
  const social = (s: Source) => SOCIAL.includes(s.source) && s.kind === "account";
  return [
    {
      key: "meta", label: "Competitor ads", path: "/ads", integration: "scrapecreators",
      gives: "What competitors run in the Meta Ad Library",
      connected: has((s) => s.source === "meta" && (s.kind === "page" || s.kind === "keyword")),
      steps: ["Add a competitor page or keyword on Competitor ads", `pnpm scrape --product ${slug}`],
    },
    {
      key: "organic", label: "Organic", path: "/organic", integration: "scrapecreators",
      gives: "Competitor and inspiration reels and videos",
      connected: has((s) => social(s) && relation(s) !== "own"),
      steps: ["Add Instagram, TikTok or Facebook accounts on Organic", `pnpm social --product ${slug}`],
    },
    {
      key: "my-accounts", label: "My accounts", path: "/my-accounts", integration: "scrapecreators",
      gives: "Views on your own posts",
      connected: has((s) => social(s) && relation(s) === "own"),
      steps: ["Add your own accounts on My accounts", `pnpm social --product ${slug} --relation own`],
    },
    {
      key: "meta-ads", label: "Meta ads", path: "/meta-ads", integration: "meta-ads",
      gives: "Spend and results from your Meta ad account",
      connected: has((s) => s.source === "meta_ads" && s.kind === "ad_account"),
      steps: [`pnpm product add-source ${slug} --source meta_ads --kind ad_account --value act_<id>`, `pnpm meta-ads sync --product ${slug}`],
    },
    {
      key: "apple", label: "Apple ads", path: "/apple-ads", integration: "apple-ads",
      gives: "Campaigns, keywords and search terms from Apple Ads",
      connected: has((s) => s.source === "apple_ads" && s.kind === "app"),
      steps: [
        `pnpm product add-source ${slug} --source apple_ads --kind app --value <App Store ID> --config '{"ad_account_id": <id>}'`,
        `pnpm apple-ads sync --product ${slug}`,
      ],
    },
    {
      key: "revenuecat", label: "RevenueCat", path: null, integration: "revenuecat",
      gives: "Trials and revenue, so the overview can show profit",
      connected: has((s) => s.source === "revenuecat" && s.kind === "project"),
      steps: [`pnpm product add-source ${slug} --source revenuecat --kind project --value <project id>`, `pnpm revenuecat sync --product ${slug}`],
    },
  ];
}

/** Sidebar items whose channel is not connected yet; Apple keywords follows Apple ads. */
export function navNeedingSetup(channels: ChannelSetup[]): NavKey[] {
  const off = new Set(channels.filter((c) => !c.connected).map((c) => c.key));
  const keys: NavKey[] = ["meta", "organic", "my-accounts", "meta-ads", "apple"];
  return [...keys.filter((k) => off.has(k as ChannelKey)), ...(off.has("apple") ? ["apple-keywords" as const] : [])];
}
