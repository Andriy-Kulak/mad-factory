# Agent instructions (CLAUDE.md = AGENTS.md)

Guidance for AI agents working in this repo. AGENTS.md is a symlink to this file, so Claude, Codex/GPT and Devin
read the same instructions.

## What this is
`mad-factory` is a generic marketing-intelligence platform: product profiles, a Meta Ad Library
scraper, organic tracking (Instagram Reels, TikTok, Facebook Reels), Apple Ads and the owner's own
Meta ad account, RevenueCat attribution, and channel-agnostic experiments — all writing to Supabase
Postgres and R2, with a Next.js web app on top. Every command and page is listed in
docs/feature-map.md. Still pending: deeper ad analysis and AI ad generation.

## The goal, and how every agent works here
Several agents (Claude, Codex/GPT, Devin) work in this repo at once. They share one goal and one set of gates.
- **The goal is a number.** Each product's monthly profit target is a `product_goals` row; profit is RevenueCat
  proceeds − ad spend from every synced channel − fixed costs. Start any marketing or analysis work with
  `pnpm brief --product <slug>`: the goal, this month's projection, the last 7 days per channel (Meta by its own
  AppsFlyer-based attribution, Apple by RevenueCat, plus RevenueCat's unattributed trials), Meta ads by spend, own
  posts, running experiments and stale data. The web overview shows the same numbers. Decide on the 7-day window;
  attribution older than about 10 days is not reliable. Justify a change by the number it moves or the bottleneck
  in the marketing loop it removes. `pnpm scorecard` sets the goal and shows the month.
- **Unattended work.** A scheduled agent follows `playbooks/daily-review.md` once a day. Work for any agent is queued
  as GitHub issues from the "Agent task" template (label `agent-ready`): goal, done-when, how to verify. A promise
  to come back later is a follow-up (`pnpm experiment log --due`); the brief lists the due ones.
- **Branch → PR → `pnpm ready` → merge.** Never push to `main`; one task per branch and PR. Never name a product,
  client, competitor, keyword or account ID in a branch name, commit message, PR title or description. GitHub keeps
  PR edit history, so a posted leak can't be fully undone. Before opening a PR, write the description to a file and
  run `pnpm ready --pr-title "<title>" --pr-body <file>`. `--fix` redacts the description, unpushed commit messages
  and an unpushed branch name. Terms come from the database, `local/private-terms.txt` and `PRIVATE_TERMS`. Run
  `pnpm hooks` once per clone to enable the pre-push check. Before calling a change ready, run `pnpm ready`: it
  runs typecheck, tests, the db types check and the web typecheck, checks the diff against the hard rules
  (`scripts/pr-review.ts`), checks private terms, shows the goal and asks the Goal check questions. Answer them in
  the PR description (`.github/pull_request_template.md`). When it passes and nothing needs the owner, merge it
  yourself (squash). CI (`.github/workflows/ci.yml`) runs the same `pnpm ready` on every PR and push to `main`.
  A PR that changes anything visual includes before/after screenshots in its description.
- **The owner approves ad-account changes in chat, not by merging.** An ad account changes only when an
  agent runs a write command (`pnpm meta-ads pause|activate|adset-update|create-ad|ad-text|launch`, with a
  reviewed plan document in `product_docs` (`pnpm product docs add <slug> --kind plan --file <path>`), journaled to `meta_ads_changes`) after the owner says
  yes in chat. Merging a PR never changes an ad account. Separately, `pnpm ready` demands owner sign-off
  for dangerous diffs: destructive SQL in a migration, a `.delete()` in code, editing a committed
  migration, or the ad-account write guards (`src/meta-ads/client.ts`, `src/apple-ads/client.ts`). Locally
  rerun with `--owner-approved`; in CI the owner adds the `owner-approved` label. Everything else: go ahead.
- **Small and boring wins.** Reuse an existing module before writing a new one; one way to do each thing; no
  abstraction with a single caller; no new dependency without a reason in the PR.
- **Corrections become checks.** When the owner corrects an agent, prefer, in order: making the mistake impossible in
  code, a test, a rule in `scripts/pr-review.ts`, and only then a line here. Say which under "Lessons" in the PR.

