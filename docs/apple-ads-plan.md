# Apple Ads campaign tracking and experiment tracking: game plan

Status: **approved 2026-09-18. Built so far: step 1 (migration + local `sync`), the experiment record and `pnpm experiment`, the playbook, skill and
first write-up, and an Apple Ads screen in the web app. The scheduled sync workflow exists and skips itself until its secrets are added (section 9).
Not built: `status`, `report`, `apply`, journal import.**
Written as a design note for the repository; current implementation and repository guidance take precedence.

This document records the design and implementation history for the Apple Ads integration.

---

## 1. Summary

### What will be built

A small, deterministic Apple Ads module inside `mad-factory`, next to the existing Meta Ad Library
scraper. It is purely additive: no Meta table, file or command is removed or renamed. It consists of:

1. **Seven new Postgres tables** (one migration) that hold the current state of Apple Ads campaigns
   and keywords, daily performance numbers per keyword and per search term split by country, a
   journal of every change made to the ad account, and a thin, channel-agnostic record of
   experiments.
2. **One command-line tool, `pnpm apple-ads`,** with four subcommands:
   `sync` (pull data from Apple into the database), `status` (print a compact summary of a running
  experiment), `report` (print one of a few fixed tables of numbers), and `apply` (the only path
  that changes anything in the ad account, always from a plan document the owner has approved, always
  journaled).
3. **Reasoning documents:** the methodology in `playbooks/apple-ads.md`; experiment write-ups and
   plans live in `product_docs` and are read through the database-backed document commands.
4. **A scheduled GitHub Actions job** that runs `sync` every morning with a separate *read-only*
   Apple Ads API key, so the key that can spend money never leaves the owner's computer.

### How the owner uses it day to day

On the owner's computer, in this repository:

```bash
pnpm apple-ads sync --product <slug>      # once the scheduled job exists, this is only needed for a fresh pull
pnpm apple-ads status --product <slug>    # about 20 lines: spend vs cap, per-campaign rates, keywords needing attention
```

The owner, or an authorized agent, reads the `status` output. That
output costs roughly 400 tokens instead of the tens of thousands it costs an agent to call the API
and read raw JSON. The agent applies the rules in `playbooks/apple-ads.md` to the summary and, if a
change is warranted, writes a small plan document. The owner reads the plan, then runs
`pnpm apple-ads apply <plan> --confirm` locally. The change and Apple's response land in the
`apple_ads_changes` table tagged with the experiment. Code does the fetching, storing and
arithmetic; agents only make judgment calls.

### Terms used in this document

- **Apple Ads** (formerly Apple Search Ads): ads in App Store search results. An advertiser bids on
  **keywords**; when a person's **search term** matches a keyword, the ad may show.
- **Impression**: the ad was shown. **Tap**: the person tapped it. **Install**: the person then
  downloaded the app. **Tap rate** is taps ÷ impressions; **install rate** is installs ÷ taps.
- **Match type**: `EXACT` means the keyword matches only that search (and close variants); `BROAD`
  matches related searches too. A **negative keyword** blocks the ad from showing for that search.
- **Ad group**: a container inside a campaign that holds keywords. Every campaign in the current
  test has exactly one.
- **Discovery campaign**: a broad-match campaign whose purpose is to reveal which real search terms
  people type, so that good ones can be promoted to exact keywords later.
- **Ad account** (Apple calls it an *organization*): the billing entity. The owner's one ad account
  holds campaigns for three different apps.
- **Max CPT bid**: the most the advertiser will pay for one tap on a keyword.
- **PGlite**: the in-memory Postgres this repository uses to test migrations without a Supabase
  project.

---

## 2. Things found while preparing this plan that the owner should know first

These notes summarize the initial implementation research. Current repository code and database
state are authoritative.

### 2.1 Repository and integration notes

Implementation details in this design note are historical. Current repository instructions, CLI
help and database schema are authoritative for branch, migration and integration workflows.

### 2.2 Product and campaign records

Product, campaign and experiment specifics live in database tables and `product_docs`; repository
files contain code, generic operating guidance and fictional examples only.

### 2.3 RevenueCat is *not* yet confirmed to receive Apple Ads attribution

Confirm that the attribution integration is enabled before using cost-per-trial as a decision
metric. Until then, trial outcomes may not be attributable to a keyword.

### 2.4 What the live API actually does (verified 2026-09-18)

