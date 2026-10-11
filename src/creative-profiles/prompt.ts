import {
  AGE_BANDS,
  ASPECTS,
  AWARENESS,
  BEATS,
  CAPTIONS,
  CLAIM_TYPES,
  CTA_TYPES,
  ETHNICITIES,
  FORMATS,
  GENDERS,
  HOOK_TYPES,
  LAYOUTS,
  MUSIC,
  PACINGS,
  PERSON_ROLES,
  PROOF,
  SETTINGS,
  STRATEGIC_RESPONSES,
  STRUCTURES,
  VISUAL_STYLES,
  VOICES,
} from "./schema.ts";

export interface VocabAngle {
  slug: string;
  name: string;
  audiences: string[];
  desires: string[];
  promise?: string;
  not?: string;
  examples?: string;
}

export interface VocabAudience {
  slug: string;
  name: string;
}

export interface UsedSlugs {
  angles: string[];
  audiences: string[];
  pain_points: string[];
  desires: string[];
  features: string[];
}

export interface ProductVocab {
  angles: VocabAngle[];
  audiences: VocabAudience[];
  desires: string[];
  /** True when the fixed 04-angle-library.md was loaded (strict angle slugs). */
  library: boolean;
  used?: UsedSlugs;
}

export interface PromptInput {
  productName: string;
  productDescription: string | null;
  mediaType: "video" | "image";
  owner: "own" | "competitor";
  vocab: ProductVocab;
}

const list = (values: readonly string[]): string => values.join(" | ");

function angleLines(vocab: ProductVocab): string {
  if (!vocab.angles.length) return "- (none defined yet)";
  if (vocab.library) {
    return vocab.angles
      .map(
        (a) =>
          `- ${a.slug}: "${a.name}"${a.promise ? ` — ${a.promise}` : ""}${a.not ? ` Not this: ${a.not}` : ""}` +
          `${a.examples ? ` Examples: ${a.examples}` : ""} (audience ${a.audiences.join(", ") || "any"}; desire ${a.desires.join(", ") || "-"})`,
      )
      .join("\n");
  }
  return vocab.angles.map((a) => `- ${a.slug}: "${a.name}" (audience ${a.audiences.join(", ") || "any"}; desire ${a.desires.join(", ") || "-"})`).join("\n");
}

function angleRuleText(vocab: ProductVocab): string {
  if (!vocab.library) {
    return "when one genuinely fits, copy its slug from the product vocabulary below exactly (the text before the colon; never shorten or reword it). If none fits, write a new short slug that names the reason to buy (angle) or the person in a situation (audience). Do not force a fit.";
  }
  return 'the angle is the reason to buy the ad keeps returning to — not the hook, the format or whether the app is shown. Pick exactly one slug from the angle library below. When two fit, pick the one the hook opens with. If none fits, use "other" and put a short new slug in strategy.angle_suggestion. Never invent an angle slug. For audience: when one genuinely fits, copy its slug from the product vocabulary below exactly; if none fits, write a new short slug that names the person in a situation. Do not force a fit.';
}

function vocabSection(vocab: ProductVocab): string {
  const angles = angleLines(vocab);
  const audiences = vocab.audiences.length ? vocab.audiences.map((a) => `- ${a.slug}: ${a.name}`).join("\n") : "- (none defined yet)";
  const desires = vocab.desires.length ? vocab.desires.join(", ") : "(none defined yet)";
  const used = vocab.used;
  const usedLines = used
    ? (
        [
          ...(!vocab.library ? ([["angle", used.angles]] as const) : []),
          ["audience", used.audiences],
          ["pain_points", used.pain_points],
          ["desires", used.desires],
          ["features", used.features],
        ] as const
      )
        .filter(([, values]) => values.length)
        .map(([field, values]) => `- ${field}: ${values.join(", ")}`)
    : [];
  const usedSection = usedLines.length
    ? `\n\nSlugs already used for other ads (reuse the exact slug when it means the same thing; only invent a new one for a genuinely different idea):\n${usedLines.join("\n")}`
    : "";
  return `${vocab.library ? "Angle library" : "Angles"}:\n${angles}\n\nAudiences:\n${audiences}\n\nDesires: ${desires}${usedSection}`;
}

