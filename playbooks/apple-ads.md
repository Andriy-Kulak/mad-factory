# Apple Ads playbook

How to operate Apple Ads campaigns from this repository. Generic: no product names, IDs or keywords belong here.
Product facts live in the database (`tracked_sources`, `apple_ads_*`, `experiments`, `experiment_log`) and in `product_docs`.
Design and schema: `docs/apple-ads-plan.md`.

## The loop

1. `pnpm apple-ads sync --product <slug>` pulls campaigns, keywords and the trailing 7 days into the database.
   It only reads. Apple revises recent days, so re-pulling is normal. Use `--days 30` after a gap.
2. Read the numbers from the database or the web app (`pnpm web`, Apple Ads screen). Do not call the API to
   "look around"; raw responses are large and cost tokens for nothing.
3. Find the running experiment (`pnpm experiment list --product <slug>`), read its write-up with MCP `product_docs`
   or `pnpm product docs show <slug> <name>`, its `rules` and the last few log entries
   (`pnpm experiment history --product <slug> --experiment <slug>`) to know what was decided last time.
4. Apply the rules below to the numbers. If a change is warranted, add a plan document to `product_docs`
   with a one-line reason per change (`pnpm product docs add <slug> --kind plan --file <path>`). Do not change the ad account yourself unless the owner
   explicitly asks you to apply that change.
5. The owner reviews the plan and applies it locally, or explicitly asks the agent to apply it. Every write is
   journaled in `apple_ads_changes` with the experiment it served. Append a dated entry to the experiment's log saying what was read, what was changed and why:
   `pnpm experiment log --product <slug> --experiment <slug> --kind change --plan <plan name> "<text>"`.
   Every analysis session ends with a log entry, even when the decision is "no change" (`--kind observation`).

The ad account changes only through an approved plan. The owner either applies it locally or explicitly asks an agent
to apply that specific change; that request is the approval, so the agent applies it without asking again, then
records the owner's words and the result in the plan document. Never apply a change the owner did not ask for.

## Keeping the data fresh

A scheduled Devin automation ("mad-factory: daily Apple Ads backfill", 7:00 New York time) runs both syncs every
morning on `main`, read-only:

    pnpm apple-ads sync --all --days auto     # spend, taps, installs per keyword and search term (Apple)
    pnpm revenuecat sync --all --days auto    # trials, conversions, revenue per keyword (RevenueCat)

`--days auto` re-pulls the trailing 7 days and widens the window to cover any days since the last successful sync,
so missed runs heal on the next success. After a longer gap, run either command with `--days 30`. Check freshness
before trusting numbers: the newest `scrape_runs` rows with `source = 'apple_ads'` and `source = 'revenuecat'`
should be under about 30 hours old.

## Hard rules

- Touch only campaigns whose `product_id` is the product you were asked about. One ad account holds several apps,
  and campaign names do not identify the app; `apple_ads_campaigns.app_store_id` does.
