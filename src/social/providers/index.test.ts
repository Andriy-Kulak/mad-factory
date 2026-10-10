import assert from "node:assert/strict";
import { test } from "node:test";
import { getSocialCollector, knownSocialProviders } from "./index.ts";
import { SOCIAL_PLATFORMS } from "../types.ts";

test("registers a ScrapeCreators collector for every supported social platform", () => {
  assert.deepEqual(knownSocialProviders(), ["scrapecreators"]);
  for (const platform of SOCIAL_PLATFORMS) {
    const collector = getSocialCollector(platform);
    assert.equal(collector.platform, platform);
    assert.equal(collector.provider, "scrapecreators");
  }
});
