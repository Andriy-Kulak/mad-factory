import { test } from "node:test";
import assert from "node:assert/strict";
import { blockingNegatives, negativeBlocks, sameText } from "./negatives.ts";

test("exact negatives block only the whole term, ignoring case and spacing", () => {
  const n = { text: "Alpha Beta", match_type: "EXACT" };
  assert.equal(negativeBlocks(n, "alpha  beta"), true);
  assert.equal(negativeBlocks(n, "alpha beta gamma"), false);
  assert.equal(negativeBlocks(n, "beta alpha"), false);
});

test("broad negatives block terms containing every word in any order", () => {
  const n = { text: "alpha beta", match_type: "BROAD" };
  assert.equal(negativeBlocks(n, "beta gamma alpha"), true);
  assert.equal(negativeBlocks(n, "alpha gamma"), false);
  assert.equal(negativeBlocks({ text: "词语", match_type: "BROAD" }, "词语"), true);
});

test("the empty (withheld) search term is never blocked", () => {
  assert.equal(negativeBlocks({ text: "alpha", match_type: "BROAD" }, ""), false);
});

test("blockingNegatives scopes by campaign, ad group and status", () => {
  const base = { text: "alpha", match_type: "EXACT", status: "ENABLED" };
  const negatives = [
    { ...base, campaign_id: 1, ad_group_id: 10 },
    { ...base, campaign_id: 1, ad_group_id: null },
    { ...base, campaign_id: 1, ad_group_id: 11 },
    { ...base, campaign_id: 2, ad_group_id: 10 },
    { ...base, campaign_id: 1, ad_group_id: 10, status: "PAUSED" },
  ];
  assert.deepEqual(blockingNegatives(negatives, 1, 10, "alpha"), [negatives[0], negatives[1]]);
});

test("sameText normalizes case and whitespace", () => {
  assert.equal(sameText(" Alpha  beta", "alpha beta"), true);
  assert.equal(sameText("alpha", "alphas"), false);
});
