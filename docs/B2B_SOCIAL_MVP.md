# B2B Social MVP

B2B Social finds people who just showed buying signals on LinkedIn and X, works out who they are, and tells a
rep why each one is worth a message. It sits under Research at `/p/<slug>/b2b-social`.

This document is generic. The accounts a product watches, the people found and everything they said live in the
database, never in the repository.

Status: Step 1 (UI), Step 2 (tables) and Step 3 (sync command) are built. The daily schedule is the remaining piece.

## How it works

1. **Watch.** Posts from a set of accounts: the product's own company page and X account, its team's profiles, and
   competitors' pages and accounts.
2. **Collect.** Everyone who replied (X) or commented (LinkedIn) on those posts.
3. **Identify.** Each person's job title, employer, the employer's size, and a Fortune 500 or YC tag.
4. **Qualify.** Keep the people worth a message, give each a reason and a suggested opener, and rank them.

### Reasons to reach out

| Reason | Rule |
| --- | --- |
| Unhappy with a competitor | A complaint (price, limits, switching, downgrade) on a competitor's post |
| Already a user | Says they use the product ("we use", "my team has") |
| Asked about the product | A short question or a complaint on the product's own posts |
| Weighing a competitor | A question or comparison on a competitor's post |
| Senior at a big company | Manager level or above at a Fortune 500 or 10k+ company, even with no signal |

Left out: the product's own team and affiliates, a competitor's support staff answering in its thread, brand and bot
accounts (1M+ followers), and anyone we can't identify. Comment kinds come from text rules, not an LLM.

### How we score

Each person gets a grade: **Fit** (A, B, C: the right company and person) × **Intent** (1, 2, 3: how strong and how
fresh the signal is), for example A1. The rules live in `web/lib/b2b-social-grade.ts`, and the page's "How we
score" panel reads the same constants.

| Fit | Rule |
| --- | --- |
| A | Fortune 500 or 10k+ company, and we know their role |
| B | Fortune 500 or 10k+ but role unknown, or a buyer (founder, CTO, VP) at a smaller or YC company |
| C | Everyone else |

Buyers sign (C-level, founders, VPs, directors, heads). Champions use it and pull it in (managers, leads, engineers).

| Intent | Rule |
| --- | --- |
| 1 | Already using it, or complaining about a competitor |
| 2 | Asking a question or comparing options |
| 3 | Engaged without a signal |

Intent goes one level stronger with two or more signals from the person, or two or more people from the same
company; one level weaker when the latest signal is more than 14 days old.

| Route | Grades | What happens |
| --- | --- | --- |
| Reach out now | A1, A2, B1 | A rep or SDR sends a personal message |
| Self-serve or startup program | B2, C1, C2 | High intent at a smaller company |
| Nurture | A3, B3, C3 | Right company, no signal yet |

The rules are hand-set. Next: define Fit from closed-won accounts (industry, engineering headcount), join with the
CRM (customer, open deal, new), and check the grades against which people turned into pipeline.

## Stack and cost

| Step | Tool | Cost |
| --- | --- | --- |
| LinkedIn posts, comments (up to 10 per post), profiles, company pages | ScrapeCreators | 1 credit per call |
| X posts of watched accounts | X API user timeline (newest first, `since_id`) | $0.005 per post |
| X replies (last 7 days, by conversation) | X API, pay per use | $0.005 per reply, about $0.01 per author profile |
| Job titles (LinkedIn masks them) and X to LinkedIn matching | Exa with Fiber people data | about $0.05 to $0.08 per person, enterprise and signal people only |
| Fortune 500 tag | 2026 Fortune 500 list, matched by company name | free |
| YC tag | yc-oss public company list, matched by website domain only (names collide) | free |

Not available from any of these: who liked or reposted a LinkedIn post, and who liked or retweeted on X.
ScrapeCreators' X endpoint returns an account's most popular tweets, not its latest, so X posts come from the X API.

## Step 1: the UI

One page, built around one list. Mockups were reviewed before building.

- **Header:** a one-line summary, the four steps above as a strip with live counts, the stack in one line, and when
  the data was last updated.
- **What we watch:** a collapsed bar ("company page, N team members, N competitors, N X accounts") that opens a
  list of every watched account grouped as company, team and competitors, with posts, people found and people worth
  a message per account. Clicking an account filters the list.
- **The list:** one row per person, with name, title and buyer or champion, company with its tier tag and how many
  colleagues also engaged, the reason, their words and where they said it, and the grade with its route. Filters for time window (7, 30, all), reason, company tier, level, source (X or LinkedIn),
  whose post, and search. Quick views: everyone, enterprise only, switching from a competitor, startups and YC.
