import { parseArgs } from "node:util";
import { ATTRIBUTE_KEYS, attributeValue } from "../meta-ads/attributes.ts";
import { MetaAdsClient } from "../meta-ads/client.ts";
import { MAX_DAYS, SOURCE, syncAccount } from "../meta-ads/sync.ts";
import { defaultDeps, downloadMedia, importMediaFile } from "../meta-ads/media.ts";
import { defaultDeps as pauseDeps, pauseAds } from "../meta-ads/pause.ts";
import { activateObjects, defaultDeps as activateDeps } from "../meta-ads/activate.ts";
import { createAdFromTemplate, defaultDeps as createAdDeps, type TextMode } from "../meta-ads/create-ad.ts";
import { copyAdset, defaultDeps as updateAdsetDeps, updateAdset } from "../meta-ads/update-adset.ts";
import { defaultDeps as adTextDeps, updateAdText } from "../meta-ads/update-ad-text.ts";
import { defaultDeps as launchDeps, launch } from "../meta-ads/launch.ts";
import { defaultDeps as verifyDeps, formatVerifyTable, verifyPlan } from "../meta-ads/verify.ts";
import { addMetaAdsChange, getDb, listTrackedSourcesBySource, requireProduct } from "../db/index.ts";
import type { Json, TrackedSourceRow } from "../db/types.ts";
import type { MetaAdsCallJournalEntry } from "../meta-ads/types.ts";
import { requireIntegration } from "../lib/integrations.ts";
import { docName } from "../lib/product-docs.ts";

export { ATTRIBUTE_KEYS };

