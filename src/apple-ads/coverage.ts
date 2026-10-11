export interface CoverageCampaign {
  id: number;
  name: string;
  role: string | null;
  geo: string | null;
}

export interface CoverageKeyword {
  campaignId: number;
  text: string;
  matchType: string;
  isNegative: boolean;
  deleted: boolean;
}

export interface CoverageGap {
  kind: "missing_negative" | "missing_broad";
  text: string;
  campaignId: number;
  discoveryCampaignId: number;
}

const normalize = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

export function discoveryGaps(campaigns: CoverageCampaign[], keywords: CoverageKeyword[]): CoverageGap[] {
  const keywordsByCampaign = new Map<number, CoverageKeyword[]>();
  for (const keyword of keywords) {
    if (keyword.deleted) continue;
    const rows = keywordsByCampaign.get(keyword.campaignId) ?? [];
    rows.push(keyword);
    keywordsByCampaign.set(keyword.campaignId, rows);
  }

  const gaps = new Map<string, CoverageGap>();
  const addGap = (gap: CoverageGap) => {
    const key = `${gap.kind}\0${gap.text}\0${gap.discoveryCampaignId}`;
    if (!gaps.has(key)) gaps.set(key, gap);
  };

  for (const discovery of campaigns) {
    if (discovery.role !== "discovery" || discovery.geo == null) continue;
    const discoveryKeywords = keywordsByCampaign.get(discovery.id) ?? [];
    const negativeTexts = new Set(discoveryKeywords.filter((keyword) => keyword.isNegative).map((keyword) => normalize(keyword.text)));
    const broadTexts = discoveryKeywords.filter((keyword) => !keyword.isNegative && keyword.matchType === "BROAD").map((keyword) => normalize(keyword.text));

    for (const source of campaigns) {
      if (source.role === "discovery" || source.geo !== discovery.geo) continue;
      for (const keyword of keywordsByCampaign.get(source.id) ?? []) {
        if (keyword.isNegative || keyword.matchType !== "EXACT") continue;
        const text = normalize(keyword.text);
        if (!negativeTexts.has(text)) {
          addGap({ kind: "missing_negative", text, campaignId: source.id, discoveryCampaignId: discovery.id });
        }
        if (source.role === "generic") {
          const phraseWords = new Set(text.split(" "));
          const covered = broadTexts.some((broad) => broad.split(" ").every((word) => phraseWords.has(word)));
          if (!covered) addGap({ kind: "missing_broad", text, campaignId: source.id, discoveryCampaignId: discovery.id });
        }
      }
    }
  }

  return [...gaps.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.text.localeCompare(b.text));
}

export function formatDiscoveryGaps(campaigns: CoverageCampaign[], gaps: CoverageGap[]): string[] {
  const names = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
  const grouped = new Map<string, { campaignId: number; kind: CoverageGap["kind"]; texts: Set<string> }>();
  for (const gap of gaps) {
    const key = `${gap.discoveryCampaignId}\0${gap.kind}`;
    const group = grouped.get(key) ?? { campaignId: gap.discoveryCampaignId, kind: gap.kind, texts: new Set<string>() };
    group.texts.add(gap.text);
    grouped.set(key, group);
  }

  return [...grouped.values()]
    .sort((a, b) => (names.get(a.campaignId) ?? "").localeCompare(names.get(b.campaignId) ?? "") || a.kind.localeCompare(b.kind))
    .map(({ campaignId, kind, texts }) => {
      const campaignName = names.get(campaignId) ?? String(campaignId);
      const keywords = [...texts].sort((a, b) => a.localeCompare(b)).join(", ");
      return kind === "missing_broad"
        ? `Apple Ads ${campaignName}: ${texts.size} generic EXACT keyword(s) without a BROAD twin: ${keywords} (playbooks/apple-ads.md "Discovery mirror")`
        : `Apple Ads ${campaignName}: ${texts.size} EXACT keyword(s) not negated in discovery: ${keywords} (playbooks/apple-ads.md "Discovery mirror")`;
    });
}
