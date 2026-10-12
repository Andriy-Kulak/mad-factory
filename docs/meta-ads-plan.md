# Meta Ads (own account): plan

Status: **read side built; writes are a small allowlist — pause, activate, adset-update, create-ad (PAUSED), ad-text.** Updated against the current implementation and owner decisions. Meta facts come from the
Marketing API docs (v26.0 current, v25.0 supported); anything else is marked *(inference)*.

Scope: read **our own** ad account through the Marketing API (campaigns, ad sets, ads, creatives, daily numbers),
learn which creative attributes work, and later make small plan-gated changes. The Ad Library scraper
(`src/sources/meta/collector.ts`, source `meta`, tables `ads` / `ad_creatives` / `product_ads`) stays as it is and
separate; the new source is called `meta_ads` everywhere.

Same loop as Apple Ads (`docs/marketing-loop.md`): daily read-only sync → Supabase → agents analyze from the DB →
plan document in `product_docs` → owner approves → apply → journal + `experiment_log`.

Built so far (reads + the allowlisted writes below):

| Part | Where |
| --- | --- |
| Tables `meta_ads_campaigns`, `_adsets`, `_creatives`, `_ads`, `_ad_daily`, `_ad_daily_breakdowns` (country), `_changes` (journal); RLS on, no policies | `supabase/migrations/20261002000000_meta_ads.sql` |
| Read-only + allowlisted-write Graph client (bearer token, call ceiling, stop at 90% usage, every call journaled; `assertNotDestructive` refuses deletes/archives) | `src/meta-ads/client.ts` |
| Pause / activate / adset-update / adset-copy / create-ad / ad-text writes, account-checked, `--plan`-gated, journaled to `meta_ads_changes` before each write | `src/meta-ads/pause.ts`, `activate.ts`, `update-adset.ts`, `create-ad.ts`, `update-ad-text.ts`; `pnpm meta-ads pause|activate|adset-update|adset-copy|create-ad|ad-text` |
| Sync: account → campaigns → ad sets → ads + creatives → daily ad insights + country, auto window 7–28 days | `src/meta-ads/sync.ts`, `pnpm meta-ads sync --product <slug> [--days n\|auto] [--dry-run]` |
| Manual creative tags in `meta_ads_creatives.attributes`: `angle`, `hook`, `format`, `length_s`, `version`, `avatar` (other keys allowed, with a warning) | `pnpm meta-ads tag <creative_id> hook=pain-first avatar=… [--remove key]` |
| DB-only status | `pnpm meta-ads status --product <slug>` |
| Web: **Meta Ads** (`/p/<slug>/meta-ads`: totals, campaigns, ad sets, ads with tags, spend by day, country) and **Meta Creatives** (`/p/<slug>/meta-ads/creatives`: performance grouped by one or two attributes, untagged list). The Ad Library page is now labelled **Meta Ad Library**. | `web/app/p/[slug]/meta-ads/` |

Not built yet: name parsing / `name_attributes` and the attribute view (naming deferred), `apply` and any write
outside the allowlist, the automation step, the playbook. **Writes are a small allowlist by owner rule: pause,
activate, updateAdset (name / daily_min_spend_target / daily_budget), copyAdset (without ads), uploadVideo, createAd,
updateAdCreative — and NEVER delete or archive Meta ads, ad sets, campaigns or creatives, not even if the owner asks.
Ads and copied ad sets are always created PAUSED.**
Template-created ads should get per-ad headlines/primary text matched to the video's hook (reuse the template
text verbatim only when the hook is the same) — `meta-ads ad-text` swaps text on an existing ad.

What changed from the prior draft:

| Prior draft | Now |
| --- | --- |
| Daily sync "via `.github/workflows/apple-ads-sync.yml`" | That workflow doesn't exist on `main` (no `.github/`; `AGENTS.md` is stale). Apple Ads + RevenueCat run in the Devin automation "mad-factory: daily Apple Ads + RevenueCat backfill". See §5. |
| Creative = Meta's fields only | §1.1 adds attributes (hook, angle, audience, format, ...) with a naming convention (§2) that fills them. |
| Pace 1 s, pause at 75%, sleep-then-stop | Sequential calls + stop at 90% / on a throttle code. No sleeps, no retries (owner preference). |
| Separate breakdowns table from day one | One generic breakdowns table, `country` only in v1 (US now, more countries in about a month). |
| Separate read / write tokens | One token: `META_ADS_TOKEN`; the sync's client refuses write calls. |
| "RevenueCat trials?" | RevenueCat attribution here is Apple AdServices only; Meta conversions arrive via AppsFlyer → Meta. Meta-reported trials decide in v1 (Decisions). |