const HELP = `Usage: pnpm meta-ads <command> [options]

Commands:
  sync --product <id|slug> | --all     Pull campaigns, ad sets, ads and daily numbers into the database.
    --days <n|auto>                    Trailing days in the ad account's time zone (default auto; maximum ${MAX_DAYS}).
    --dry-run                          Make API calls and print counts without writing to the database.
  status --product <id|slug>           Show the latest sync, object counts, last-seven-day metrics and creative tags.
  tag <creative_id> key=value ...     Merge manual attributes into a creative (database only; no Meta call).
    --remove <key>                     Remove an attribute; may be repeated.
  media --product <id|slug>          Download the video/image behind each creative missing sha256.
    --limit <n>                        Process at most n creatives.
    --creative <id> --file <path>      Import a media file manually for one creative (no Meta call).
    --force                            With --creative: replace a different sha256 already on the creative.
  pause --product <id|slug> --ad <id> [--ad <id> ...] --plan <name> [--dry-run]
                                       Pause ads in the product's ad account (journals each write to meta_ads_changes).
  activate --product <id|slug> (--ad <id> | --adset <id>)... --plan <name> [--dry-run]
                                       Activate ads / ad sets (journals each write to meta_ads_changes).
  adset-update --product <id|slug> --adset <id> [--name <n>] [--min-spend <usd>] [--daily-budget <usd>]
            --plan <name> [--dry-run]
                                       Update an ad set's name, daily_min_spend_target and/or daily_budget (usd → cents).
  adset-copy --product <id|slug> --adset <source id> --name <n> [--daily-budget <usd>] --plan <name> [--dry-run]
                                       Copy an ad set into its campaign WITHOUT its ads, PAUSED, then name it (and set
                                       its daily budget). Activate it with \`activate --adset\` once it has ads.
  create-ad --product <id|slug> --adset <id> --template-ad <id> (--file <mp4> | --video-id <id>)
            --name <ad name> --plan <name> [--validate-only] [--text-mode feed|single]
            [--title <t> ...] [--body <b> ...] [--image-hash <hash>]
                                       Upload a video/image and create a PAUSED ad from a template ad's creative.
  verify --product <id|slug> --plan <name> [--json]
                                       Re-read only the objects a plan's journaled writes touched and compare them
                                       to what the writes set (2 grouped GETs; run once after a batch of writes).
  launch --product <id|slug> --spec <file.json> [--validate-only]
                                       Create every ad in the spec PAUSED, activate them (paced), then mirror
                                       them into the DB. Keep the spec in local/; its plan field is a document name.
  ad-text --product <id|slug> --ad <id> --title <t> ... --body <b> ... --plan <name>
            [--validate-only] [--text-mode feed|single]
                                       Swap an ad's headlines/primary text (rebuilds the inline creative; the ad
                                       keeps its status). --title and --body must both be passed.
                                       NEVER delete or archive ads, ad sets, campaigns or creatives — not even if
                                       the owner asks. These writes are the whole allowlist; pausing is reversible.

An account is tracked with:
  pnpm product add-source <product> --source ${SOURCE} --kind ad_account --value act_<id>

Credentials: META_ADS_READ_TOKEN for reads (legacy META_ADS_TOKEN still works), META_ADS_WRITE_TOKEN for any write (see .env.example).
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: "string" },
    all: { type: "boolean", default: false },
    days: { type: "string", default: "auto" },
    "dry-run": { type: "boolean", default: false },
    remove: { type: "string", multiple: true },
    limit: { type: "string" },
    creative: { type: "string" },
    file: { type: "string" },
    ad: { type: "string", multiple: true },
    adset: { type: "string", multiple: true },
    plan: { type: "string" },
    name: { type: "string" },
    "min-spend": { type: "string" },
    "daily-budget": { type: "string" },
    "template-ad": { type: "string" },
    "video-id": { type: "string" },
    "image-hash": { type: "string" },
    spec: { type: "string" },
    "validate-only": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    "text-mode": { type: "string", default: "feed" },
    title: { type: "string", multiple: true },
    body: { type: "string", multiple: true },
    force: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [command, ...args] = positionals;
if (values.help || !command) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

function ensureAccountSource(ts: TrackedSourceRow): void {
  if (ts.kind !== "ad_account" || !/^act_\d+$/.test(ts.value)) {
    throw new Error(`Tracked source ${ts.id} is not a valid ad_account source`);
  }
}

async function selectedSources(productRef?: string, all = false): Promise<TrackedSourceRow[]> {
  if (Boolean(productRef) === all) throw new Error("specify exactly one of --product <id|slug> or --all");
  const product = productRef ? await requireProduct(productRef) : null;
  const rows = (await listTrackedSourcesBySource(SOURCE, product?.id)).filter((source) => source.kind === "ad_account");
  for (const row of rows) ensureAccountSource(row);
  return rows;
}

async function syncCommand(): Promise<void> {
  const auto = values.days === "auto";
  const fixedDays = Number(values.days);
  if (!auto && (!Number.isInteger(fixedDays) || fixedDays < 1 || fixedDays > MAX_DAYS)) {
    throw new Error(`--days must be "auto" or a whole number from 1 to ${MAX_DAYS}`);
  }
  const sources = await selectedSources(values.product, values.all);
  if (!sources.length) throw new Error(`No enabled ${SOURCE} ad_account is tracked`);
  let failures = 0;

  for (const ts of sources) {
    const journal = values["dry-run"]
      ? undefined
      : async (entry: MetaAdsCallJournalEntry) => {
          await addMetaAdsChange({
            at: new Date().toISOString(),
            actor: "meta-ads sync",
            ad_account_id: ts.value,
            product_id: ts.product_id,
            method: entry.method,
            path: entry.path,
            is_write: entry.method !== "GET",
            request: entry.params as Json,
            status: entry.status,
            response: entry.error ? { error: entry.error } : null,
            usage: entry.usage,
            note: entry.error ?? null,
          });
        };
    const client = metaClient({ journal });
    console.log(`== ${ts.label ?? `account ${ts.value}`}`);
    try {
      const stats = await syncAccount(client, ts, {
        days: auto ? "auto" : fixedDays,
        dryRun: values["dry-run"],
        log: (line) => console.log(`   ${line}`),
      });
      for (const warning of stats.warnings) console.warn(`   WARNING ${warning}`);
      console.log(`   ${client.calls} API call(s); ${values["dry-run"] ? "dry-run; no database writes" : "synced"}`);
    } catch (error) {
      failures++;
      console.error(`   FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures) process.exit(1);
}

