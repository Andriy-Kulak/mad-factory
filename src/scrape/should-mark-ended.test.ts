import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldMarkEnded } from "./should-mark-ended.ts";

test("does not mark ads ended when the run reaches its max", () => {
  assert.equal(shouldMarkEnded({ collector: "scrapecreators", status: "ACTIVE", adsSeen: 250, maxAds: 250 }), false);
});

test("does not mark ads ended for Playwright runs", () => {
  assert.equal(shouldMarkEnded({ collector: "playwright", status: "ACTIVE", adsSeen: 1, maxAds: 250 }), false);
});

test("does not mark ads ended for all-status runs", () => {
  assert.equal(shouldMarkEnded({ collector: "scrapecreators", status: "ALL", adsSeen: 1, maxAds: 250 }), false);
});

test("marks ads ended after a complete active ScrapeCreators run", () => {
  assert.equal(shouldMarkEnded({ collector: "scrapecreators", status: "active", adsSeen: 1, maxAds: 250 }), true);
  assert.equal(shouldMarkEnded({ collector: "scrapecreators", adsSeen: 1, maxAds: 250 }), true);
});
