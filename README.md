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

<br>

<img src="web/public/home/factory-simple.webp" alt="A paper-cut factory with two striped smokestacks and a lime flag on a hill above the sea" width="900">

</div>

<br>

Mad Factory collects what your competitors run, what your own ads and posts do, and what you earn. It keeps all of
it in one Postgres database and puts one number on top: your monthly profit against your goal. AI agents (Claude,
Codex, Devin or any MCP client) read the same data and follow the same playbooks.

<table>
<tr>
<td width="50%" valign="top">
<img src="web/public/home/blimp.webp" alt="" height="44"><br>
<b>Competitor research</b><br>
Ads from the Meta Ad Library, plus Instagram, TikTok and Facebook reels from accounts you follow. Videos are
downloaded and ranked over time.
</td>
<td width="50%" valign="top">
<img src="web/public/home/gears.webp" alt="" height="44"><br>
<b>Your channels</b><br>
Your Meta ad account and Apple Ads campaigns (spend, installs, trials, keywords, search terms), your own posts'
views, and RevenueCat revenue for attribution and profit.
</td>
</tr>
<tr>
<td valign="top">
<img src="web/public/home/megaphone.webp" alt="" height="44"><br>
<b>Creative analysis</b><br>
Gemini breaks each video or image into its hook, script, angle and production style, so you can see what works.
</td>
<td valign="top">
<img src="web/public/home/conveyor.webp" alt="" height="44"><br>
<b>Experiments and agents</b><br>
A record per test with a dated log and follow-ups. On top: a web app, a read-only MCP server and
<code>pnpm brief</code>, which tells an agent where things stand.
</td>
</tr>
</table>

Everything specific to a product (competitors, keywords, accounts, goals) lives in the database, so the code
stays generic. Every integration except the database is optional: turn on only what you use.

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

## How it works

```mermaid
flowchart LR
  cli["<b>CLI syncs</b><br/>scrape · social · meta-ads<br/>apple-ads · revenuecat<br/>creatives profile"]
  db[("<b>Supabase Postgres</b><br/>products, ads, posts,<br/>metrics, experiments")]
  r2[("Cloudflare R2<br/>media")]
  web["<b>Web app</b><br/>overview, research,<br/>channels, setup"]
  mcp["<b>/api/mcp</b><br/>read-only, for agents"]
  cli --> db
  cli --> r2
  db --> web
  db --> mcp
```

The commands hold the API keys and write to the database. The web app only reads it, so a hosted web server never
needs your ad-account keys.

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
| Web sign-in (GitHub) | Sign in to the hosted web app | `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET`, `AUTH_SECRET`, `AUTH_ALLOWED_GITHUB_USERS`, optional `AUTH_URL` | The web app serves only `/setup`; `AUTH_DISABLED=true` skips sign-in in local `next dev` |

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

Most commands only read. The Meta write commands (`pause`, `activate`, `adset-update`, `create-ad`, `ad-text`,
`launch`) each need a reviewed plan document in `product_docs`, and every request is journaled before it is sent. Read one with
`pnpm product docs show <slug> <name>`; add or update one with `pnpm product docs add <slug> --kind plan --file <path>`.
New ads are always
created paused. Nothing in the code can delete or archive a campaign, ad set, ad or creative. The web app and the
MCP server cannot change an ad account at all.

## Web app

`pnpm web` starts it at http://localhost:3000. It has:

- an overview with the goal, channels, ads by spend, own posts, experiments and data freshness
- Competitor ads, Organic and Creatives for research
- Meta ads, Apple ads, Apple keywords and My accounts for your own channels
- Brand, for the product's profile and brand/research documents (`product_docs`; `pnpm product docs import|add|show|export`)

Hosted, it signs in with GitHub and lets in only the usernames in `AUTH_ALLOWED_GITHUB_USERS`.

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
