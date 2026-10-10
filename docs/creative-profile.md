# Creative profile: what we record about every ad's media

One JSON document per media file describes *what is in the ad*: hook, script, strategy, production and the people on
screen. The same shape is used for our own Meta ads and for ads scraped from the Meta Ad Library, so "what do
competitors' long-running ads do that ours don't" is one query.

## Where it lives

- Table `creative_profiles`, primary key `sha256` → `creatives.sha256` (the content-addressed media file). A video
  that runs as several ads (two campaigns, five captions) is profiled once.
- Our ads reach it through `meta_ads_creatives.sha256`; Ad Library ads through `ad_creatives`.
- Carousels: the profile is keyed by the first card's file and describes the whole set in `cards`.
- Not in the profile, because it already lives elsewhere:
  - Performance: `meta_ads_ad_daily` (own); run dates and impressions rank in `ads` / `ad_library_observations`.
  - Copy: primary text, headline and CTA type are columns on `meta_ads_creatives` / `ads`. (Our ads currently use
    Meta's multiple text options, so one ad carries 2–3 bodies and 1–3 headlines.)
  - Lineage (concept, hook variant, actor code, edit round): parsed from our ad names, not observed in the media.
- Market sophistication is not a per-ad field: it is one judgement per market, recorded in the product's brand doc.
  `strategy.claim_type` on competitor ads is the evidence for it.

## Rules

1. **Fixed lists** (marked `enum` below) are generic marketing vocabulary and are validated in code. Any value
   outside the list is rejected.
2. **Product vocabulary** (`angle`, `audience`, `desires`, `features`, `pain_points`) is lowercase slugs. Values
   come from the product's brand and research documents in `product_docs`. A competitor ad that
   fits none gets a new slug; the owner decides whether it joins the list. Code only checks the slug format.
   Exception: `angle` is stricter when an `angle-library` document exists — it must be one of the
   library's slugs or `other`, and `other` requires a suggested new slug in `strategy.angle_suggestion`
   (`null` otherwise). When the library document is absent, the `angles` document is the fallback and angles stay
   free-form slugs as before.
3. **Free text** (hook lines, transcript, mechanism, new information, identity, vibe) is for reading and comparing
   wording, never for grouping.
4. **Not applicable = `null`** (or `[]` for lists), never a guess. Video-only fields are `null` for images.
5. **Manual edits win.** A field set by hand is listed in `_meta.manual_keys` (field path, e.g. `strategy.angle` or `people[0].gender`)
   and an automated pass never overwrites it.
6. Bump `schema_version` when a field changes meaning; adding an optional field does not need a bump.

## Fields (schema_version 1)

| Path | Type | Values / meaning |
| --- | --- | --- |
| `schema_version` | int | `1` |
| `media_type` | enum | `video` · `image` · `carousel` |
| **hook** | | the first ~3 seconds (video) or what the eye reads first (image) |
| `hook.spoken` | text \| null | first spoken line, verbatim |
| `hook.onscreen_text` | text \| null | overlay / headline text in the hook, verbatim |
| `hook.visual` | text \| null | what is shown, one sentence |
| `hook.type` | enum \| null | `callout` · `question` · `bold_claim` · `pov` · `story_open` · `pattern_interrupt` · `stat` · `demo_first` · `controversial` |
| `hook.length_s` | number \| null | seconds until the hook ends (video only) |
| **script** | | video only; `null` for images |
| `script.transcript` | text \| null | full spoken text |
| `script.beats` | array | `{ t: seconds, beat: enum, text }`; beat ∈ `hook` · `problem` · `agitate` · `solution` · `mechanism` · `demo` · `proof` · `offer` · `cta` |
| `script.structure` | enum \| null | `problem_solution` · `testimonial` · `founder_story` · `listicle` · `tutorial` · `skit` · `before_after` · `demo` |
| **strategy** | | |
| `strategy.awareness` | enum \| null | `unaware` · `problem_aware` · `solution_aware` · `product_aware` · `most_aware` |
| `strategy.strategic_response` | enum \| null | main lever: `benefit` · `mechanism` · `new_information` · `new_identity` |
| `strategy.claim_type` | enum \| null | Schwartz stage the claim is written for: `simple_benefit` · `amplified_benefit` · `mechanism` · `enhanced_mechanism` · `identity` |
| `strategy.mechanism` | text \| null | the "how it works" the ad claims |
| `strategy.new_information` | text \| null | the reframe or hidden cause the ad reveals |
| `strategy.identity` | text \| null | "for people who…" / who you become |
| `strategy.angle` | slug \| null | angle-library slug, or `other` |
| `strategy.angle_suggestion` | slug \| null | suggested new angle; required when `angle` is `other`, `null` otherwise |
| `strategy.audience` | slug \| null | product vocabulary |
| `strategy.pain_points` | slug[] | product vocabulary |
| `strategy.desires` | slug[] | product vocabulary |
| `strategy.features` | slug[] | product features shown or named |
| `strategy.proof` | enum[] | `app_demo` · `score_screen` · `testimonial` · `stat` · `before_after` · `press` · `none` |
| `strategy.objections_handled` | text[] | e.g. "no time" |
| `strategy.offer` | text \| null | e.g. "free trial" |
| `strategy.claims` | text[] | claims made, verbatim or close |
| **production** | | |
| `production.format` | enum \| null | `talking_head` · `ugc_selfie` · `green_screen` · `skit` · `app_demo` · `slideshow` · `static_image` · `carousel` · `animation` |
| `production.visual_style` | enum \| null | `lofi_selfie` · `polished` · `studio` · `screen_record` · `text_heavy` · `meme` · `ai_generated` |
| `production.layout` | enum \| null | images/cards: `text_overlay` · `screenshot` · `before_after` · `meme` · `product_shot` · `photo`; `null` for video |
| `production.setting` | enum \| null | `home` · `bathroom` · `car` · `office` · `outdoor` · `studio` · `other` |
| `production.length_s` | number \| null | video length |
| `production.aspect` | enum \| null | `9:16` · `4:5` · `1:1` · `16:9` · `other` |
| `production.voice` | enum \| null | `on_camera` · `actor_vo` · `ai_voice` · `none` (video only) |
| `production.captions` | enum \| null | `word_by_word` · `static` · `none` (video only) |
| `production.music` | enum \| null | `none` · `background` · `trending` (video only) |
| `production.app_on_screen_s` | number \| null | seconds the app UI is visible (video only) |
| `production.pacing` | enum \| null | `fast` · `medium` · `slow` (video only) |
| `cards` | array | carousel only: `{ position, text, visual }`; `[]` otherwise |
| **people** | array | one entry per person on screen; `[]` if none |
| `people[].role` | enum | `presenter` · `actor` · `voice_only` · `extra` |
| `people[].gender` | enum \| null | `female` · `male` · `other` (as presented) |
| `people[].age_band` | enum \| null | `under_18` · `18_24` · `25_34` · `35_44` · `45_54` · `55_plus` (apparent) |
| `people[].ethnicity` | enum \| null | `black` · `east_asian` · `south_asian` · `southeast_asian` · `hispanic` · `middle_eastern` · `white` · `mixed_other` (apparent) |
| `people[].vibe` | text \| null | e.g. "relatable, casual" |
| **cta** | | |
| `cta.type` | enum \| null | `download` · `try_free` · `learn_more` · `sign_up` · `shop` · `other` |
| `cta.spoken` | text \| null | |
| `cta.onscreen` | text \| null | |
| **_meta** | | |
| `_meta.by` | enum | `llm` · `manual` |
| `_meta.model` | text \| null | model id for `llm` |
| `_meta.at` | ISO timestamp | |
| `_meta.manual_keys` | text[] | field paths set by hand |

## Example (illustrative values)

```json
{
  "schema_version": 1,
  "media_type": "video",
  "hook": { "spoken": "Your plant wilts before you notice what it needs?", "onscreen_text": "POV: you spot your plant wilting", "visual": "close-up of drooping leaves beside a phone with care tips", "type": "callout", "length_s": 3 },
  "script": {
    "transcript": "…",
    "beats": [{ "t": 0, "beat": "hook", "text": "…" }, { "t": 3, "beat": "problem", "text": "…" }, { "t": 15, "beat": "demo", "text": "…" }, { "t": 26, "beat": "cta", "text": "…" }],
    "structure": "problem_solution"
  },
  "strategy": {
    "awareness": "problem_aware", "strategic_response": "mechanism", "claim_type": "mechanism",
    "mechanism": "one-minute daily plant check-ins with instant tips", "new_information": null, "identity": null,
    "angle": "daily-plant-care-check-ins", "angle_suggestion": null, "audience": "new-plant-owners", "pain_points": ["uncertain-plant-needs"], "desires": ["healthy-plants", "less-guesswork"],
    "features": ["plant-id", "watering-reminders"], "proof": ["app_demo", "score_screen"],
    "objections_handled": ["no time"], "offer": "free trial", "claims": ["help your plants thrive with simple daily care"]
  },
  "production": { "format": "talking_head", "visual_style": "lofi_selfie", "layout": null, "setting": "home", "length_s": 32, "aspect": "9:16", "voice": "on_camera", "captions": "word_by_word", "music": "background", "app_on_screen_s": 8, "pacing": "fast" },
  "cards": [],
  "people": [{ "role": "actor", "gender": "male", "age_band": "25_34", "ethnicity": "white", "vibe": "relatable, casual" }],
  "cta": { "type": "try_free", "spoken": "Try it free", "onscreen": "Download now" },
  "_meta": { "by": "llm", "model": "…", "at": "2026-10-05T12:00:00Z", "manual_keys": [] }
}
```

## How profiles are filled

`pnpm creatives profile --product <slug> [--source own|library|all] [--limit N] [--min-days N] [--model <id>] [--force]
[--concurrency 3] [--dry-run]` sends each stored media file (`public_url` under 20 MB) to Gemini through the
Google Gemini API (`GEMINI_API_KEY`, native `generateContent` format; temperature 0.2,
`responseMimeType: application/json`). The default model is the latest stable `gemini-*-flash`, resolved at
runtime from the models list; `--model <id>` takes a bare Gemini id, or a `google/…` id to go through the Vercel
AI Gateway (`AI_GATEWAY_API_KEY`) instead. Own Meta creatives come first, then Ad Library videos ordered by
`ads.start_date` (longest-running first). The prompt (`src/creative-profiles/prompt.ts`) carries the product's
vocabulary from the product's audience document in `product_docs` and the angle table (`angle-library` when it exists,
else `03-angles.md`) loaded by `src/creative-profiles/vocab.ts`. With a library the prompt lists each angle with
its promise, "not this" boundary and example hooks, the model must pick a library slug or `other` +
`angle_suggestion`, and the answer is checked against the library (an off-library angle triggers the repair turn).

