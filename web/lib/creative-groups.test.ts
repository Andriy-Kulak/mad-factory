import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCreativeFilters, applyScopeFilters, creativeFiltersHref, groupItems, parseCreativeFilters, type CreativeItem } from "./creative-groups.ts";

function item(sha256: string, over: Partial<CreativeItem> & { angle?: string; audience?: string } = {}): CreativeItem {
  const { angle = "a1", audience = "p1", ...rest } = over;
  return {
    sha256,
    mediaType: "video",
    url: null,
    owner: "competitor",
    source: "Page one",
    days: 40,
    active: true,
    bucket: "long",
    hook: { spoken: "Say it clearly", onscreen: null, visual: null },
    fields: { angle, angle_suggestion: null, audience, hook_type: "question", awareness: null, response: null, format: null, style: null, structure: null },
    ...rest,
  };
}

const items = [
  item("x", {}),
  item("y", { owner: "own", source: "our_ad", bucket: null, days: null, active: null, angle: "a2" }),
  item("z", { source: "Page two", bucket: "stopped", days: 5, active: false, audience: "p2", hook: { spoken: null, onscreen: "Stop rambling", visual: null } }),
  item("w", { owner: "inspiration", source: "Adjacent page", bucket: "mid", days: 20, angle: "a2" }),
];

test("groupItems counts owners and run buckets per value", () => {
  assert.deepEqual(
    groupItems(items, "angle").map((g) => [g.value, g.total, g.own, g.long, g.stopped]),
    [
      ["a1", 2, 0, 1, 1],
      ["a2", 2, 1, 0, 0],
    ],
  );
  assert.deepEqual(
    groupItems(items, "angle").map((g) => [g.value, g.competitor, g.inspiration]),
    [
      ["a1", 2, 0],
      ["a2", 0, 1],
    ],
  );
  assert.deepEqual(
    groupItems(items, "audience").map((g) => g.value),
    ["p1", "p2"],
  );
});

test("filters narrow by owner, advertiser, run length, hook text and the picked breakdown row", () => {
  const run = (sp: Record<string, string | string[]>) => applyCreativeFilters(items, parseCreativeFilters(sp)).map((i) => i.sha256);
  assert.deepEqual(run({ owner: "own" }), ["y"]);
  assert.deepEqual(run({ owner: "inspiration" }), ["w"]);
  assert.deepEqual(run({ owner: "bogus" }), ["x", "y", "z", "w"]);
  assert.deepEqual(run({ src: "Page two" }), ["z"]);
  assert.deepEqual(run({ run: "stopped" }), ["z"]);
  assert.deepEqual(run({ run: "live" }), ["x", "w"]);
  assert.deepEqual(run({ q: "RAMBLING" }), ["z"]);
  assert.deepEqual(run({ by: "audience", v: "p2" }), ["z"]);
  // The breakdown table counts across every value of its dimension, ignoring the picked row.
  assert.equal(applyScopeFilters(items, parseCreativeFilters({ v: "a2" })).length, 4);
});

test("creativeFiltersHref round-trips and omits defaults", () => {
  const f = parseCreativeFilters({ owner: "competitor", src: ["Page one", "Page two"], run: "long", q: "hook", by: "hook", v: "question" });
  const qs = new URLSearchParams(creativeFiltersHref(f).slice(1));
  assert.deepEqual(parseCreativeFilters(Object.fromEntries([...new Set(qs.keys())].map((k) => [k, qs.getAll(k)]))), f);
  assert.equal(creativeFiltersHref(parseCreativeFilters({ by: "bogus" })), "?");
});