## Hard rule: product and campaign specifics live in the database
Anything about a specific product, client or campaign lives in the database, never in a repository file:
product, client, brand and competitor names; page, account, app and ad-account IDs; social handles and domains;
keywords and search terms; bids, budgets and target countries; copy, personas and claims; results, plans and notes.
This covers source, config, tests, examples, env var names, playbooks and docs, and also branch names, commit
messages, PR titles and descriptions. The repository holds code, generic playbooks and fictional examples
(`examples/product.example.json` must stay fictional). Env vars hold infrastructure credentials only (Supabase, R2,
optional proxy). If you are tempted to hardcode something, it belongs in a table.

`pnpm privacy` (part of `pnpm ready`) blocks the names and IDs it loads from the database. It cannot catch ordinary
words that give a niche away, such as the category a product's keywords target. So before opening a PR, read the
whole diff, every commit message and the PR title and description yourself, remove anything specific to a product,
client or campaign, and answer "Privacy" in the PR description.

## Product brand context
Brand data lives in `product_docs`, one markdown document per row (`readme`, `brand`, `audiences`, `angles`,
`angle-library`). Read it through MCP `product_docs` or export it with `pnpm product docs export <slug> --dir
local/<slug>` before writing copy, keywords, ad scripts or creative briefs. Edit documents locally and import
them with `pnpm product docs import <slug> --dir local/<slug>`.

## Layout
```
supabase/migrations/   SQL migrations (Supabase CLI layout; `supabase db push` or `pnpm db:migrate`)
src/db/                typed supabase-js client; database.types.ts is GENERATED from migrations (`pnpm db:types`),
                       types.ts holds aliases over it
src/sources/           ad sources behind the AdSource interface; Meta defaults to ScrapeCreators, with Playwright available
src/apple-ads/         own Apple Ads campaign tracking (not an AdSource): API client, payload mapping, sync
src/meta-ads/          own Meta ad account (not the Ad Library scraper): read-only + allowlisted-write Graph client
                       (pause, activate, updateAdset, uploadVideo, createAd), mapping, sync
src/scrape/ingest.ts   source-agnostic persistence: upsert ad, link to product, download+store media
src/lib/               env access and R2/local storage
src/cli/               `pnpm product`, `pnpm scrape`, `pnpm social`, `pnpm apple-ads`, `pnpm meta-ads`, `pnpm experiment` and
                       `pnpm scorecard`/`pnpm brief` entrypoints
src/scorecard/         profit vs goal and the overview: pure math (scorecard.ts, overview.ts) + loaders (load.ts),
                       shared by `pnpm scorecard`, `pnpm brief` and the web overview
src/social/            provider-neutral organic sync, SocialCollector and SocialStore contracts, Supabase store
src/social/providers/  platform/provider-specific collectors and normalizers
scripts/               migrate.ts, migrate-local.ts (PGlite), gen-types.ts, check-db.ts, db-audit.ts, schema.test.ts;
                       ready.ts (`pnpm ready`), privacy.ts and privacy-check.ts (`pnpm privacy`), pr-review.ts
.github/               CI (`ci.yml`: `pnpm ready`), the PR template with the Goal check and the Agent task issue template
examples/              fictional example product profile
product_docs           brand, research, plan and write-up documents in the database; use `pnpm product docs`
                       or MCP `product_docs` to list, read, import and export them
playbooks/             generic operating method: daily-review.md (the unattended daily routine); per channel read
                       playbooks/apple-ads.md or playbooks/meta-ads.md first
docs/                  design documents (docs/apple-ads-plan.md: schema, CLI and build order for Apple Ads + experiments)
web/                   Next.js 16 app (App Router, Tailwind v4): browse products, sources, runs, Meta ads, Apple Ads.
                       Server components + server actions only; service-role client in web/lib/db.ts.
                       Imports row types from ../src/db/types.ts via the @db/* alias (type-only).
```

## Data model (see the migration for details)
- `products` profile fields + `tracked_sources` (source, kind, value, country) per product. An Ad Library source's
  `config.relation` is `competitor` (default when unset) or `inspiration` (an adjacent niche); ads and creatives
  inherit it through `product_ads.tracked_source_id`, and `competitor` wins when sources disagree.