---

## 1. Schema

One future migration, plain SQL (PGlite-compatible, no extensions; `gen_random_uuid()` is core), with
`alter table ... enable row level security` on every new table and **no policies** (service role only, like every
other table since `20260930120000_enable_rls.sql`). Plus a PGlite schema test, as for the Apple tables.

Rules that differ from Apple:

- **Meta IDs are `text`.** They exceed 2^53; a `bigint` reaches JS as a rounded number.
- Budgets are stored as returned (minor units) plus `currency`; views convert.
- The ad account is a `tracked_sources` row: `source='meta_ads', kind='ad_account', value='act_<id>'`,
  `config` = `{ "product_code": "<code used in names>" }`. No IDs in env vars or code.

**Reused as is:** `products`, `tracked_sources`, `scrape_runs` (sync runs, `source='meta_ads'`),
`experiments` + `experiment_campaigns` (`channel='meta_ads'`), `experiment_log` (reasoning, `plan_path`), and
`creatives` (sha256 media) as an optional link only.

| Table | Grain | Key | Notes |
| --- | --- | --- | --- |
| `meta_ads_campaigns` | campaign | `id text` | product, account, objective, status, budgets, `name_attributes` |
| `meta_ads_adsets` | ad set | `id text` | optimization goal, budget, `targeting`, `learning_stage_info`, `name_attributes` |
| `meta_ads_creatives` | creative | `id text` | media IDs, primary text, headline, CTA, `attributes` (content tags) |
| `meta_ads_ads` | ad | `id text` | ad set, creative, status, `name_attributes`, `parse_warnings` |
| `meta_ads_ad_daily` | ad × day | `(date, ad_id)` | delivery, video, installs, trials, purchases, `actions` |
| `meta_ads_ad_daily_breakdowns` | ad × day × breakdown value | `(date, ad_id, breakdown, value)` | v1: `breakdown='country'` only |
| `scrape_runs` (existing) | sync run | `id uuid` | `ads_seen` = ads synced, `ads_new` = new ads, `error`; call cost lives in the journal |
| `meta_ads_changes` | API call | `id uuid` | every call (reads too) with usage headers, `plan_path` |

