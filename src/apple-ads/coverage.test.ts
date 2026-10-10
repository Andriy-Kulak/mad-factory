import { test } from "node:test";
import assert from "node:assert/strict";
import { discoveryGaps, formatDiscoveryGaps, type CoverageCampaign, type CoverageKeyword } from "./coverage.ts";

const campaigns: CoverageCampaign[] = [
  { id: 1, name: "Discovery", role: "discovery", geo: "US" },
  { id: 2, name: "Generic", role: "generic", geo: "US" },
  { id: 3, name: "Competitors", role: "competitors", geo: "US" },
];

const keyword = (campaignId: number, text: string, matchType: string, options: Partial<CoverageKeyword> = {}): CoverageKeyword => ({
  campaignId,
  text,
  matchType,
  isNegative: false,
  deleted: false,
  ...options,
});

test("reports missing negatives and generic broad twins", () => {
  assert.deepEqual(
    discoveryGaps(campaigns, [keyword(2, "watering", "EXACT")]),
    [
      { kind: "missing_broad", text: "watering", campaignId: 2, discoveryCampaignId: 1 },
      { kind: "missing_negative", text: "watering", campaignId: 2, discoveryCampaignId: 1 },
    ],
  );
});

test("competitor exact keywords need a negative but not a broad twin", () => {
  assert.deepEqual(
    discoveryGaps(campaigns, [keyword(3, "rival app", "EXACT")]),
    [{ kind: "missing_negative", text: "rival app", campaignId: 3, discoveryCampaignId: 1 }],
  );
});

test("gaps for repeated normalized keywords are deduplicated", () => {
  const repeatedCampaigns = [...campaigns, { id: 4, name: "Generic two", role: "generic", geo: "US" }];
  const gaps = discoveryGaps(repeatedCampaigns, [
    keyword(2, "Phrase", "EXACT"),
    keyword(4, " phrase  ", "EXACT"),
  ]);
  assert.deepEqual(gaps, [
    { kind: "missing_broad", text: "phrase", campaignId: 2, discoveryCampaignId: 1 },
    { kind: "missing_negative", text: "phrase", campaignId: 2, discoveryCampaignId: 1 },
  ]);
});

test("paused generic exact keywords are still counted", () => {
  const pausedKeyword = { ...keyword(2, "paused phrase", "EXACT"), status: "PAUSED" };
  const gaps = discoveryGaps(campaigns, [pausedKeyword]);
  assert.equal(gaps.length, 2);
});

test("a broad keyword covers an exact phrase when its words are a subset", () => {
  assert.deepEqual(discoveryGaps(campaigns, [
    keyword(2, "plant care app", "EXACT"),
    keyword(1, "plant care", "BROAD"),
    keyword(1, "plant care app", "EXACT", { isNegative: true }),
  ]), []);
});

test("a broad keyword does not cover a word-form variation", () => {
  const gaps = discoveryGaps(campaigns, [
    keyword(2, "watering", "EXACT"),
    keyword(1, "water", "BROAD"),
    keyword(1, "watering", "EXACT", { isNegative: true }),
  ]);
  assert.deepEqual(gaps, [{ kind: "missing_broad", text: "watering", campaignId: 2, discoveryCampaignId: 1 }]);
});

test("keyword comparison normalizes case and whitespace", () => {
  assert.deepEqual(discoveryGaps(campaigns, [
    keyword(2, "  PLANT   Care App ", "EXACT"),
    keyword(1, "plant care", "BROAD"),
    keyword(1, " plant   care app ", "EXACT", { isNegative: true }),
  ]), []);
});

test("deleted keywords do not count as sources, negatives, or broad coverage", () => {
  const gaps = discoveryGaps(campaigns, [
    keyword(2, "active phrase", "EXACT"),
    keyword(1, "active phrase", "BROAD", { deleted: true }),
    keyword(2, "deleted exact", "EXACT", { deleted: true }),
  ]);
  assert.deepEqual(gaps, [
    { kind: "missing_broad", text: "active phrase", campaignId: 2, discoveryCampaignId: 1 },
    { kind: "missing_negative", text: "active phrase", campaignId: 2, discoveryCampaignId: 1 },
  ]);
});

test("campaign geos without a discovery campaign produce no gaps", () => {
  assert.deepEqual(discoveryGaps(
    [{ id: 2, name: "Generic", role: "generic", geo: "CA" }],
    [keyword(2, "phrase", "EXACT")],
  ), []);
});

test("a broad negative with the same text counts as a negative", () => {
  assert.deepEqual(discoveryGaps(campaigns, [
    keyword(2, "phrase", "EXACT"),
    keyword(1, "phrase", "BROAD", { isNegative: true }),
  ]), [{ kind: "missing_broad", text: "phrase", campaignId: 2, discoveryCampaignId: 1 }]);
});

test("formatter groups by discovery campaign and kind", () => {
  const gaps = [
    { kind: "missing_broad", text: "water plants", campaignId: 2, discoveryCampaignId: 1 },
    { kind: "missing_broad", text: "watering", campaignId: 2, discoveryCampaignId: 1 },
    { kind: "missing_negative", text: "rival app", campaignId: 3, discoveryCampaignId: 1 },
  ] as const;
  assert.deepEqual(formatDiscoveryGaps(campaigns, [...gaps]), [
    'Apple Ads Discovery: 2 generic EXACT keyword(s) without a BROAD twin: water plants, watering (playbooks/apple-ads.md "Discovery mirror")',
    'Apple Ads Discovery: 1 EXACT keyword(s) not negated in discovery: rival app (playbooks/apple-ads.md "Discovery mirror")',
  ]);
  assert.deepEqual(formatDiscoveryGaps(campaigns, []), []);
});