async function statusCommand(): Promise<void> {
  if (!values.product) throw new Error("status needs --product <id|slug>");
  const statusError = (error: { message: string }): string => error.message || JSON.stringify(error) || String(error);
  const product = await requireProduct(values.product);
  const sources = (await listTrackedSourcesBySource(SOURCE, product.id)).filter((source) => source.kind === "ad_account");
  if (!sources.length) throw new Error(`No enabled ${SOURCE} ad_account is tracked for product "${product.slug}"`);
  const db = getDb();

  for (const ts of sources) {
    ensureAccountSource(ts);
    const latestDailyResult = await db.from("meta_ads_ad_daily").select("date").eq("product_id", product.id).order("date", { ascending: false }).limit(1).maybeSingle();
    if (latestDailyResult.error) throw new Error(`status: ${statusError(latestDailyResult.error)}`);
    const latestDate = latestDailyResult.data?.date ?? null;
    const startDate = latestDate ? new Date(`${latestDate}T00:00:00.000Z`) : null;
    if (startDate) startDate.setUTCDate(startDate.getUTCDate() - 6);
    const startDateText = startDate?.toISOString().slice(0, 10) ?? null;
    const runResult = await db
      .from("scrape_runs")
      .select("id,status,started_at,finished_at,error,ads_seen")
      .eq("tracked_source_id", ts.id)
      .eq("source", SOURCE)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runResult.error) throw new Error(`status: ${statusError(runResult.error)}`);
    const run = runResult.data;

    const campaignIds: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await db
        .from("meta_ads_campaigns")
        .select("id")
        .eq("product_id", product.id)
        .range(offset, offset + 999);
      if (page.error) throw new Error(`status: ${statusError(page.error)}`);
      campaignIds.push(...(page.data ?? []).map((row) => row.id));
      if ((page.data ?? []).length < 1000) break;
    }
    let adsetCount = 0;
    let adCount = 0;
    for (let offset = 0; offset < campaignIds.length; offset += 100) {
      const batch = campaignIds.slice(offset, offset + 100);
      const adsets = await db.from("meta_ads_adsets").select("id", { count: "exact", head: true }).in("campaign_id", batch);
      if (adsets.error) throw new Error(`status: ${statusError(adsets.error)}`);
      adsetCount += adsets.count ?? 0;
      const ads = await db.from("meta_ads_ads").select("id", { count: "exact", head: true }).in("campaign_id", batch);
      if (ads.error) throw new Error(`status: ${statusError(ads.error)}`);
      adCount += ads.count ?? 0;
    }
    const creativeResult = await db.from("meta_ads_creatives").select("id", { count: "exact", head: true }).eq("product_id", product.id);
    if (creativeResult.error) throw new Error(`status: ${statusError(creativeResult.error)}`);
    const emptyCreativeResult = await db.from("meta_ads_creatives").select("id", { count: "exact", head: true }).eq("product_id", product.id).eq("attributes", "{}");
    if (emptyCreativeResult.error) throw new Error(`status: ${statusError(emptyCreativeResult.error)}`);

    let metricsLine = "Last 7 days: no daily rows";
    if (latestDate && startDateText) {
      let spend = 0;
      let installs = 0;
      let trials = 0;
      for (let offset = 0; ; offset += 1000) {
        const dailyResult = await db
          .from("meta_ads_ad_daily")
          .select("spend,installs,trials")
          .eq("product_id", product.id)
          .gte("date", startDateText)
          .lte("date", latestDate)
          .range(offset, offset + 999);
        if (dailyResult.error) throw new Error(`status: ${statusError(dailyResult.error)}`);
        for (const row of dailyResult.data ?? []) {
          spend += Number(row.spend ?? 0);
          installs += Number(row.installs ?? 0);
          trials += Number(row.trials ?? 0);
        }
        if ((dailyResult.data ?? []).length < 1000) break;
      }
      metricsLine = `Last 7 days (${startDateText} to ${latestDate}): ${spend.toFixed(4)} spend · ${installs} installs · ${trials} trials`;
    }

    let callCount = 0;
    if (run) {
      let callsQuery = db.from("meta_ads_changes").select("id", { count: "exact", head: true }).eq("product_id", product.id).eq("ad_account_id", ts.value).gte("at", run.started_at);
      if (run.finished_at) callsQuery = callsQuery.lte("at", run.finished_at);
      const callsResult = await callsQuery;
      if (callsResult.error) throw new Error(`status: ${statusError(callsResult.error)}`);
      callCount = callsResult.count ?? 0;
    }

    console.log(`== ${ts.label ?? `account ${ts.value}`}`);
    console.log(`Last run: ${run ? `${run.status} at ${run.started_at}${run.error ? ` — ${run.error}` : ""}` : "none"}`);
    console.log(`Campaigns ${campaignIds.length} · ad sets ${adsetCount} · ads ${adCount} · creatives ${creativeResult.count ?? 0}`);
    console.log(metricsLine);
    console.log(`Calls in last run: ${callCount} · creatives with empty attributes: ${emptyCreativeResult.count ?? 0}`);
  }
}

