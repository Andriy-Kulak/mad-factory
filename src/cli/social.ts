import { parseArgs } from "node:util";
import { listTrackedSources, requireProduct } from "../db/products.ts";
import { requireIntegration } from "../lib/integrations.ts";
import { r2Enabled } from "../lib/storage.ts";
import { getSocialCollector, knownSocialProviders } from "../social/providers/index.ts";
import { getSocialStore } from "../social/store.ts";
import { syncSource } from "../social/sync.ts";
import { SOCIAL_PLATFORMS } from "../social/types.ts";
import type { SocialPlatform } from "../social/types.ts";
import { record } from "../social/util.ts";

const HELP = `Usage: pnpm social --product <slug> [options]

Syncs enabled social account sources for a product.

Options:
  --product <slug>                    Product to sync (required)
  --platform ${[...SOCIAL_PLATFORMS, "all"].join("|")}  Platform filter (default all)
  --relation own|competitor|inspiration  Optional source relation filter
  --posts <n>                          Max posts per account (default 12)
  --max-credits <n>                    Maximum credits per account (default 5)
  --since <YYYY-MM-DD>                 Facebook only: keep reels posted on/after this date and stop paging
                                       past it (pair with a large --posts and --max-credits)
  --no-download                        Skip profile and post media downloads
  -h, --help

Collectors: ${knownSocialProviders().join(", ")} (set config.provider on a tracked source; default scrapecreators)
`;

const { values } = parseArgs({
  options: {
    product: { type: "string" },
    platform: { type: "string", default: "all" },
    relation: { type: "string" },
    posts: { type: "string", default: "12" },
    "max-credits": { type: "string", default: "5" },
    since: { type: "string" },
    "no-download": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

function parsePlatform(value: string): SocialPlatform | "all" {
  if (value === "all" || (SOCIAL_PLATFORMS as readonly string[]).includes(value)) {
    return value as SocialPlatform | "all";
  }
  throw new Error(`Unsupported platform "${value}"; expected ${[...SOCIAL_PLATFORMS, "all"].join(", ")}`);
}

function sourceRelation(source: { config: unknown }): string | null {
  const value = record(source.config)?.relation;
  return typeof value === "string" ? value : null;
}

function sourceProvider(source: { config: unknown }): string {
  const value = record(source.config)?.provider;
  return typeof value === "string" && value.length ? value : "scrapecreators";
}

async function main(): Promise<void> {
  if (values.help || !values.product) {
    console.log(HELP);
    if (!values.help) process.exitCode = 1;
    return;
  }

  const platform = parsePlatform(values.platform);
  const relation = values.relation;
  if (relation && !["own", "competitor", "inspiration"].includes(relation)) {
    throw new Error("--relation must be own, competitor, or inspiration");
  }
  const maxPosts = Number(values.posts);
  if (!Number.isInteger(maxPosts) || maxPosts <= 0) throw new Error("--posts must be a positive integer");
  const maxCredits = Number(values["max-credits"]);
  if (!Number.isInteger(maxCredits) || maxCredits <= 0) {
    throw new Error("--max-credits must be a positive integer");
  }

  const since = values.since;
  if (since !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(since))) {
      throw new Error("--since must be a date like 2025-10-06");
    }
    if (platform !== "facebook") throw new Error("--since is only supported with --platform facebook");
  }

  const product = await requireProduct(values.product);
  const sources = (await listTrackedSources(product.id, true)).filter((source) => {
    const isSocial = (SOCIAL_PLATFORMS as readonly string[]).includes(source.source) && source.kind === "account";
    const matchesPlatform = platform === "all" || source.source === platform;
    const matchesRelation = !relation || sourceRelation(source) === relation;
    return isSocial && matchesPlatform && matchesRelation;
  });
  if (!sources.length) {
    const scope = relation ? ` ${relation}` : "";
    throw new Error(`No enabled${scope} social account sources for product "${product.slug}"`);
  }
  if (sources.some((source) => sourceProvider(source) === "scrapecreators")) requireIntegration("scrapecreators");

  const downloadMedia = !values["no-download"] && r2Enabled;
  if (values["no-download"]) {
    console.log("Media downloads disabled by --no-download.");
  } else if (!r2Enabled) {
    console.log("R2 is not configured; skipping profile and post media downloads.");
  }
  console.log(`Product ${product.name} (${product.slug}): ${sources.length} social account(s)`);

  const store = getSocialStore();
  let failures = 0;
  for (const source of sources) {
    const provider = sourceProvider(source);
    console.log(`\n== [${source.source}/${provider}] ${source.value}`);
    try {
      const collector = getSocialCollector(source.source as SocialPlatform, provider);
      await syncSource(source, product.id, collector, store, {
        maxPosts,
        maxCredits,
        since,
        downloadMedia,
      });
    } catch (error) {
      failures++;
      if (!(error instanceof Error && error.message.startsWith("-- failed:"))) {
        console.error(`-- failed: ${source.source} ${source.value}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (failures) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