- `ads` is source-agnostic: unique on `(source, external_id)`; `raw` keeps the full payload,
  plus `collation_id`, `reach_estimate`, `spend`, `total_active_time` for later analysis.
- `creatives` keyed by sha256, shared across sources; `ad_creatives` links (ad, position) → creative.
- `product_ads` maps ads to the products/tracked sources that surfaced them.
- `scrape_runs` records each run per tracked source (Apple Ads syncs included, `source = 'apple_ads'`).
- `ad_library_observations` records each Ad Library ad's rank and status per scrape run.
- `apple_ads_*` tables hold the owner's own Apple Ads campaigns, keywords, daily keyword/search-term numbers per
  country, and the change journal; `experiments` + `experiment_campaigns` + `experiment_log` (dated observations,
  decisions and changes) are channel-agnostic. An app is tied to a
  product by a `tracked_sources` row (`source = 'apple_ads'`, `kind = 'app'`, `value` = App Store ID,
  `config.ad_account_id`). `pnpm scrape` skips sources that are not registered scrapers. See docs/apple-ads-plan.md.
- `meta_ads_*` tables hold the owner's own Meta ad account (campaigns, ad sets, ads, creatives with manual
  `attributes`, daily ad numbers + country breakdowns, call journal), tied to a product by a `tracked_sources` row
  (`source = 'meta_ads'`, `kind = 'ad_account'`, `value = act_<id>`). Separate from the Ad Library tables. See
  docs/meta-ads-plan.md.
- `product_goals` holds each product's monthly profit target, currency and monthly fixed costs (`pnpm scorecard goal`).
- `creative_profiles` stores one JSON breakdown per media file (hook, script, strategy, production, people),
  keyed by `creatives.sha256`; validated by `src/creative-profiles/schema.ts`. See docs/creative-profile.md.
- `social_accounts`, `social_account_snapshots`, `social_posts`, `social_post_media`, and `social_post_snapshots`
  hold public organic account and post data for Instagram, TikTok, and Facebook. Social sources use `source` equal
  to the platform, `kind = 'account'`, and `country = 'ALL'`; Instagram/TikTok values are lowercase handles,
  Facebook values are HTTPS profile URLs. `config.relation` is `own`, `competitor`, or `inspiration`;
  `config.provider` defaults to `scrapecreators`.

## Keys and optional integrations
Only Supabase is required. Every other service (ScrapeCreators, R2, Meta Ads, Apple Ads, RevenueCat, Gemini, GitHub
sign-in) is optional and listed once in `src/lib/integrations.ts`: its env vars, what it turns on, what still works
without it. `pnpm doctor`, the CLIs' missing-key messages (`requireIntegration`, printed without a stack trace by
`src/cli/errors.ts`), the web `/setup` page and the README table all read it; a test keeps `.env.example` and the
README in step. A new integration goes there first. In the web app a channel counts as connected when the product
has a tracked source for it (`web/lib/setup.ts`), since the web host does not hold sync keys; unconnected channels
stay in the sidebar marked "set up".

## Adding a source
Implement `AdSource` in `src/sources/<name>/`, map its payload to `CollectedAd`, and register it in
`src/sources/index.ts`. Do not touch ingest.ts unless the source needs a new media type.

## Conventions
- Formatting is Biome (`pnpm format`); `pnpm ready` fails on unformatted files. There is no linter on purpose.
- Node 22, TypeScript run directly via node type stripping (`node file.ts`; no tsx, no build step).
  Keep syntax erasable (`erasableSyntaxOnly`): no enums, no parameter properties. Import with `.ts` extensions.
- pnpm. Avoid native-build dependencies (playwright, @aws-sdk/client-s3, @supabase/supabase-js, postgres are all pure JS).
- `SCRAPECREATORS_API_KEY` is required for the default Meta Ad Library collector and the Instagram, TikTok, and Facebook `pnpm social` collectors; use `pnpm scrape --collector playwright` for the browser collector.
- Social collectors implement `SocialCollector`; `src/social/sync.ts` depends on that contract and the provider-neutral `SocialStore` interface.
- `pnpm social --product <slug> [--platform instagram|tiktok|facebook|all] [--relation own|competitor|inspiration] [--posts 12] [--max-credits 5] [--since YYYY-MM-DD] [--no-download]` syncs enabled social account sources; platform defaults to `all`. `--since` (Facebook only) keeps reels posted on/after the date and stops paging past it; pair it with a large `--posts` and `--max-credits` for a backfill (~1 credit per 10 reels).
- `docs/feature-map.md` lists every CLI command and web page — what it does, what it reads/writes, and the
  external API cost per run. Update it when you add or change a command or a page (pr-review warns).
