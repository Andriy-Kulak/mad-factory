# Meta Ads playbook

How to run the owner's own Meta ad account from this repository: where creatives are tested, how a winner
graduates to scaling, and what an agent may change. Generic: no product names, IDs or copy belong here.
Product facts live in the database (`meta_ads_*`, `experiments`, `experiment_log`) and in `product_docs`, alongside
`docs/meta-ads-plan.md` (which campaign plays which role for a product). Status: the process the owner is
trying out from 2026-10-05; revise it as results come in.

## Hard rules

- **Never delete or archive** an ad, ad set, campaign or creative, not even if the owner asks. Pause instead;
  pausing is reversible. The client enforces this (`assertNotDestructive`).
- Ads are always created **paused**. They go live only after the owner says go.
- Every write follows `playbooks/ad-changes.md` (plan → owner approval → apply → read-back → log): the
  `pnpm meta-ads ...` write commands take `--plan <name>` and journal to `meta_ads_changes`.
- Keep API use small. A handful of calls per task is fine; anything bulk or repeated (loops, retries, probing
  settings to see what Meta accepts) needs the owner's explicit OK first. Status changes are spaced 31s apart.
- Read numbers from the database (`pnpm meta-ads sync`), not by browsing the API.
- The read-back step of `playbooks/ad-changes.md` is `pnpm meta-ads verify --product <slug> --plan <name>`
  once for the plan — it re-reads only the affected objects in two grouped GETs and prints a
  pass/fail table. Do not re-read after each write.

## Launching new ads

1. The owner gives creatives + intent.
2. The agent writes the launch spec JSON under `local/`, adds a plan document to `product_docs` with the reasoning,
   and sends the owner a one-line-per-ad summary: name, ad set, headlines, text.
3. On approval (per `playbooks/ad-changes.md`), `pnpm meta-ads launch --product <slug> --spec local/<file>.json` creates every ad PAUSED,
   activates them and mirrors them into the DB after Meta returns success. The morning sync re-reads
   everything.

Text is written per ad from its hook, and the product's claim limits come from its brand documents in `product_docs`.
The owner's approval of the summary is the go. A spec ad uses exactly one of `file`, `video_id` or
`image_hash`; `titles`/`bodies` are optional but come together. `--validate-only` creates nothing and
validates only ads whose media is already uploaded (uploads are real writes).

A spec holds at most 10 ads; split a bigger batch into several specs. Launch rejects a larger spec before
any Meta call, so a launch never stops halfway. Its call ceiling is sized from the spec: 10 + 12 per ad
(130 for 10 ads). A video file costs about 11 Graph calls (upload, ~5 status polls, thumbnail, create,
activate GET + POST, mirror GET); a `video_id` ad about 5, an `image_hash` ad 4. Launching into an ad set
just made by `adset-copy` works: launch mirrors the ad set into the DB before its ads.

## Two campaigns: test and scale

| | Test campaign | Scale campaign |
|---|---|---|
| Budget | **ABO**: each ad set has its own daily budget | **CBO**: one campaign budget, Meta splits it |
| Holds | new creatives, one ad set per batch of variants, plus the current control | proven winners only |
| Purpose | give every new creative a fair, fixed amount of spend | put the most money behind what already works |

Why: under CBO, Meta sends money to whatever already has history, so new creatives barely spend next to a proven
ad and the test says little. Ad set minimum spends did not fix this in practice (Meta rejected them). Under ABO the
split is fixed. App campaigns allow only a few ad sets, so keep to one test campaign and one scale campaign rather
than many of each.

Do not flip a campaign between ABO and CBO to change its role; create the other campaign instead.

## Testing a batch

1. Keep the control (the current best ad) running alone in its own ad set in the test campaign.
2. Put a batch of variants in a new ad set in the same campaign. In app campaigns, copy an existing ad set
   (Meta requires the same attribution settings within a campaign): `meta-ads adset-copy --adset <id> --name <n>
   --daily-budget <usd>` copies it without its ads, PAUSED, names it and sets its budget. Activate it with
   `meta-ads activate --adset <id>` once its ads are launched.
3. Create each ad paused from the control's creative (`meta-ads create-ad --template-ad`), with headlines and
   primary text rewritten for that video's hook. Owner turns them on.
4. Set each ad set's daily budget for the split the owner wants (`meta-ads adset-update --daily-budget`), and
   check the total against the intended account spend.
5. Record the batch as an experiment with its goal (beat the control's cost per trial) and log decisions.

Expect Meta to put most of an ad set's spend on one or two ads. A batch answers "does any variant beat the
control?", not a full ranking.

## When an ad is a winner

Starting rule, to be refined: an ad is a winner after about a week with **10+ trials** and a **cost per trial at or
below the control's** over the same days. The owner makes the call.

## Graduating a winner to the scale campaign

Meta cannot move an ad. A "move" or "duplicate", in code or in Ads Manager, always creates a new ad. What carries
over depends on how the new ad is made:

| New ad made with | Video | Likes, comments, shares | Can change text | Meta's learning |
|---|---|---|---|---|
| the same **post** (`object_story_id`, Ads Manager's "Use existing post") | same | **kept** (shared by every ad on that post) | no | starts over |
| a new creative from the same `video_id` | same | start at zero | yes | starts over |

Graduate winners **on the same post**, so the social proof comes with them:

1. Find the winner's post ID (`effective_object_story_id` on its creative).
2. Create the ad in the scale campaign on that post, paused; owner turns it on.
3. Leave the original running in the test campaign until the new ad is delivering, then **pause** the original.
   Never delete it.
4. Log the graduation on the experiment.

Use a new creative from the same `video_id` only when the text needs to change; that ad starts with no engagement.

## Not built yet

- Creating a campaign from code (`meta-ads` cannot yet).
- Creating an ad on an existing post (`create-ad` builds a new creative today; a `--post <id>` option is planned).
- Unverified: whether a post from an ad that rotates several headlines and primary texts can be reused as is.
  Check with a validate-only call before relying on it.
