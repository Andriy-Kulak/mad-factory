import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeB2BAccountConfig } from "./db.ts";

test("mergeB2BAccountConfig keeps learned fields unless explicitly reset", () => {
  const existing = {
    group: "competitor" as const,
    url: "https://x.com/sample",
    followers: 42,
    replies: false,
    x_user_id: "user-id",
    last_post_id: "post-id",
    max_replies: 30,
    reply_order: "relevancy" as const,
    sample: "popular" as const,
  };
  const merged = mergeB2BAccountConfig(existing, {
    group: "team",
    url: "https://x.com/sample",
  });
  assert.equal(merged.group, "team");
  assert.equal(merged.replies, false);
  assert.equal(merged.x_user_id, "user-id");
  assert.equal(merged.last_post_id, "post-id");
  assert.equal(merged.max_replies, 30);
  assert.equal(merged.reply_order, "relevancy");
  assert.equal(merged.sample, "popular");

  const reset = mergeB2BAccountConfig(existing, {
    group: "team",
    url: "https://x.com/sample",
    replies: true,
    maxReplies: 50,
    replyOrder: "recency",
    reset: true,
  });
  assert.equal(reset.x_user_id, "user-id");
  assert.equal(reset.last_post_id, undefined);
  assert.equal(reset.max_replies, 50);
  assert.equal(reset.reply_order, "recency");
});
