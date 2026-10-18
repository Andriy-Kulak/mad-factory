import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { requireProduct } from "../db/products.ts";
import { importSnapshot, type Snapshot } from "../b2b-social/import.ts";
import { syncB2BSocial } from "../b2b-social/sync.ts";
import { requireIntegration } from "../lib/integrations.ts";

const HELP = `Usage: pnpm b2b-social <command> --product <slug> [options]

B2B Social (docs/B2B_SOCIAL_MVP.md): people who replied or commented on watched X and LinkedIn posts.

Commands:
  import --file <path>   Load a local snapshot (the B2BSocialData JSON) into the b2b_ tables and the watch list
  sync                   Fetch what is new since the last run and enrich new people

Options:
  --product <slug>       Product (required)
  --max-credits <n>      ScrapeCreators credits per run (default 150)
  --max-x-usd <n>        X API dollars per run (default 8)
  --fortune500 <path>    Fortune 500 CSV for tagging (default local/reference/f500-raw.csv)
  --yc <path>            YC companies JSON (default local/reference/yc/companies.json)
  --dry-run              Show what is due without calling any API
  -h, --help
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      product: { type: "string" },
      file: { type: "string" },
      "max-credits": { type: "string", default: "150" },
      "max-x-usd": { type: "string", default: "8" },
      fortune500: { type: "string", default: "local/reference/f500-raw.csv" },
      yc: { type: "string", default: "local/reference/yc/companies.json" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || !command || !values.product) {
    console.log(HELP);
    if (!values.help) process.exitCode = 1;
    return;
  }
  const product = await requireProduct(values.product);
  if (command === "import") {
    if (!values.file) throw new Error("import needs --file <path>");
    const snap = JSON.parse(readFileSync(values.file, "utf8")) as Snapshot;
    const n = await importSnapshot(product.id, snap);
    console.log(`Imported into ${product.slug}: ${n.accounts} watched accounts, ${n.posts} posts, ${n.people} people, ${n.comments} comments.`);
    return;
  }
  if (command === "sync") {
    if (!values["dry-run"]) {
      requireIntegration("scrapecreators");
      requireIntegration("x-api");
    }
    const sum = await syncB2BSocial(product.id, {
      maxCredits: Number(values["max-credits"]),
      maxXUsd: Number(values["max-x-usd"]),
      dryRun: !!values["dry-run"],
      fortune500Csv: values.fortune500 ?? null,
      ycJson: values.yc ?? null,
      log: (line) => console.log(line),
    });
    if (!values["dry-run"]) {
      console.log(
        `Done: ${sum.newPosts} new posts, ${sum.postsChecked} posts checked, ${sum.newComments} new comments, ${sum.newPeople} new people · ${sum.credits} ScrapeCreators credits, about $${sum.xUsd.toFixed(2)} of X`,
      );
      for (const s of sum.skipped) console.log(`  skipped: ${s}`);
    }
    return;
  }
  throw new Error(`Unknown command "${command}"; expected import or sync`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