The reply is fenced-stripped, wrapped with our `schema_version`/`media_type`/`_meta` (the model cannot set them),
and run through `parseCreativeProfile`. On a parse or validation failure exactly one repair turn is sent with the
error; a second failure is logged and skipped. `manual` rows (`profiled_by = 'manual'`) are never re-profiled;
with `--force`, paths listed in the old `_meta.manual_keys` are copied into the new profile and the list is kept.
`pnpm creatives show <sha256>` prints a stored profile.

`--min-days N` limits Ad Library media to files whose longest-running ad ran N+ days, so one-day tests never cost a
call. Already-profiled files are dropped before `--limit` counts, so a capped run spends its calls on new media.
The daily review (`playbooks/daily-review.md`) runs `--source library --min-days 7 --limit 50`, which is how a newly
added advertiser's media gets profiled without anyone asking.

Re-tagging angles on existing profiles is a cheap text-only pass: `pnpm creatives angles --product <slug> --out
<file>` asks the model for just `{"angle", "angle_suggestion"}` per stored profile (the old angle and `_meta` are
stripped from the prompt so it doesn't anchor) and writes `{sha256, owner, old_angle, angle, angle_suggestion,
usage}` rows to the file — no database writes. Review the file, then `pnpm creatives angles --product <slug>
--apply <file>` re-validates each angle and writes only `strategy.angle`/`angle_suggestion` back (`_meta`
untouched). Manual profiles and profiles whose angle fields are in `_meta.manual_keys` are skipped in both
directions.

Own media reaches `creatives` two ways: `pnpm meta-ads media --product <id|slug>` downloads the video `source` /
ad image for creatives whose `sha256` is null; when Meta refuses a download, the owner can drop the file in
manually with `pnpm meta-ads media --product <id|slug> --creative <meta_ads_creatives id> --file <path>` — the
extension decides video (`mp4`/`mov`) or image (`jpg`/`jpeg`/`png`/`webp`), an existing different `sha256` is
refused unless `--force`, and no Meta API call is made.
