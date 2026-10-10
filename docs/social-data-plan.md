# Competitor ads, organic accounts, own content: plan

Status: **organic collection implemented for Instagram Reels, TikTok videos, and Facebook Reels; Organic tab implemented.** My Content and official API
insights remain pending. Three new data feeds and tabs on top of the existing
mad-factory stack (Supabase Postgres, Cloudflare R2 via `src/lib/storage.ts`, `tracked_sources` / `scrape_runs`).

| # | Feed | Tab | Data source (recommended) |
| --- | --- | --- | --- |
| 1 | Meta Ad Library: competitor ads, ranked by impressions | **Competitor Ads** (replaces today's "Meta Ad Library") | ScrapeCreators Ad Library endpoints, `sort_by` = impressions |
| 2 | Competitor / inspiration organic accounts on IG, FB, TikTok | **Organic** | ScrapeCreators profile + posts endpoints |
| 3 | My own IG/FB reels and TikTok videos | **My Content** | Official APIs (IG Graph insights, FB Page video insights, TikTok); ScrapeCreators public counts as v1 fallback |

## 1. Apify vs ScrapeCreators

| | ScrapeCreators | Apify |
| --- | --- | --- |
| Model | One REST API, one key. 1 credit per request for most endpoints (one request = one page of results). | Marketplace of third-party "actors", each with its own input/output schema and price. |
| Price | $47 = 25k credits ($1.88/1k requests); $497 = 500k ($0.99/1k). Credits never expire. 100 free. Cache hits free. | Pay per result: Ad Library actors $0.40–$0.75 per 1k ads; `clockworks/tiktok-scraper` from $1.70 per 1k results. $5 free/month. |
| Meta Ad Library | `/v1/facebook/adLibrary/company/ads` (by page id), `/search/ads` (keyword), `/search/companies`; `sort_by` defaults to impressions (high→low), alt = most recent. Returns Meta's raw ad JSON (`ad_archive_id`, `collation_id`, `snapshot`, `impressions_with_index`), the same shape our Playwright collector already normalizes. | Several competing actors (`solidcode`, `automly`, `thodor`, …) with `sortBy: total_impressions`; some add EU reach / age-gender data for EU-delivered ads. Output shape differs per actor. |
| IG / FB / TikTok organic | Profile, posts, reels, single post, comments and transcript endpoints for all three platforms, all from one vendor. | Best-in-class per platform (`apify/instagram-scraper`, `clockworks/tiktok-scraper`, …) but a different actor and schema for each. |
| Runs | Synchronous HTTP: call → JSON. Fits our CLI + Devin automation pattern directly. | Async: start run → poll → read dataset. Built-in scheduler, retries, and video download to its storage. |
| Reliability risk | Small vendor; if an endpoint breaks you wait for them. | Big platform, but individual actors are maintained by third parties and get abandoned/repriced (e.g. `automly` changes extras pricing 2026-10-16). |
| Cost shape | Cheapest when you pull many results per request (Ad Library pages, post lists). | Cheapest when you pull few results; per-result pricing grows with volume. |

Shared to both: CDN media URLs expire (Meta signed URLs; TikTok covers have a 6 h TTL), so media must be downloaded
to R2 during the run, which our `storage.ts` already does content-addressed (sha256). Both take the scraping off our
own IP and login, which matters because Meta's Automated Data Collection Terms make our own Playwright scraper the
riskiest piece today.

**Recommendation:** ScrapeCreators as the single vendor for feeds 1 and 2 (and as the v1 fallback for 3), behind
the existing `AdSource`-style adapter interface so one platform can swap to an Apify actor if an endpoint breaks.
Keep the Playwright collector as a fallback until ScrapeCreators matches it on our tracked sources, then retire it.

Rough volume (estimate): 10 competitor pages × 3 pages of ads weekly ≈ 130 requests/month; 20 organic accounts × (profile + 1 posts page) daily ≈ 1,200/month;
plus post re-checks. That's well under one $47 pack per month.

## 2. "Highest by impressions": what we can actually know

Meta doesn't publish impression counts for commercial ads (only for political/issue ads, and EU reach for
EU-delivered ads). What we get is the **order**: with `sort=total_impressions` the Ad Library lists an
advertiser's ads biggest-delivery first. `impressions_with_index.impressions_index` is not a usable rank: of our
190 stored ads, 120 have `-1`, 69 have `0` and one has `39`.

