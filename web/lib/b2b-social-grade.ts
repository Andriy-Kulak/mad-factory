/**
 * How B2B Social grades a person: Fit (A/B/C: right company, right person) × Intent (1/2/3: how strong and how fresh
 * the signal is), e.g. "A1". The grade picks a route. Every rule lives here, and the page's "How we score" panel reads
 * these same constants, so the explanation and the logic can't drift apart. Adjust the rules here.
 */
import type { CommentKind, CompanyTier, Seniority } from "./b2b-social.ts";

export type Persona = "buyer" | "champion" | "unknown";
export type Fit = "A" | "B" | "C";
export type Intent = 1 | 2 | 3;
export type Route = "now" | "nurture" | "selfserve";

/** Buyers sign (C-level, founders, VPs, directors and heads); champions use it and pull it in (managers, leads, engineers). */
export function personaOf(seniority: Seniority): Persona {
  if (seniority === "exec" || seniority === "vp" || seniority === "director") return "buyer";
  if (seniority === "unknown") return "unknown";
  return "champion";
}

export const PERSONA_LABEL: Record<Persona, string> = { buyer: "Buyer", champion: "Champion", unknown: "Role unknown" };

/** Days after which a signal counts one intent level weaker. */
export const FADE_DAYS = 14;

export const SCORING = {
  fit: [
    { grade: "A", rule: "Fortune 500 or 10k+ company, and we know their role (buyer or champion)" },
    { grade: "B", rule: "Fortune 500 or 10k+ company but role unknown, or a buyer (founder, CTO, VP) at a smaller or YC company" },
    { grade: "C", rule: "Everyone else: engineers at smaller companies, unknown roles at unknown companies" },
  ],
  intent: [
    { grade: 1, rule: "Already using it, or complaining about a competitor (price, limits, switching)" },
    { grade: 2, rule: "Asking a question or comparing options" },
    { grade: 3, rule: "Engaged without a signal (congrats, a long take)" },
  ],
  adjustments: [
    "A reply on a team member's post that has nothing to do with the product or coding is graded C3 and listed last",
    "One level stronger when they left two or more signals, or when two or more people from the same company engaged",
    `One level weaker when their latest signal is more than ${FADE_DAYS} days old`,
  ],
  routes: [
    { route: "now", label: "Reach out now", grades: "A1, A2, B1", rule: "A rep or SDR sends a personal message this week" },
    { route: "selfserve", label: "Self-serve or startup program", grades: "B2, C1, C2", rule: "High intent at a smaller company: point them to self-serve or the startup program" },
    { route: "nurture", label: "Nurture", grades: "A3, B3, C3", rule: "Right company, no signal yet: marketing keeps them warm" },
  ],
} as const;

export const ROUTE_LABEL: Record<Route, string> = { now: "Reach out now", selfserve: "Self-serve or startup", nurture: "Nurture" };

export function fitOf(tier: CompanyTier, persona: Persona, hasCompany: boolean): Fit {
  const big = tier === "fortune500" || tier === "enterprise";
  if (big && persona !== "unknown") return "A";
  if (big || (persona === "buyer" && (tier === "yc" || hasCompany))) return "B";
  return "C";
}

const BASE_INTENT: Record<CommentKind, Intent> = { using: 1, pain: 1, evaluating: 2, commentary: 3, cheer: 3, insider: 3, company: 3 };

export function intentOf(input: { kind: CommentKind; signals: number; colleagues: number; lastAt: string | null; capturedAt: string }): Intent {
  let level: number = BASE_INTENT[input.kind];
  if (input.signals >= 2 || input.colleagues >= 2) level -= 1;
  const age = input.lastAt ? (Date.parse(input.capturedAt) - Date.parse(input.lastAt)) / 86_400_000 : 0;
  if (age > FADE_DAYS) level += 1;
  return Math.min(3, Math.max(1, level)) as Intent;
}

export function routeOf(fit: Fit, intent: Intent): Route {
  if ((fit === "A" && intent <= 2) || (fit === "B" && intent === 1)) return "now";
  if (intent === 3) return "nurture";
  return "selfserve";
}

/** Sort key: A1 first, then A2, B1, … C3. */
export const gradeRank = (fit: Fit, intent: Intent) => ({ A: 0, B: 3, C: 6 })[fit] + intent;