export function buildProfilePrompt(input: PromptInput): string {
  const { productName, productDescription, mediaType, owner, vocab } = input;
  const isImage = mediaType === "image";
  const whose =
    owner === "own"
      ? `This is one of ${productName}'s own ads.`
      : `This ad is run by another advertiser in the same market as ${productName}. Describe what this ad does, not what ${productName} does.`;

  return `You are a senior direct-response creative strategist. You break paid social ads down into a fixed structure so hundreds of ads can be grouped and compared. Be literal and consistent: describe what is actually seen and heard, never what the ad might intend.

${whose}
Product context: ${productName}${productDescription ? ` — ${productDescription}` : ""}

The attached file is a single ${mediaType}. Return ONLY one JSON object, no prose and no code fences, with exactly these keys:

{
  "hook": { "spoken": string|null, "onscreen_text": string|null, "visual": string|null, "type": enum|null, "length_s": number|null },
  "script": ${isImage ? "null" : `{ "transcript": string|null, "beats": [{ "t": number, "beat": enum, "text": string }], "structure": enum|null }`},
  "strategy": {
    "awareness": enum|null, "strategic_response": enum|null, "claim_type": enum|null,
    "mechanism": string|null, "new_information": string|null, "identity": string|null,
    "angle": slug|null, "angle_suggestion": slug|null, "audience": slug|null,
    "pain_points": [slug], "desires": [slug], "features": [slug],
    "proof": [enum], "objections_handled": [string], "offer": string|null, "claims": [string]
  },
  "production": {
    "format": enum|null, "visual_style": enum|null, "layout": ${isImage ? "enum|null" : "null"}, "setting": enum|null,
    "length_s": ${isImage ? "null" : "number|null"}, "aspect": enum|null, "voice": ${isImage ? "null" : "enum|null"},
    "captions": ${isImage ? "null" : "enum|null"}, "music": ${isImage ? "null" : "enum|null"},
    "app_on_screen_s": ${isImage ? "null" : "number|null"}, "pacing": ${isImage ? "null" : "enum|null"}
  },
  "cards": [],
  "people": [{ "role": enum, "gender": enum|null, "age_band": enum|null, "ethnicity": enum|null, "vibe": string|null }],
  "cta": { "type": enum|null, "spoken": string|null, "onscreen": string|null }
}

General rules
- Use null (or []) when something is absent or you cannot tell. Never guess to fill a field.
- Enum fields must use one of the listed values exactly. Slugs are lowercase words joined by hyphens (e.g. "wasted-time").
- Quote spoken and on-screen text verbatim in the ad's language; do not translate or tidy it.
- Times and lengths are in seconds from the start of the ${isImage ? "image (not applicable)" : "video"}.

Hook${isImage ? " (for an image: the headline or largest text plus the main visual)" : " (the first ~3 seconds)"}
- spoken: the first spoken sentence${isImage ? " — null for images" : ""}. onscreen_text: text shown ${isImage ? "most prominently" : "in the first 3 seconds"}. visual: one short phrase for what is shown (e.g. "close-up selfie, presenter reacts to phone").
- type: ${list(HOOK_TYPES)}.
  callout = names the viewer or their situation ("If you always run out of time…"); question = opens with a question; bold_claim = a strong promise or statement; pov = "POV:" or first-person scenario framing; story_open = starts a personal story ("Last week I…"); pattern_interrupt = an unexpected visual or sound meant to stop the scroll; stat = opens with a number or fact; demo_first = opens on the product in use; controversial = a contrarian or provocative take. If two apply, pick the one carrying the first line.
- length_s: when the hook ends and the body starts${isImage ? " — null for images" : ""}.
${
  isImage
    ? ""
    : `
Script
- transcript: everything spoken, in order. null if nothing is spoken.
- beats: the ad split into consecutive sections, each with its start time t, a beat (${list(BEATS)}) and a short summary or quote. The first beat is "hook".
  agitate = makes the problem feel worse; mechanism = explains how/why the product works; proof = evidence (demo result, testimonial, stat); offer = price, trial or discount.
- structure: ${list(STRUCTURES)}.
`
}
Strategy
- awareness (what the ad assumes the viewer already knows): ${list(AWARENESS)}.
  unaware = opens on an identity, story, challenge or curiosity without naming a problem; problem_aware = names the viewer's problem but not yet a solution category; solution_aware = assumes they know solutions exist and argues for this kind or this one; product_aware = assumes they know the product, pushes them to act; most_aware = offer/reminder only (discount, "still thinking about it?").
- strategic_response (the main way the ad stands out): ${list(STRATEGIC_RESPONSES)}.
  benefit = promises a result with no "how" ("this app helps you X" is benefit); mechanism = the core is a named or explained way it works ("short daily sessions with instant feedback"); new_information = the core is a reframe, hidden cause or surprising fact ("the real reason you X isn't Y, it's…"); new_identity = the core is who you become or which group you join ("for people who…", "introverts who…"), including creator-journey content ("day 12 of…") whose pull is the person, not a result.
  Showing the product in use is proof (app_demo), not a mechanism. Pick mechanism only when the ad names or explains how or why it works (a method, process, or unique ingredient).
- claim_type (the strongest claim made, Schwartz-style): ${list(CLAIM_TYPES)}.
  simple_benefit = plain promise ("get better at X"), or no explicit claim at all; amplified_benefit = bigger, faster or more specific promise ("pro-level results in 7 days"); mechanism = promise plus how; enhanced_mechanism = a mechanism presented as newer, faster or better than other mechanisms ("unlike other apps that just score you…"); identity = the claim is about who you are or become.
- mechanism / new_information / identity: a one-sentence paraphrase of that element when it is present, otherwise null. Fill whichever apply, not only the one picked as strategic_response.
- angle and audience: ${angleRuleText(vocab)}
- pain_points: problems named or shown, as slugs (e.g. "wasted-time", "feeling-stuck", "self-doubt").
- desires: what the viewer is promised emotionally, as slugs; prefer the vocabulary desires below.
- features: product features shown or named, as generic slugs (e.g. "ai-feedback", "progress-score", "daily-reminders"). Not benefits.
- proof: ${list(PROOF)}. Use ["none"] if the ad shows no proof.
- objections_handled: objections the ad answers, short phrases (e.g. "no time", "too expensive", "feels awkward").
- offer: the offer stated or shown (e.g. "free trial", "50% off"), else null.
- claims: the explicit outcome claims, short phrases, verbatim where possible.

Product vocabulary
${vocabSection(vocab)}

Production
- format: ${list(FORMATS)}.
  talking_head = one person speaking to camera in a set-up shot; ugc_selfie = handheld phone selfie style; green_screen = person over a background image/screenshot; skit = acted scene with characters; app_demo = mostly the app on screen; slideshow = sequence of stills/text; animation = motion graphics or animated characters. If the ad mixes formats, pick the one on screen longest.
- visual_style: ${list(VISUAL_STYLES)}. ai_generated = people or scenes that are visibly AI-generated (AI avatars, synthetic footage); it wins over the others.
- layout${isImage ? "" : " (null for videos)"}: ${list(LAYOUTS)}.
- setting: ${list(SETTINGS)}. null if there is no physical setting (e.g. pure screen recording or graphics).
${
  isImage
    ? "- aspect: " + list(ASPECTS) + ". length_s, voice, captions, music, app_on_screen_s, pacing are null for images."
    : `- length_s: total video length. aspect: ${list(ASPECTS)}.
- voice: ${list(VOICES)}. on_camera = the speaker is visible while talking; actor_vo = human voiceover from off screen; ai_voice = synthetic-sounding voice.
- captions: ${list(CAPTIONS)}. word_by_word = animated captions that follow speech; static = fixed subtitle blocks.
- music: ${list(MUSIC)}. trending = a recognisable popular track or meme sound.
- app_on_screen_s: total seconds the app or its screens are visible, 0 if never.
- pacing: ${list(PACINGS)}. fast = cuts every ~1-2 s; slow = long unbroken shots.`
}

People (everyone visible or heard who matters; [] if none)
- role: ${list(PERSON_ROLES)}. gender: ${list(GENDERS)}. age_band: ${list(AGE_BANDS)}. ethnicity: ${list(ETHNICITIES)}.
- These are apparent perceived traits for casting comparison only; use null when unclear. vibe: 2-4 words on how they come across (e.g. "relatable, casual").

CTA
- type: ${list(CTA_TYPES)}. spoken: the spoken call to action verbatim. onscreen: the on-screen call to action text verbatim.

cards is always [] for a single ${mediaType}.`;
}

