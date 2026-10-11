/**
 * Validation for the per-media creative profile document.
 * Field paths and enum values mirror docs/creative-profile.md exactly.
 */

export const SCHEMA_VERSION = 1;

export const MEDIA_TYPES = ["video", "image", "carousel"] as const;
export const HOOK_TYPES = ["callout", "question", "bold_claim", "pov", "story_open", "pattern_interrupt", "stat", "demo_first", "controversial"] as const;
export const BEATS = ["hook", "problem", "agitate", "solution", "mechanism", "demo", "proof", "offer", "cta"] as const;
export const STRUCTURES = ["problem_solution", "testimonial", "founder_story", "listicle", "tutorial", "skit", "before_after", "demo"] as const;
export const AWARENESS = ["unaware", "problem_aware", "solution_aware", "product_aware", "most_aware"] as const;
export const STRATEGIC_RESPONSES = ["benefit", "mechanism", "new_information", "new_identity"] as const;
export const CLAIM_TYPES = ["simple_benefit", "amplified_benefit", "mechanism", "enhanced_mechanism", "identity"] as const;
export const PROOF = ["app_demo", "score_screen", "testimonial", "stat", "before_after", "press", "none"] as const;
export const FORMATS = ["talking_head", "ugc_selfie", "green_screen", "skit", "app_demo", "slideshow", "static_image", "carousel", "animation"] as const;
export const VISUAL_STYLES = ["lofi_selfie", "polished", "studio", "screen_record", "text_heavy", "meme", "ai_generated"] as const;
export const LAYOUTS = ["text_overlay", "screenshot", "before_after", "meme", "product_shot", "photo"] as const;
export const SETTINGS = ["home", "bathroom", "car", "office", "outdoor", "studio", "other"] as const;
export const ASPECTS = ["9:16", "4:5", "1:1", "16:9", "other"] as const;
export const VOICES = ["on_camera", "actor_vo", "ai_voice", "none"] as const;
export const CAPTIONS = ["word_by_word", "static", "none"] as const;
export const MUSIC = ["none", "background", "trending"] as const;
export const PACINGS = ["fast", "medium", "slow"] as const;
export const PERSON_ROLES = ["presenter", "actor", "voice_only", "extra"] as const;
export const GENDERS = ["female", "male", "other"] as const;
export const AGE_BANDS = ["under_18", "18_24", "25_34", "35_44", "45_54", "55_plus"] as const;
export const ETHNICITIES = ["black", "east_asian", "south_asian", "southeast_asian", "hispanic", "middle_eastern", "white", "mixed_other"] as const;
export const CTA_TYPES = ["download", "try_free", "learn_more", "sign_up", "shop", "other"] as const;
export const PROFILED_BY = ["llm", "manual"] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export interface ScriptBeat {
  t: number;
  beat: (typeof BEATS)[number];
  text: string;
}

export interface CarouselCard {
  position: number;
  text: string;
  visual: string;
}

export interface Person {
  role: (typeof PERSON_ROLES)[number];
  gender: (typeof GENDERS)[number] | null;
  age_band: (typeof AGE_BANDS)[number] | null;
  ethnicity: (typeof ETHNICITIES)[number] | null;
  vibe: string | null;
}

export interface CreativeProfile {
  schema_version: number;
  media_type: MediaType;
  hook: {
    spoken: string | null;
    onscreen_text: string | null;
    visual: string | null;
    type: (typeof HOOK_TYPES)[number] | null;
    length_s: number | null;
  };
  script: {
    transcript: string | null;
    beats: ScriptBeat[];
    structure: (typeof STRUCTURES)[number] | null;
  } | null;
  strategy: {
    awareness: (typeof AWARENESS)[number] | null;
    strategic_response: (typeof STRATEGIC_RESPONSES)[number] | null;
    claim_type: (typeof CLAIM_TYPES)[number] | null;
    mechanism: string | null;
    new_information: string | null;
    identity: string | null;
    angle: string | null;
    angle_suggestion: string | null;
    audience: string | null;
    pain_points: string[];
    desires: string[];
    features: string[];
    proof: (typeof PROOF)[number][];
    objections_handled: string[];
    offer: string | null;
    claims: string[];
  };
  production: {
    format: (typeof FORMATS)[number] | null;
    visual_style: (typeof VISUAL_STYLES)[number] | null;
    layout: (typeof LAYOUTS)[number] | null;
    setting: (typeof SETTINGS)[number] | null;
    length_s: number | null;
    aspect: (typeof ASPECTS)[number] | null;
    voice: (typeof VOICES)[number] | null;
    captions: (typeof CAPTIONS)[number] | null;
    music: (typeof MUSIC)[number] | null;
    app_on_screen_s: number | null;
    pacing: (typeof PACINGS)[number] | null;
  };
  cards: CarouselCard[];
  people: Person[];
  cta: {
    type: (typeof CTA_TYPES)[number] | null;
    spoken: string | null;
    onscreen: string | null;
  };
  _meta: {
    by: (typeof PROFILED_BY)[number];
    model: string | null;
    at: string;
    manual_keys: string[];
  };
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const DOTTED_PATH = /^[a-z_0-9]+(\[\d+\])?(\.[a-z_0-9]+(\[\d+\])?)*$/;

type Problems = { push: (path: string, message: string) => void };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(problems: Problems, path: string, obj: Record<string, unknown>, expected: string[]): void {
  const allowed = new Set(expected);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) problems.push(path ? `${path}.${key}` : key, "unknown key");
  }
}