```sql
create table if not exists meta_ads_campaigns (
  id text primary key,
  product_id uuid not null references products(id) on delete cascade,
  tracked_source_id uuid references tracked_sources(id) on delete set null,
  ad_account_id text not null,
  name text not null, objective text, status text not null, effective_status text,
  daily_budget bigint, lifetime_budget bigint, currency text, bid_strategy text,
  name_attributes jsonb not null default '{}',
  meta_created_at timestamptz, meta_updated_at timestamptz,
  raw jsonb not null, first_seen_at timestamptz not null default now(), last_synced_at timestamptz not null default now()
);

create table if not exists meta_ads_adsets (
  id text primary key,
  campaign_id text not null references meta_ads_campaigns(id) on delete cascade,
  name text not null, status text not null, effective_status text,
  optimization_goal text, billing_event text, bid_amount bigint, daily_budget bigint, lifetime_budget bigint,
  targeting jsonb, promoted_object jsonb, learning_stage_info jsonb, is_skadnetwork_attribution boolean,
  name_attributes jsonb not null default '{}',
  raw jsonb not null, last_synced_at timestamptz not null default now()
);

create table if not exists meta_ads_creatives (
  id text primary key,
  ad_account_id text not null,
  video_id text, image_hash text, thumbnail_url text,
  body text, title text, call_to_action_type text,       -- primary text, headline, CTA as Meta stores them
  object_story_spec jsonb, asset_feed_spec jsonb,
  attributes jsonb not null default '{}',                -- content tags: manual or LLM (1.1)
  sha256 text references creatives(sha256),              -- optional: same media table as the Ad Library
  raw jsonb not null, last_synced_at timestamptz not null default now()
);

create table if not exists meta_ads_ads (
  id text primary key,
  adset_id text not null references meta_ads_adsets(id) on delete cascade,
  campaign_id text not null references meta_ads_campaigns(id) on delete cascade,
  creative_id text references meta_ads_creatives(id),
  name text not null, status text not null, effective_status text,
  name_attributes jsonb not null default '{}',           -- parsed from name, rewritten every sync (2)
  parse_warnings text[] not null default '{}',
  issues_info jsonb, meta_created_at timestamptz, meta_updated_at timestamptz,
  raw jsonb not null, last_synced_at timestamptz not null default now()
);

create table if not exists meta_ads_ad_daily (
  date date not null,                                    -- ad account time zone
  ad_id text not null references meta_ads_ads(id) on delete cascade,
  campaign_id text not null, adset_id text not null,
  impressions integer not null default 0, reach integer,
  clicks integer not null default 0, inline_link_clicks integer not null default 0,
  spend numeric(12,4) not null default 0, currency text not null,
  video_3s_views integer, video_p25 integer, video_p50 integer, video_p100 integer, thruplays integer,
  installs integer,                                      -- actions[mobile_app_install]
  trials integer,                                        -- Meta-reported start-trial event (decision metric, mobile)
  purchases integer,                                     -- Meta-reported purchase (future web-to-app metric)
  actions jsonb, cost_per_action_type jsonb,
  quality_ranking text, engagement_rate_ranking text, conversion_rate_ranking text,
  synced_at timestamptz not null default now(),
  primary key (date, ad_id)
);

create table if not exists meta_ads_ad_daily_breakdowns (
  date date not null, ad_id text not null references meta_ads_ads(id) on delete cascade,
  breakdown text not null, value text not null,          -- v1: 'country' / 'US'; later 'placement' / 'instagram/reels'
  impressions integer not null default 0, clicks integer not null default 0,
  spend numeric(12,4) not null default 0, currency text not null,
  installs integer, trials integer, purchases integer, actions jsonb,
  synced_at timestamptz not null default now(),
  primary key (date, ad_id, breakdown, value)
);

create table if not exists meta_ads_changes (            -- same shape as apple_ads_changes
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null, actor text not null, ad_account_id text,
  product_id uuid references products(id) on delete set null,
  experiment_id uuid references experiments(id) on delete set null,
  object_type text, object_id text,                      -- campaign | adset | ad
  method text not null, path text not null, is_write boolean not null,
  request jsonb, status integer, response jsonb,
  usage jsonb,                                           -- X-Ad-Account-Usage / X-Business-Use-Case / insights throttle
  plan_path text, note text
);

-- enable RLS on all seven (no policies)
alter table meta_ads_campaigns enable row level security;  -- ...and the other six
```

Later, only if needed: placement / age-gender rows in the same breakdowns table (no migration), and a
channel-agnostic `ad_changes` replacing both journals.

The decision metric is data, not code: v1 ranks by **cost per trial** (`spend / trials`). When web-to-app funnels
start, the metric becomes **cost per purchase**; the experiment's `rules` (`experiments.rules.metric`) says which
one applies, defaulting to `trials`.

### 1.1 Creative attributes

What we want to answer: *spend, CPI, hook rate, cost per trial grouped by hook / angle / audience / format / text /
actor, and by combinations (hook × audience).* The unit Meta reports on is the **ad** (= one creative in one ad
set), so every attribute must resolve to an `ad_id` to join `meta_ads_ad_daily`.

Where each attribute naturally comes from:

| Attribute | Lives on | Filled by |
| --- | --- | --- |
| media (video/image), format, length | creative | sync (`video_id` / `image_hash`), name token `fmt:` / `len:` |
| hook, angle, CTA style, actor/voice | ad name | name tokens (§2); LLM pass can propose for old/unnamed ads |
| primary text, headline | creative | sync (`body`, `title`, exact strings); optional `txt:` / `hl:` variant code in name for grouping |
| subtitles / on-screen text, spoken hook line | creative | not in the API: LLM pass over the video (transcript + frames) → `attributes` |
| audience | ad set | name token `aud:` on the ad set; raw `targeting` from sync |
| geo, objective, launch month | campaign | name tokens |
| anything new | any | new name token or a manual/LLM key; no migration |

Options:

