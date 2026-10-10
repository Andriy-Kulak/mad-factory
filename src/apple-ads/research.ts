/**
 * Read-only keyword research against Apple's suggestions endpoint.
 *
 * `POST /suggestions/keywords/query` returns `{text, popularity}` (0-100, relative "across App Store
 * countries or regions", not per storefront). Seeded with the app only it lists terms Apple associates
 * with the app; seeded with `terms` it lists related terms. A term you ask about comes back only when
 * Apple knows it, and a bare `5` for the seed itself is the floor ("no meaningful volume"), so treat
 * 5 as "unknown/none". Real volume for us is what the exact campaigns actually get (apple_ads_keyword_daily).
 */
import type { AppleAdsClient } from "./client.ts";

export interface KeywordSuggestion {
  text: string;
  popularity: number;
}

interface SuggestionsPage {
  result: KeywordSuggestion[];
  pagination: { offset: number; pageSize: number; totalCount: number };
}

export const POPULARITY_FLOOR = 5;
export const MAX_NEW_POPULARITY_TERMS = 10;
export const TERM_POPULARITY_SOURCE = "suggestions/keywords (term seed)";

export interface TargetedTerm {
  text: string;
  country: string;
}

const normalizeTerm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/** Targeted keyword texts with no popularity row yet (any country counts as known), deduped, sorted by text, capped. */
export function termsMissingPopularity(
  targeted: TargetedTerm[],
  known: Iterable<string>,
  limit: number,
): { lookups: TargetedTerm[]; deferred: number } {
  const knownTerms = new Set([...known].map(normalizeTerm));
  const firstCountryByTerm = new Map<string, string>();
  for (const { text, country } of targeted) {
    const term = normalizeTerm(text);
    if (!firstCountryByTerm.has(term)) firstCountryByTerm.set(term, country);
  }

  const missing = [...firstCountryByTerm]
    .filter(([text]) => !knownTerms.has(text))
    .map(([text, country]) => ({ text, country }))
    .sort((a, b) => a.text.localeCompare(b.text));
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const lookups = missing.slice(0, cap);
  return { lookups, deferred: missing.length - lookups.length };
}

export async function keywordSuggestions(
  client: AppleAdsClient,
  adAccountId: number,
  appStoreId: string,
  countries: string[],
  terms?: string[],
): Promise<KeywordSuggestion[]> {
  const filters: Record<string, unknown>[] = [
    { field: "promotedObjectId", operator: "EQUALS", value: [appStoreId] },
    { field: "promotedObjectType", operator: "EQUALS", value: ["APPSTORE_APP"] },
    { field: "countriesOrRegions", operator: "IN", value: countries },
  ];
  if (terms?.length) filters.push({ field: "terms", operator: "IN", value: terms });
  const all: KeywordSuggestion[] = [];
  for (let offset = 0; ; ) {
    const res = await client.call<SuggestionsPage>(adAccountId, "POST", "/suggestions/keywords/query", { filters, pagination: { offset, limit: 100 } });
    if (res.status !== 200) throw new Error(`suggestions/keywords/query: HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
    const page = res.data.result ?? [];
    all.push(...page);
    offset += page.length;
    if (!page.length || offset >= res.data.pagination.totalCount) break;
  }
  return all.sort((a, b) => b.popularity - a.popularity);
}

/** Popularity of each term as Apple reports it when seeded with that term alone; absent = Apple returned nothing. */
export async function termPopularity(
  client: AppleAdsClient,
  adAccountId: number,
  appStoreId: string,
  countries: string[],
  terms: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const term of terms) {
    const got = await keywordSuggestions(client, adAccountId, appStoreId, countries, [term]);
    const hit = got.find((s) => s.text.toLowerCase() === term.toLowerCase());
    out.set(term, hit ? hit.popularity : null);
  }
  return out;
}