- Service role key server-side only. RLS is on for every table with no policies, so the anon/authenticated roles
  get nothing; every new table must `enable row level security` in its migration. Never print secret values.
- Tests: `node --test`, colocated `*.test.ts`. `scripts/schema.test.ts` runs every migration on an in-memory
  PGlite Postgres, so schema changes are verified without a Supabase project. Run `pnpm ready` before calling a change ready.
- Migrations must stay PGlite-compatible: plain SQL, no Supabase-only extensions (gen_random_uuid is core).
- After changing a migration run `pnpm db:types` and commit `src/db/database.types.ts`; `pnpm db:types:check` fails when stale.
  `pnpm db:types:remote` does the same via the Supabase CLI against the live project (needs an IPv4-reachable
  SUPABASE_DB_URL, i.e. the Session pooler URI; the direct host is IPv6-only).
- `pnpm db:audit` runs post-scrape assertions against the live project (field coverage, orphan ads, missing creatives).
- LLM media analysis (`pnpm creatives profile`) calls Gemini directly with `GEMINI_API_KEY` and defaults to the
  latest stable Gemini Flash model, resolved at runtime from the models list; don't hardcode a model. Use Pro
  models or the Vercel AI Gateway (`google/…` ids, `AI_GATEWAY_API_KEY`) only when the owner asks.
- Commits: small, on a branch, ending with your own `Co-Authored-By:` line. The remote is a private GitHub repo; push
  the branch and open a PR (see "The goal, and how every agent works here").

## Apple Ads and experiments
Read `playbooks/apple-ads.md` before any Apple Ads work. `pnpm apple-ads sync` only reads; the Devin scheduled
automation "mad-factory: daily Apple Ads + RevenueCat backfill" runs it daily. The sync uses the same keys
as the write commands — the keys are not read-only; what makes it read-only is that the automation's prompt
and the sync code send no writes. Never change the ad
account directly: draft a plan document in `product_docs` for the owner with
`pnpm product docs add <slug> --kind plan --file <path>`. Claude also has `.claude/skills/apple-ads`.

## Meta Ads (own account)
Read `playbooks/meta-ads.md` before any Meta Ads work: ABO test campaign, CBO scale campaign, winners graduate on
their existing post so likes and comments carry over.
`pnpm meta-ads sync|status|tag|media` reads the owner's ad account into `meta_ads_*` (token in `META_ADS_TOKEN` only).
`meta-ads media` downloads each creative's video or image into `creatives` and fills `meta_ads_creatives.sha256`;
`--creative <id> --file <path>` imports a file the owner provides manually instead (no Meta call).
**NEVER delete or archive Meta ads, ad sets, campaigns or creatives — not even if the owner asks.
Pausing is reversible; deleting is not.** The client's write surface is a small allowlist
(`assertNotDestructive` guards every request): `meta-ads pause --ad <id>`, `meta-ads activate --ad|--adset <id>`,
`meta-ads adset-update --adset <id> [--name|--min-spend]`, `meta-ads create-ad --adset <id> --template-ad <id>
(--file|--video-id)` which uploads a video and creates a PAUSED ad from a template creative (ads are always
created PAUSED), `meta-ads ad-text --ad <id> --title|--body ...` which swaps an ad's text via a rebuilt
inline creative, and `meta-ads launch --spec local/<file>.json` which batches create PAUSED → activate → DB
mirror from a local spec (see "Launching new ads" in playbooks/meta-ads.md). Uploads are
`uploadVideo`/`uploadImage`. All writes take `--plan <file>` and journal-then-write to `meta_ads_changes`
(docs/meta-ads-plan.md). Tag creatives with `pnpm meta-ads tag`; analyze from the database only.
After a batch of approved writes, run `pnpm meta-ads verify --product <slug> --plan <name>` once: it
re-reads only the affected objects in grouped GETs and prints a pass/fail table to paste into the plan document.
When creating Meta ads from a template, write per-ad headlines/primary text matched to that video's hook and
keep the template's structure; reuse the template text verbatim only when the hook is the same.