| | Typed columns (`hook text, audience text, ...`) | Tag table (`ad_id, key, value, source`) | **jsonb on existing rows + one view** |
| --- | --- | --- | --- |
| New attribute | migration | insert | insert |
| Query "by hook" | `group by hook` | join + filter per key; combos need self-joins | `group by attrs->>'hook'` |
| Multi-valued | awkward | natural | arrays in jsonb |
| Tables added | 0 | 1 | 0 (+1 view) |
| Risk | churn as we learn what matters | over-built for one account | typos in keys/values → parser validates keys |

**Recommendation: jsonb + one view.** Name-derived keys sit in `name_attributes` on campaigns, ad sets and ads
(the sync rewrites them from the current name, so renaming in Ads Manager is how you change them). Content tags
that aren't in the name sit in `meta_ads_creatives.attributes` (manual or LLM, never touched by sync). One view
merges them; the more specific, owner-written source wins:

```sql
create view meta_ads_ad_attributes as
select a.id as ad_id, a.adset_id, a.campaign_id, a.creative_id,
       coalesce(cr.attributes, '{}')                       -- content tags (lowest)
       || c.name_attributes || s.name_attributes || a.name_attributes   -- names (ad wins)
       || jsonb_strip_nulls(jsonb_build_object('headline', cr.title, 'primary_text', cr.body,
                                               'cta_type', cr.call_to_action_type)) as attrs
from meta_ads_ads a
join meta_ads_adsets s on s.id = a.adset_id
join meta_ads_campaigns c on c.id = a.campaign_id
left join meta_ads_creatives cr on cr.id = a.creative_id;

-- Leaderboard: performance by hook (swap the key, or group by two keys for combinations)
select attrs->>'hook' as hook, count(distinct d.ad_id) as ads,
       sum(spend) as spend, sum(impressions) as impr,
       sum(video_3s_views)::numeric / nullif(sum(impressions), 0) as hook_rate,
       sum(spend) / nullif(sum(installs), 0) as cpi,
       sum(spend) / nullif(sum(trials), 0) as cost_per_trial
from meta_ads_ad_daily d join meta_ads_ad_attributes x using (ad_id)
where d.date >= current_date - 28
group by 1 having sum(spend) >= 20 order by cpi nulls last;
```

The leaderboard runs as SQL (view or RPC), not as a PostgREST select aggregated in JS, because selects cap at
1000 rows.

Filling the attributes:

1. **Naming convention (default, deterministic):** the sync parses names into `name_attributes` and records
   problems in `parse_warnings`. No extra calls.
2. **Manual:** `pnpm meta-ads tag <creative_id> key=value ...` writes `meta_ads_creatives.attributes` (DB only, no
   Meta call). Used for things not worth putting in a name.
3. **LLM pass (later, optional):** for creatives missing on-screen text / hook line, an agent session reads the
   thumbnail and video, writes `{ "onscreen_text": "...", "hook_line": "...", "_by": "llm", "_at": "..." }` into
   `attributes`. It never overwrites a key the owner set (keys without `_by: llm` are left alone). Getting the
   video file needs one `GET /<video_id>?fields=source` call per new video *(inference: check `META_ADS_TOKEN` can
   see Page videos)*.

Keys are a small generic vocabulary in code (`product, angle, hook, audience, format, length_s, cta, actor,
text_variant, headline_variant, placement, geo, objective, version, launch`); values are free lowercase slugs that
live only in the data. Unknown keys are kept and warned about, not rejected.

**Reuse `ads` / `creatives`?** Keep separate. `ads` / `ad_creatives` / `product_ads` model *public Ad Library
observations* (competitors, start/stop dates, scrape membership); our ads have budgets, statuses, a hierarchy and
daily spend, and the scraper's upserts on `(source, external_id)` shouldn't share rows with them. The only overlap
is media: `meta_ads_creatives.sha256` can point at `creatives` once we download our own files, so own and
competitor creatives can sit side by side later. Not needed for v1.

Keep the attributes clean: prefer one creative per ad and turn off "multiple text options" / dynamic creative /
Advantage+ creative enhancements for test ads; otherwise Meta mixes texts per impression and per-ad attributes
stop meaning one thing *(inference: setting names as they appear in Ads Manager today)*.

## 2. Naming convention

