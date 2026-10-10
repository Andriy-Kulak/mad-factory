# Mad Factory

**Open-source marketing and ads automation for app makers.** Mad Factory collects what your competitors run, what
your own ads and posts do, and what you earn, puts it in one Postgres database, and shows one number on top: your
monthly profit against your goal. AI agents (Claude, Codex, Devin, or any MCP client) read the same data and work
from the same playbooks.

- **Competitor research**: ads from the Meta Ad Library, and Instagram, TikTok and Facebook reels from accounts you
  follow, with video downloads and ranks over time.
- **Your channels**: your own Meta ad account and Apple Ads campaigns (spend, installs, trials, keywords, search
  terms), your own posts' views, and RevenueCat revenue for attribution and profit.
- **Creative analysis**: Gemini breaks each video or image into its hook, script, angle and production style, so
  you can compare what works.
- **Experiments**: a test record per idea, a dated log and follow-ups, across channels.
- **A web app and an MCP server** on top of all of it, plus a `pnpm brief` that tells an agent where things stand.

Everything specific to a product (competitors, keywords, accounts, goals) lives in the database, so the code
stays generic. Every integration except the database is optional: turn on only what you use.

## How it works

```
 CLI syncs (your machine or a scheduled job)        Supabase Postgres          Web app (Next.js)
 pnpm scrape · social · meta-ads · apple-ads  ───▶  products, ads, posts,  ───▶  overview, research,
 pnpm revenuecat · creatives profile                metrics, experiments        channels, setup
                │                                           │
                └──▶ Cloudflare R2 (media)                  └───▶  /api/mcp (read-only, for agents)
```

The commands hold the API keys and write to the database. The web app only reads the database, so a hosted web
server never needs your ad-account keys.

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
| Google Gemini | AI breakdowns of creatives (`pnpm creatives profile`) | `GEMINI_API_KEY` | The Creatives tab stays empty |
| Vercel AI Gateway | `google/…` model ids for creative profiles | `AI_GATEWAY_API_KEY` | Gemini is called directly |
| Web sign-in (GitHub) | Sign in to the hosted web app | `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET`, `AUTH_SECRET`, `AUTH_ALLOWED_GITHUB_USERS`, optional `AUTH_URL` | The web app serves only `/setup`; `AUTH_DISABLED=true` skips sign-in in local `next dev` |

`.env.example` explains where to get each key. On a hosted web server, set only the Supabase and `AUTH_*`
variables. Keep ad-account keys on the machine that runs the syncs, so a stolen web session has nothing that can
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