## Creative profiles
`pnpm creatives profile --product <slug> [--source own|library|all] [--limit N] [--min-days N] [--model <id>] [--force]
[--concurrency N] [--dry-run]` asks an LLM (Google Gemini API, `GEMINI_API_KEY`) to break down each stored
media file and saves a validated profile to `creative_profiles`. `pnpm creatives angles --product <slug> --out <file>`
re-tags `strategy.angle` on stored profiles against the product's angle-library document in `product_docs`, and `--apply <file>`
writes a reviewed file back. `pnpm creatives show <sha256>` prints one.
See docs/creative-profile.md.

## Web app
- `pnpm web` starts the dev server; `pnpm web:build` builds. Shares the repo-root `.env` via next.config.ts.
- Keep all Supabase access server-side (`server-only`). Sign-in is GitHub OAuth for the numeric GitHub user IDs in
  `AUTH_ALLOWED_GITHUB_IDS` (web/lib/auth, web/proxy.ts gates every route); every new server action starts with
  `await requireOwner()`. `AUTH_DISABLED=true` skips sign-in in local `next dev` only.
- `/api/mcp` (web/lib/mcp/server.ts) is the read-only MCP server for outside agents, one key per agent
  (`pnpm mcp-key`). Its tools reuse the same loaders as the pages and `pnpm brief`; keep it read-only, and add new
  data (organic, competitor ads) as tools there rather than a second API.
- The web app never changes an ad account: nothing under `web/` may import Apple Ads or Meta Ads write code
  (web/lib/no-ad-writes.test.ts enforces it), and the hosted web server gets no `META_ADS_TOKEN` or Apple Ads keys.
  Ad-account writes stay in the CLIs, run from your machine with owner approval.
- The pnpm workspace is root + `web/`. Typecheck web with `pnpm --filter web typecheck`.
- Look and components: dark chrome (top bar, collapsible sidebar in `app/p/[slug]/layout.tsx`) around a light
  workspace; Geist, with Geist Mono only for numbers. Colour and motion tokens live in `app/globals.css`; build screens
  from the one component library before writing new markup: `components/ui.tsx` (static), `controls.tsx` (filters,
  popovers, modals), `media.tsx` (ad/post media and previews), `data-table.tsx` (tables), `skeleton.tsx` (loading
  states) and `switch.tsx`. `/ui` shows every component; read `web/DESIGN.md` (how screens
  should feel: instant client-side filters, URL follows state, everything closes on Esc) before building one.
  Sentence case, one primary (lime) button per view, transitions respect reduced motion.
- The overview (`/p/<slug>`) is goal-first and renders `overviewFor` from src/scorecard (web/lib/overview.ts), the
  same data as `pnpm brief`; the product profile and tracked sources live under Brand → "Profile & sources".
  `DataTable` rows take an `href`, so tables are sortable and rows link to their detail.
- Insights (`/p/<slug>/insights`, `components/insights-view.tsx`, pure logic in `lib/insights.ts`) aggregates the same
  ad cards as Competitor ads (`competitorAds()` attaches each card's slim creative profile and its `signal`: working
  or early) by angle, persona, hook type, format and landing page, by advertiser or in totals; clicking a row or cell opens
  its ads (working / running 21d+ / all) below the table. Opens on direct competitors. No LLM calls.
- Competitor ads (`/p/<slug>/ads`) and Organic load every card once and filter in the browser
  (`components/ad-browser.tsx`, `organic-browser.tsx`; pure logic in `lib/ad-cards.ts`, `lib/organic-filters.ts`).
- The Organic tab shows `competitor`/`inspiration` accounts; the My Accounts tab (`/p/<slug>/my-accounts`) shows `own` accounts' reels/videos only (`social_posts.kind` = `reel` or `video`), grouped by `tracked_sources.label`.

## Running
See README.md. `pnpm db:check` is the quickest connectivity test. `--headed` shows the browser when Meta changes the Ad Library page.
