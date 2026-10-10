/** Apple Ads negative keyword matching, approximated: exact = the whole search term, broad = every word, any order. Apple also blocks close variants (plurals, misspellings), which this does not model. */
export interface NegativeLike {
  text: string;
  match_type: string;
  campaign_id: number;
  ad_group_id: number | null;
  status: string;
}

const words = (s: string) => s.normalize("NFKC").toLowerCase().split(/\s+/).filter(Boolean);

export function negativeBlocks(negative: Pick<NegativeLike, "text" | "match_type">, term: string): boolean {
  const t = words(term);
  const n = words(negative.text);
  if (!t.length || !n.length) return false;
  if (negative.match_type === "EXACT") return t.join(" ") === n.join(" ");
  return n.every((w) => t.includes(w));
}

/** Negatives that would block `term` for a keyword in this campaign and ad group. Campaign-level negatives have no ad group. */
export function blockingNegatives<N extends NegativeLike>(negatives: N[], campaignId: number, adGroupId: number | null, term: string): N[] {
  return negatives.filter((n) => n.status === "ENABLED" && n.campaign_id === campaignId && (n.ad_group_id == null || n.ad_group_id === adGroupId) && negativeBlocks(n, term));
}

export const sameText = (a: string, b: string) => words(a).join(" ") === words(b).join(" ");
