# Feature map

One row per CLI command and web page: what it does, what it reads and writes, and what an
external API call costs per run. Derived from the code — when a cost depends on the data, it
says "varies". Ad-account writes happen only through `pnpm meta-ads` write subcommands, each
journaled to `meta_ads_changes` and requiring a `--plan` document name.

## CLI commands

| Command | What it does | Reads/writes | Tables touched | External API cost per run |
|---|---|---|---|---|
| `pnpm product list` / `show` | List/show products and their tracked sources | DB read | `products`, `tracked_sources` | 0 |
| `pnpm product create` / `update` | Create/update a product profile | DB write | `products` | 0 |
| `pnpm product docs list` / `import` / `add` / `show` / `export` | List, import, add, read and export typed product documents | DB read/write | `product_docs` | 0 |
| `pnpm product delete` | Delete a product and everything linked | DB write (destructive) | `products`, `tracked_sources`, linked rows | 0 |
| `pnpm product add-source` / `remove-source` / `enable-source` / `disable-source` | Manage a product's tracked sources | DB write | `tracked_sources` | 0 |
| `pnpm scrape` | Scrape a product's enabled ad sources (Ad Library) and store ads + media | DB write | `ads`, `creatives`, `ad_creatives`, `product_ads`, `scrape_runs`, `ad_library_observations` | varies (ScrapeCreators credits or Playwright; see --help) |
| `pnpm social` | Sync organic account + post stats per product | DB write | `social_accounts`, `social_account_snapshots`, `social_posts`, `social_post_media`, `social_post_snapshots`, `creatives` | varies (--posts/--max-credits; ScrapeCreators ~1 credit per profile + 1 per 10 Facebook reels; `--since` bounds a Facebook backfill) |
| `pnpm apple-ads sync` | Pull campaigns, keywords and daily numbers from Apple | DB write; ad account read-only | `apple_ads_campaigns`, `apple_ads_keywords`, `apple_ads_keyword_daily`, `apple_ads_search_terms_daily`, `apple_ads_term_popularity`, `scrape_runs` | ~40 calls for `--all --days 1`; +1–2 calls per new keyword text, max 10/run |
| `pnpm apple-ads research` | Apple's keyword suggestions for the app | DB write unless `--no-save`; read-only | `apple_ads_term_popularity` | varies (one lookup per term; see --help) |
| `pnpm meta-ads sync` | Pull campaigns, ad sets, ads and daily numbers into the DB | DB write; ad account read-only | `meta_ads_campaigns`, `meta_ads_adsets`, `meta_ads_ads`, `meta_ads_creatives`, `meta_ads_ad_daily`, `meta_ads_ad_daily_breakdowns`, `meta_ads_changes` (journal), `scrape_runs` | varies (one page per object type + per-day insights; see --help) |
| `pnpm meta-ads status` | Show latest sync, counts, last-7-day metrics, creative tags | DB read | `meta_ads_*`, `scrape_runs`, `meta_ads_changes` | 0 |
| `pnpm meta-ads tag` | Merge manual attributes into a creative | DB write | `meta_ads_creatives` | 0 |
| `pnpm meta-ads media` | Download each creative's video/image, or import a file | DB write + media storage | `creatives`, `meta_ads_creatives`, `meta_ads_changes` (journal) | varies (one per creative; --creative/--file = 0) |
| `pnpm meta-ads pause` | Pause ads | Ad account write | `meta_ads_changes` (journal), `meta_ads_ads` | 1 read + 1 write per ad |
| `pnpm meta-ads activate` | Activate ads / ad sets | Ad account write | `meta_ads_changes` (journal), `meta_ads_ads`, `meta_ads_adsets` | 1 read + 1 write per object |
| `pnpm meta-ads adset-update` | Update an ad set's name / daily_min_spend_target | Ad account write | `meta_ads_changes` (journal) | 1 read + 1 write |
| `pnpm meta-ads create-ad` | Upload media and create a PAUSED ad from a template | Ad account write | `meta_ads_changes` (journal) | varies (upload polls; see --help) |
| `pnpm meta-ads ad-text` | Swap an ad's headlines/primary text via a rebuilt creative | Ad account write | `meta_ads_changes` (journal) | ~3 calls |
| `pnpm meta-ads launch` | Batch create PAUSED → activate → DB mirror from a spec | Ad account write | `meta_ads_changes` (journal), `meta_ads_ads`, `meta_ads_creatives`, `creatives` | varies (per spec ad; see --help) |
| `pnpm meta-ads verify` | Re-read the objects a plan document's writes touched and compare | DB read + ad account read | `meta_ads_changes` (read + journal rows only) | ≤6 GETs (typically 2: ads + ad sets) |
| `pnpm creatives profile` | LLM breakdown of each stored media file; runs daily from the daily review (`--source library --min-days 7 --limit 50`) | DB write | `creative_profiles`, `creatives` | 1 Gemini Flash call per new file; already-profiled files and ads under `--min-days` cost nothing; `--limit` caps a run |
| `pnpm creatives angles` | Re-tag `strategy.angle` on stored profiles | DB write with `--apply` | `creative_profiles` | varies (LLM; --out alone = reads only) |
| `pnpm creatives show` | Print one stored profile | DB read | `creative_profiles` | 0 |
| `pnpm revenuecat sync` | Pull trials, conversions, revenue, proceeds per day/keyword | DB write | `revenuecat_keyword_daily`, `scrape_runs` | varies (see --help) |
| `pnpm scorecard` | Monthly profit vs goal from synced tables | DB read | `product_goals`, `revenuecat_keyword_daily`, `meta_ads_ad_daily`, `apple_ads_keyword_daily` | 0 |
| `pnpm scorecard goal` | Set a product's monthly profit goal | DB write | `product_goals` | 0 |
| `pnpm brief` | Goal, projection, last-N-days per channel, follow-ups due, stale data | DB read | same as scorecard + `experiments`, `experiment_log`, `experiment_campaigns`, `apple_ads_campaigns`, `apple_ads_keywords`, `social_posts`, `scrape_runs` | 0 |
| `pnpm experiment upsert` / `list` / `log --due` / `resolve` / `history` | Experiment records, dated log and follow-ups | DB read/write | `experiments`, `experiment_campaigns`, `experiment_log` | 0 |
| `pnpm mcp-key create` / `list` / `revoke` | Per-agent keys for `/api/mcp` (only the SHA-256 is stored) | DB read/write | `mcp_api_keys` | 0 |
| `pnpm doctor` | Which integrations have keys here (names only), what each missing one turns on, database reachable | env read + DB read | `products` (count) | 0 |
| `pnpm ready` | Local gate: typecheck, tests, db types, web typecheck, diff rules, privacy check and goal | repo checks + private-term sources | `products`, `tracked_sources` (privacy reads only) | 0 |
| `pnpm privacy [--all]` | Block private terms in changed files (or all tracked files), paths, commit messages, branch names and PR text | DB/local/CI terms + git metadata | `products`, `tracked_sources`, `experiment_campaigns`, `apple_ads_keywords` (read-only) | 0 |

