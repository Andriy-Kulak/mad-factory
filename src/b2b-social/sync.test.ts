import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateXReplyUsd, parseB2BGroupFilter, xReplyParams } from "./sync.ts";

const post = (last_reply_id: string | null = null) => ({ external_id: "post-id", account_handle: "sample", last_reply_id });

test("xReplyParams defaults to 100 replies in recency order and only adds since_id when present", () => {
  const params = xReplyParams(post(), {});
  assert.deepEqual(params, {
    query: "conversation_id:post-id -from:sample is:reply",
    max_results: "100",
    sort_order: "recency",
    expansions: "author_id",
    "tweet.fields": "created_at",
    "user.fields": "description,location,public_metrics",
  });
  assert.equal(xReplyParams(post("reply-id"), {}).since_id, "reply-id");
});

test("xReplyParams clamps reply caps and accepts relevancy ordering", () => {
  assert.equal(xReplyParams(post(), { max_replies: 5 }).max_results, "10");
  assert.equal(xReplyParams(post(), { max_replies: 500 }).max_results, "100");
  assert.equal(xReplyParams(post(), { reply_order: "relevancy" }).sort_order, "relevancy");
});

test("parseB2BGroupFilter accepts comma-separated groups and rejects unknown values", () => {
  assert.deepEqual(parseB2BGroupFilter("company, team"), ["company", "team"]);
  assert.throws(() => parseB2BGroupFilter("company,unknown"), /company, team or competitor/);
});

test("estimateXReplyUsd applies each account's cap and treats null counts as zero", () => {
  const estimate = estimateXReplyUsd(
    [
      { account_handle: "sample", comments: 250 },
      { account_handle: "sample", comments: null },
    ],
    new Map([["sample", { max_replies: 30 }]]),
  );
  assert.equal(estimate.perAccount.get("sample"), 30 * (0.005 + 0.01));
  assert.equal(estimate.totalUsd, 30 * (0.005 + 0.01));
});