So the signal we store is **rank position per scrape**, plus two proxies that agree with it:

- **Days running**: `coalesce(end_date, now()) - start_date`. Advertisers kill losers fast; an ad live 30+ days is spending profitably.
- **Variants**: `collation_count`. Many copies of one creative = they're scaling it.

"Winner" = top-10 rank for that advertiser **and** running ≥ 21 days (thresholds tunable). Rank history over
weekly scrapes shows when a creative gets scaled up or turned off.

## 3. Schema

Principles: entity tables hold the latest state; **snapshot tables** hold metrics over time (rank, followers,
views all change); every row links to the `scrape_runs` row that produced it; external IDs are `text`; media goes
to R2 via the existing `creatives` (sha256) table; RLS on, no policies, like every table.

### 3.1 Competitor ads (extends existing tables)

Reused as is: `ads` (`source='meta'`; ScrapeCreators returns the same `ad_archive_id`, so it dedupes with the 190
ads already stored), `creatives`, `ad_creatives`, `product_ads`, `tracked_sources` (`kind=page|keyword`,
`config.sort='total_impressions'`).

```sql
alter table scrape_runs add column if not exists collector text;        -- playwright | scrapecreators | apify
alter table scrape_runs add column if not exists credits_used integer;
alter table ads add column if not exists attributes jsonb not null default '{}';  -- same tags as meta_ads_creatives: angle, hook, format, …

create table if not exists ad_library_observations (
  scrape_run_id     uuid not null references scrape_runs(id) on delete cascade,
  ad_id             uuid not null references ads(id) on delete cascade,
  tracked_source_id uuid references tracked_sources(id) on delete set null,
  observed_at       timestamptz not null default now(),
  sort_mode         text not null,          -- total_impressions | relevancy_monthly_grouped
  rank              integer not null,       -- 1 = most impressions in this result list
  is_active         boolean,
  collation_count   integer,
  eu_total_reach    integer,                -- only when Meta exposes it
  primary key (scrape_run_id, ad_id)
);
create index if not exists ad_library_obs_ad_idx on ad_library_observations(ad_id, observed_at desc);
alter table ad_library_observations enable row level security;
```

### 3.2 Organic accounts and posts (competitors **and** own, same tables)

One set of tables for both, so "my reels vs theirs" is a filter, not a join across schemas.

```sql
create table if not exists social_accounts (
  id             uuid primary key default gen_random_uuid(),
  platform       text not null,              -- instagram | facebook | tiktok
  external_id    text,                       -- platform user / page id
  handle         text not null,
  display_name   text,
  bio            text,
  avatar_sha256  text references creatives(sha256),
  raw            jsonb not null default '{}',
  first_seen_at  timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (platform, handle)
);
-- product link + relation lives in tracked_sources:
--   source = instagram | facebook | tiktok, kind = 'account', value = handle,
--   config = { "relation": "own" | "competitor" | "inspiration", "account_id": "<social_accounts.id>" }

create table if not exists social_account_snapshots (
  account_id   uuid not null references social_accounts(id) on delete cascade,
  captured_on  date not null,
  followers    integer,
  following    integer,
  posts_count  integer,
  total_likes  bigint,                       -- TikTok hearts
  scrape_run_id uuid references scrape_runs(id) on delete set null,
  primary key (account_id, captured_on)
);

create table if not exists social_posts (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references social_accounts(id) on delete cascade,
  platform       text not null,
  external_id    text not null,
  url            text,
  kind           text not null,              -- reel | video | post | carousel
  caption        text,
  posted_at      timestamptz,
  duration_s     numeric(8,2),
  audio_id       text, audio_title text,
  hashtags       text[] not null default '{}',
  is_paid_partnership boolean,
  transcript     text,                       -- ScrapeCreators transcript endpoint, on demand
  attributes     jsonb not null default '{}',-- hook / angle / format tags, same vocabulary as ads
  raw            jsonb not null default '{}',
  first_seen_at  timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (platform, external_id)
);
create index if not exists social_posts_account_idx on social_posts(account_id, posted_at desc);

create table if not exists social_post_media (
  post_id  uuid not null references social_posts(id) on delete cascade,
  sha256   text not null references creatives(sha256),
  position integer not null,                 -- 0 = video/first slide; thumbnails use role
  role     text not null default 'media',    -- media | thumbnail
  primary key (post_id, role, position)
);

create table if not exists social_post_snapshots (
  post_id      uuid not null references social_posts(id) on delete cascade,
  captured_on  date not null,
  source       text not null,                -- scrape (public counts) | api (own account insights)
  views        bigint, likes integer, comments integer, shares integer, saves integer,
  -- own-account only (official APIs):
  reach        integer,
  avg_watch_ms integer, total_watch_ms bigint, skip_rate numeric(5,2),
  follows      integer, profile_visits integer,
  metrics      jsonb not null default '{}',  -- anything else the API returns
  scrape_run_id uuid references scrape_runs(id) on delete set null,
  primary key (post_id, captured_on, source)
);
-- enable row level security on all five tables
```

