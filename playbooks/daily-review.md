# Daily review playbook

The routine an agent runs once a day per product, unattended: read where the product stands against its profit goal,
apply each running experiment's rules, and leave plans for the owner. Generic: no product names, IDs or keywords
belong here. Channel details: `playbooks/apple-ads.md`, `playbooks/meta-ads.md`. The loop itself: `docs/marketing-loop.md`.

## What an agent may do without asking

Run read-only syncs, read the database, profile new Ad Library media (step 3, capped), write plan documents to `product_docs`, append
`experiment_log` entries, open issues and code PRs, and merge its own PR once `pnpm ready` passes — but the daily review itself opens no PR. It may **not**
write to an ad account or run destructive database changes; those wait for the owner (see "The goal, and how
every agent works here" in CLAUDE.md).
There is no command for Meta budgets: a Meta budget raise or cut becomes a plan with exact numbers
that the owner changes in Ads Manager.

## The routine

1. **Read the brief.** `pnpm brief --product <slug>` prints the goal, this month's projection, the last 7 complete
   days per channel, Meta ads by spend, own posts, running experiments and stale data. Attribution older than about
   10 days is not reliable, so decisions use the 7-day window (`--days 14` only to check a trend).
2. **Stop on stale data.** If the brief lists a stale source or a failed run, run that channel's sync once
   (`pnpm apple-ads sync --all --days auto`, `pnpm revenuecat sync --all --days auto`, `pnpm meta-ads sync --product <slug>`).
   If it still fails, open an issue (agent task template) and decide nothing from that channel today.
3. **Profile new competitor media.** `pnpm creatives profile --product <slug> --source library --min-days 7 --limit 50`
   breaks down each new Ad Library video or image whose ad has run 7+ days (one Gemini Flash call per file; files
   already profiled and one-day tests are skipped, so a quiet day costs nothing). This is how a newly added
   advertiser, competitor or adjacent niche, reaches Creatives and Insights without anyone asking. No
   `GEMINI_API_KEY` in this environment: skip it and list it under "Stale or broken".
4. **Check follow-ups.** The brief's "Follow-ups due" lists promises whose day has come. Act on each now (usually
   a line in today's plan), then run `pnpm experiment resolve --product <slug> --id <id> "<what was done>"`. If it
   is still too early, resolve it and log a new one with a later `--due`.
5. **Read the experiments.** For each running experiment: its write-up, its `rules`
   (`pnpm experiment list --product <slug>`) and the last log entries (`pnpm experiment history ...`).
   An experiment's rules override the defaults below.
6. **Judge against the proceeds-per-trial line.** The brief's "proceeds per trial" is what a trial is worth on first
   payments. Defaults when an experiment has no rule:
   - *Scale candidate*: cost per trial below the line with at least 5 trials in the window. Raise budget or bid by
     at most 20% per change, one change per ad set or keyword per 24 hours.
   - *Cut candidate*: spent at least 3× the line in the window with no trial, or cost per trial above 2× the line
     with at least 5 trials. Pause, never delete.
   - *Too early*: everything else. Say so instead of acting.
7. **Write the plan.** At most one plan per channel per day: add a plan document to `product_docs` with a table of
   changes and one line of reason each, quoting the brief's numbers (`pnpm product docs add <slug> --kind plan --file <path>`).
   The owner approves it before anything is applied; approved changes are applied per `playbooks/ad-changes.md`. Discovery-mirror gaps listed by the brief go into that day's
   Apple plan as the missing BROAD/negative keywords. After a batch of approved writes runs, verify it once with
   `pnpm meta-ads verify --product <slug> --plan <name>` and paste the table into the plan document under "## Result"
   — never re-read after each write.
8. **Log.** Every review ends with one log entry per running experiment, even when nothing changes:
   `pnpm experiment log --product <slug> --experiment <slug> --kind observation "<what the numbers said, what was proposed>"`.
9. **Report. No PR.** The session's final message is the report, short enough for a phone:

   ```
   <product> <YYYY-MM-DD>: <PROFITABLE | NOT PROFITABLE YET>. Month projects <x> vs goal <y> (gap <z>).
   Last 7 days: spend <s>, trials <t>, cost per trial <c> vs proceeds per trial <p>.
   Meta: spend <s>, <t> trials, CPT <c>. Apple: spend <s>, <t> trials, CPT <c>.
   Due today: <follow-ups, or "none">.
   Proposed (reply yes to apply): <one line per change, or "nothing">.
   Watch today: <up to 3 items, each with its number, or "nothing">.
   Stale or broken: <sources, or "none">.
   ```

   *Watch today* is observation only: no plan, no write. It lists at most 3 things trending badly that do not yet
   meet the cut or scale rules in step 6, each with the number behind it. Examples: cost per trial up against the
   prior 7 days (`pnpm brief --days 14` minus the 7-day numbers), an ad set with spend but no trial that is still
   under the cut line, a source whose last sync is close to stale, a follow-up due tomorrow. The report is a
   once-a-day snapshot; nothing checks again until the next run.

   Below that template comes the full plan table for each proposal. The owner approves by replying in that
   session. After approval the agent applies with `--plan`, verifies, and updates the plan document with its
   "## Result". Unapproved plans are not applied.

## Promises to come back later

Whenever an agent says it will check something later (in chat, a plan or a PR), it records it at once:
`pnpm experiment log --product <slug> --experiment <slug> --kind decision --due <YYYY-MM-DD> "<what to check, and
what to do for each outcome>"`. A session that ends cannot come back; the daily review reads these.

## When the numbers look wrong

Do not patch around them in a plan. Open an issue with the agent task template naming the query, the expected and
the actual value, and how to reproduce it (`pnpm brief --json` output is fine). Fixing it is a separate task.