- Never recreate objects that exist. Read by ID and update. If a write times out, sync and reconcile before retrying.
- Never add a keyword the experiment lists under `rules.never_target`.
- **Discovery mirror:** A keyword is active in one campaign only. Adding a category keyword is three writes: EXACT in
  the generic campaign, EXACT negative in the discovery campaign, and BROAD in the discovery campaign (same ad group
  as the other broads, using discovery's broad bid). Competitor and brand keywords get the first two only.
  `pnpm brief` lists any gap under "Check before trusting the numbers".
- Change a keyword's bid at most once per 24 hours (check `apple_ads_changes`).
- Never print, paste or commit credentials. They live outside git (`APPLE_ADS_DIR`) or in CI secrets.

## Reading the numbers

- A keyword with no rows in `apple_ads_keyword_daily` has never served. That is the first thing a new test shows.
- Tap rate = taps / impressions. Install rate = tap installs / taps. Cost per install = spend / tap installs.
  View installs (saw the ad, installed later without tapping) are stored separately; do not mix them in.
- Small numbers lie. Do not judge a keyword below the thresholds in the experiment's `rules`.
- Apple's popularity score is relative, not search volume. A sample term may receive the same score as a widely
  searched phrase, so validate demand with impressions, taps and paid outcomes rather than treating the score as a forecast.
- Apple withholds low-volume search terms (`search_term = ''`). Expect most rows to be withheld early on.
- Trials, conversions, revenue and proceeds per keyword are in `revenuecat_keyword_daily`, from RevenueCat's Apple Ads
  attribution. Join to `apple_ads_keyword_daily` on `apple_keyword_id` (and `apple_campaign_id`). Cost per trial =
  spend / `new_trials`. RevenueCat credits the customer's install keyword, not the search term behind it, so a
  broad keyword's trials cannot be split by search term. Rows with `campaign = ''` are customers with no Apple Ads
  attribution. If every row in the window has `campaign = ''`, RevenueCat is not receiving attribution: say
  "cost per install" and do not estimate trials. Days are UTC in RevenueCat and the ad account's zone in Apple, so
  compare over several days, not one. Rows with `incomplete = true` are still filling in.

## Default decision rules

The experiment's `rules` JSON overrides these.

- Not serving (under 20 impressions in 3 days): raise the bid 10% every 2 days up to the experiment's cap.
- Pause a keyword at over 300 impressions with tap rate under 3%, or over 30 taps with install rate under 30%,
  or when spend passes the experiment's no-trial limit.
- Weekly, review discovery search terms: irrelevant ones become exact negatives; relevant ones with taps and
  installs become exact keywords in the matching campaign (and exact negatives in discovery).
- Judge a campaign type or a country only on whole-experiment totals, never on one day.

## API facts verified on the live v1 API

Base `https://api.ads.apple.com/v1`. Older Search Ads v5 shapes are rejected. The client is `src/apple-ads/client.ts`.

- Auth: ES256 JWT (`iss` team, `sub` client, `aud` https://appleid.apple.com) exchanged at
  `https://appleid.apple.com/auth/oauth2/token` with `grant_type=client_credentials`, `scope=searchadsorg`.
  Every call sends `Authorization: Bearer …` and `X-AP-Context: adAccountId=<id>`.
- Responses wrap the payload in `result`. Many read-only calls are `POST …/query`.
- List queries filter with `{"filters":[{"field":"adGroupId","operator":"EQUALS","value":<id>}],"pagination":{"offset":0,"pageSize":200}}`.
  A top-level `adGroupId` is rejected. Always paginate; the default page is 20.
- Reports: `{"timeRange":{"start","end","timeZone":"ORTZ","granularity":"DAILY"},"groupBy":["countryOrRegion"],"filters":[campaignId EQUALS],"pagination"}`.
  Keyword and search-term reports require the `campaignId` filter; the campaign report rejects it.
  Rows are in `result.rows`; with no data `result` is `{}`. Days without activity are `{ "date" }` only.
  Keywords and countries without activity return no row. `insights.bidRecommendation` is per row, not per day.
- Entity timestamps are UTC without a suffix; report metadata shows the same moments in the account time zone.
  Report dates are calendar days in the account time zone (`ORTZ`).
- Targeting keywords and negative keywords use different ID sequences.
- Writes that Apple accepted: `PUT /keywords/{id}` with only `bid` and/or `status`; `POST /keywords/bulk-create`
  with `{"items":[{"correlationId":<number>,"data":{adGroupId, text, matchType, bid, status}}]}` (a bare array or a
  string `correlationId` is a 400); `POST /negative-keywords/bulk-create` with the same `items` shape and `data`
  `{adGroupId, text, matchType, status}` for an ad-group negative (`campaignId` instead of `adGroupId` for a
  campaign negative). Status values are `ENABLED`/`PAUSED`. Any single failing item rejects the whole batch unless
  `allowPartialSuccess: true`; `POST /adgroups` needs an explicit `startTime`;
  `POST /ads` is rejected for App Store search-results campaigns (the default presentation runs without an ad).
- Keyword research (read-only): `POST /suggestions/keywords/query` with
  `filters: [{promotedObjectId EQUALS ["<app id>"]}, {promotedObjectType EQUALS ["APPSTORE_APP"]}, {countriesOrRegions IN [..]}, optional {terms IN [..]}]`
  and `pagination {offset, limit}` returns `{text, popularity}` (scalar filter values are rejected as "not readable").
  `POST /insights/apps/search-term-popularity/query` needs `timeRange {start, end, granularity: MONTHLY|WEEKLY}` and
  `countryOrRegion` + `genre` (enum, e.g. `EDUCATION`) filters; `pagination.limit` is rejected. Neither gives popularity for a term you choose.
  Use `pnpm apple-ads research --product <slug> [--terms "a, b"]` (src/apple-ads/research.ts) rather than hand-rolled calls;
  the score is relative across storefronts and shifts with the seed set, so it is not a search-volume estimate.
  A sample term may receive the same score as a widely searched phrase. For bid decisions, actual exact-keyword
  performance in `apple_ads_keyword_daily` is the source of truth; record requested re-checks in the plan document.
- The daily sync looks up popularity once for any newly targeted keyword text (max 10 per run; the rest are tried on the next run); existing readings are only re-pulled by hand with `research --terms` when the owner asks.
- Negative keywords are created with the same `{items: [{correlationId, data: {adGroupId, text, matchType, status: "ENABLED"}}]}` envelope as
  `POST /keywords/bulk-create`; a bare array is rejected. The method is written up in `docs/reference/apple-ads-guide-ivan-sparrow.txt`.
- Rate limits: read `RateLimit-Remaining` on every response, one request at a time, wait for `Retry-After` on 429,
  never loop on validation errors.
