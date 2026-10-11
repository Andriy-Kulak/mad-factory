import assert from "node:assert/strict";
import { test } from "node:test";
import { docFromFile, productDocFromFile } from "./product-docs.ts";

test("docFromFile maps README.md to the readme doc at sort zero", () => {
  assert.deepEqual(docFromFile("README.md", "# Overview\n\nGeneric guidance."), {
    name: "readme",
    title: "Overview",
    sort: 0,
    body_md: "# Overview\n\nGeneric guidance.",
  });
});

test("docFromFile maps numbered markdown names and reads the first heading", () => {
  assert.deepEqual(docFromFile("02-audiences.md", "intro\n# Audiences ##\n\nMore."), {
    name: "audiences",
    title: "Audiences",
    sort: 2,
    body_md: "intro\n# Audiences ##\n\nMore.",
  });
});

test("docFromFile uses an unnumbered basename at sort one hundred", () => {
  assert.deepEqual(docFromFile("brand.md", "No heading here."), {
    name: "brand",
    title: null,
    sort: 100,
    body_md: "No heading here.",
  });
});

test("productDocFromFile uses kind defaults for non-brand documents", () => {
  assert.deepEqual(productDocFromFile("experiments/plans/sample.json", '{"plan":true}', "plan"), {
    name: "sample",
    title: null,
    sort: 0,
    body_md: '{"plan":true}',
  });
  assert.deepEqual(productDocFromFile("research/sample.md", "# Research\n\nNotes.", "research"), {
    name: "sample",
    title: "Research",
    sort: 100,
    body_md: "# Research\n\nNotes.",
  });
});

test("productDocFromFile preserves brand mappings and applies explicit overrides", () => {
  assert.deepEqual(productDocFromFile("02-audiences.md", "# Audiences\n", "brand", { name: "audience-notes", title: "Custom" }), {
    name: "audience-notes",
    title: "Custom",
    sort: 2,
    body_md: "# Audiences\n",
  });
});