export interface AnglePromptInput {
  productName: string;
  productDescription: string | null;
  owner: "own" | "competitor";
  vocab: ProductVocab;
  /** Stored profile; _meta, strategy.angle and strategy.angle_suggestion are stripped. */
  profile: Record<string, unknown>;
}

/** Text-only re-tag prompt: pick this stored profile's angle from the library. */
export function buildAnglePrompt(input: AnglePromptInput): string {
  const { productName, productDescription, owner, vocab, profile } = input;
  const stripped = structuredClone(profile);
  delete stripped._meta;
  const strategy = stripped.strategy as Record<string, unknown> | undefined;
  if (strategy) {
    delete strategy.angle;
    delete strategy.angle_suggestion;
  }
  const whose = owner === "own" ? `This is one of ${productName}'s own ads.` : `This ad is run by another advertiser in the same market as ${productName}.`;

  return `You are a senior direct-response creative strategist labelling paid social ads for comparison. Be literal and consistent.

${whose}
Product context: ${productName}${productDescription ? ` — ${productDescription}` : ""}

Here is the structured breakdown of one ad's media file:
${JSON.stringify(stripped)}

Pick the ad's angle: ${angleRuleText(vocab)}

Angle library:
${angleLines(vocab)}

Return ONLY one JSON object, no prose and no code fences:
{ "angle": slug, "angle_suggestion": slug|null }`;
}
