import assert from "node:assert/strict";
import { test } from "node:test";
import { metaSource } from "../sources/meta/collector.ts";
import { scrapeCreatorsSource } from "../sources/meta/scrapecreators.ts";
import { adRelationOf, mergeAdRelations, parseAdLibraryInput, parseSocialAccountInput } from "./tracked-source-input.ts";

test("normalizes Instagram handles and profile links", () => {
  const cases = [
    ["Example.User", "example.user"],
    [" @Example_User ", "example_user"],
    ["instagram.com/Example.User", "example.user"],
    ["https://www.instagram.com/Example_User/", "example_user"],
    ["https://www.instagram.com/Example.User/reels/?tab=recent", "example.user"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(parseSocialAccountInput("instagram", input!), expected);
  }
});

test("normalizes TikTok handles and profile/video links", () => {
  const cases = [
    ["Example.User", "example.user"],
    ["@Example_User", "example_user"],
    ["tiktok.com/@Example.User", "example.user"],
    ["https://www.tiktok.com/@Example.User?lang=en", "example.user"],
    ["https://www.tiktok.com/@Example_User/video/1234567890", "example_user"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(parseSocialAccountInput("tiktok", input!), expected);
  }
});

test("normalizes Facebook page URLs and numeric IDs", () => {
  const cases = [
    ["987654321012345", "https://www.facebook.com/profile.php?id=987654321012345"],
    [
      "https://www.facebook.com/profile.php?id=987654321012345&sk=reels_tab",
      "https://www.facebook.com/profile.php?id=987654321012345",
    ],
    [
      "facebook.com/example.page/reels/?ref=share#videos",
      "https://www.facebook.com/example.page",
    ],
    [
      "https://m.facebook.com/example.page?ref=profile",
      "https://www.facebook.com/example.page",
    ],
  ];

  for (const [input, expected] of cases) {
    assert.equal(parseSocialAccountInput("facebook", input!), expected);
  }
});

test("rejects empty inputs and URLs from the wrong social platform", () => {
  for (const platform of ["instagram", "tiktok", "facebook"] as const) {
    assert.throws(() => parseSocialAccountInput(platform, "  "), /Enter a .* handle or profile URL/);
  }

  assert.throws(
    () => parseSocialAccountInput("instagram", "https://www.tiktok.com/@example.user"),
    /Expected an Instagram profile URL, not a TikTok URL/,
  );
  assert.throws(
    () => parseSocialAccountInput("tiktok", "https://www.facebook.com/example.page"),
    /Expected a TikTok profile URL, not a Facebook URL/,
  );
  assert.throws(
    () => parseSocialAccountInput("facebook", "https://www.instagram.com/example.user"),
    /Expected a Facebook profile URL, not an Instagram URL/,
  );
  assert.throws(
    () => parseSocialAccountInput("instagram", "https://example.test/example.user"),
    /Expected an Instagram profile URL/,
  );
});

test("rejects Instagram post and non-profile routes", () => {
  for (const route of ["p", "reel", "reels", "stories", "explore", "tv"]) {
    assert.throws(
      () => parseSocialAccountInput("instagram", `https://www.instagram.com/${route}/123`),
      /Paste a profile link, not a post link/,
    );
  }
  assert.throws(
    () => parseSocialAccountInput("instagram", "https://www.instagram.com/example.user/p/123"),
    /Paste an Instagram profile link, not a post link/,
  );
});

test("rejects TikTok URLs without an @handle and invalid handles", () => {
  assert.throws(
    () => parseSocialAccountInput("tiktok", "https://www.tiktok.com/example.user/video/123"),
    /must include an @handle/,
  );
  assert.throws(() => parseSocialAccountInput("tiktok", "@bad handle"), /lowercase handle without @/);
});

test("rejects invalid Facebook profile URLs and bare handles", () => {
  assert.throws(
    () => parseSocialAccountInput("facebook", "https://www.facebook.com/profile.php?sk=reels_tab"),
    /must include a numeric page ID/,
  );
  assert.throws(
    () => parseSocialAccountInput("facebook", "https://www.facebook.com/example.page/posts/123"),
    /Paste a Facebook profile URL, not a post link/,
  );
  assert.throws(() => parseSocialAccountInput("facebook", "example.page"), /numeric page ID/);
});

test("parses Meta Ad Library page URLs and validates them for both collectors", () => {
  const result = parseAdLibraryInput(
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&is_targeted_country=false&media_type=all&search_type=page&sort_data[direction]=desc&sort_data[mode]=total_impressions&view_all_page_id=123456789012345",
  );
  assert.deepEqual(result, {
    kind: "page",
    value: "123456789012345",
    country: "US",
    config: { status: "ACTIVE" },
  });

  const trackedSource: Parameters<typeof metaSource.validate>[0] = {
    id: "fixture",
    product_id: "fixture",
    source: "meta",
    kind: result.kind,
    value: result.value,
    country: result.country,
    label: null,
    enabled: true,
    config: result.config,
    last_scraped_at: null,
    created_at: "",
  };
  assert.doesNotThrow(() => metaSource.validate(trackedSource));
  assert.doesNotThrow(() => scrapeCreatorsSource.validate(trackedSource));
});

test("parses numeric Meta page IDs and keyword searches", () => {
  assert.deepEqual(parseAdLibraryInput("987654321012345"), {
    kind: "page",
    value: "987654321012345",
    country: "US",
    config: {},
  });
  assert.deepEqual(
    parseAdLibraryInput(
      "https://facebook.com/ads/library/?search_type=keyword_unordered&q=sample+term%26more&country=all&active_status=inactive",
    ),
    {
      kind: "keyword",
      value: "sample term&more",
      country: "ALL",
      config: { status: "INACTIVE" },
    },
  );
});

test("maps Ad Library status values and omits missing status", () => {
  for (const [status, expected] of [
    ["active", "ACTIVE"],
    ["inactive", "INACTIVE"],
    ["all", "ALL"],
  ] as const) {
    assert.deepEqual(
      parseAdLibraryInput(
        `https://www.facebook.com/ads/library/?view_all_page_id=123456789012345&active_status=${status}`,
      ).config,
      { status: expected },
    );
  }
  assert.deepEqual(
    parseAdLibraryInput("https://www.facebook.com/ads/library/?view_all_page_id=123456789012345").config,
    {},
  );
});

test("rejects unsupported Ad Library inputs", () => {
  assert.throws(() => parseAdLibraryInput(""), /Paste a Meta Ad Library URL or numeric page ID/);
  assert.throws(() => parseAdLibraryInput("not a page ID"), /Paste a Meta Ad Library URL or numeric page ID/);
  assert.throws(
    () => parseAdLibraryInput("https://www.instagram.com/ads/library/?view_all_page_id=123"),
    /must be on facebook.com/,
  );
  assert.throws(
    () => parseAdLibraryInput("https://www.facebook.com/example.page"),
    /not a Facebook profile or post link/,
  );
  assert.throws(
    () => parseAdLibraryInput("https://www.facebook.com/ads/library/?view_all_page_id=abc"),
    /page ID must be numeric/,
  );
  assert.throws(
    () => parseAdLibraryInput("https://www.facebook.com/ads/library/?search_type=page&q=example"),
    /page ID or keyword search/,
  );
  assert.throws(
    () => parseAdLibraryInput("https://www.facebook.com/ads/library/?view_all_page_id=123&active_status=archived"),
    /status must be active, inactive, or all/,
  );
  assert.throws(
    () => parseAdLibraryInput("https://www.facebook.com/ads/library/?view_all_page_id=123&country="),
    /country cannot be empty/,
  );
});

test("Ad Library relation defaults to competitor, and competitor wins when sources disagree", () => {
  assert.equal(adRelationOf({}), "competitor");
  assert.equal(adRelationOf(null), "competitor");
  assert.equal(adRelationOf({ relation: "own" }), "competitor");
  assert.equal(adRelationOf({ status: "ACTIVE", relation: "inspiration" }), "inspiration");
  assert.equal(mergeAdRelations("inspiration", "inspiration"), "inspiration");
  assert.equal(mergeAdRelations("inspiration", "competitor"), "competitor");
  assert.equal(mergeAdRelations("competitor", "inspiration"), "competitor");
});