async function mediaCommand(): Promise<void> {
  if (!values.product) throw new Error("media needs --product <id|slug>");
  if (values.creative || values.file) {
    if (!values.creative || !values.file) throw new Error("--creative and --file go together");
    const product = await requireProduct(values.product);
    await importMediaFile(
      product.id,
      values.creative,
      values.file,
      { force: values.force },
      {
        ...defaultDeps,
        log: (line) => console.log(`   ${line}`),
      },
    );
    return;
  }
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  const product = await requireProduct(values.product);
  const sources = (await listTrackedSourcesBySource(SOURCE, product.id)).filter((source) => source.kind === "ad_account");
  if (!sources.length) throw new Error(`No enabled ${SOURCE} ad_account is tracked for product "${product.slug}"`);

  for (const ts of sources) {
    ensureAccountSource(ts);
    const journal = async (entry: MetaAdsCallJournalEntry) => {
      await addMetaAdsChange({
        at: new Date().toISOString(),
        actor: "meta-ads media",
        ad_account_id: ts.value,
        product_id: ts.product_id,
        method: entry.method,
        path: entry.path,
        is_write: entry.method !== "GET",
        request: entry.params as Json,
        status: entry.status,
        response: entry.error ? { error: entry.error } : null,
        usage: entry.usage,
        note: entry.error ?? null,
      });
    };
    const client = metaClient({ journal });
    console.log(`== ${ts.label ?? `account ${ts.value}`}`);
    const stats = await downloadMedia(
      client,
      ts.value,
      product.id,
      { limit },
      {
        ...defaultDeps,
        log: (line) => console.log(`   ${line}`),
      },
    );
    console.log(`   ${stats.scanned} creative(s): ${stats.videos} video(s), ${stats.images} image(s) stored; ${stats.skipped} skipped, ${stats.failures} failed; ${client.calls} API call(s)`);
  }
}

async function tagCommand(): Promise<void> {
  const creativeId = args[0];
  if (!creativeId) throw new Error("tag needs a creative_id");
  const updates: Record<string, string | number> = {};
  const unknownKeys = new Set<string>();
  for (const token of args.slice(1)) {
    const equals = token.indexOf("=");
    if (equals <= 0) throw new Error(`Invalid tag "${token}"; expected key=value`);
    const key = token.slice(0, equals);
    updates[key] = attributeValue(key, token.slice(equals + 1));
    if (!(ATTRIBUTE_KEYS as readonly string[]).includes(key)) unknownKeys.add(key);
  }
  const removes = values.remove ?? [];
  for (const key of removes) {
    attributeValue(key, key === "length_s" ? "1" : "value");
    if (!(ATTRIBUTE_KEYS as readonly string[]).includes(key)) unknownKeys.add(key);
  }
  if (!Object.keys(updates).length && !removes.length) throw new Error("tag needs at least one key=value or --remove key");
  for (const key of unknownKeys) console.warn(`WARNING unknown attribute key "${key}"`);

  const db = getDb();
  const currentResult = await db.from("meta_ads_creatives").select("attributes").eq("id", creativeId).maybeSingle();
  if (currentResult.error) throw new Error(`tag: ${currentResult.error.message}`);
  if (!currentResult.data) throw new Error(`Creative not found: ${creativeId}`);
  const attributes =
    currentResult.data.attributes && typeof currentResult.data.attributes === "object" && !Array.isArray(currentResult.data.attributes)
      ? { ...(currentResult.data.attributes as Record<string, Json>) }
      : {};
  for (const key of removes) delete attributes[key];
  Object.assign(attributes, updates);
  const result = await db.from("meta_ads_creatives").update({ attributes }).eq("id", creativeId);
  if (result.error) throw new Error(`tag: ${result.error.message}`);
  console.log(`Updated attributes for creative ${creativeId}`);
}

