import { parseArgs } from "node:util";
import { MAX_DAYS, autoDays } from "../apple-ads/sync.ts";
import { RevenueCatClient, loadApiKey } from "../revenuecat/client.ts";
import { SOURCE, syncProject } from "../revenuecat/sync.ts";
import { listTrackedSourcesBySource, requireProduct } from "../db/index.ts";
import { requireIntegration } from "../lib/integrations.ts";

const HELP = `Usage: pnpm revenuecat <command> [options]

Commands:
  sync --product <id|slug> | --all     Pull new trials, trial conversions, paid subscriptions, revenue and proceeds
                                       per day, per Apple Ads campaign and keyword (RevenueCat's attribution),
                                       into revenuecat_keyword_daily. Read-only towards RevenueCat.
    --days <n|auto>                    Trailing days to pull, in UTC (default 7). auto: 7, widened to cover every
                                       day since the source's last successful sync.

A RevenueCat project is tracked with:
  pnpm product add-source <product> --source ${SOURCE} --kind project --value <project id, proj...> \\
    --config '{"currency": "USD"}'

Credentials: REVENUECAT_API_KEY, a v2 secret key with read-only Charts & metrics access (see .env.example).
Needs RevenueCat's Apple Ads integration switched on; without it every row is "not attributed".
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: "string" },
    all: { type: "boolean", default: false },
    days: { type: "string", default: "7" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [cmd] = positionals;
if (values.help || !cmd) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

if (cmd === "sync") requireIntegration("revenuecat");

switch (cmd) {
  case "sync": {
    const auto = values.days === "auto";
    const fixedDays = Number(values.days);
    if (!auto && (!Number.isInteger(fixedDays) || fixedDays < 1 || fixedDays > MAX_DAYS)) throw new Error(`--days must be "auto" or a whole number from 1 to ${MAX_DAYS}`);
    if (!values.product && !values.all) throw new Error("sync needs --product <id|slug> or --all");
    const product = values.product ? await requireProduct(values.product) : null;
    const sources = (await listTrackedSourcesBySource(SOURCE, product?.id)).filter((s) => s.kind === "project");
    if (!sources.length) {
      console.error(`No enabled ${SOURCE} project is tracked${product ? ` for product "${product.slug}"` : ""}.\n\n${HELP}`);
      process.exit(1);
    }
    const client = new RevenueCatClient(loadApiKey());
    let failures = 0;
    for (const ts of sources) {
      const days = auto ? autoDays(ts.last_scraped_at, 7) : fixedDays;
      console.log(`== ${ts.label ?? `project ${ts.value}`} · trailing ${days} day(s)`);
      try {
        const stats = await syncProject(client, ts, { days, log: (l) => console.log(`   ${l}`) });
        for (const u of stats.unmatched) console.warn(`   WARNING no Apple Ads match for ${u}`);
        console.log(`   ${stats.campaigns} attributed campaign(s), ${stats.rows} daily row(s), ${stats.attributedRows} of them attributed`);
      } catch (e) {
        failures++;
        console.error(`   FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log(`${client.calls} API call(s)`);
    if (failures) process.exit(1);
    break;
  }
  default:
    console.error(`Unknown command "${cmd}"\n\n${HELP}`);
    process.exit(1);
}
