<div align="center">

<img src="web/public/home/emblem.webp" alt="" height="96">

# Mad Factory

**Open-source agents for marketing and ads.**<br>
Watch your competitors, run your Meta and Apple Ads, and make your next ads and posts.<br>
Self-hosted. You approve every change.

[![License: MIT](https://img.shields.io/badge/license-MIT-c6f432?style=flat-square&labelColor=1e2a44)](LICENSE)
![Node 22](https://img.shields.io/badge/node-22.6%2B-c6f432?style=flat-square&labelColor=1e2a44)
![Supabase](https://img.shields.io/badge/database-Supabase-c6f432?style=flat-square&labelColor=1e2a44)
![MCP](https://img.shields.io/badge/agents-MCP-c6f432?style=flat-square&labelColor=1e2a44)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Integrations](#keys-and-integrations) · [Agents](#working-with-ai-agents) · [Feature map](docs/feature-map.md)

</div>

## TL;DR

- **Automates Meta Ads and Apple Ads** for apps: syncs your campaigns, spend and revenue (RevenueCat), tracks
  competitor ads and reels, and puts one number on top: monthly profit against your goal. Google Ads and SEO are next.
- **Built to iterate fast without getting banned.** Data from ad platforms is fetched **once a day** by read-only
  syncs, and every analysis reads the database, never the platform API. No polling, no scraping on every question.
- **Experiments find what works.** Each one tests a marketing strategy (a hook, an angle, keywords, an audience)
  against rules that say when to scale it and when to pause it. Agents follow playbooks to judge them daily and
  draft changes; you approve in chat before any ad account changes.

<div align="center">
<img src="web/public/home/factory-animated.webp" alt="A paper-cut factory on a hill with smoke rising from its two striped chimneys" width="480">
</div>

## How it works

```mermaid
flowchart LR
  platforms["<b>Ad platforms and sources</b><br/>Meta Ads · Apple Ads · RevenueCat<br/>Ad Library · Instagram · TikTok"]
  db[("<b>Postgres</b><br/>spend, revenue, ads,<br/>posts, experiments")]
  read["<b>pnpm brief · web app · MCP</b><br/>profit vs goal, last 7 days"]
  agent["<b>AI agent</b><br/>follows the playbooks"]
  you["<b>You</b><br/>approve in chat"]
  platforms -- "once a day, read-only" --> db
  db --> read --> agent
  agent -- "plan" --> you
  you -- "write command, journaled" --> platforms
```

Syncs pull each platform once a day into Postgres. Everything else (the brief, the web app, agents) reads the
database, so nobody calls an ad API to answer a question. The only way back to an ad account is a plan you approved,
run from your machine. The web app holds no ad-account keys and can never change a campaign.

## Experiments: test strategies, keep what works

Marketing here is a series of experiments. Each one tests one strategy (a new hook or angle, a set of keywords, an
audience, a country) with its own campaigns, budget, dates and the rules that decide it, then ends with a verdict
that shapes the next one.

```mermaid
flowchart LR
  idea["<b>Strategy to test</b><br/>hook, angle, keywords,<br/>audience, country"]
  exp["<b>Experiment</b><br/>campaigns, budget,<br/>win and cut rules"]
  run["<b>Runs for days</b><br/>daily sync collects<br/>spend, trials, revenue"]
  judge{"<b>Judge vs rules</b><br/>cost per trial vs<br/>what a trial is worth"}
  scale["Scale it"]
  cut["Pause it"]
  learn["<b>Verdict</b><br/>what we learned"]
  idea --> exp --> run --> judge
  judge -- "works" --> scale --> learn
  judge -- "doesn't" --> cut --> learn
  learn --> idea
```

- **Experiments** keep the memory: what is being tested, the rules, and a dated log of every observation,
  decision and follow-up, so "what are we testing and how is it going?" has an answer any day.
  `pnpm experiment list --product <slug>`.
- **Playbooks** ([playbooks/](playbooks)) are the method agents follow: [daily-review.md](playbooks/daily-review.md)
  (once a day: read the brief, judge each running experiment by its rules, log, draft plans), plus
  [meta-ads.md](playbooks/meta-ads.md) and [apple-ads.md](playbooks/apple-ads.md) for how campaigns are structured.
- **Plans** turn a verdict into a change: one reason per item, you say yes in chat, then a write command
  (`pnpm meta-ads pause|activate|launch|...`) applies it. Changes are paced: at most 20% on a budget or bid, once
  per ad set or keyword per 24 hours. Nothing is ever deleted.

The full model is in [docs/marketing-loop.md](docs/marketing-loop.md).

## What's built and what's next

| Channel | Status | What it does |
|---|---|---|
| **Meta Ad Library** | ✅ Built | Tracks competitor pages and search keywords, downloads every ad's video or image, and records each ad's rank and status on every run, so long-running ads stand out. Sources are tagged as competitors or inspiration from nearby niches. `pnpm scrape` |
| **Organic** | ✅ Built | Instagram, TikTok and Facebook reels from competitor, inspiration and your own accounts, with views tracked over time so outlier posts float up. `pnpm social` |
| **Meta Ads** | ✅ Built | Syncs your own ad account (campaigns, ad sets, ads, creatives, daily numbers by country). It can pause, activate, create paused ads and launch tests, each from a plan you approve first and journaled before it is sent. It never deletes. `pnpm meta-ads` |
| **Apple Ads** | ✅ Built | Syncs your campaigns, keywords and search terms per country, every day. Changes are drafted as a plan for you to apply. `pnpm apple-ads` |
| **RevenueCat** | ✅ Built | Trials and proceeds, so the overview shows profit against your monthly goal. `pnpm revenuecat` |
| **Creative analysis** | ✅ Built | Gemini breaks each stored video or image into its hook, script, angle and production style. `pnpm creatives profile` |
| **Google Ads** | 🛠 Next | Your own Google Ads campaigns (Search and video): spend, keywords and conversions, synced like Meta and Apple Ads. |
| **SEO** | 🛠 Next | Search rankings and organic traffic for your site and app store pages. |

**Automations.** The syncs and the daily review (`playbooks/daily-review.md`) run on a schedule. Today that
schedule is a Devin automation (see [What Devin does here today](#what-devin-does-here-today)) and isn't part of
this repository. Every step is a plain `pnpm` command, so cron, GitHub Actions or any agent that can run a shell
works too.

## Quick start

You need Node 22.6+ and pnpm. Supabase is the only required service, and its free plan is enough.

```bash
pnpm install
cp .env.example .env          # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
pnpm doctor                   # what is configured, what each missing key would turn on
pnpm db:migrate               # creates the tables (needs SUPABASE_DB_URL; or: supabase db push)
pnpm product create --file examples/product.example.json
echo "AUTH_DISABLED=true" >> .env   # local only: skip GitHub sign-in for `pnpm web`
pnpm web                      # http://localhost:3000
```

The web app works from the first step. A page whose channel is not set up says so, and the overview lists the
commands that connect each channel. `/setup` shows which keys the server has; it shows names only, never values.

No database yet? `pnpm db:migrate:local` runs every migration on an embedded Postgres (PGlite) to check the
schema without one.

## Keys and integrations

Put keys in `.env` at the repository root. The web app reads the same file. Only Supabase is required. Without a
key, its feature stays off, and the command that needs it says which key to set and where to get it.
`pnpm doctor` checks all of them.

| Integration | Turns on | Variables | Without it |
|---|---|---|---|
| **Supabase** (required) | The database for everything | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Nothing runs |
| Database migrations | `pnpm db:migrate` | `SUPABASE_DB_URL` (Session pooler URI) | Use `supabase db push` |
| ScrapeCreators | Competitor ads (`pnpm scrape`) and organic posts (`pnpm social`) | `SCRAPECREATORS_API_KEY` | `pnpm scrape --collector playwright` uses a local browser instead; no organic sync |
| Cloudflare R2 | Media storage, so the web app can play videos | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, optional `R2_PUBLIC_URL` | Media is saved to `./data/media`; the web app shows placeholders |
| Proxy | A rotating proxy for the browser collector | `PROXY_URL` | Direct connection |
| Meta Ads | Your own Meta ad account (`pnpm meta-ads`) | `META_ADS_TOKEN` | The Meta ads tab stays empty |
| Apple Ads | Your Apple Ads campaigns (`pnpm apple-ads`) | `APPLE_ADS_DIR`, or `APPLE_ADS_CLIENT_ID`, `APPLE_ADS_TEAM_ID`, `APPLE_ADS_KEY_ID`, `APPLE_ADS_PRIVATE_KEY` | The Apple ads tabs stay empty |
| RevenueCat | Trials and revenue, so the overview shows profit (`pnpm revenuecat`) | `REVENUECAT_API_KEY` | Spend without revenue or profit |
| Google Gemini | AI breakdowns of creatives (`pnpm creatives profile`) and the web Transcribe button on organic posts | `GEMINI_API_KEY` | The Creatives tab stays empty; posts can't be transcribed |
| Vercel AI Gateway | `google/…` model ids for creative profiles | `AI_GATEWAY_API_KEY` | Gemini is called directly |
| Web sign-in (GitHub) | Sign in to the hosted web app | `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET`, `AUTH_SECRET`, `AUTH_ALLOWED_GITHUB_IDS`, optional `AUTH_URL` | The web app serves only `/setup`; `AUTH_DISABLED=true` skips sign-in in local `next dev` |

`.env.example` explains where to get each key. On a hosted web server, set only the Supabase and `AUTH_*`
variables, plus `GEMINI_API_KEY` for the Transcribe button. Keep ad-account keys on the machine that runs the syncs, so a stolen web session has nothing that can
change a campaign.

## Using it

Each product is something you market. Connect a channel by adding a tracked source to the product, then run its
sync:

```bash
# Competitor ads from the Meta Ad Library
pnpm product add-source example-product --kind page --value <facebook page id> --country US
pnpm product add-source example-product --kind keyword --value "search phrase"
pnpm scrape --product example-product --max 200

# Instagram, TikTok and Facebook accounts (relation: competitor, inspiration or own)
pnpm product add-source example-product --source tiktok --kind account --value example_handle --country ALL \
  --config '{"relation":"competitor"}'
pnpm social --product example-product

# Your own ad accounts and revenue
pnpm product add-source example-product --source meta_ads --kind ad_account --value act_<id>
pnpm meta-ads sync --product example-product
pnpm product add-source example-product --source apple_ads --kind app --value <App Store ID> \
  --config '{"ad_account_id": <id>}'
pnpm apple-ads sync --product example-product
pnpm product add-source example-product --source revenuecat --kind project --value <project id>
pnpm revenuecat sync --product example-product

# The goal and where you stand
pnpm scorecard goal --product example-product --target 5000
pnpm brief --product example-product

# AI breakdowns of every stored video and image
pnpm creatives profile --product example-product
```

Every command has `--help`. [docs/feature-map.md](docs/feature-map.md) lists every command and page: what it
reads and writes and what each run costs in API calls.

### Changing an ad account

Most commands only read. The Meta write commands (`pause`, `activate`, `adset-update`, `adset-copy`, `create-ad`,
`ad-text`, `launch`) each need a reviewed plan document in `product_docs`, and every request is journaled before it is sent. Read one with
`pnpm product docs show <slug> <name>`; add or update one with `pnpm product docs add <slug> --kind plan --file <path>`.
New ads and copied ad sets are always
created paused. Nothing in the code can delete or archive a campaign, ad set, ad or creative. The web app and the
MCP server cannot change an ad account at all.

## Web app

`pnpm web` starts it at http://localhost:3000. It has:

- an overview with the goal, channels, ads by spend, own posts, experiments and data freshness
- Competitor ads, Organic and Creatives for research
- Meta ads, Apple ads, Apple keywords and My accounts for your own channels
- Brand, for the product's profile and brand/research documents (`product_docs`; `pnpm product docs import|add|show|export`)

Hosted, it signs in with GitHub and lets in only the numeric GitHub user IDs in `AUTH_ALLOWED_GITHUB_IDS` (an ID never changes, a username can be renamed and taken by someone else; find yours at `https://api.github.com/users/<username>`).

### MCP for agents

`/api/mcp` is a read-only [MCP](https://modelcontextprotocol.io) server (Streamable HTTP). Each agent gets its own
key and sends `Authorization: Bearer <key>`:

```bash
pnpm mcp-key create --name my-agent   # prints the key once; only its SHA-256 is stored
pnpm mcp-key list
pnpm mcp-key revoke --name my-agent
```

The tools are `start_here`, `brief`, `recent_activity`, `experiments`, `experiment`, `apple_ads`, `meta_ads`,
`list_docs` and `read_doc`.

## Working with AI agents

The repository is set up for coding and marketing agents working side by side:

- [CLAUDE.md](CLAUDE.md) (also `AGENTS.md`) holds the rules every agent follows.
- [playbooks/](playbooks) holds the operating method: a daily review, plus Meta Ads and Apple Ads playbooks.
- `pnpm ready` runs every gate before a change merges: typecheck, tests, database types, and the repository's
  review rules.

### What Devin does here today

[Devin](https://devin.ai) does most of the day-to-day work. The rules it follows are the same ones in CLAUDE.md, so
Claude or Codex could do any of it.

- **Every morning, on a schedule.** A Devin automation starts a session once a day. The session follows a prompt
  that first runs the syncs as plain `pnpm` commands (Apple Ads, RevenueCat, Meta Ads, Ad Library, organic), each
  once with at most one retry. Then it follows `playbooks/daily-review.md`: it reads `pnpm brief`, checks each
  running experiment against its rules, drafts plans, logs observations and follow-ups, and sends a short report
  that is easy to read on a phone. That session never changes an ad account. Its prompt forbids write commands,
  and its network allowlist only reaches the APIs it syncs from. The only writes it makes are `experiment_log`
  rows.
- **Ad-account changes you approve in chat.** You ask for a change, Devin writes a plan to `product_docs`, and after
  you say yes it runs the write command (`pnpm meta-ads pause|activate|launch|...`). Every write is journaled before
  it is sent, and nothing is ever deleted.
- **Research.** Adding competitor and inspiration accounts, backfilling their ads and reels, and breaking down
  creatives with Gemini to find the hooks and angles that keep running.
- **Building Mad Factory itself.** Devin opens a branch and a PR for each change and runs `pnpm ready`. The owner
  merges.

## Development

```bash
pnpm ready          # typecheck, tests, db types, web typecheck, review rules
pnpm test           # node --test; migrations run on an in-memory PGlite Postgres
pnpm db:types       # regenerate src/db/database.types.ts after changing a migration
pnpm db:check       # quick connectivity test
pnpm db:audit       # post-scrape integrity checks on the live database
```

TypeScript runs directly on Node (type stripping): there is no build step and no native dependencies. See
[CLAUDE.md](CLAUDE.md) for the layout, the conventions and how to add a source.

## License

MIT. See [LICENSE](LICENSE).