function requiredObj(problems: Problems, path: string, value: unknown, keys: string[]): Record<string, unknown> | null {
  if (!isObject(value)) {
    problems.push(path, "must be an object");
    return null;
  }
  unknownKeys(problems, path, value, keys);
  return value;
}

function textField(problems: Problems, path: string, value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    problems.push(path, "must be a string or null");
    return null;
  }
  return value;
}

function numberField(problems: Problems, path: string, value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    problems.push(path, "must be a number or null");
    return null;
  }
  return value;
}

function enumField<const T extends readonly string[]>(problems: Problems, path: string, value: unknown, values: T): T[number] | null {
  if (value === null) return null;
  if (typeof value !== "string" || !values.includes(value)) {
    problems.push(path, `must be one of ${values.join(", ")} or null`);
    return null;
  }
  return value;
}

function requiredEnumField<const T extends readonly string[]>(problems: Problems, path: string, value: unknown, values: T): T[number] | null {
  if (typeof value !== "string" || !values.includes(value)) {
    problems.push(path, `must be one of ${values.join(", ")}`);
    return null;
  }
  return value;
}

function slugField(problems: Problems, path: string, value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !SLUG.test(value)) {
    problems.push(path, "must be a lowercase slug or null");
    return null;
  }
  return value;
}

function stringList(problems: Problems, path: string, value: unknown): string[] {
  if (!Array.isArray(value)) {
    problems.push(path, "must be an array");
    return [];
  }
  const out: string[] = [];
  for (const [i, item] of value.entries()) {
    if (typeof item !== "string") problems.push(`${path}[${i}]`, "must be a string");
    else out.push(item);
  }
  return out;
}

function slugList(problems: Problems, path: string, value: unknown): string[] {
  if (!Array.isArray(value)) {
    problems.push(path, "must be an array");
    return [];
  }
  const out: string[] = [];
  for (const [i, item] of value.entries()) {
    if (typeof item !== "string" || !SLUG.test(item)) problems.push(`${path}[${i}]`, "must be a lowercase slug");
    else out.push(item);
  }
  return out;
}

function enumList<const T extends readonly string[]>(problems: Problems, path: string, value: unknown, values: T): T[number][] {
  if (!Array.isArray(value)) {
    problems.push(path, "must be an array");
    return [];
  }
  const out: T[number][] = [];
  for (const [i, item] of value.entries()) {
    if (typeof item !== "string" || !values.includes(item)) {
      problems.push(`${path}[${i}]`, `must be one of ${values.join(", ")}`);
    } else out.push(item);
  }
  return out;
}

/**
 * Validate `input` against the creative profile schema. Collects every problem
 * and throws a single Error listing them as `path: message`; returns the typed
 * profile on success.
 */
