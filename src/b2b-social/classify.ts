export const COMMENT_KINDS = ["using", "pain", "evaluating", "insider", "commentary", "cheer", "company"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];
export const SIGNAL_KINDS: readonly CommentKind[] = ["using", "pain", "evaluating"];
export const isSignal = (kind: CommentKind) => SIGNAL_KINDS.includes(kind);

const INSIDER_TEXT = /\b(by our team|work by our|our team!|we('re| are) just getting started|loved working on|proud of (the|our) team|welcome to the team|great to work with)\b/i;
const VENDOR_SUPPORT = /\b(sorry about that|should be resolved now|we('re| are) looking into (it|this)|please (dm|email) (us|support)|reach out to (our )?support)\b/i;
const USING =
  /\b(we use|we('ve| have) been using|we('re| are) using|i use|i('ve| have) been using|i('ve| have) applied|i have applied|my team (has|have|is)|our team (has|have|is) (been )?using|at our company|we tried|we switched|upgrade to our|improved our|changed our|in our (workflow|stack|codebase))\b/i;
const PAIN =
  /\b(price (hike|increase)|nuked|too expensive|expensive|costly|confusing|rate[- ]limit(s|ed)?|usage limits?|hit (the|my|a) limit|quota|too slow|so slow|broken|buggy|unusable|cancel(l?ed|ling)?|switch(ed|ing)? (to|from|away)|downgrad\w*|frustrat\w*|disappointed|regress\w*|outage|keeps (failing|crashing)|worse than)\b/i;
const EVALUATING = /\b(compare[ds]?|compared to|vs\.?|versus|alternative to|advantage over|does it (work|support|handle)|can it|any plans|on the roadmap|is there a way|how (does|do|can|is))\b/i;
const QUESTION_MAX = 220;

export function normalizeName(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function classifyComment<T extends { employer: string | null }>(comment: { authorUrl: string | null; text: string }, person: T | undefined, posterNames: string[]): CommentKind {
  if (comment.authorUrl && /\/(company|school)\//.test(comment.authorUrl)) return "company";
  const employer = normalizeName(person?.employer ?? null);
  if (employer && posterNames.some((n) => n && normalizeName(n) === employer)) return "insider";
  const text = comment.text.trim();
  if ((INSIDER_TEXT.test(text) && !text.includes("?")) || VENDOR_SUPPORT.test(text)) return "insider";
  if (USING.test(text)) return "using";
  if (PAIN.test(text)) return "pain";
  if (EVALUATING.test(text) || (text.includes("?") && text.length <= QUESTION_MAX)) return "evaluating";
  return text.length >= 160 ? "commentary" : "cheer";
}
