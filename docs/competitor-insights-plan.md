# Competitor insights: what's working, where the gaps are

Status: design plan; direct vs adjacent advertisers, per-advertiser view, no LLM calls from the web app. Turns a manual
research document in `product_docs` into a
repeatable feature: a map of the category, a "working" signal per ad, and a ranked gap board, rebuilt daily for
almost nothing.

## The three questions

1. **What is most likely working for competitors?** We can't see their spend or results, so we infer from what they
   keep paying for. An ad is *working* when Meta and the advertiser both keep it alive:
   - **survival**: still running 21+ days after launch (our winner rule already uses this);
   - **reach**: top 10 in the advertiser's Ad Library impressions sort (`ad_library_observations`);
   - **scaling**: the creative runs as many versions (Meta's collation count, e.g. 246 versions of one video);
   - **relaunch**: the same hook or creative shows up again in a new ad.

   `working_score` = survival × (reach or scaling). It's a ranking, not a truth: run length is confounded by launch
   date, so compare ads of the same age.

   Step 1 uses a yes/no version per ad card: **working = still running beyond the chosen duration and (high-ranked
   by impressions or replicated across versions)**. The stricter winner rule in `lib/ad-cards.ts` stays as a
   "strict winners" toggle for comparison.

   **Lift** = a row's share of working ads ÷ its share of all ads. Every row also says how concentrated it is: on
   A high lift from one advertiser is that advertiser's bet, not a category trend.
2. **Where are the gaps?** A gap is demand that nobody's ads meet, or a lever nobody pulls. Four kinds, each from
   data we already have or can cheaply get:
   - **Angle and persona whitespace**: our angle library and audiences in `product_docs`
     against competitors' share of ads and of *working* ads.
   - **Mechanism whitespace**: the "how it works" each ad claims (`strategy.mechanism`). Promises crowd, mechanisms
     don't.
   - **Format and hook whitespace**: `hook.type`, `script.structure`, presenter and length. For example, 48
     `demo_first` hooks against 283 `bold_claim`.
   - **Pain without ads**: complaints in App Store reviews and Reddit with little or no ad coverage, such as unclear
     progress or confusing pricing.

   Plus the opposite of a gap: **tried and dropped**. Angles competitors launched and killed within about 14 days
   are a cheap warning, like a competitor's fear-framed missed-deadline ads.
3. **How does it show in the UI and how is it triggered, cheaply?** See below. The rule: the LLM runs once per new
   creative (description) and once per changed dataset (synthesis). Everything in between is SQL.

## Direct competitors and adjacent niches

Not every tracked advertiser is a competitor. Some sell something adjacent to the same audience, and they matter as inspiration. Each Ad Library source gets a `relation`, like social sources
already have: `competitor` (the default, so existing sources need no edit) or `inspiration`.

- **Where it lives:** `tracked_sources.config.relation`, chosen when the source is added (web form or
  `pnpm product add-source --config`) and editable later. It belongs to the tracked source and not the ad or
  creative, because the same advertiser can be a competitor for one product and inspiration for another. An ad or
  creative inherits it through `product_ads.tracked_source_id`; when two sources with different relations surface
  the same ad, `competitor` wins.
- **How much to copy:** from a direct competitor, take the angle or hook type and change the execution (our
  presenter, our app on screen, our words). From an adjacent niche, copy the structure close to 1:1 (hook, format,
  script beats, CTA) with our product swapped in. Nobody in our feed has seen it.
- **What's comparable:** angles and personas are our product's vocabulary, so an adjacent niche's ads mostly land
  in `other`. Hook type, format and script structure are generic enums and compare across niches.
- **Lift per group:** lift is computed within the selected group (direct, adjacent or all), so adjacent ads never
  move direct-competitor numbers.
- **Transfer opportunities:** a hook type or format that works in an adjacent niche and that direct competitors
  barely use is a ready-made gap ("copy from adjacent" on the Gaps board).

## What we already have

- 1,472 ad cards from 7 advertisers, refreshed daily, with impressions rank, run dates, versions, landing URL, CTA
  and copy (Competitor ads tab).
- 1,031 Gemini creative profiles (`creative_profiles`, one per media file, deduped by sha256), already tagged with:
  - angle: sample angle A, sample angle B, …
  - audience (≈ persona): sample audience A, sample audience B, …
  - hook type, script structure, awareness, claim type, mechanism, pain points, desires, and the people on screen.
- Our own ads with spend and trials (`meta_ads_ad_daily`), so every row can compare the selected dimension with
  observed outcomes.
- The Creatives tab already groups profiles by angle, persona and hook type, split own vs competitor,
  with duration and stopped-ad counts, in the pure module `web/lib/creative-groups.ts`.
  Insights builds on that module rather than adding a second grouping. What it adds: impressions rank, the working
  flag, lift, the relation split, landing pages and links into Competitor ads.
- Unprofiled adjacent advertisers can still be shown from their ad copy until their media is profiled.

So step 1 needs **no new LLM spend**: it's a join between profiles, ad cards and ranks.

## UI: an Insights page under Research

Its own page, `/p/<slug>/insights`, in the sidebar's Research group next to Competitor ads, Organic and Creatives.
Creatives stays the browsing tool; Insights is the answers page. Tabs (`Tabs` from `components/ui.tsx`), tables on
`DataTable`, filters from `components/controls.tsx`. Every count links into the Competitor ads browser with the
matching filter, so you can see the ads behind the number.

| Tab | Rows | Columns |
| --- | --- | --- |
| **Angles** | angle slug | ads (with share of ads) · working ads (with share of working) · lift and concentration · advertisers · longest running · recently added · later **we run it** (observed outcomes) and a gap flag |
| **Personas** | audience slug | same columns |
| **Hooks** | hook type, plus the top verbatim hooks of working ads | same, plus example hooks with a play thumbnail |
| **Formats** | `production.format`, `script.structure` | same columns; the main view for adjacent niches |
| **Mechanisms** | clustered `strategy.mechanism` | same; clustering is one cheap LLM pass over the text, cached |
| **Landing pages** | `link_url` without query (no LLM at all) | ads · working · lift · longest running · new in 30d · funnel type (app store / web funnel / web quiz) |
| **Gaps** | ranked opportunities | gap · kind · evidence (counts, example ads, review quotes) · risk (claims check) · we run it · **Brief this** |

Each dimension tab has two views: **Totals** (the table above) and **By competitor** (rows × advertisers, each cell
ads with working ads under it, shaded by that row's share of the advertiser's ads, with direct and adjacent columns
grouped). A filter strip on top: direct competitors / adjacent niches / all, launched in 30/90 days or all,
advertisers, format.

Read it like this: **high lift from several advertisers + we don't run it** = adapt the angle with our execution.
**Works in an adjacent niche + direct competitors don't use it** = copy it nearly as is. **Low competitor share + our
library has it + reviews mention the pain** = gap. **Launched and killed fast** = don't.

"Brief this" gives a creative brief for one gap (angle, persona, hook options, mechanism, proof, claims to avoid)
from the brand docs and the gap's evidence. Because the web app makes no LLM calls, the button copies the CLI
command (`pnpm insights brief --gap <id>`) and shows the brief once it's stored. You review it and it goes to the
existing ad workflow (`meta-ads create-ad` stays paused and on a plan, as today).

## Pipeline and cost

| Step | When | Cost control |
| --- | --- | --- |
| 1. Scrape Ad Library | daily (exists) | ScrapeCreators credits, already capped |
| 2. Download media | daily (exists) | once per sha256 |
| 3. **Profile new creatives** (`pnpm creatives profile --source library`) | daily, after scrape | Profile only creatives that survive a chosen duration or rank highly, so brief tests never cost a call. Deduped by sha256. Gemini Flash, lowest media resolution, the opening of a video, batch mode where available. Add `--max-creatives` and a dry-run cost estimate. |
| 4. **Aggregate** (pure module next to `lib/creative-groups.ts`) | on page load | free; pure function with tests, like `lib/ad-cards.ts` |
| 5. **Synthesize gaps** (`pnpm insights gaps --product <slug>`) | weekly automation, or by hand | Input is the aggregate tables, not raw ads. Cached by a hash of the inputs, so a run on unchanged data is skipped. Gemini Flash by default (repo rule); Pro only if the owner asks |
| 6. Validate pains | weekly | App Store reviews feed (free, already used in PR #30); Reddit through ScrapeCreators' Reddit endpoints when added |

Synthesis results go in a new `competitor_insights` table (product, run date, input hash, gaps JSON validated in
code, markdown). The web page renders the latest row, and `pnpm brief` gets a "Top gaps" line. RLS on, like every
table.

**How it refreshes, and why there is no refresh button.** The tables are computed from the database on every page
load, so they are as fresh as the last daily scrape; the page shows "data as of <last scrape>" instead of a
button. Profiling and gap synthesis run only from the CLI (the daily and weekly automations, or by hand). The web
app makes no LLM calls: it can run online behind sign-in, and the web host should hold no
`GEMINI_API_KEY`, just as it holds no ad-account keys. The Gaps tab shows "last run <date>, next run <day>".

**Where things are stored:** step-1 tables store nothing; per-creative profiles in `creative_profiles` (exists),
media in R2 (exists), gaps and briefs in `competitor_insights`.

## Build order (each one a small PR)

0. **Competitor or inspiration per Ad Library source**: `config.relation` on the add form and the manage list, and
   a relation filter in Competitor ads and Creatives. No schema change.
1. **Insights tables from existing data**: Angles, Personas, Hooks, Formats, Landing pages with working share, lift
   and concentration, Totals and By competitor views, the relation filter, and links into the browser (which gains
   angle, persona, hook and landing-page filters). No schema change, no LLM. This answers question 1 on day one.
   Built: `/p/<slug>/insights` with two windows. **All time**: working = still running after 21+ days and top 10
   by impressions or 5+ versions. **Last 14 days**: ads launched since, with an early signal = still running and
   already top 10 (versions don't count for new ads, which often launch straight into many). Opens on direct
   competitors; adjacent niches and all advertisers are one click away. The page shows counts (ads, working, running
   21d+) and who the working ads come from, not lift: in review a ratio column was harder to read than the counts.
   By advertiser is the default view; clicking a row or cell opens its ads below the table.
2. **"We run it" column**: join our own ads' profiles (`--source own`) and spend. This turns the map into "where
   are we vs them".
3. **Survival-gated profiling**: `--min-days` and the daily-review step (built 2026-10-09; `--top-rank` and a cost
   estimate left for later). The first run covered the adjacent-niche advertisers, which had no profiles yet.
4. **Gap synthesis**: `competitor_insights` table, `pnpm insights gaps`, the Gaps tab, cached by input hash,
   including "copy from adjacent" transfer opportunities.
5. **Mechanism clustering and tried-and-dropped**: one cached LLM pass, plus a launch→stop analysis.
6. **Brief this**: brief generation from the brand docs, saved in `product_docs`.
7. **Review and Reddit validation** as an evidence source per gap.

## Caveats

- How long an ad runs and its impressions rank stand in for performance. They don't measure it.
- Older web-to-app funnels may target a different buyer than app-install ads. Show the
  funnel type next to every insight.
- Angle tags are only as good as the `angle-library` document. `other` with `angle_suggestion` is where new angles show
  up, so review those monthly.