| Finding | Effect on the design |
| --- | --- |
| `POST /reports/apps/keywords/query` **rejects a request without a `campaignId` filter** ("campaignId filter is required for KEYWORD reports"). The same filter shape works on the search terms report. | `sync` makes one keyword-report call and one search-terms-report call **per campaign**, with `"filters":[{"field":"campaignId","operator":"EQUALS","value":<id>}]`. |
| `"groupBy":["countryOrRegion"]` is accepted together with `"granularity":"DAILY"`. Each row is then one keyword in one country, with `metadata.countryOrRegion` set. | The per-day, per-keyword, per-country table is filled by a single call per campaign. |
| The payload is `result.rows[]`. **When there is no data, `result` is `{}` with no `rows` key.** | The code must treat a missing `rows` as an empty list. |
| When grouped by country, **keywords and countries with no activity return no row at all.** A campaign enabled today returned zero rows. | "Which keywords serve at all" is answered by *absence*: keywords in `apple_ads_keywords` with no rows in the daily table. No zero rows are stored. |
| Each row has `metadata`, `totalMetrics`, `granularMetrics[]`, and `insights`. A day with no activity appears in `granularMetrics` as `{"date": "…"}` with no metric fields. | Skip granular entries that have only a date. |
| `insights.bidRecommendation` (Apple's suggested bid range) is **one value per row, not per day**, and was `{}` for all brand keywords. Its populated shape has not been observed yet. | It is a snapshot of "now", so it is stored on the keyword (current state), not on daily rows. This is a deliberate change from the proposed schema; see 4.2. It is stored as JSON until a populated response has been seen. |
| In the search terms report, **`metadata.searchTermText` is `null`** when Apple withholds a low-volume term for privacy. `metadata.searchTermSource` is `TARGETED` (matched a keyword) or `AUTO` (Search Match). The matched keyword is nested at `metadata.keyword`. | The search-term table stores withheld terms as the empty string so they can be part of the primary key, and reports label them "(low volume, withheld)". |
| `POST /campaigns/query` accepts `{"pagination":{"offset":0,"pageSize":100,"fetchTotalCount":true}}` (in the journal, 2026-09-11). The account has 18 campaigns; Apple's default page size is 20. | Always send explicit pagination and loop until `offset + pageSize ≥ totalCount`. |
| Campaign names do not identify the app (for example `ES_generic` belongs to a different app than the one its name suggests). `promotedObjectId` (the App Store ID) does. | Campaigns are assigned to products by App Store ID, never by name. |
| Entity endpoints return timestamps in UTC (`creationTime: 2026-09-17T20:07:09`), while report `metadata` returns the same moment in the account time zone (`14:07:09`). Neither has an offset suffix. | Timestamps are taken only from entity endpoints and stored as UTC. Report dates (`granularMetrics[].date`) are calendar dates in the account time zone (`timeZone: "ORTZ"` means "organization time zone", America/Denver here). |
| Targeting keyword IDs and negative keyword IDs come from **different ID sequences** (a keyword and a negative created the same minute: `2320902916` vs `2343758022`). | An ID alone is not guaranteed unique across the two kinds, so the keywords table's primary key is `(id, is_negative)`. |
| Rate limit header reported `remaining 200` after every call. | About 25 calls per daily sync is well inside the limit. Calls stay sequential. |

Metric fields available per day (verified): `impressions`, `taps`, `localSpend{amount,currency}`,
`tapInstalls`, `viewInstalls`, `totalInstalls`, `totalNewDownloads`, `totalRedownloads`, plus
derived rates (`ttr`, `cpt`, `tapInstallRate`, …) that are not stored because they can be
recomputed.

### 2.5 Are the owner's settled decisions sound?

Yes, with three small refinements, each explained where it appears:
(a) suggested bid range moves from the daily table to the keywords table (2.4);
(b) the experiments table gains one `rules` JSON column so that `status` can flag keywords without
any threshold being hardcoded (4.6);
(c) no new "apps" or "sync runs" tables: the existing `tracked_sources` and `scrape_runs` tables
already fit (section 3).

---

## 3. How this fits the existing schema

The existing migration anticipated this. Its comment on `tracked_sources` reads: "`source` names
the platform (meta, later apple_search_ads, …)". So:

- **Which app belongs to which product** is one row in the existing `tracked_sources` table:
  `source = 'apple_ads'`, `kind = 'app'`, `value = '<App Store ID>'`, `country = 'ALL'`,
  `config = {"ad_account_id": <number>, "currency": "USD", "timezone": "America/Denver"}`.
  It is created with the existing `pnpm product add-source` command (which will need `--source` and
  `--config` flags if it lacks them). The Sonito and Chiway apps are added the same way whenever
  the owner wants them tracked; until then `sync` ignores their campaigns.
- **Each `sync` run is recorded** in the existing `scrape_runs` table (`source = 'apple_ads'`,
  `status`, `started_at`, `finished_at`, `error`; `ads_seen` holds the number of daily rows
  upserted). The web app's runs page will show Apple syncs with no change.
- **One guard is needed in Meta code:** `pnpm scrape` loops over every enabled tracked source and
  throws on an unknown source name. It must skip rows whose `source` is not a registered scraper.
  This is a two-line filter in `src/cli/scrape.ts` using the existing `knownSources()`, with a
  test. It is the only edit to an existing Meta file in this plan.

Apple Ads is **not** implemented as an `AdSource`. That interface collects *other advertisers'*
creatives into `ads`; this module tracks *the owner's own* campaign performance. The code lives in
`src/apple-ads/` with its command in `src/cli/apple-ads.ts`.

Naming follows the existing migration: lower snake case, plural table names, `uuid` keys with
`gen_random_uuid()` for rows this system invents, `timestamptz`, `jsonb` `raw` columns, `text`
instead of enums, `create … if not exists` so that re-applying is a no-op (the schema test checks
this). Rows that Apple identifies use Apple's numeric ID as a `bigint` key, because every report
row refers to it. (The IDs are around 2.3 billion, far inside JavaScript's safe integer range, so
the generated TypeScript type `number` is safe.)

---

## 4. The tables

### 4.1 `apple_ads_campaigns`: current state of each campaign

**One row represents** one Apple Ads campaign that promotes an app tracked by a product. It is
overwritten on every sync; it is not a history.

| Column | Type | Why it exists | Filled from `POST /campaigns/query` → `result[]` |
| --- | --- | --- | --- |
| `id` | `bigint` primary key | Apple's campaign ID; every report row refers to it | `id` |
| `product_id` | `uuid not null` → `products(id)` on delete cascade | Keys everything by product, because one ad account serves three apps | looked up: `promotedObjectId` = `tracked_sources.value` |
| `tracked_source_id` | `uuid` → `tracked_sources(id)` on delete set null | Which tracked app surfaced it (same pattern as `product_ads`) | same lookup |
| `ad_account_id` | `bigint not null` | Needed for the `X-AP-Context` header on any later call | `adAccountId` |
| `app_store_id` | `text not null` | The app being promoted | `promotedObjectId` |
| `name` | `text not null` | Human label | `name` |
| `status` | `text not null` | What the owner set: `ENABLED` or `PAUSED` | `status` |
| `display_status` | `text` | What is actually happening: `RUNNING`, `PAUSED`, `LIMITED`, `ON_HOLD`… | `displayStatus` |
| `daily_budget` | `numeric(12,2)` | The daily cap, for "spend versus cap" | `dailyBudget.value.amount` |
| `currency` | `text` | | `dailyBudget.value.currency` |
| `countries` | `text[] not null default '{}'` | Targeted countries | `targeting.countryOrRegion.include` |
| `deleted` | `boolean not null default false` | Apple soft-deletes | `deleted` |
| `apple_created_at`, `apple_modified_at` | `timestamptz` | When Apple says it was created / last changed (UTC) | `creationTime`, `modificationTime` |
| `raw` | `jsonb not null` | The full object, so nothing is lost (limiting reasons, bid strategy, placement) | whole element |
| `first_seen_at`, `last_synced_at` | `timestamptz not null default now()` | Same bookkeeping pattern as `ads` | set by `sync` |

**Question it answers:** "What is live for this product right now, and what is the total daily cap?"

```sql
select c.name, c.status, c.display_status, c.daily_budget, c.countries
from apple_ads_campaigns c
join products p on p.id = c.product_id
where p.slug = $1 and not c.deleted
order by c.name;
```

### 4.2 `apple_ads_keywords`: current state of each keyword and negative keyword

**One row represents** one targeting keyword or one negative keyword. Overwritten on every sync.

| Column | Type | Why it exists | Filled from |
| --- | --- | --- | --- |
| `id` | `bigint not null` | Apple's keyword ID | `id` |
| `is_negative` | `boolean not null default false` | Negatives share the table, as decided. Part of the key because the two ID sequences differ (2.4) | which endpoint returned it |
| `campaign_id` | `bigint not null` → `apple_ads_campaigns(id)` on delete cascade | | `campaignId` |
| `ad_group_id` | `bigint not null` | Needed to create or query keywords; there is no ad groups table, as decided | `adGroupId` |
| `text` | `text not null` | The keyword | `text` |
| `match_type` | `text not null` | `EXACT` or `BROAD` | `matchType` |
| `bid` | `numeric(12,4)` | Current max CPT bid; null for negatives | `bid.amount` |
| `currency` | `text` | | `bid.currency` |
| `status` | `text not null` | `ENABLED` or `PAUSED` | `status` |
| `display_status` | `text` | Apple's effective status | `displayStatus` |
| `deleted` | `boolean not null default false` | | `deleted` |
| `bid_recommendation` | `jsonb` | Apple's suggested bid range, a snapshot of "now" (2.4). Moved here from the daily table | keyword report → `rows[].insights.bidRecommendation`, from an ungrouped call |
| `bid_recommendation_at` | `timestamptz` | When that snapshot was taken | set by `sync` |
| `apple_created_at`, `apple_modified_at` | `timestamptz` | | `creationTime`, `modificationTime` |
| `raw` | `jsonb not null` | Full object | whole element |
| `last_synced_at` | `timestamptz not null default now()` | | set by `sync` |

Primary key: `(id, is_negative)`.

Endpoints, one call per ad group, both with the verified body
`{"filters":[{"field":"adGroupId","operator":"EQUALS","value":<id>}],"pagination":{"offset":0,"pageSize":1000}}`:
targeting keywords from `POST /keywords/query`, negatives from `POST /negative-keywords/query`
(both → `result[]`). Ad group IDs come from `POST /adgroups/query` filtered by `campaignId`
(verified in the journal). The maximum accepted `pageSize` is to be confirmed in step 1; 200 is
verified.

**Question it answers:** "Which keywords in this experiment have never served?" (A keyword that
serves has daily rows; one that does not has none.)

```sql
select c.name as campaign, k.text, k.match_type, k.bid, k.bid_recommendation
from apple_ads_keywords k
join apple_ads_campaigns c on c.id = k.campaign_id
where not k.is_negative and k.status = 'ENABLED' and not k.deleted
  and c.id::text in (select external_campaign_id from experiment_campaigns where experiment_id = $1)
  and not exists (select 1 from apple_ads_keyword_daily d where d.keyword_id = k.id)
order by c.name, k.text;
```

### 4.3 `apple_ads_keyword_daily`: performance per day, keyword and country

**One row represents** what one keyword did in one country on one calendar day (account time
zone). Rows exist only where there was activity. This is the main fact table; campaign totals are
sums of these rows, as decided.

| Column | Type | Why it exists | Filled from `POST /reports/apps/keywords/query` → `result.rows[]` |
| --- | --- | --- | --- |
| `date` | `date not null` | | `granularMetrics[].date` |
| `keyword_id` | `bigint not null` | Always a targeting keyword, so no `is_negative` here | `metadata.id` |
| `country` | `text not null` | Two-letter code | `metadata.countryOrRegion` |
| `campaign_id` | `bigint not null` → `apple_ads_campaigns(id)` on delete cascade | Lets campaign sums skip a join | `metadata.campaignId` |
| `impressions`, `taps` | `integer not null default 0` | | same names |
| `tap_installs` | `integer not null default 0` | Installs after a tap: the install count used for install rate and cost per install | `tapInstalls` |
| `view_installs` | `integer not null default 0` | Installs after only seeing the ad. Kept separate because the brand campaign's installs were all of this kind | `viewInstalls` |
| `new_downloads`, `redownloads` | `integer not null default 0` | First-time versus returning users; only new downloads can start a trial | `totalNewDownloads`, `totalRedownloads` |
| `spend` | `numeric(12,4) not null default 0` | Apple reports four decimals (e.g. `0.3749`) | `localSpend.amount` |
| `currency` | `text not null` | | `localSpend.currency` |
| `synced_at` | `timestamptz not null default now()` | When this row was last refreshed; recent days get revised | set by `sync` |

Primary key: `(date, keyword_id, country)`. There is deliberately no foreign key to
`apple_ads_keywords`, because that table's key includes `is_negative`; `sync` upserts keywords
before daily rows, and the join is `k.id = d.keyword_id and not k.is_negative`.

Request body (verified):

```json
{
  "timeRange": {"start": "2026-09-12", "end": "2026-09-18", "timeZone": "ORTZ", "granularity": "DAILY"},
  "groupBy": ["countryOrRegion"],
  "filters": [{"field": "campaignId", "operator": "EQUALS", "value": 2144707682}],
  "pagination": {"offset": 0, "pageSize": 1000}
}
```

A second call per campaign, identical but **without `groupBy`**, is used only to read
`insights.bidRecommendation` into `apple_ads_keywords`. Whether that ungrouped call also returns
keywords with zero activity is to be confirmed in step 1; if it does not, Apple's
`POST /keywords/query` has no recommendation field and the column stays empty for unserved
keywords.

**Questions it answers.** Cost per install by campaign for an experiment:

```sql
select c.name, ec.role,
       sum(d.impressions) as impressions, sum(d.taps) as taps, sum(d.tap_installs) as installs,
       sum(d.spend) as spend,
       round(100.0 * sum(d.taps) / nullif(sum(d.impressions), 0), 1)        as tap_rate_pct,
       round(100.0 * sum(d.tap_installs) / nullif(sum(d.taps), 0), 1)       as install_rate_pct,
       round(sum(d.spend) / nullif(sum(d.tap_installs), 0), 2)              as cost_per_install
from experiments e
join experiment_campaigns ec on ec.experiment_id = e.id and ec.channel = 'apple_ads'
join apple_ads_campaigns c   on c.id::text = ec.external_campaign_id
left join apple_ads_keyword_daily d
       on d.campaign_id = c.id and d.date between e.start_date and coalesce(e.end_date, current_date)
where e.slug = $1
group by c.name, ec.role
order by spend desc nulls last;
```

Which countries within the selected region group receive spend:

```sql
select d.country, sum(d.spend) as spend, sum(d.taps) as taps, sum(d.tap_installs) as installs,
       round(100.0 * sum(d.spend) / sum(sum(d.spend)) over (), 1) as share_of_spend_pct
from apple_ads_keyword_daily d
join experiment_campaigns ec on ec.external_campaign_id = d.campaign_id::text
where ec.experiment_id = $1 and ec.geo = 'region_group'
group by d.country
order by spend desc;
```

### 4.4 `apple_ads_search_terms_daily`: what people actually typed

**One row represents** one search term, matched by one keyword, in one country on one day. It
matters mostly for the discovery campaign.

| Column | Type | Why it exists | Filled from `POST /reports/apps/searchterms/query` → `result.rows[]` |
| --- | --- | --- | --- |
| `date` | `date not null` | | `granularMetrics[].date` |
| `campaign_id` | `bigint not null` → `apple_ads_campaigns(id)` on delete cascade | | `metadata.campaignId` |
| `keyword_id` | `bigint not null default 0` | The keyword that matched; `0` means none (Search Match, source `AUTO`) | `metadata.keyword.id` |
| `search_term` | `text not null default ''` | What the person typed; `''` means Apple withheld it (low volume) | `metadata.searchTermText` |
| `country` | `text not null` | | `metadata.countryOrRegion` |
| `source` | `text` | `TARGETED` or `AUTO` | `metadata.searchTermSource` |
| `impressions`, `taps`, `tap_installs`, `view_installs`, `new_downloads`, `redownloads`, `spend`, `currency`, `synced_at` | as in 4.3 | | as in 4.3 |

Primary key: `(date, campaign_id, keyword_id, search_term, country)`. The request body is the same
as in 4.3 (verified with `groupBy` and the `campaignId` filter).

**Question it answers:** "Which discovery search terms are worth promoting to exact keywords, and
which should become negatives?"

```sql
select s.search_term,
       sum(s.impressions) as impressions, sum(s.taps) as taps, sum(s.tap_installs) as installs,
       sum(s.spend) as spend,
       round(100.0 * sum(s.tap_installs) / nullif(sum(s.taps), 0), 1) as install_rate_pct
from apple_ads_search_terms_daily s
join experiment_campaigns ec on ec.external_campaign_id = s.campaign_id::text
where ec.experiment_id = $1 and ec.role = 'discovery' and s.search_term <> ''
  and not exists (                       -- not already a keyword anywhere for this product
    select 1 from apple_ads_keywords k
    join apple_ads_campaigns c on c.id = k.campaign_id
    where lower(k.text) = lower(s.search_term) and not k.is_negative
      and c.product_id = (select product_id from experiments where id = $1))
group by s.search_term
having sum(s.taps) >= 3
order by installs desc, taps desc;
```

Sorting the same query by spend with zero installs gives the negative-keyword candidates.

### 4.5 `apple_ads_changes`: the journal of everything done to the ad account

**One row represents** one API call that mattered: what was sent, what Apple answered, who sent it
and for which experiment. It replaces `operator-audit.jsonl`. Because keyword and campaign state
tables are overwritten, **this table is the history of bids, budgets and statuses**, as decided.

| Column | Type | Why it exists |
| --- | --- | --- |
| `id` | `uuid` primary key default `gen_random_uuid()` | |
| `at` | `timestamptz not null` | When the call was made |
| `actor` | `text not null` | Who: `owner`, `claude`, `codex`, `devin`, or `import` for migrated history. Passed to `apply` with `--actor` |
| `ad_account_id` | `bigint` | |
| `product_id` | `uuid` → `products(id)` on delete set null | Keeps the three apps' histories apart |
| `experiment_id` | `uuid` → `experiments(id)` on delete set null | Ties a change to the experiment it served |
| `campaign_id`, `keyword_id` | `bigint` | Plain numbers, deliberately **not** foreign keys: rejected requests and deleted objects must still be recordable |
| `method`, `path` | `text not null` | For example `PUT`, `/keywords/2319811866` |
| `is_write` | `boolean not null` | `true` for `PUT`, `DELETE`, and any `POST` whose path does not end in `/query` |
| `request` | `jsonb` | The body sent |
| `status` | `integer` | HTTP status (rejections are kept: they document what the API refuses) |
| `response` | `jsonb` | Apple's answer |
| `plan_path` | `text` | The plan file that caused it |
| `note` | `text` | One-line reason, from the plan |

Unique on `(at, method, path)` so that importing the old journal twice is harmless.
Going forward only `apply` writes here, and only for write calls; `sync` reads are not journaled
because their result is the tables themselves.

**Question it answers:** "What was this keyword's bid history, and was it changed in the last 24
hours?" (The test rule allows at most one bid change per 24 hours.)

```sql
select at, actor, request->'bid'->>'amount' as new_bid, status, note
from apple_ads_changes
where keyword_id = $1 and is_write and status < 400
order by at desc;
```

### 4.6 `experiments`: thin, channel-agnostic record of a test

**One row represents** one experiment on one product on one channel. It holds only what a query or
a summary needs; the reasoning is in the markdown file it points to.

| Column | Type | Why it exists |
| --- | --- | --- |
| `id` | `uuid` primary key default `gen_random_uuid()` | |
| `product_id` | `uuid not null` → `products(id)` on delete cascade | |
| `channel` | `text not null` | `apple_ads` now, `meta` later |
| `slug` | `text not null`, unique with `product_id` | Stable handle for commands, e.g. the write-up's file name without `.md` |
| `name` | `text not null` | |
| `hypothesis` | `text` | One line |
| `status` | `text not null default 'planned'` | `planned`, `running`, `ended`, `abandoned` |
| `start_date`, `end_date` | `date` | Bounds every experiment query |
| `daily_budget`, `total_budget` | `numeric(12,2)` | The $80/day cap and the 28-day ceiling |
| `currency` | `text` | |
| `success_criteria` | `text` | Written before the results are in |
| `rules` | `jsonb not null default '{}'` | **Addition to the proposed schema.** Machine-readable thresholds that `status` uses to flag keywords (minimum impressions, tap-rate floor, install-rate floor, spend-without-trial limit, bid caps per country, bid step). Without it the thresholds would have to be hardcoded, which the repository forbids, or `status` could not flag anything and an agent would spend tokens doing arithmetic |
| `verdict` | `text` | Filled at the end |
| `writeup_path` | `text` | Repository-relative path to the markdown file |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` uses the existing `set_updated_at()` trigger function |

### 4.7 `experiment_campaigns`: which campaigns belong to an experiment

**One row represents** one campaign's membership in one experiment.

| Column | Type | Why it exists |
| --- | --- | --- |
| `experiment_id` | `uuid not null` → `experiments(id)` on delete cascade | |
| `channel` | `text not null` | Same values as `experiments.channel` |
| `external_campaign_id` | `text not null` | The channel's own campaign ID as text, so that a Meta campaign ID fits later. There is no foreign key to `apple_ads_campaigns` for that reason; queries join on `c.id::text` |
| `role` | `text` | The campaign's type within the test: `generic`, `discovery`, `competitors`, `brand`. This is what "cost per trial by campaign type" groups by |
| `geo` | `text` | A label for a configured country group, so queries do not parse campaign names |

Primary key: `(experiment_id, channel, external_campaign_id)`.

### 4.8 Trials and revenue (built: `revenuecat_keyword_daily`)

`pnpm revenuecat sync` fills `revenuecat_keyword_daily` (source, date, campaign, keyword → new trials,
trial conversions, paid subscriptions, transactions, revenue, proceeds) from RevenueCat Charts
(`trials_new`, `actives_new`, `revenue`), filtered by `attribution_campaign` and segmented by
`attribution_keyword`. RevenueCat exposes keyword and campaign *names*, not IDs, so the sync matches them
to `apple_ads_campaigns.name` and `apple_ads_keywords.text` and stores `apple_campaign_id` /
`apple_keyword_id`. Charts take one segment at a time, so there is no country split per keyword; use
the campaign (one geo per campaign) instead. Migration: `20260930000000_revenuecat.sql`.

### 4.9 Draft migration

File: `supabase/migrations/20260919000000_apple_ads_and_experiments.sql`. Plain SQL, PGlite
compatible, safe to re-apply.

```sql
-- Apple Ads campaign tracking and channel-agnostic experiments.
-- Which app belongs to which product is a tracked_sources row
-- (source = 'apple_ads', kind = 'app', value = App Store ID, config.ad_account_id).

-- ---------------------------------------------------------------------------
-- Experiments: numbers and pointers only; the reasoning lives in markdown.
-- ---------------------------------------------------------------------------
create table if not exists experiments (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references products(id) on delete cascade,
  channel          text not null,
  slug             text not null,
  name             text not null,
  hypothesis       text,
  status           text not null default 'planned',
  start_date       date,
  end_date         date,
  daily_budget     numeric(12,2),
  total_budget     numeric(12,2),
  currency         text,
  success_criteria text,
  rules            jsonb not null default '{}'::jsonb,
  verdict          text,
  writeup_path     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (product_id, slug)
);

drop trigger if exists experiments_set_updated_at on experiments;
create trigger experiments_set_updated_at
  before update on experiments
  for each row execute function set_updated_at();

create table if not exists experiment_campaigns (
  experiment_id        uuid not null references experiments(id) on delete cascade,
  channel              text not null,
  external_campaign_id text not null,
  role                 text,
  geo                  text,
  primary key (experiment_id, channel, external_campaign_id)
);
create index if not exists experiment_campaigns_external_idx
  on experiment_campaigns(channel, external_campaign_id);

-- ---------------------------------------------------------------------------
-- Apple Ads current state (overwritten on every sync).
-- ---------------------------------------------------------------------------
create table if not exists apple_ads_campaigns (
  id                bigint primary key,
  product_id        uuid not null references products(id) on delete cascade,
  tracked_source_id uuid references tracked_sources(id) on delete set null,
  ad_account_id     bigint not null,
  app_store_id      text not null,
  name              text not null,
  status            text not null,
  display_status    text,
  daily_budget      numeric(12,2),
  currency          text,
  countries         text[] not null default '{}',
  deleted           boolean not null default false,
  apple_created_at  timestamptz,
  apple_modified_at timestamptz,
  raw               jsonb not null,
  first_seen_at     timestamptz not null default now(),
  last_synced_at    timestamptz not null default now()
);
create index if not exists apple_ads_campaigns_product_idx on apple_ads_campaigns(product_id);

create table if not exists apple_ads_keywords (
  id                    bigint not null,
  is_negative           boolean not null default false,
  campaign_id           bigint not null references apple_ads_campaigns(id) on delete cascade,
  ad_group_id           bigint not null,
  text                  text not null,
  match_type            text not null,
  bid                   numeric(12,4),
  currency              text,
  status                text not null,
  display_status        text,
  deleted               boolean not null default false,
  bid_recommendation    jsonb,
  bid_recommendation_at timestamptz,
  apple_created_at      timestamptz,
  apple_modified_at     timestamptz,
  raw                   jsonb not null,
  last_synced_at        timestamptz not null default now(),
  primary key (id, is_negative)
);
create index if not exists apple_ads_keywords_campaign_idx on apple_ads_keywords(campaign_id);

-- ---------------------------------------------------------------------------
-- Apple Ads daily facts. Rows exist only where there was activity.
-- ---------------------------------------------------------------------------
create table if not exists apple_ads_keyword_daily (
  date          date not null,
  keyword_id    bigint not null,
  country       text not null,
  campaign_id   bigint not null references apple_ads_campaigns(id) on delete cascade,
  impressions   integer not null default 0,
  taps          integer not null default 0,
  tap_installs  integer not null default 0,
  view_installs integer not null default 0,
  new_downloads integer not null default 0,
  redownloads   integer not null default 0,
  spend         numeric(12,4) not null default 0,
  currency      text not null,
  synced_at     timestamptz not null default now(),
  primary key (date, keyword_id, country)
);
create index if not exists apple_ads_keyword_daily_campaign_idx
  on apple_ads_keyword_daily(campaign_id, date);

create table if not exists apple_ads_search_terms_daily (
  date          date not null,
  campaign_id   bigint not null references apple_ads_campaigns(id) on delete cascade,
  keyword_id    bigint not null default 0,    -- 0 = no keyword (Search Match)
  search_term   text not null default '',     -- '' = withheld by Apple (low volume)
  country       text not null,
  source        text,
  impressions   integer not null default 0,
  taps          integer not null default 0,
  tap_installs  integer not null default 0,
  view_installs integer not null default 0,
  new_downloads integer not null default 0,
  redownloads   integer not null default 0,
  spend         numeric(12,4) not null default 0,
  currency      text not null,
  synced_at     timestamptz not null default now(),
  primary key (date, campaign_id, keyword_id, search_term, country)
);

-- ---------------------------------------------------------------------------
-- Journal of calls to the ad account. The history of bids, budgets, statuses.
-- ---------------------------------------------------------------------------
create table if not exists apple_ads_changes (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null,
  actor         text not null,
  ad_account_id bigint,
  product_id    uuid references products(id) on delete set null,
  experiment_id uuid references experiments(id) on delete set null,
  campaign_id   bigint,
  keyword_id    bigint,
  method        text not null,
  path          text not null,
  is_write      boolean not null,
  request       jsonb,
  status        integer,
  response      jsonb,
  plan_path     text,
  note          text,
  unique (at, method, path)
);
create index if not exists apple_ads_changes_keyword_idx on apple_ads_changes(keyword_id, at);
create index if not exists apple_ads_changes_experiment_idx on apple_ads_changes(experiment_id, at);
```

After adding it: `pnpm db:types`, commit `src/db/database.types.ts`, add aliases to
`src/db/types.ts`, and add `scripts/schema.test.ts` cases (re-apply is a no-op; a daily upsert on
the primary key overwrites rather than duplicates; a keyword and a negative with the same `id` can
coexist).

---

## 5. The command-line tool

Entry point `src/cli/apple-ads.ts`, script `"apple-ads": "node --env-file-if-exists=.env … src/cli/apple-ads.ts"`,
same `parseArgs` style as `src/cli/product.ts`. Every subcommand takes `--product <slug>`.

### 5.1 `sync`: pull from Apple into the database (read-only towards Apple)

- **Inputs:** `--product <slug>` (or `--all` for every product with an `apple_ads` tracked source),
  `--days <n>` (default 7; re-pulls the trailing n days and upserts, because Apple revises recent
  numbers), `--no-search-terms`.
- **Calls, in order, one at a time:** campaigns query (paginated); keep campaigns whose
  `promotedObjectId` matches the tracked app; ad groups query per campaign; keywords query and
  negative keywords query per ad group; then per campaign: keyword report grouped by country,
  keyword report ungrouped (bid recommendations), search terms report grouped by country; finally
  one campaign report (`POST /reports/apps/campaigns/query`, all campaigns, select rows by
  `metadata.id` as the runbook notes) used only as a **cross-check** that per-campaign spend equals
  the sum of keyword rows, printing a warning if it does not. For the current six campaigns this is
  about 35 calls.
- **Rate limits:** reads `RateLimit-Remaining` on every response, stops if it falls below 20, and
  on HTTP 429 waits for `Retry-After` once. It never retries validation errors.
- **Tables written:** `apple_ads_campaigns`, `apple_ads_keywords`, `apple_ads_keyword_daily`,
  `apple_ads_search_terms_daily` (all upserts), one `scrape_runs` row, and
  `tracked_sources.last_scraped_at`.
- **Prints:** one line per campaign (`keywords 25, negatives 0, daily rows 41, search-term rows 0`)
  and a final line with the call count and remaining rate limit.

### 5.2 `status`: the compact summary agents read

- **Inputs:** `--product <slug>`, optional `--experiment <slug>` (default: the product's experiment
  with `status = 'running'`), `--json` for a machine-readable version.
- **Tables read:** all seven, plus `scrape_runs` for freshness. It makes no API calls.
- **Prints** (mock with invented numbers, to show the shape only):

```text
apple-ads status · product <slug> · experiment <experiment> (running)
day <elapsed> of <duration> · last sync <timestamp> (ok)
spend <amount> of <cap> to date · yesterday <amount> of <daily cap>

campaign                 role         region       budget   spend    impr   taps  tap%   inst  inst%  cost/inst
sample_generic           generic      <region>    <amount> <amount> <count> <count> <rate> <count> <rate> <amount>
sample_discovery         discovery    <region>    <amount> <amount> <count> <count> <rate> <count> <rate> <amount>

keyword totals: <enabled> enabled · <serving> serving · <unserved> with no impressions

needs attention (rules from experiments.rules)
  RAISE BID  below the configured impression threshold: <count> keywords
  PAUSE?     "<sample term>" <region>: tap rate below the configured threshold
  REVIEW     discovery: <count> new search terms (run: report search-terms)
trials and revenue: <attribution status>
```

### 5.3 `report`: fixed tables of numbers

- **Inputs:** `--product`, `--experiment`, a report name, `--since`/`--until`, `--format table|csv|json`.
- **Report names:** `campaigns`, `countries`, `keywords`, `unserved`, `search-terms`, `changes`.
  Each is one of the queries in section 4 with no judgment applied.
- **Tables read:** those of the chosen query. No API calls, no writes.

### 5.4 `apply`: the only path that changes the ad account

- **Inputs:** a plan file path, `--product`, `--experiment`, `--actor`, and `--confirm`. **Without
  `--confirm` it is a dry run:** it reads the current state from Apple, prints a before → after
  line for every operation, and changes nothing.
- **Plan format:** the existing creation format (campaigns with countries, budget, default bid,
  keywords, negative keywords) stays valid, plus a `changes` list of small operations:
  `setBid`, `setKeywordStatus`, `addKeywords`, `addNegatives`, `setCampaignStatus`, `setBudget`,
  each with a `note`. The request bodies are the ones the journal shows Apple accepted
  (`PUT /keywords/{id}` with only `bid` and/or `status`; bulk-create items with `correlationId`
  and `data`; negative items with `adGroupId`, `campaignId`, `text`, `matchType`, `status`; ad
  groups with an explicit `startTime`; no `POST /ads` for search-results campaigns). The old
  script's literal ad account ID and App Store ID are replaced by values read from
  `tracked_sources`.
- **Safeguards:** refuses any campaign whose `product_id` is not the `--product` given (this is
  what protects the other two apps in the same account); refuses a bid above the cap in
  `experiments.rules` or a second bid change within 24 hours (checked in `apple_ads_changes`);
  fetches fresh state before each write; stops at the first error; never retries a write whose
  outcome is unknown, and instead tells the operator to run `sync` and reconcile; refuses to run
  when the environment variable `CI` is set, so a cloud job cannot change the account even by
  mistake.
- **Tables written:** one `apple_ads_changes` row per call (including rejected ones), then a
  targeted refresh of the affected campaigns and keywords. IDs created by Apple are written back
  into the plan file, as the old script does, so a re-run skips what already exists.

---

## 6. Moving the existing material here

1. **`client.mjs` → `src/apple-ads/client.ts`.** Same logic: ES256 client secret signed with
   `node:crypto` (`dsaEncoding: 'ieee-p1363'`), token exchange at
   `https://appleid.apple.com/auth/oauth2/token` with scope `searchadsorg`, token cached until two
   minutes before expiry, `X-AP-Context: adAccountId=<id>` header, responses unwrapped from
   `result`. It stays dependency-free. Changes for this repository's conventions: TypeScript with
   erasable syntax only, `.ts` import extensions, typed request and response shapes in
   `src/apple-ads/types.ts`, colocated `client.test.ts` (JWT structure and header construction with
   a throwaway key and a stubbed `fetch`; no network in tests). Credentials come from **either** a
   directory named by `APPLE_ADS_DIR` (the owner's machine: the existing `credentials.json`,
   `private-key.pem` and `token-cache.json` work unchanged) **or** four environment variables
   (`APPLE_ADS_CLIENT_ID`, `APPLE_ADS_TEAM_ID`, `APPLE_ADS_KEY_ID`, `APPLE_ADS_PRIVATE_KEY`) for
   GitHub Actions. These are infrastructure credentials, which the repository allows in env; they
   are added to `.env.example` with empty values. There is no default path in code, because the
   current path contains a product name. The ad account ID comes from `tracked_sources.config`,
   not from `account-selection.json`. Known limitation: one run uses one credential set, which fits today
   because every tracked app is in the same ad account. If a product ever lives in an ad account that needs a
   different API user, add an optional `credentials_dir` (local) or secret-name prefix (CI) per ad account;
   nothing else changes. The client no longer writes a journal file; `apply` writes
   to `apple_ads_changes`. Secret values are never printed or stored.
2. **Importing write history.** An importer maps journal events to `apple_ads_changes`, associates
   rows only with campaigns that unambiguously belong to the selected product, and uses a unique
   key to make re-runs harmless. Secret values are never printed or stored.
3. **Seeding experiments.** A reusable seed process creates an `experiments` row with its
   `writeup_path`, configured rules and `experiment_campaigns` rows. It parses roles and region
   groups from an explicit mapping in the plan document rather than inferring them from names.
   Product-specific thresholds, budgets and dates remain in database rows and `product_docs`.
   Other campaigns for a product remain tracked even when they are outside a particular experiment.
   Plan documents and imported reference material belong in `product_docs`; database rows are the
   source of truth for current state and historical writes.

---

## 7. Where skills, the playbook and write-ups live

```text
playbooks/apple-ads.md                                 methodology, generic: how to read status, the decision
                                                       rules and why, how to write a plan, verified API shapes,
                                                       what never to do (touch another product's campaigns,
                                                       write outside apply, recreate existing objects)
product_docs                                           experiment write-ups and plan documents, read by name
                                                        through MCP `product_docs` or `pnpm product docs show`
.claude/skills/apple-ads/SKILL.md                      a dozen lines: when to use, "read playbooks/apple-ads.md,
                                                       run status first, never call the API directly"
AGENTS.md and CLAUDE.md                                repository guidance and the pointer to this playbook
```

- **Claude Code** loads `CLAUDE.md` automatically and discovers the project skill in
  `.claude/skills/`. The skill holds no methodology of its own, so there is one source of truth.
- **Codex** loads `AGENTS.md` automatically, which points to the playbook.
- **Devin** reads `AGENTS.md` from the repository; if a given Devin workspace does not, the owner
  adds one Knowledge entry: "For Apple Ads work in mad-factory, read playbooks/apple-ads.md first."
- Cloud agents (Codex cloud, Devin) have no Apple credentials and no `--confirm` path, so they can
  work on code, read committed write-ups, and draft plan files in a pull request, but cannot change
  the ad account. This matches decision 2.

Numbers stay in the database; a write-up quotes `report` output with the date it was run.

---

## 8. Not included, on purpose

No MCP server, no web deployment, no bid or status history tables, no ad groups table, no
learnings table, no automatic bid changes (every change is an approved plan), no web UI pages for
Apple Ads (the existing runs page will show syncs for free; more can come later).

---

## 9. The scheduled sync

**Workflow outline** (`.github/workflows/apple-ads-sync.yml`):

```yaml
name: apple-ads-sync
on:
  schedule:
    - cron: "0 13 * * *"      # 13:00 UTC = 07:00 in Denver during daylight time, 06:00 in winter
  workflow_dispatch: {}        # manual "Run workflow" button
concurrency: apple-ads-sync    # never two at once
permissions:
  contents: read
jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: pnpm apple-ads sync --all --days 7
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          APPLE_ADS_CLIENT_ID: ${{ secrets.APPLE_ADS_RO_CLIENT_ID }}
          APPLE_ADS_TEAM_ID: ${{ secrets.APPLE_ADS_RO_TEAM_ID }}
          APPLE_ADS_KEY_ID: ${{ secrets.APPLE_ADS_RO_KEY_ID }}
          APPLE_ADS_PRIVATE_KEY: ${{ secrets.APPLE_ADS_RO_PRIVATE_KEY }}
```

**Run time.** The account's day ends at midnight in Denver and Apple's numbers for a day keep
settling for some hours. 13:00 UTC is 07:00 Mountain Daylight Time (06:00 after 2026-11-01), so
yesterday is complete and the data is waiting when the owner starts work. GitHub may start
scheduled jobs several minutes late; that does not matter here. The Playwright browser is not
installed in this job; `sync` does not import it.

**Secrets needed (six):** the two Supabase values the repository already uses, and the four
read-only Apple values. `sync` uses `supabase-js` over HTTPS, so the IPv6-only direct database
host is not an issue. The service-role key in GitHub can write to the database, which is
unavoidable for a job that stores data; it cannot touch the ad account.

**Read-only key setup, done once by the owner** (Apple ties an API key to a *user* and the user's
role decides what the key may do, so a read-only key requires a second user):

1. On the owner's machine, create a new key pair in a new folder outside git:
   `openssl ecparam -genkey -name prime256v1 -noout -out private-key.pem`, then
   `openssl ec -in private-key.pem -pubout -out public-key.pem`.
2. In the Apple Ads web interface (ads.apple.com), as the account administrator: account menu →
   Account Settings → User Management → Invite Users. Invite an Apple Account the owner controls
   that is not already a user of this ad account (an email alias with its own Apple Account
   works), with the role **API Account Read Only**.
3. Sign in as that invited user, accept the invitation, open Account Settings → API, paste the
   contents of `public-key.pem`, and save. Apple shows a `clientId`, `teamId` and `keyId`.
4. Add the four values as GitHub repository secrets (Settings → Secrets and variables → Actions)
   named as in the workflow above. `APPLE_ADS_RO_PRIVATE_KEY` is the full text of
   `private-key.pem`, including the BEGIN and END lines.
5. Verify locally before trusting it: run `sync` once with `APPLE_ADS_DIR` pointed at the new
   folder (it must succeed), and confirm in the playbook that a write attempted with this key is
   refused by Apple. (Exact menu names may differ slightly; Apple renames them occasionally.)

**Failure handling.**
- A failed run marks its `scrape_runs` row `failed` with the error text and exits non-zero, so
  GitHub emails the owner.
- Because every run re-pulls seven days, one to six missed days heal themselves on the next
  success. After a longer gap: `pnpm apple-ads sync --product <slug> --days 30` locally.
- `status` always prints the age of the last successful sync and turns it into a warning line
  above 30 hours, so stale numbers are never read as fresh ones.
- Authentication failures (HTTP 401 or 403) stop immediately with a message naming the likely
  cause (key revoked or user removed), without retry loops.
- The local write-capable key is never uploaded anywhere; `apply` refuses to run under `CI`.

---

## 10. Build order

Each step is usable on its own and is a small commit (or a few) with `pnpm typecheck && pnpm test`
passing. Steps 1 to 3 are the ones the live test needs soon.

0. **Repository guidance.** Keep the playbook, database-backed document workflow and feature map
   consistent as implementation changes.
1. **Migration and local `sync`** (target: usable for the day-2 check on 2026-09-20). The
   migration, generated types, schema tests; the ported client with tests; the `pnpm scrape` guard
   for non-scraper sources; `--source`/`--config` on `pnpm product add-source` if missing; the
   tracked-source row for the app; `pnpm apple-ads sync`. Confirm in this step the three items
   marked "to be confirmed" (maximum `pageSize`; whether the ungrouped keyword report lists
   unserved keywords; the populated `bidRecommendation` shape). Until step 2 exists, the queries in
   section 4 can be run by hand.
2. **`status` and `report`**, plus `scripts/seed-experiment.ts` and the first experiment's row and
   campaign links, so that `status` has something to summarize.
3. **Journal import and `apply`.** Import `operator-audit.jsonl`; build `apply` with dry run,
   safeguards and journaling; prove it with one real, owner-approved, low-stakes plan (for
   example one bid raise the rules already call for). Then freeze the old folder (section 6,
   item 5).
4. **Playbook, first write-up, skill and AGENTS.md section** (section 7). The write-up can be
   started earlier by hand; this step makes it the documented standard.
5. **Scheduled sync** (section 9), after the owner has created the read-only key.
6. **Later:** RevenueCat trials and revenue (4.8) and cost-per-trial lines in `status`; Meta
   experiments using the same two experiment tables; optional web pages.

---

## 11. Open questions for the owner

1. Confirm attribution availability before using trial outcomes as a decision metric.
2. Store product-specific thresholds, prices and other decision inputs in the database.
3. Confirm the authorized API user and integration credentials through the normal setup process.