## Web pages (`web/app`, server components; Supabase service-role reads unless noted)

| Route | What it shows | Reads/writes | Tables touched | External API cost per run |
|---|---|---|---|---|
| `/` | Product list | DB read | `products` | 0 |
| `/setup` | Which keys this server has (names only) and how to add the rest; every page shows it while Supabase or sign-in is missing | env read | none | 0 |
| `/p/[slug]` | Goal-first overview (same numbers as `pnpm brief`), plus the channels not set up yet with their commands | DB read | same as `pnpm brief`, including `apple_ads_keywords` and `experiment_campaigns`, plus `tracked_sources` | 0 |
| `/p/[slug]/ads` | Ad Library ads for the product, filterable by direct competitor vs adjacent niche and favorites; star an ad; the preview shows the video transcript from its creative profile + add-source and relation-switch actions | DB read/write (source add, `config.relation`, `favorites`) | `ads`, `product_ads`, `scrape_runs`, `ad_library_observations`, `creatives`, `creative_profiles`, `favorites`, `tracked_sources` | 0 |
| `/p/[slug]/ads/[id]` | One ad's detail and creatives | DB read | `ads`, `ad_creatives`, `creatives`, `ad_library_observations` | 0 |
| `/p/[slug]/apple-ads` | Apple Ads overview: campaigns, bids, experiments | DB read | `apple_ads_campaigns`, `apple_ads_keywords`, `apple_ads_keyword_daily`, `apple_ads_search_terms_daily`, `revenuecat_keyword_daily`, `experiments`, `experiment_campaigns`, `experiment_log` | 0 |
| `/p/[slug]/apple-keywords` | Keyword performance + term popularity | DB read | `apple_ads_keywords`, `apple_ads_keyword_daily`, `apple_ads_campaigns`, `apple_ads_term_popularity` | 0 |
| `/p/[slug]/brand` | Product profile, brand and research docs, tracked sources | DB read | `products`, `product_docs` (brand/research), `tracked_sources` | 0 |
| `/p/[slug]/creatives` | Stored creatives grouped with profiles; ours, direct competitors or adjacent niches | DB read | `creatives`, `creative_profiles`, `product_ads`, `tracked_sources`, `meta_ads_creatives`, `meta_ads_ads` | 0 |
| `/p/[slug]/edit` | Edit product profile fields | DB write | `products` | 0 |
| `/p/[slug]/meta-ads` | Own Meta account overview | DB read | `meta_ads_campaigns`, `meta_ads_adsets`, `meta_ads_ads`, `meta_ads_creatives`, `meta_ads_ad_daily`, `meta_ads_ad_daily_breakdowns`, `scrape_runs` | 0 |
| `/p/[slug]/meta-ads/creatives` | Meta creatives with manual attributes | DB read | `meta_ads_creatives`, `meta_ads_ads`, `creatives` | 0 |
| `/p/[slug]/my-accounts` | Own social accounts' reels/videos (starrable, with transcripts in the preview) + add-source action | DB read/write (source add, `favorites`) | `social_accounts`, `social_posts`, `social_post_snapshots`, `social_post_media`, `social_account_snapshots`, `creatives`, `creative_profiles`, `favorites`, `tracked_sources` | 0 |
| `/p/[slug]/organic` | Competitor/inspiration accounts; star a post and filter to favorites; the preview shows the transcript (the post's own, else its video's creative profile) | DB read/write (source add, `favorites`) | `social_accounts`, `social_posts`, `social_post_snapshots`, `social_post_media`, `social_account_snapshots`, `creatives`, `creative_profiles`, `favorites`, `tracked_sources` | 0 |
| `/ui`, `/ui/frame` | Component gallery | none | none | 0 |
| `/login`, `/api/auth/github`, `/api/auth/callback`, `/api/auth/logout` | GitHub sign-in for allowlisted owners; signed session cookie | none (cookie only) | none | 2 GitHub calls per sign-in |
| `/api/mcp` | Read-only MCP server for agents (per-agent bearer key), including the `product_docs` tool for brand, research, plan and write-up documents | DB read (+ `last_used_at`) + file read | `mcp_api_keys`, `product_docs`, same as `pnpm brief`, `/p/[slug]/apple-ads`, `/p/[slug]/meta-ads`, `apple_ads_changes`, `meta_ads_changes` | 0 |

Every route except the sign-in flow and `/api/mcp` requires a signed-in owner (`web/proxy.ts`); server actions also
call `requireOwner()`. While sign-in is not configured, page loads show `/setup` and nothing else.

No web page or read-only command touches an ad account. Source add/remove actions on the ads
and organic pages write `tracked_sources` only.