export function parseCreativeProfile(input: unknown): CreativeProfile {
  const list: string[] = [];
  const problems: Problems = { push: (path, message) => list.push(`${path}: ${message}`) };

  const root = requiredObj(problems, "", input, ["schema_version", "media_type", "hook", "script", "strategy", "production", "cards", "people", "cta", "_meta"]);
  if (!root) throw new Error(`Invalid creative profile:\n${list.join("\n")}`);

  const schemaVersion = root.schema_version;
  if (schemaVersion !== SCHEMA_VERSION) {
    problems.push("schema_version", `must be ${SCHEMA_VERSION}`);
  }

  const mediaType = requiredEnumField(problems, "media_type", root.media_type, MEDIA_TYPES) ?? "video";

  const hookInput = requiredObj(problems, "hook", root.hook, ["spoken", "onscreen_text", "visual", "type", "length_s"]);
  const hook = {
    spoken: hookInput ? textField(problems, "hook.spoken", hookInput.spoken) : null,
    onscreen_text: hookInput ? textField(problems, "hook.onscreen_text", hookInput.onscreen_text) : null,
    visual: hookInput ? textField(problems, "hook.visual", hookInput.visual) : null,
    type: hookInput ? enumField(problems, "hook.type", hookInput.type, HOOK_TYPES) : null,
    length_s: hookInput ? numberField(problems, "hook.length_s", hookInput.length_s) : null,
  };

  let script: CreativeProfile["script"] = null;
  if (root.script !== null) {
    const scriptInput = requiredObj(problems, "script", root.script, ["transcript", "beats", "structure"]);
    if (scriptInput) {
      const beats: ScriptBeat[] = [];
      if (!Array.isArray(scriptInput.beats)) {
        problems.push("script.beats", "must be an array");
      } else {
        for (const [i, item] of scriptInput.beats.entries()) {
          const beat = requiredObj(problems, `script.beats[${i}]`, item, ["t", "beat", "text"]);
          if (!beat) continue;
          const t = typeof beat.t === "number" && Number.isFinite(beat.t) ? beat.t : null;
          if (t === null) problems.push(`script.beats[${i}].t`, "must be a number");
          const beatName = requiredEnumField(problems, `script.beats[${i}].beat`, beat.beat, BEATS);
          if (typeof beat.text !== "string") problems.push(`script.beats[${i}].text`, "must be a string");
          if (t !== null && beatName !== null && typeof beat.text === "string") {
            beats.push({ t, beat: beatName, text: beat.text });
          }
        }
      }
      script = {
        transcript: textField(problems, "script.transcript", scriptInput.transcript),
        beats,
        structure: enumField(problems, "script.structure", scriptInput.structure, STRUCTURES),
      };
    }
  }

  const strategyInput = requiredObj(problems, "strategy", root.strategy, [
    "awareness",
    "strategic_response",
    "claim_type",
    "mechanism",
    "new_information",
    "identity",
    "angle",
    "angle_suggestion",
    "audience",
    "pain_points",
    "desires",
    "features",
    "proof",
    "objections_handled",
    "offer",
    "claims",
  ]);
  const strategy = {
    awareness: strategyInput ? enumField(problems, "strategy.awareness", strategyInput.awareness, AWARENESS) : null,
    strategic_response: strategyInput ? enumField(problems, "strategy.strategic_response", strategyInput.strategic_response, STRATEGIC_RESPONSES) : null,
    claim_type: strategyInput ? enumField(problems, "strategy.claim_type", strategyInput.claim_type, CLAIM_TYPES) : null,
    mechanism: strategyInput ? textField(problems, "strategy.mechanism", strategyInput.mechanism) : null,
    new_information: strategyInput ? textField(problems, "strategy.new_information", strategyInput.new_information) : null,
    identity: strategyInput ? textField(problems, "strategy.identity", strategyInput.identity) : null,
    angle: strategyInput ? slugField(problems, "strategy.angle", strategyInput.angle) : null,
    angle_suggestion: strategyInput ? slugField(problems, "strategy.angle_suggestion", strategyInput.angle_suggestion ?? null) : null,
    audience: strategyInput ? slugField(problems, "strategy.audience", strategyInput.audience) : null,
    pain_points: strategyInput ? slugList(problems, "strategy.pain_points", strategyInput.pain_points) : [],
    desires: strategyInput ? slugList(problems, "strategy.desires", strategyInput.desires) : [],
    features: strategyInput ? slugList(problems, "strategy.features", strategyInput.features) : [],
    proof: strategyInput ? enumList(problems, "strategy.proof", strategyInput.proof, PROOF) : [],
    objections_handled: strategyInput ? stringList(problems, "strategy.objections_handled", strategyInput.objections_handled) : [],
    offer: strategyInput ? textField(problems, "strategy.offer", strategyInput.offer) : null,
    claims: strategyInput ? stringList(problems, "strategy.claims", strategyInput.claims) : [],
  };

  const productionInput = requiredObj(problems, "production", root.production, [
    "format",
    "visual_style",
    "layout",
    "setting",
    "length_s",
    "aspect",
    "voice",
    "captions",
    "music",
    "app_on_screen_s",
    "pacing",
  ]);
  const production = {
    format: productionInput ? enumField(problems, "production.format", productionInput.format, FORMATS) : null,
    visual_style: productionInput ? enumField(problems, "production.visual_style", productionInput.visual_style, VISUAL_STYLES) : null,
    layout: productionInput ? enumField(problems, "production.layout", productionInput.layout, LAYOUTS) : null,
    setting: productionInput ? enumField(problems, "production.setting", productionInput.setting, SETTINGS) : null,
    length_s: productionInput ? numberField(problems, "production.length_s", productionInput.length_s) : null,
    aspect: productionInput ? enumField(problems, "production.aspect", productionInput.aspect, ASPECTS) : null,
    voice: productionInput ? enumField(problems, "production.voice", productionInput.voice, VOICES) : null,
    captions: productionInput ? enumField(problems, "production.captions", productionInput.captions, CAPTIONS) : null,
    music: productionInput ? enumField(problems, "production.music", productionInput.music, MUSIC) : null,
    app_on_screen_s: productionInput ? numberField(problems, "production.app_on_screen_s", productionInput.app_on_screen_s) : null,
    pacing: productionInput ? enumField(problems, "production.pacing", productionInput.pacing, PACINGS) : null,
  };

  const cards: CarouselCard[] = [];
  if (!Array.isArray(root.cards)) {
    problems.push("cards", "must be an array");
  } else {
    for (const [i, item] of root.cards.entries()) {
      const card = requiredObj(problems, `cards[${i}]`, item, ["position", "text", "visual"]);
      if (!card) continue;
      const position = typeof card.position === "number" && Number.isInteger(card.position) ? card.position : null;
      if (position === null) problems.push(`cards[${i}].position`, "must be an integer");
      if (typeof card.text !== "string") problems.push(`cards[${i}].text`, "must be a string");
      if (typeof card.visual !== "string") problems.push(`cards[${i}].visual`, "must be a string");
      if (position !== null && typeof card.text === "string" && typeof card.visual === "string") {
        cards.push({ position, text: card.text, visual: card.visual });
      }
    }
  }
  if (mediaType !== "carousel" && Array.isArray(root.cards) && root.cards.length) {
    problems.push("cards", "must be [] unless media_type is carousel");
  }

  const people: Person[] = [];
  if (!Array.isArray(root.people)) {
    problems.push("people", "must be an array");
  } else {
    for (const [i, item] of root.people.entries()) {
      const person = requiredObj(problems, `people[${i}]`, item, ["role", "gender", "age_band", "ethnicity", "vibe"]);
      if (!person) continue;
      const role = requiredEnumField(problems, `people[${i}].role`, person.role, PERSON_ROLES);
      if (role === null) continue;
      people.push({
        role,
        gender: enumField(problems, `people[${i}].gender`, person.gender, GENDERS),
        age_band: enumField(problems, `people[${i}].age_band`, person.age_band, AGE_BANDS),
        ethnicity: enumField(problems, `people[${i}].ethnicity`, person.ethnicity, ETHNICITIES),
        vibe: textField(problems, `people[${i}].vibe`, person.vibe),
      });
    }
  }

  const ctaInput = requiredObj(problems, "cta", root.cta, ["type", "spoken", "onscreen"]);
  const cta = {
    type: ctaInput ? enumField(problems, "cta.type", ctaInput.type, CTA_TYPES) : null,
    spoken: ctaInput ? textField(problems, "cta.spoken", ctaInput.spoken) : null,
    onscreen: ctaInput ? textField(problems, "cta.onscreen", ctaInput.onscreen) : null,
  };

  const metaInput = requiredObj(problems, "_meta", root._meta, ["by", "model", "at", "manual_keys"]);
  const meta = {
    by: metaInput ? requiredEnumField(problems, "_meta.by", metaInput.by, PROFILED_BY) : null,
    model: metaInput ? textField(problems, "_meta.model", metaInput.model) : null,
    at: metaInput && typeof metaInput.at === "string" ? metaInput.at : null,
    manual_keys: metaInput ? stringList(problems, "_meta.manual_keys", metaInput.manual_keys) : [],
  };
  if (metaInput) {
    if (meta.at === null || Number.isNaN(Date.parse(meta.at))) {
      problems.push("_meta.at", "must be a parseable date-time string");
    }
    for (const [i, key] of meta.manual_keys.entries()) {
      if (!DOTTED_PATH.test(key)) problems.push(`_meta.manual_keys[${i}]`, "must be a field path like strategy.angle or people[0].gender");
    }
  }

  if (strategy.angle === "other") {
    if (strategy.angle_suggestion === null) {
      problems.push("strategy.angle_suggestion", 'must be a slug when angle is "other"');
    }
  } else if (strategy.angle_suggestion !== null) {
    problems.push("strategy.angle_suggestion", 'must be null unless angle is "other"');
  }

  if (mediaType === "image") {
    if (root.script !== null) problems.push("script", "must be null for image");
    if (hook.length_s !== null) problems.push("hook.length_s", "must be null for image");
    for (const key of ["voice", "captions", "music", "app_on_screen_s", "pacing", "length_s"] as const) {
      if (production[key] !== null) problems.push(`production.${key}`, "must be null for image");
    }
  }

  if (list.length) throw new Error(`Invalid creative profile:\n${list.join("\n")}`);

  return {
    schema_version: SCHEMA_VERSION,
    media_type: mediaType,
    hook,
    script,
    strategy,
    production,
    cards,
    people,
    cta,
    _meta: { by: meta.by!, model: meta.model, at: meta.at!, manual_keys: meta.manual_keys },
  };
}