- **Person panel:** opens on a row. The full quote and post, who they are and how we know (profile, Exa match,
  bio), the suggested opener with a copy button, and links to their LinkedIn, X and the post.
- **Export CSV** of the filtered list, shaped for Clay.
- **Content** (secondary): what gets reach on X and LinkedIn by account, format and topic.

## Step 2: the database

Three tables, all prefixed `b2b_` so B2B Social stays separate from the B2C organic tables and can be removed in one
step. Watched accounts are `tracked_sources` rows with source `b2b_social` (kind = platform, value = handle,
`config.group` = company, team or competitor, `config.replies` = whether to collect comments). Everything the page
shows beyond these (reason, grade, route, opener, tier) is worked out when the page loads: plain code over stored rows,
no API calls.

- `b2b_posts`: one row per post of a watched account, with its numbers and the tracking fields
  `replies_open_until`, `last_reply_id`, `replies_checked_at` and `comments_seen`.
- `b2b_comments`: one row per reply or comment. Unique on post plus the comment's id (the reply id on X, a hash of
  author and text on LinkedIn), so fetching again never duplicates.
- `b2b_people`: one row per person per product. Name, LinkedIn URL, location, bio, title, employer, company size,
  Fortune 500 rank, YC batch, and `enriched_at`.

Row-level security on all three.

## Step 3: the daily cron

One command per product, run once a day:

```
pnpm b2b-social sync --product <slug>             # one incremental run
pnpm b2b-social sync --product <slug> --dry-run   # what is due, no API calls
pnpm b2b-social import --product <slug> --file <snapshot.json>
```

Each run only does what is new, so cost tracks new activity, not days.

1. **Posts.** For each watched account, fetch posts newer than its `last_scraped_at`.
2. **Comments.** For posts under 7 days old (X only serves replies for 7 days), fetch comments when the comment count
   has gone up since the last fetch. X asks only for replies newer than the last one stored (`since_id`). Posts older
   than 7 days are never fetched again.
3. **People.** Enrich only commenters with no `enriched_at`: LinkedIn profile and employer page first, then Exa for
   the title when the person is at a big company or said something worth a message. Each person is paid for once.
4. **Finish.** Update the timestamps and write the run's credits to `scrape_runs`.

Per post, two fields track what was fetched: `comments_fetched_at` and `comments_seen`. A run that fails halfway
picks up from the timestamps, so nothing is lost or paid twice. Each run has caps for ScrapeCreators credits, X
dollars and Exa dollars, and stops cleanly at a cap.

Rough cost at about 50 watched accounts: 20 to 40 ScrapeCreators credits, $1 to $3 of X and $0.50 to $1 of Exa a
day.

## Adding accounts and backfilling

```
pnpm b2b-social add --product <slug> --x <handle> --group team
pnpm b2b-social add --product <slug> --linkedin https://www.linkedin.com/company/<slug> --group competitor
pnpm b2b-social add --product <slug> --linkedin https://www.linkedin.com/in/<slug> --group team --name "<label>"
pnpm b2b-social sync --product <slug> --dry-run   # check what the next run will do
pnpm b2b-social sync --product <slug>             # the first sync backfills the new accounts
```

- `--group` is `company` (the product's own accounts), `team` (people who work there; their comments are never
  leads) or `competitor`.
- `add` on an account that is already watched updates its group or name and keeps what the sync learned.
  `--off` stops collecting its comments (its posts stay); `--reset` clears its marker so the next sync backfills
  it again.
- What a backfill reaches: X posts from the last 7 days (the timeline goes further back, but X serves replies for
  7 days only, so older posts would have no replies to collect); LinkedIn the latest posts on the page or profile
  (about 7 to 10) with comments for those under 14 days old.
- Comments are fetched once a post is 48 hours old, so a fresh account's newest posts get theirs on a later run.
  Run `sync` on later days, or daily, to keep collecting.
- Cost of adding an X account: about $0.01 to look it up once, $0.005 per post, then about $1 per post that has
  100 replies (less for quieter posts). A LinkedIn account costs 1 credit per run to list its posts, 1 per post
  checked, and 1 or 2 per new commenter.

## Then: expand

- More X accounts: competitors' and the team's, and keyword searches for pain (price changes, rollout problems)
  through the X API's recent search.
- A weekly digest of new people worth a message.
- Cheaper matching if Exa adds up: People Data Labs takes an X profile URL directly; Clay has the same step.

## Open questions

- How posts, comments and people are marked as fetched (Step 3) gets a closer look when the tables are built.
- Whether the snapshot moves to the database before or after the UI is final.

## Keys

`SCRAPECREATORS_API_KEY` (exists), `X_BEARER_TOKEN` (an X app inside a pay-per-use project) and `EXA_API_KEY`. All
optional, registered in `src/lib/integrations.ts` when the sync is built.