Goals: readable at a glance in Ads Manager, short enough to fit the column, parseable. `PRD` below is a
placeholder product code (the real code lives in `tracked_sources.config.product_code`).

**Option A: positional, underscore-separated**

```
PRD_US_install_2610                        campaign
PRD_broad-25-44_adv                        ad set
PRD_time-saver_pain-first_ugc_15_v2        ad
```
Shortest. But you must remember the order, an empty slot breaks it, and adding a field changes every position.

**Option B: everything on the ad, key:value**

```
PRD | geo:us | aud:broad-25-44 | ang:time-saver | hook:pain-first | fmt:ugc | len:15 | cta:try | v2 | 2610
```
Self-describing and order-free, but long (truncated in Ads Manager) and repeats what the ad set already says.

**Option C (recommended): key:value tokens, each level carries its own attributes**

```
PRD | us | install | 2610                                  campaign: product, geo, objective, launch YYMM
aud:broad-25-44 | plc:adv                                  ad set: audience, placement
ang:time-saver | hook:pain-first | fmt:ugc | len:15 | v2   ad: angle, hook, format, length, version
ang:social-proof | hook:question | fmt:static | txt:b | v1
```
Each name stays short, the hierarchy is visible in Ads Manager anyway, and the view (§1.1) merges the levels.
Order doesn't matter; tokens can be added or omitted.

Token aliases (generic, in code): `ang`→angle, `hook`, `aud`→audience, `fmt`→format, `len`→length_s, `cta`,
`act`→actor, `txt`→text_variant, `hl`→headline_variant, `plc`→placement, `geo`, `obj`→objective.

Parsing rules (same function for all three levels):

1. Split on `|`, trim, lowercase. Empty tokens are ignored.
2. `key:value` → alias lookup; value must match `[a-z0-9][a-z0-9-]*` (`len` must be an integer → number).
3. Bare tokens: `v\d+` → `version`; `\d{4}` → `launch` (YYMM) and `\d{6}` → `launch` (YYMMDD); two-letter token on
   a campaign → `geo`; known objective words on a campaign (`install`, `traffic`, `purchase`) → `objective`;
   the first token of a campaign → `product`, checked against `product_code` (mismatch = warning).
4. Unknown key → kept as is + warning `unknown key "x"`. Unparseable token → appended to `_unparsed` + warning.
   Duplicate key → last one wins + warning.
5. **Never fails the sync.** Warnings land in `parse_warnings` and show in the UI; fixing = rename in Ads Manager
   (renaming doesn't reset learning *(inference: names aren't a delivery field)*), next sync re-parses.
6. Names with no `|` (legacy ads) parse to `{}` + warning `no tokens`; they can be tagged manually or by the LLM pass.

## 3. UI (web/)

Follow the Apple Ads screens (`web/app/p/[slug]/apple-ads/page.tsx` + `web/lib/apple-ads.ts`): server components,
`server-only` Supabase, a range selector, stat cards, tables, a daily chart, experiments + log panels.

Sidebar (`web/components/sidebar.tsx`): the current "Meta ads" item is the **Ad Library** page (`/p/[slug]/ads`).
Rename it to "Meta Ad Library" (same route) and add two items, mirroring "Apple Ads" + "Apple keywords":

| Item | Route | Content |
| --- | --- | --- |
| Meta Ads | `/p/[slug]/meta-ads` | stat cards (spend, impressions, CTR, installs, CPI, Meta trials, cost per trial, hook rate); daily spend/trials chart; country table (spend, trials, cost per trial); campaigns table (status, budget, spend, CPI); ad sets table (audience, budget, learning stage); ads table (thumbnail, parsed attributes as chips, spend, hook rate, CPI, rankings, `parse_warnings` badge); experiments with `channel='meta_ads'` + `experiment_log`; recent `meta_ads_changes` writes |
| Meta creatives | `/p/[slug]/meta-ads/creatives` | leaderboard: pick one or two attribute keys (`?by=hook&by2=aud`), min spend, range; rows = attribute value(s) with ads count, spend, hook rate, thruplay rate, CTR, CPI, cost per trial; click a row → the ads behind it with thumbnails; an "untagged / warnings" list |

