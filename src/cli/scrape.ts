import { parseArgs } from "node:util";
import { finishScrapeRun, insertAdLibraryObservation, markUnseenAdsEnded, startScrapeRun } from "../db/ads.ts";
import { getTrackedSource, listTrackedSources, markSourceScraped, requireProduct } from "../db/products.ts";
import { optionalEnv } from "../lib/env.ts";
import { requireIntegration } from "../lib/integrations.ts";
import { ingestAd, type IngestStats } from "../scrape/ingest.ts";
import { shouldMarkEnded } from "../scrape/should-mark-ended.ts";
import { getSource, knownCollectors, knownSources } from "../sources/index.ts";

const HELP = `Usage: pnpm scrape --product <id|slug> [options]

Scrapes every enabled tracked source of a product (or one source with --source-id).

Options:
  --product <id|slug>   Product to scrape (required)
  --source-id <uuid>    Only this tracked source
  --collector <name>    Collector (${knownCollectors("meta").join(", ")}; default: scrapecreators)
  --max <n>             Max ads per source (default 250)
  --no-download         Metadata only, skip media downloads
  --sd                  Prefer SD video over HD
  --headed              Show the browser
  -h, --help
`;

const { values } = parseArgs({
  options: {
    product: { type: "string" },
    "source-id": { type: "string" },
    collector: { type: "string" },
    max: { type: "string", default: "250" },
    "no-download": { type: "boolean", default: false },
    sd: { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || !values.product) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const maxAds = Number(values.max);
if (!Number.isFinite(maxAds) || maxAds <= 0) throw new Error("--max must be a positive number");

const product = await requireProduct(values.product);
const sources = values["source-id"]
  ? [await getTrackedSource(values["source-id"])].filter((s) => s != null)
  : // Tracked sources of non-scraper platforms (e.g. own ad accounts) are handled by their own CLI.
    (await listTrackedSources(product.id, true)).filter((s) => knownSources().includes(s.source));

if (!sources.length) {
  console.error(`No enabled tracked sources for product "${product.slug}". Add one with: pnpm product add-source`);
  process.exit(1);
}
if (sources.some((s) => s.product_id !== product.id)) throw new Error("--source-id does not belong to --product");
if (sources.some((s) => getSource(s.source, values.collector).collector === "scrapecreators")) requireIntegration("scrapecreators");

console.log(`Product ${product.name} (${product.slug}): ${sources.length} source(s)`);

let failures = 0;
for (const ts of sources) {
  const src = getSource(ts.source, values.collector);
  const label = ts.label ?? `${ts.kind}:${ts.value}`;
  console.log(`\n== [${ts.source}] ${label} (${ts.country})`);
  const runId = await startScrapeRun({
    product_id: product.id,
    tracked_source_id: ts.id,
    source: ts.source,
    collector: src.collector,
  });
  const stats: IngestStats = { adsSeen: 0, adsNew: 0, creativesNew: 0 };
  let creditsUsed = 0;
  const seenAdIds = new Set<string>();
  try {
    src.validate(ts);
    await src.collect(ts, {
      maxAds,
      headless: !values.headed,
      proxyUrl: optionalEnv("PROXY_URL"),
      log: (m) => console.log(`   ${m}`),
      onUsage: (credits) => {
        creditsUsed += credits;
      },
      onBatch: async (batch) => {
        for (const ad of batch) {
          if (stats.adsSeen >= maxAds) return;
          const rank = stats.adsSeen + 1;
          console.log(`[${rank}] ${ad.externalId} ${ad.advertiserName ?? ""} media=${ad.media.length}`);
          const adId = await ingestAd(
            ad,
            {
              productId: product.id,
              trackedSourceId: ts.id,
              downloadMedia: !values["no-download"],
              preferSd: values.sd,
              log: console.log,
            },
            stats,
          );
          seenAdIds.add(adId);
          await insertAdLibraryObservation({
            scrape_run_id: runId,
            ad_id: adId,
            tracked_source_id: ts.id,
            sort_mode: src.sortMode,
            rank,
            is_active: ad.isActive,
            collation_count: ad.collationCount,
          });
        }
      },
    });
    const config = ts.config && typeof ts.config === "object" && !Array.isArray(ts.config) ? ts.config : {};
    const status = typeof config.status === "string" ? config.status : undefined;
    if (shouldMarkEnded({ collector: src.collector, status, adsSeen: stats.adsSeen, maxAds })) {
      const marked = await markUnseenAdsEnded(ts.id, [...seenAdIds], new Date().toISOString());
      console.log(`-- marked ${marked} ads ended`);
    }
    await markSourceScraped(ts.id);
    await finishScrapeRun(runId, {
      status: "done",
      ads_seen: stats.adsSeen,
      ads_new: stats.adsNew,
      creatives_new: stats.creativesNew,
      credits_used: src.collector === "playwright" ? null : creditsUsed,
    });
    console.log(`-- done: ${stats.adsSeen} ads (${stats.adsNew} new), ${stats.creativesNew} new creatives`);
  } catch (err) {
    failures++;
    const msg = (err as Error).message;
    await finishScrapeRun(runId, {
      status: "error",
      error: msg,
      ads_seen: stats.adsSeen,
      ads_new: stats.adsNew,
      creatives_new: stats.creativesNew,
      credits_used: src.collector === "playwright" ? null : creditsUsed,
    });
    console.error(`-- failed: ${msg}`);
  }
}

process.exit(failures ? 1 : 0);
