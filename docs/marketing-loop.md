# The marketing loop

How `mad-factory` runs paid marketing for a product across channels (Apple Ads today; Google Ads and Meta next).
Channel specifics live in `playbooks/<channel>.md` and `docs/<channel>-plan.md`; this file is the shape they all share.

## One sentence

**Ingest daily, analyze from the database, change only through an approved and journaled plan, and keep every
experiment's current state and history so anyone can ask "where are we?" on any day.**

## Principles

1. **Ingest is read-only and boring.** Each channel has a sync that pulls current state and daily numbers into
   Postgres. It never writes to the ad platform. It re-pulls a trailing window (platforms revise recent days) and
   widens the window to cover missed runs, so it is safe to run twice and it heals itself.
   Every run leaves a `scrape_runs` row (`done`/`error`, counts, message). Freshness is checked there, not by
   calling the API.
2. **Analysis reads the database, never the platform.** Numbers come from the `*_daily` tables (later a shared
   `ad_metrics_daily`), joined with attribution when available. Nobody "looks around" in an API.
3. **Nothing changes without a plan.** A change is a small JSON document in `product_docs` with one line of
   reason per item. The owner approves it, the owner's machine applies it, and every write lands in the channel's
   change journal (`apple_ads_changes`, later a shared `ad_changes`) with the experiment it served. This is the
   audit trail and it enforces pacing rules such as "one bid change per keyword per 24 h".
4. **Experiments are the unit of memory.** Every campaign that spends money belongs to exactly one experiment.
   The experiment says what we are testing, how we decide, when it ends, and what we learned.
5. **Numbers and reasoning in the database.** The experiment row holds facts that code needs (status, dates,
   budget, `rules`, verdict). `product_docs` holds plan and write-up documents.
6. **Nothing product-specific in repository files.** Products, apps, accounts, campaigns and keywords are rows;
   source, playbooks and docs stay generic.
7. **Adding a channel means adding a sync + a mapper.** The experiment model, the plan/approval flow, the change
   journal and the analysis step are shared. Meta's extra "scrape competitors → generate creatives" work happens
   *before* the plan step: a new creative is just another proposed change.

## The loop, per channel

```
platform ──(daily sync, read-only)──► Supabase ──► analyze ──► plan ──► owner approves ──► apply ──► platform
                                         ▲                                              │
                                         └──────────── change journal + log line ◄──────┘
```

| Step | Who | Input | Output |
| --- | --- | --- | --- |
| Sync | scheduled job (Devin automation / CI) | platform API | `*_campaigns`, `*_keywords`, `*_daily`, `scrape_runs` |
| Analyze | agent or owner, on demand or weekly | DB numbers + experiment `rules` + playbook | a status update and, if warranted, a draft plan |
| Plan | agent | analysis | plan document in `product_docs` |
| Approve | owner | plan | yes / edit / no |
| Apply | owner's machine only | approved plan | platform writes, `*_changes` rows, dated line in the experiment log |

## Experiments: current state and history

An experiment answers two questions at any time: **what is it now** and **how did it get here**.

### Current state (experiment row in the `experiments` table; plans and write-ups in `product_docs`)

| Field | Meaning |
| --- | --- |
| `status` | `planned` → `running` → `ended` / `abandoned` |
| `channel`, `product_id` | which platform, which product |
| `start_date`, `end_date`, `daily_budget`, `total_budget` | the box the test runs in |
| `hypothesis`, `success_criteria` | what would make it a win |
| `rules` (JSON) | machine-readable decision rules; overrides the playbook defaults |
| `verdict` | filled once, when it ends: what we learned in one paragraph |
| `experiment_campaigns` | which platform campaigns belong to it, with `role` and `geo` |

`pnpm experiment list --product <slug>` shows every experiment of a product with its campaigns. That is the
answer to "what are we testing right now?"

### History (append-only)

| Source | What it records |
| --- | --- |
| `experiment_log` | append-only dated events: decisions, observations, follow-ups and outcomes |
| `product_docs` plan / write-up | current reasoning and design context |
| `apple_ads_changes` (per channel) | every write to the platform: object, before → after, when, experiment. Machine truth for "what did we change and when". |
| `*_daily` tables | the numbers themselves, by day, never overwritten except by the platform's own revisions |
| `scrape_runs` | whether the data was fresh on a given day |

Rules for the log:

- Every analysis session ends with a dated log line, even if the decision was "no change". Quote numbers with the
  date they were read, because trailing days get revised.
- Every applied plan gets a log line pointing at the plan document.
- When an experiment ends, write `verdict` in the experiment row and its write-up document, set `status`, and open the next
  experiment with rules that start from what was learned. Do not edit a closed experiment's log.

### "Give me an update" (the daily ritual)

1. Check freshness: newest `scrape_runs` row for the channel is under ~30 h old, status `done`.
2. `pnpm experiment list --product <slug>` → the running experiments and their campaigns.
3. Read the experiment's `rules` and the last few log lines to know what was decided last time.
4. Pull the numbers from the DB for the experiment's campaigns (per campaign, per keyword, per geo; whole-period and
   last 3 days).
5. Apply the rules. Output: a short status (serving / not serving, tap rate, install rate, cost per install,
   spend vs budget) plus either "no change" or a draft plan.
6. Append a dated log line. If there is a plan, hand it to the owner.

This is the same ritual on every channel; only step 4's tables and step 5's rules differ.

## Where this goes next

- `ad_metrics_daily` and `ad_changes`: channel-agnostic tables that every channel's sync and apply step also write,
  so the analysis step and the web UI are written once. Apple dual-writes first; Google lands as sync + mapper.
- Attribution: join trials and revenue (RevenueCat / AppsFlyer) by campaign and keyword into the daily numbers, so
  on/off decisions use cost per trial, not cost per install.
- A weekly analysis automation that performs the ritual above and opens a plan as a PR. Still no direct writes.
