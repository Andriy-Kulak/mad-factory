import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { requireProduct } from "../db/products.ts";
import { addB2BSource, type B2BGroup } from "../b2b-social/db.ts";
import { canonicalLinkedIn, fortune500Matcher, ycMatcher } from "../b2b-social/enrich.ts";
import { enrichWithExa } from "../b2b-social/exa.ts";
import { importSnapshot, type Snapshot } from "../b2b-social/import.ts";
import { parseB2BGroupFilter, syncB2BSocial } from "../b2b-social/sync.ts";
import { integrationStatus, requireIntegration } from "../lib/integrations.ts";

const HELP = `Usage: pnpm b2b-social <command> --product <slug> [options]

B2B Social (docs/B2B_SOCIAL_MVP.md): people who replied or commented on watched X and LinkedIn posts.

Commands:
  add                    Watch an account (or change one): --x <handle> or --linkedin <url>, --group company|team|competitor
                         [--name "<label>"] [--off to stop comments] [--on to resume them] [--reset to backfill it again]
                         [--max-replies 10..100] [--reply-order recency|relevancy] (X only)
  sync                   Fetch what is new since the last run and enrich new people. A new or reset account is
                         backfilled on its first sync (X: last 7 days of posts; LinkedIn: its latest posts)
                         [--group company,team] [--posts-only]
  enrich                 Enrich eligible people already stored with Exa: --max-exa-usd 3, --limit <n>, --dry-run
  import --file <path>   Load a local snapshot (the B2BSocialData JSON) into the b2b_ tables and the watch list

Options:
  --product <slug>       Product (required)
  --max-credits <n>      ScrapeCreators credits per run (default 150)
  --max-x-usd <n>        X API dollars per run (default 8)
  --max-exa-usd <n>      Exa dollars per run (default 3)
  --max-replies <n>      X replies per post per check, 10–100 (default 100)
  --reply-order <value>  X reply order: recency (default) or relevancy
  --group <groups>       Restrict sync to comma-separated company, team and/or competitor groups
  --posts-only           Sync new posts only; skip comments, profile enrichment and Exa
  --fortune500 <path>    Fortune 500 CSV for tagging (default: committed reference list)
  --yc <path>            YC companies CSV for tagging (default: committed reference list)
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
      x: { type: "string" },
      linkedin: { type: "string" },
      group: { type: "string" },
      name: { type: "string" },
      off: { type: "boolean" },
      on: { type: "boolean" },
      reset: { type: "boolean", default: false },
      "max-replies": { type: "string" },
      "reply-order": { type: "string" },
      "posts-only": { type: "boolean", default: false },
      "max-credits": { type: "string", default: "150" },
      "max-x-usd": { type: "string", default: "8" },
      "max-exa-usd": { type: "string", default: "3" },
      limit: { type: "string" },
      fortune500: { type: "string", default: fileURLToPath(new URL("../b2b-social/reference/fortune500.csv", import.meta.url)) },
      yc: { type: "string", default: fileURLToPath(new URL("../b2b-social/reference/yc.csv", import.meta.url)) },
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
  if (command === "add") {
    const group = values.group as B2BGroup | undefined;
    if (!group || !["company", "team", "competitor"].includes(group)) throw new Error("add needs --group company, team or competitor");
    if (values.off && values.on) throw new Error("--off and --on cannot be used together");
    let input: { platform: "x" | "linkedin"; handle: string; url: string };
    if (values.x) {
      const handle = values.x
        .replace(/^@/, "")
        .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, "")
        .split(/[/?]/)[0]!
        .toLowerCase();
      if (!/^[a-z0-9_]{1,15}$/.test(handle)) throw new Error(`Not an X handle: ${values.x}`);
      input = { platform: "x", handle, url: `https://x.com/${handle}` };
    } else if (values.linkedin) {
      const url = canonicalLinkedIn(values.linkedin);
      const m = url?.match(/^https:\/\/www\.linkedin\.com\/(company|school|in)\/([^/]+)$/);
      if (!url || !m) throw new Error("--linkedin must be a company page (linkedin.com/company/<slug>) or a profile (linkedin.com/in/<slug>)");
      input = { platform: "linkedin", handle: m[2]!.toLowerCase(), url };
    } else {
      throw new Error("add needs --x <handle> or --linkedin <url>");
    }
    const maxReplies = values["max-replies"] === undefined ? undefined : Number(values["max-replies"]);
    if (maxReplies !== undefined && (!Number.isInteger(maxReplies) || maxReplies < 10 || maxReplies > 100)) {
      throw new Error("--max-replies must be an integer from 10 to 100");
    }
    const replyOrder = values["reply-order"];
    if (replyOrder !== undefined && replyOrder !== "recency" && replyOrder !== "relevancy") {
      throw new Error("--reply-order must be recency or relevancy");
    }
    if (input.platform !== "x" && (maxReplies !== undefined || replyOrder !== undefined)) {
      throw new Error("--max-replies and --reply-order apply only to X accounts");
    }
    const { row, created } = await addB2BSource(product.id, {
      ...input,
      name: values.name ?? null,
      group,
      replies: values.off ? false : values.on ? true : undefined,
      reset: values.reset,
      maxReplies,
      replyOrder,
    });
    const config = (row.config ?? {}) as { max_replies?: number; reply_order?: "recency" | "relevancy" };
    const replySettings = input.platform === "x" ? `, max ${config.max_replies ?? 100} replies, ${config.reply_order ?? "recency"}` : "";
    console.log(
      `${created ? "Watching" : "Updated"} ${input.platform} ${input.handle} (${group}${values.off ? ", comments off" : values.on ? ", comments on" : ""}${replySettings}).${created || values.reset ? " The next sync backfills it." : ""}`,
    );
    return;
  }
  if (command === "import") {
    if (!values.file) throw new Error("import needs --file <path>");
    const snap = JSON.parse(readFileSync(values.file, "utf8")) as Snapshot;
    const n = await importSnapshot(product.id, snap);
    console.log(`Imported into ${product.slug}: ${n.accounts} watched accounts, ${n.posts} posts, ${n.people} people, ${n.comments} comments.`);
    return;
  }
  if (command === "enrich") {
    if (!values["dry-run"] && integrationStatus("exa").configured === false) requireIntegration("exa");
    const maxUsd = Number(values["max-exa-usd"]);
    const limit = values.limit === undefined ? undefined : Number(values.limit);
    if (!Number.isFinite(maxUsd) || maxUsd < 0) throw new Error("--max-exa-usd must be a non-negative number");
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) throw new Error("--limit must be a non-negative integer");
    const result = await enrichWithExa(product.id, {
      maxUsd,
      limit,
      dryRun: !!values["dry-run"],
      f500: fortune500Matcher(values.fortune500 ?? null),
      yc: ycMatcher(values.yc ?? null),
      log: (line) => console.log(line),
    });
    console.log(`Done: ${result.asked} people asked, ${result.matched} matched · $${result.usd.toFixed(2)} Exa`);
    for (const s of result.skipped) console.log(`  skipped: ${s}`);
    return;
  }
  if (command === "sync") {
    if (!values["dry-run"]) requireIntegration("scrapecreators");
    const groups = parseB2BGroupFilter(values.group);
    const postsOnly = !!values["posts-only"];
    const sum = await syncB2BSocial(product.id, {
      maxCredits: Number(values["max-credits"]),
      maxXUsd: Number(values["max-x-usd"]),
      maxExaUsd: Number(values["max-exa-usd"]),
      dryRun: !!values["dry-run"],
      groups,
      postsOnly,
      fortune500Csv: values.fortune500 ?? null,
      ycCsv: values.yc ?? null,
      log: (line) => console.log(line),
    });
    if (!values["dry-run"]) {
      console.log(
        `Done${postsOnly ? " (posts-only)" : ""}: ${sum.newPosts} new posts, ${sum.postsChecked} posts checked, ${sum.newComments} new comments, ${sum.newPeople} new people · ${sum.credits} ScrapeCreators credits, about $${sum.xUsd.toFixed(2)} of X, $${sum.exaUsd.toFixed(2)} of Exa`,
      );
      for (const s of sum.skipped) console.log(`  skipped: ${s}`);
    }
    return;
  }
  throw new Error(`Unknown command "${command}"; expected add, sync, enrich or import`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