Re-check cadence to cap credits: posts < 7 days old daily, 7–30 days weekly, then stop. That gives views at
~24 h / 7 d / 30 d, enough for velocity.

Derived (SQL views, no extra tables):
- **Outlier score** = post views ÷ the account's median views over its last 30 posts. 5× = something worked.
  This is the standard way to find winning organic formats across accounts of different sizes.
- Follower growth (7 d / 30 d) from `social_account_snapshots`.
- Own posts by `attributes` (hook, angle, format), comparable with Meta ad creatives.

### 3.3 My own content: official APIs vs scraping

| Platform | Public scrape gives | Official API adds | Needs |
| --- | --- | --- | --- |
| Instagram reels | views, likes, comments | reach, saved, shares, `ig_reels_avg_watch_time`, total watch time, `reels_skip_rate`, follows | IG professional account linked to a FB Page; token with `instagram_manage_insights` (likely the same Meta business/system user as `META_ADS_TOKEN`; to verify) |
| Facebook reels | plays, reactions | Page video insights (plays, watch time, reach) | Page token with `pages_read_engagement` / `read_insights` |
| TikTok | views, likes, comments, shares | Display API: the same 4 counts only. Watch time / completion / traffic source need the TikTok Business API account endpoints (to verify) | TikTok developer app + OAuth on my account |

Plan: v1 tracks own accounts with the same scraper pipeline (zero setup, public counts). v2 adds the official IG
and FB insights (the most valuable: watch time and skip rate), written to the same `social_post_snapshots` rows with
`source='api'`. TikTok official API only if the deeper metrics turn out available for our account type.

## 4. Tabs

- **Competitor Ads** `/p/<slug>/competitor-ads`: per advertiser, ads in impression-rank order from the latest
  run; columns rank, rank change, days running, variants, platforms, active; video from R2; "winners" filter.
- **Organic** `/p/<slug>/organic`: accounts (followers, 7 d growth, posts/week, median views) and a top-posts
  grid sorted by outlier score, filter by platform / account / last N days.
- **My Content** `/p/<slug>/my-content`: my posts with views at 24 h / 7 d, watch time and skip rate (when API),
  vs my median; group by attribute tags.

## 5. Build order

1. ScrapeCreators client + Ad Library adapter + `ad_library_observations` + Competitor Ads tab (reuses most of today's code).
2. Social tables + IG/TikTok/FB account and post sync + Organic tab.
3. My Content tab on scraped counts; then IG/FB official insights.
4. Add the syncs to the daily Devin automation (`auto-64f2b8…`): Ad Library weekly, organic daily.

## 6. Open questions

1. OK to go with ScrapeCreators (needs an API key as a repo secret `SCRAPECREATORS_API_KEY`)?
2. Which competitor pages / organic accounts to track first (start from `products.competitors`), and which owned social accounts to include.
3. Is my Instagram a professional account linked to a Facebook Page in the "Teaflow App" business? (Decides whether v2 insights are easy.)
4. Monthly scraping budget ceiling.