Proposed changes are **read-only** in the UI (no auth, internal tool): a "Proposed changes" panel lists Meta plan
plan documents in `product_docs` that have no matching write in `meta_ads_changes` yet (read from the database like the Brand
tab's `web/lib/brand.ts`), and the affected rows in the ads / ad sets tables get a "pause proposed" or
"budget 20 → 24 proposed" badge. Approval happens by the owner saying yes; `apply` runs outside the UI.

## 4. Manual first fill

One-time setup by Andriy (about 20 min; menu names as of the docs, may shift):

1. **Business Manager**: confirm the business owns the ad account and the Page.
2. **App**: developers.facebook.com → Create app → type *Business* → connect it to the business. Add the
   *Marketing API* product. Managing your own account needs only standard access to `ads_read` /
   `ads_management`; no App Review.
3. **System user + token**: Business settings → Users → System users → add `mad-factory` (role *Employee*) →
   Assign assets: the ad account with *Manage campaigns*, and the app → Generate token: the app, expiry *Never*,
   scopes **`ads_read`, `ads_management`** (plus `business_management` only if the dialog requires it).
   Use `META_ADS_TOKEN` for sync and any later owner-approved `apply`; the sync client only exposes GET and cannot
   write to the account.
4. **Secrets** (names describe infrastructure, not the product):

   | Secret | Where | Used by |
   | --- | --- | --- |
   | `META_ADS_TOKEN` | Devin repo-scoped secret + local `.env` | sync (read-only by code), `apply` |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | already exist | writing rows |

5. **Register the account** (DB row, no code):
   `pnpm product add-source <slug> --source meta_ads --kind ad_account --value act_<id> --config '{"product_code":"<code>"}'`
6. **First sync**, locally: `pnpm meta-ads sync --product <slug> --days 28 --dry-run` (prints
   counts, writes nothing), then without `--dry-run`.
7. **Sanity checks** (SQL or the new page):
   - campaign / ad set / ad counts match Ads Manager (incl. paused);
   - 28-day spend and impressions per campaign match Ads Manager within rounding (same attribution setting, account
     time zone);
   - installs per campaign match Ads Manager's "App installs" column;
   - `parse_warnings` lists exactly the ads with legacy names;
   - `meta_ads_changes` shows only `is_write = false` rows and the run's total calls.

**Call budget** (one account, Limited access tier: 60 points / 300 s, read = 1 point; insights 600 + 400 × active
ads per hour):

| # | Call | Calls |
| - | --- | --- |
| 1 | `GET act_<id>?fields=currency,timezone_name,account_status` | 1 |
| 2–4 | `GET act_<id>/campaigns`, `/adsets`, `/ads?fields=...,creative{...}` (`limit=200`) | 3 (+1 per extra page) |
| 5 | `GET act_<id>/insights?level=ad&time_increment=1&time_range=<window>` (impressions > 0) | 1–3 pages per 7 days |
| 6 | same, `breakdowns=country` | 1–3 pages per 7 days |

First fill (28 days): ~15–25 calls. Daily: ~6–10. Hard ceiling per run: **40 calls**; reaching it stops the run with
an error. Well under every limit.

Rate-limit handling, only what Meta's guidance requires: calls are sequential (no parallel insights); every
response's usage headers go into the journal; the run **stops** (no sleep, no retry) when any `*_util_pct` ≥ 90 or
on a throttle code (`4`, `17`, `613`, `80000`, `80003`, `80004`, `80014`, `2446079`, `1487742`), with
`estimated_time_to_regain_access` in the error. The next day's run picks up the gap (§5).

## 5. Automation

**Daily read sync**, `pnpm meta-ads sync --all --days auto`: re-pulls the trailing **7 days** every day (SKAN and
late conversions arrive ≥ 24 h late; upserts overwrite), widens automatically after a missed day, capped at 28
(insights are final after 28 days). Mondays re-pull 28 days.

How it runs today vs options:

| | GitHub Actions workflow (documented in `AGENTS.md`, not on `main`) | Devin scheduled automation (what runs Apple Ads + RevenueCat today) |
| --- | --- | --- |
| Exists | no `.github/` in the repo | yes: daily 07:00 America/New_York, max 1 concurrent, on `main` |
| Cost | free, no LLM | ACUs per run |
| Secrets | would need duplicating into GitHub | repo-scoped Devin secrets already set |
| Failure alert | GitHub email | automation reports failure |
| Network | open | allowlist: add `graph.facebook.com` |

**Recommendation:** add `pnpm meta-ads sync --all --days auto` as one more step to the existing Devin automation,
with `META_ADS_TOKEN` as a repo-scoped secret and `graph.facebook.com` allowlisted. One schedule, one
failure report, secrets already in place. Revisit GitHub Actions for all three syncs if the ACU cost matters; it
would also make `AGENTS.md` true again (separate fix).

**Failure handling** (no extra machinery): the run marks `scrape_runs.status='error'` with the message and exits
non-zero; the automation reports it; tomorrow's `--days auto` widens the window to cover the gap. A Meta failure
doesn't block the Apple / RevenueCat steps (separate commands). `401/190` (token invalid/expired) → the error says
to regenerate the system-user token.

**Agents and writes** (new `playbooks/meta-ads.md`, mirroring `playbooks/apple-ads.md`):

- Agents read only the DB (web app, `pnpm meta-ads status`, SQL). No "looking around" API calls.
- Changes are proposed as plan documents in `product_docs` with a machine-readable block:

  ```json
  { "channel": "meta_ads", "experiment": "<slug or null>",
    "actions": [
      { "op": "pause",  "object": "ad",    "id": "<ad id>", "expect": { "status": "ACTIVE" }, "why": "..." },
      { "op": "budget", "object": "adset", "id": "<adset id>", "from": 2000, "to": 2400, "why": "..." } ] }
  ```
- v1 ops only: `pause` / `resume` (ad, ad set, campaign) and `budget` (ad set or campaign daily budget).
  Guardrails checked by `apply` (agreed with Andriy): budget change ≤ ±20% per object per 24 h (from `meta_ads_changes`; Meta itself allows 4 budget edits per ad set per
  hour); no creative/targeting/optimization edits (those always reset learning).
- **Every change needs Andriy's approval.** No auto-pause. Review is batched about **twice a week**: an agent
  session reads the DB, drafts one plan with all proposed pauses / resumes / budget moves, Andriy approves (all or
  some), then it's applied.
- `pnpm meta-ads apply <plan> --confirm`, run with `META_ADS_TOKEN` in an owner-authorized session: re-reads each object (1 call), refuses if it differs from `expect` / `from`, writes,
  journals each call with `plan_path`, re-syncs touched objects, and appends a line to `experiment_log`. Without
  `--confirm` it prints what it would do. (Apple Ads has no `apply` command; Devin applies its plans by hand and
  journals them. Meta gets the command because its writes are few and uniform.)

Build order once approved: migration + types + PGlite test → client + sync (+ fixture tests) → CLI + first fill →
automation step → web pages → playbook → `apply`.

## Decisions (Andriy, 2026-10-02)

| # | Question | Answer |
| - | --- | --- |
| 1 | Accounts | One ad account. Multiple accounts (if open-sourced) later; `tracked_sources` already allows it. |
| 3 | Keep/kill metric | Start trial (mobile) now; purchase for web-to-app later. Per experiment, default trials. |
| 4 | RevenueCat vs Meta | Meta-reported trials are fine for v1. |
| 5 | Auto-pause | No. Every change approved; batched about twice a week. |
| 6 | Budget limits | ±20% per 24 h. |
| 7 | Tokens | One token for now (`META_ADS_TOKEN`); split may come later. |
| 9 | Breakdowns | Country in v1 (US only now, more countries in about a month). |

## Still open

2. **Naming:** deferred by Andriy. Tags are manual (`pnpm meta-ads tag`) until a convention is picked; then a
   parser fills the same keys from names.
8. **LLM tagging:** deferred. An optional step where an agent watches each new video once and records on-screen text /
   subtitles and the first spoken line as tags (these aren't in Meta's API). Proposed: skip in v1; put the hook
   in the ad name. The storage for a richer per-media breakdown lives in `creative_profiles` (docs/creative-profile.md).

- **Writes:** how `apply` works (plan format, write permissions) is decided later; nothing in this PR writes to Meta.

## Campaign roles

Process in `playbooks/meta-ads.md`. Keep a test campaign for new creative variants and a separate scale
campaign for proven winners. Preserve the existing post when a winner graduates so its social proof carries
over. The product's plan document records the approved split and the evidence for each change.