// OWNER RULE: pausing is the only write this CLI may ever send to the ad account.
// NEVER delete or archive ads, ad sets, campaigns or creatives — not even if the
// owner asks. Pausing is reversible; deleting is not (see src/meta-ads/client.ts).
async function pauseCommand(): Promise<void> {
  if (!values.product) throw new Error("pause needs --product <id|slug>");
  const adIds = values.ad ?? [];
  if (!adIds.length) throw new Error("pause needs at least one --ad <id>");
  if (!values.plan) throw new Error("pause needs --plan <name> (a reviewed plan document)");
  const client = metaClient();
  const stats = await pauseAds(
    client,
    values.product,
    {
      adIds,
      plan: values.plan,
      dryRun: values["dry-run"],
    },
    { ...pauseDeps, log: (line) => console.log(line) },
  );
  console.log(`   ${stats.paused} ad(s) paused, ${stats.skipped} already paused${values["dry-run"] ? " (dry-run, nothing written)" : ""}`);
}

async function activateCommand(): Promise<void> {
  if (!values.product) throw new Error("activate needs --product <id|slug>");
  if (!values.plan) throw new Error("activate needs --plan <name> (a reviewed plan document)");
  const client = metaClient();
  const stats = await activateObjects(
    client,
    values.product,
    {
      adIds: values.ad ?? [],
      adsetIds: values.adset ?? [],
      plan: values.plan,
      dryRun: values["dry-run"],
    },
    { ...activateDeps, log: (line) => console.log(line) },
  );
  console.log(`   ${stats.activated} object(s) activated, ${stats.skipped} already active${values["dry-run"] ? " (dry-run, nothing written)" : ""}`);
}

function usdToCents(flag: "min-spend" | "daily-budget", min: number): number | undefined {
  const raw = values[flag];
  if (raw === undefined) return undefined;
  const usd = Number(raw);
  if (!Number.isFinite(usd) || usd < min) throw new Error(`--${flag} must be a number of USD, at least ${min}`);
  return Math.round(usd * 100);
}

async function adsetUpdateCommand(): Promise<void> {
  if (!values.product) throw new Error("adset-update needs --product <id|slug>");
  const adsetId = (values.adset ?? [])[0];
  if (!adsetId) throw new Error("adset-update needs --adset <id>");
  if (!values.plan) throw new Error("adset-update needs --plan <name> (a reviewed plan document)");
  const dailyMinSpendCents = usdToCents("min-spend", 0);
  const dailyBudgetCents = usdToCents("daily-budget", 1);
  const client = metaClient();
  await updateAdset(
    client,
    values.product,
    {
      adsetId,
      name: values.name,
      dailyMinSpendCents,
      dailyBudgetCents,
      plan: values.plan,
      dryRun: values["dry-run"],
    },
    { ...updateAdsetDeps, log: (line) => console.log(line) },
  );
}

async function adsetCopyCommand(): Promise<void> {
  if (!values.product) throw new Error("adset-copy needs --product <id|slug>");
  const fromAdsetId = (values.adset ?? [])[0];
  if (!fromAdsetId) throw new Error("adset-copy needs --adset <source ad set id>");
  if (!values.name) throw new Error("adset-copy needs --name <new ad set name>");
  if (!values.plan) throw new Error("adset-copy needs --plan <name> (a reviewed plan document)");
  const newId = await copyAdset(
    metaClient(),
    values.product,
    { fromAdsetId, name: values.name, dailyBudgetCents: usdToCents("daily-budget", 1), plan: values.plan, dryRun: values["dry-run"] },
    { ...updateAdsetDeps, log: (line) => console.log(line) },
  );
  if (newId) console.log(`   new ad set ${newId} is PAUSED with no ads; launch into it, then \`activate --adset ${newId}\``);
}

async function createAdCommand(): Promise<void> {
  if (!values.product) throw new Error("create-ad needs --product <id|slug>");
  const adsetId = (values.adset ?? [])[0];
  if (!adsetId) throw new Error("create-ad needs --adset <id>");
  if (!values["template-ad"]) throw new Error("create-ad needs --template-ad <id>");
  if (!values.name) throw new Error("create-ad needs --name <ad name>");
  if (!values.plan) throw new Error("create-ad needs --plan <name> (a reviewed plan document)");
  const textMode = values["text-mode"] as TextMode;
  if (textMode !== "feed" && textMode !== "single") throw new Error("--text-mode must be feed or single");
  const client = metaClient();
  await createAdFromTemplate(
    client,
    values.product,
    {
      adsetId,
      templateAdId: values["template-ad"],
      file: values.file,
      videoId: values["video-id"],
      imageHash: values["image-hash"],
      name: values.name,
      plan: values.plan,
      validateOnly: values["validate-only"],
      textMode,
      titles: values.title,
      bodies: values.body,
    },
    { ...createAdDeps, log: (line) => console.log(line) },
  );
}

