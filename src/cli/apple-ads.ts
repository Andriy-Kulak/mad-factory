import { parseArgs } from "node:util";
import { AppleAdsClient, loadCredentials } from "../apple-ads/client.ts";
import { MAX_DAYS, SOURCE, autoDays, syncApp } from "../apple-ads/sync.ts";
import { MAX_NEW_POPULARITY_TERMS, POPULARITY_FLOOR, TERM_POPULARITY_SOURCE, keywordSuggestions, termPopularity } from "../apple-ads/research.ts";
import { listTrackedSourcesBySource, requireProduct, upsertTermPopularity } from "../db/index.ts";
import { requireIntegration } from "../lib/integrations.ts";

const HELP = `Usage: pnpm apple-ads <command> [options]

Commands:
  sync --product <id|slug> | --all     Pull campaigns, keywords and daily numbers from Apple into the database.
                                       Read-only towards Apple. Re-pulls the trailing days because Apple revises them.
    --days <n|auto>                    Trailing days to pull, counted in the ad account's time zone (default 7).
                                       auto: 7, widened to cover every day since the source's last successful sync,
                                       so a scheduled run that was skipped is filled by the next one.
    --no-search-terms                  Skip the search terms report
    --no-popularity                    Skip looking up Apple popularity for newly targeted keyword texts (max ${MAX_NEW_POPULARITY_TERMS} per run; existing readings are never re-pulled)
  research --product <id|slug>         Apple's keyword suggestions for the app (read-only). popularity is 0-100,
                                       relative across storefronts; 5 is the floor and means "no meaningful volume".
    --terms "a, b, c"                  Look each term up by itself and print its popularity (null = Apple has never
                                       seen it). Without --terms: the terms Apple associates with the app.
    --country <code>                   Storefront filter (default US)
    --json                             Machine-readable output
    --no-save                          Do not write the result to apple_ads_term_popularity (the Apple Keywords tab)

An app is tracked with:
  pnpm product add-source <product> --source ${SOURCE} --kind app --value <App Store ID> \\
    --config '{"ad_account_id": <id>, "currency": "USD", "timezone": "<IANA zone>"}'

Credentials: APPLE_ADS_DIR, or APPLE_ADS_CLIENT_ID / _TEAM_ID / _KEY_ID / _PRIVATE_KEY (see .env.example).
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: "string" },
    all: { type: "boolean", default: false },
    days: { type: "string", default: "7" },
    "no-search-terms": { type: "boolean", default: false },
    "no-popularity": { type: "boolean", default: false },
    terms: { type: "string" },
    country: { type: "string", default: "US" },
    json: { type: "boolean", default: false },
    "no-save": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [cmd] = positionals;
if (values.help || !cmd) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

if (cmd === "sync" || cmd === "research") requireIntegration("apple-ads");

switch (cmd) {
  case "sync": {
    const auto = values.days === "auto";
    const fixedDays = Number(values.days);
    if (!auto && (!Number.isInteger(fixedDays) || fixedDays < 1 || fixedDays > MAX_DAYS)) throw new Error(`--days must be "auto" or a whole number from 1 to ${MAX_DAYS}`);
    if (!values.product && !values.all) throw new Error("sync needs --product <id|slug> or --all");
    const product = values.product ? await requireProduct(values.product) : null;
    const sources = (await listTrackedSourcesBySource(SOURCE, product?.id)).filter((s) => s.kind === "app");
    if (!sources.length) {
      console.error(`No enabled ${SOURCE} app is tracked${product ? ` for product "${product.slug}"` : ""}.\n\n${HELP}`);
      process.exit(1);
    }
    const client = new AppleAdsClient(loadCredentials());
    let failures = 0;
    for (const ts of sources) {
      const days = auto ? autoDays(ts.last_scraped_at, 7) : fixedDays;
      console.log(`== ${ts.label ?? `app ${ts.value}`} · trailing ${days} day(s)`);
      try {
        const stats = await syncApp(client, ts, {
          days,
          searchTerms: !values["no-search-terms"],
          popularity: !values["no-popularity"],
          log: (l) => console.log(`   ${l}`),
        });
        for (const w of stats.warnings) console.warn(`   WARNING ${w}`);
        console.log(`   ${stats.campaigns} campaign(s), ${stats.keywords} keyword(s), ${stats.negatives} negative(s), ${stats.dailyRows} daily row(s), ${stats.searchTermRows} search-term row(s), ${stats.popularityTerms} new popularity term(s)`);
      } catch (e) {
        failures++;
        console.error(`   FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log(`${client.calls} API call(s), rate limit remaining ${client.rateLimitRemaining ?? "unknown"}`);
    if (failures) process.exit(1);
    break;
  }
  case "research": {
    if (!values.product) throw new Error("research needs --product <id|slug>");
    const product = await requireProduct(values.product);
    const [ts] = (await listTrackedSourcesBySource(SOURCE, product.id)).filter((s) => s.kind === "app");
    if (!ts) throw new Error(`No enabled ${SOURCE} app is tracked for product "${product.slug}"`);
    const adAccountId = Number((ts.config as Record<string, unknown>).ad_account_id);
    const client = new AppleAdsClient(loadCredentials());
    const countries = [values.country.toUpperCase()];
    const terms = values.terms?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
    const pulledAt = new Date().toISOString();
    let rows: { term: string; popularity: number | null }[];
    if (terms.length) {
      const pop = await termPopularity(client, adAccountId, ts.value, countries, terms);
      rows = [...pop].map(([term, popularity]) => ({ term, popularity }));
      if (values.json) console.log(JSON.stringify(Object.fromEntries(pop), null, 2));
      else for (const [t, p] of pop) console.log(`${p === null ? "  -" : String(p).padStart(3)}  ${t}${p !== null && p <= POPULARITY_FLOOR ? "  (floor)" : ""}`);
    } else {
      const got = await keywordSuggestions(client, adAccountId, ts.value, countries);
      rows = got.map((s) => ({ term: s.text.toLowerCase(), popularity: s.popularity }));
      if (values.json) console.log(JSON.stringify(got, null, 2));
      else for (const s of got) console.log(`${String(s.popularity).padStart(3)}  ${s.text}`);
    }
    if (!values["no-save"]) {
      const source = terms.length ? TERM_POPULARITY_SOURCE : "suggestions/keywords (app seed)";
      const n = await upsertTermPopularity(rows.map((r) => ({ product_id: product.id, country: countries[0]!, term: r.term.toLowerCase(), popularity: r.popularity, source, pulled_at: pulledAt })));
      console.error(`saved ${n} term(s) to apple_ads_term_popularity`);
    }
    console.error(`${client.calls} API call(s), rate limit remaining ${client.rateLimitRemaining ?? "unknown"}`);
    break;
  }
  default:
    console.error(`Unknown command "${cmd}"\n\n${HELP}`);
    process.exit(1);
}
