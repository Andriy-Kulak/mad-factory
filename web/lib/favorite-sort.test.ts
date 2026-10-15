import assert from "node:assert/strict";
import { test } from "node:test";
import { byRecentlyStarred } from "./favorite-sort.ts";

test("byRecentlyStarred orders by starredAt descending", () => {
  const items = ["old", "new", "mid"];
  const starredAt = { old: "2026-10-01T00:00:00Z", new: "2026-10-03T00:00:00Z", mid: "2026-10-02T00:00:00Z" };
  assert.deepEqual(
    byRecentlyStarred(items, (x) => [x], starredAt),
    ["new", "mid", "old"],
  );
});

test("byRecentlyStarred uses the max starredAt across an item's ids", () => {
  const items = [
    { id: "g1", memberIds: ["a1", "a2"] },
    { id: "g2", memberIds: ["b1"] },
  ];
  const starredAt = { a1: "2026-10-01T00:00:00Z", a2: "2026-10-05T00:00:00Z", b1: "2026-10-03T00:00:00Z" };
  assert.deepEqual(
    byRecentlyStarred(items, (g) => g.memberIds, starredAt).map((g) => g.id),
    ["g1", "g2"],
  );
});

test("byRecentlyStarred puts items with no starredAt entry last", () => {
  const items = ["none", "starred"];
  const starredAt = { starred: "2026-10-01T00:00:00Z" };
  assert.deepEqual(
    byRecentlyStarred(items, (x) => [x], starredAt),
    ["starred", "none"],
  );
});

test("byRecentlyStarred keeps input order on equal timestamps", () => {
  const items = ["first", "second", "newest"];
  const same = "2026-10-01T00:00:00Z";
  const starredAt = { first: same, second: same, newest: "2026-10-02T00:00:00Z" };
  assert.deepEqual(
    byRecentlyStarred(items, (x) => [x], starredAt),
    ["newest", "first", "second"],
  );
});

test("byRecentlyStarred does not mutate the input array", () => {
  const items = ["b", "a"];
  const starredAt = { a: "2026-10-02T00:00:00Z", b: "2026-10-01T00:00:00Z" };
  const out = byRecentlyStarred(items, (x) => [x], starredAt);
  assert.deepEqual(items, ["b", "a"]);
  assert.notEqual(out, items);
});