async function launchCommand(): Promise<void> {
  if (!values.product) throw new Error("launch needs --product <id|slug>");
  if (!values.spec) throw new Error("launch needs --spec <file.json>");
  const client = metaClient();
  await launch(client, values.product, { specPath: values.spec, validateOnly: values["validate-only"] }, launchDeps);
}

async function verifyCommand(): Promise<void> {
  if (!values.product) throw new Error("verify needs --product <id|slug>");
  if (!values.plan) throw new Error("verify needs --plan <name> (the plan the writes were journaled under)");
  const planName = docName(values.plan);
  const product = await requireProduct(values.product);
  const sources = (await listTrackedSourcesBySource(SOURCE, product.id)).filter((source) => source.kind === "ad_account");
  if (!sources.length) throw new Error(`No enabled ${SOURCE} ad_account is tracked for product "${product.slug}"`);
  const ts = sources[0]!;
  ensureAccountSource(ts);
  const journal = async (entry: MetaAdsCallJournalEntry) => {
    await addMetaAdsChange({
      at: new Date().toISOString(),
      actor: "meta-ads verify",
      ad_account_id: ts.value,
      product_id: product.id,
      method: entry.method,
      path: entry.path,
      is_write: false,
      request: entry.params as Json,
      status: entry.status,
      response: entry.error ? { error: entry.error } : null,
      usage: entry.usage,
      plan_path: planName,
      note: entry.error ?? null,
    });
  };
  const client = metaClient({ journal, maxCalls: 6 });
  const report = await verifyPlan(client, values.product, { plan: planName }, verifyDeps);
  if (values.json) {
    console.log(JSON.stringify({ ...report, apiCalls: client.calls }, null, 2));
  } else {
    for (const line of formatVerifyTable(report)) console.log(line);
    for (const warning of report.warnings) console.log(`WARNING ${warning}`);
    for (const row of report.skipped) console.log(`not checked: ${row.path}${row.id ? ` (${row.id})` : ""} — ${row.reason}`);
    for (const row of report.failed) console.log(`FAILED: ${row.path}${row.id ? ` (${row.id})` : ""} — status ${row.status ?? "none"}: ${row.note}`);
    console.log(`${client.calls} API call(s)`);
  }
  if (report.failed.length || report.checks.some((c) => !c.ok)) process.exit(1);
}

async function adTextCommand(): Promise<void> {
  if (!values.product) throw new Error("ad-text needs --product <id|slug>");
  const adId = (values.ad ?? [])[0];
  if (!adId) throw new Error("ad-text needs --ad <id>");
  if (!values.plan) throw new Error("ad-text needs --plan <name> (a reviewed plan document)");
  const textMode = values["text-mode"] as TextMode;
  if (textMode !== "feed" && textMode !== "single") throw new Error("--text-mode must be feed or single");
  const client = metaClient();
  await updateAdText(
    client,
    values.product,
    {
      adId,
      titles: values.title ?? [],
      bodies: values.body ?? [],
      plan: values.plan,
      validateOnly: values["validate-only"],
      textMode,
    },
    { ...adTextDeps, log: (line) => console.log(line) },
  );
}

/** Every Meta call goes through here, so a missing token stops with the setup steps instead of a stack trace. */
function metaClient(...args: ConstructorParameters<typeof MetaAdsClient>): MetaAdsClient {
  requireIntegration("meta-ads");
  return new MetaAdsClient(...args);
}

switch (command) {
  case "sync":
    await syncCommand();
    break;
  case "status":
    await statusCommand();
    break;
  case "tag":
    await tagCommand();
    break;
  case "media":
    await mediaCommand();
    break;
  case "pause":
    await pauseCommand();
    break;
  case "activate":
    await activateCommand();
    break;
  case "adset-update":
    await adsetUpdateCommand();
    break;
  case "adset-copy":
    await adsetCopyCommand();
    break;
  case "create-ad":
    await createAdCommand();
    break;
  case "verify":
    await verifyCommand();
    break;
  case "ad-text":
    await adTextCommand();
    break;
  case "launch":
    await launchCommand();
    break;
  default:
    console.error(`Unknown command "${command}"\n\n${HELP}`);
    process.exit(1);
}
