import { parseArgs } from "node:util";
import { getCreativeProfile } from "../db/index.ts";
import { applyAngles, tagAngles } from "../creative-profiles/angles.ts";
import { latestFlashModel } from "../creative-profiles/gemini.ts";
import { pickComplete, profileCreatives } from "../creative-profiles/profile.ts";
import { defaultDeps as anglesDefaultDeps } from "../creative-profiles/angles.ts";

const HELP = `Usage: pnpm creatives <command> [options]

Commands:
  profile --product <slug>           Have an LLM break down each stored media file into a creative profile.
    --source own|library|all|favorites  Which creatives to profile (default all; favorites = starred ads and posts).
    --limit <n>                      Profile at most n creatives (counted after skipping already-profiled ones).
    --min-days <n>                   Ad Library media only: skip files whose longest-running ad ran under n days.
    --model <id>                     Bare Gemini id for the direct API, or google/<id> for the AI Gateway
                                     (default: latest stable Gemini Flash, resolved at runtime).
    --force                          Re-profile creatives that already have a profile (keeps manual keys).
    --concurrency <n>                Parallel profiles (default 3).
    --dry-run                        Print profiles instead of writing them.
  angles --product <slug>            Re-tag strategy.angle on stored profiles from the angle library.
    --out <file>                       Write suggested angles as JSON (no database writes).
    --apply <file>                     Apply a reviewed --out file to the stored profiles.
    --source own|library|all         Which creatives to consider (default all).
    --limit <n>                      Re-tag at most n profiles.
    --model <id>                     Same routing as profile (default: latest stable Gemini Flash).
    --concurrency <n>                Parallel re-tags (default 3).
  show <sha256>                      Print the stored profile for a media file.

Credentials: GEMINI_API_KEY (AI_GATEWAY_API_KEY only for google/… model ids; see .env.example).
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: "string" },
    source: { type: "string", default: "all" },
    limit: { type: "string" },
    "min-days": { type: "string" },
    model: { type: "string" },
    out: { type: "string" },
    apply: { type: "string" },
    force: { type: "boolean", default: false },
    concurrency: { type: "string", default: "3" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [command, ...args] = positionals;
if (values.help || !command) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

async function profileCommand(): Promise<void> {
  if (!values.product) throw new Error("profile needs --product <slug>");
  if (values.source !== "own" && values.source !== "library" && values.source !== "all" && values.source !== "favorites") {
    throw new Error("--source must be own, library, all or favorites");
  }
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  const minDays = values["min-days"] === undefined ? undefined : Number(values["min-days"]);
  if (minDays !== undefined && (!Number.isInteger(minDays) || minDays < 1)) {
    throw new Error("--min-days must be a positive integer");
  }
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }

  const model = values.model ?? (await latestFlashModel());
  const stats = await profileCreatives(values.product, {
    source: values.source,
    limit,
    minDays,
    model,
    force: values.force,
    concurrency,
    dryRun: values["dry-run"],
  });
  console.log(`Done: ${stats.selected} selected, ${stats.profiled} profiled, ${stats.skipped} skipped, ${stats.failures} failed`);
}

async function anglesCommand(): Promise<void> {
  if (!values.product) throw new Error("angles needs --product <slug>");
  if (values.source !== "own" && values.source !== "library" && values.source !== "all") {
    throw new Error("--source must be own, library or all");
  }
  if (Boolean(values.out) === Boolean(values.apply)) {
    throw new Error("angles needs exactly one of --out <file> or --apply <file>");
  }
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (values.apply) {
    await applyAngles(values.product, { file: values.apply });
    return;
  }
  const model = values.model ?? (await latestFlashModel());
  await tagAngles(
    values.product,
    {
      source: values.source,
      limit,
      model,
      concurrency,
      out: values.out!,
    },
    {
      ...anglesDefaultDeps,
      complete: (messages, options) => pickComplete(options.model)(messages, options),
    },
  );
}

async function showCommand(): Promise<void> {
  const sha = args[0];
  if (!sha) throw new Error("show needs a sha256");
  const row = await getCreativeProfile(sha);
  if (!row) throw new Error(`No profile for ${sha}`);
  console.log(JSON.stringify(row.profile, null, 2));
}

switch (command) {
  case "profile":
    await profileCommand();
    break;
  case "angles":
    await anglesCommand();
    break;
  case "show":
    await showCommand();
    break;
  default:
    console.error(`Unknown command "${command}"\n\n${HELP}`);
    process.exit(1);
}
