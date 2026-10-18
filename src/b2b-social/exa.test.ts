import assert from "node:assert/strict";
import { test } from "node:test";
import type { B2BPersonRow } from "../db/types.ts";
import { applyLinkedInBatch, applyLinkedInTitle, applyXMatch, applyXMatchBatch, exaAgentRun, exaCandidates, parseEmployees } from "./exa.ts";

const person = (url: string, patch: Partial<B2BPersonRow> = {}): B2BPersonRow => ({
  id: url,
  product_id: "00000000-0000-0000-0000-000000000001",
  url,
  name: null,
  linkedin_url: null,
  location: null,
  bio: null,
  followers: null,
  found: true,
  title: null,
  employer: null,
  employer_url: null,
  company_size: null,
  company_employees: null,
  company_domain: null,
  industry: null,
  fortune500_rank: null,
  yc_batch: null,
  enriched_at: null,
  exa_checked_at: null,
  first_seen_at: "2026-01-01T00:00:00.000Z",
  ...patch,
});

test("exaCandidates includes big companies and signal commenters, excluding cheer, insiders and checked people", () => {
  const big = person("https://www.linkedin.com/in/big", { company_employees: 10_000, first_seen_at: "2026-01-05T00:00:00.000Z" });
  const signal = person("https://www.linkedin.com/in/signal", { first_seen_at: "2026-01-02T00:00:00.000Z" });
  const xSignal = person("https://x.com/signal", { first_seen_at: "2026-01-03T00:00:00.000Z" });
  const cheer = person("https://www.linkedin.com/in/cheer");
  const insider = person("https://www.linkedin.com/in/insider");
  const team = person("https://www.linkedin.com/in/team", { company_employees: 20_000 });
  const checked = person("https://www.linkedin.com/in/checked", { fortune500_rank: 1, exa_checked_at: "2026-01-04T00:00:00.000Z" });
  const sources = [
    { id: "company-source", label: "Sample Org", config: { group: "company", url: "https://www.linkedin.com/company/sample" } },
    { id: "team-source", label: "Team Profile", config: { group: "team", url: team.url } },
    { id: "competitor-source", label: "Other Org", config: { group: "competitor", url: "https://www.linkedin.com/company/other" } },
  ];
  const posts = [
    { id: "signal-post", tracked_source_id: "competitor-source" },
    { id: "cheer-post", tracked_source_id: "company-source" },
    { id: "insider-post", tracked_source_id: "company-source" },
    { id: "x-post", tracked_source_id: "competitor-source" },
  ];
  const comments = [
    { post_id: "signal-post", author_url: signal.url, text: "Can it handle this workflow?" },
    { post_id: "cheer-post", author_url: cheer.url, text: "Congrats!" },
    { post_id: "insider-post", author_url: insider.url, text: "Proud of our team." },
    { post_id: "x-post", author_url: xSignal.url, text: "We use this every day." },
  ];

  const result = exaCandidates([big, signal, xSignal, cheer, insider, team, checked], comments, { posts, sources });
  assert.deepEqual(
    result.linkedin.map((row) => row.url),
    [big.url, signal.url],
  );
  assert.deepEqual(
    result.x.map((row) => row.url),
    [xSignal.url],
  );
});

test("applyLinkedInTitle rejects a different profile and replaces changed employer fields", () => {
  const existing = person("https://www.linkedin.com/in/worker", {
    employer: "Old Org",
    employer_url: "https://www.linkedin.com/company/old",
    company_size: "10,001+ employees",
    company_employees: 10_001,
    company_domain: "old.example",
    industry: "old industry",
    yc_batch: "W20",
    fortune500_rank: 99,
  });
  const f500 = (company: string | null | undefined) => (company === "New Org" ? 12 : null);
  assert.equal(
    applyLinkedInTitle(existing, { linkedin_url: "https://www.linkedin.com/in/someone-else", current_title: "Lead", current_company: "New Org" }, f500, () => null),
    null,
  );
  assert.equal(
    applyLinkedInTitle(existing, { linkedin_url: null, current_title: "Lead", current_company: "New Org" }, f500, () => null),
    null,
  );
  assert.deepEqual(
    applyLinkedInTitle(existing, { linkedin_url: existing.url, current_title: "Director", current_company: "New Org" }, f500, () => null),
    {
      title: "Director",
      employer: "New Org",
      fortune500_rank: 12,
      employer_url: null,
      company_size: null,
      company_employees: null,
      company_domain: null,
      industry: null,
      yc_batch: null,
    },
  );
});

test("applyLinkedInTitle keeps company metadata when Fiber confirms the same employer", () => {
  const existing = person("https://www.linkedin.com/in/worker", {
    employer: "Sample Org",
    company_domain: "sample.dev",
    company_employees: 500,
    yc_batch: "W25",
  });
  assert.deepEqual(
    applyLinkedInTitle(
      existing,
      { linkedin_url: existing.url, current_title: "Engineer", current_company: "Sample Org" },
      () => null,
      () => null,
    ),
    { title: "Engineer" },
  );
});

test("LinkedIn batch outputs apply by canonical profile URL when Exa reorders them", () => {
  const alpha = person("https://www.linkedin.com/in/alpha");
  const beta = person("https://www.linkedin.com/in/beta");
  const patches = applyLinkedInBatch(
    [alpha, beta],
    [
      { linkedin_url: `${beta.url}/`, current_title: "Beta title", current_company: "" },
      { linkedin_url: alpha.url, current_title: "Alpha title", current_company: "" },
    ],
    () => null,
    () => null,
  );
  assert.equal(patches.get(alpha.url)?.title, "Alpha title");
  assert.equal(patches.get(beta.url)?.title, "Beta title");
});

test("LinkedIn batch skips null profile URLs and still applies valid outputs", () => {
  const alpha = person("https://www.linkedin.com/in/alpha");
  const beta = person("https://www.linkedin.com/in/beta");
  const patches = applyLinkedInBatch(
    [alpha, beta],
    [
      { linkedin_url: null, current_title: "Alpha title", current_company: "" },
      { linkedin_url: beta.url, current_title: "Beta title", current_company: "" },
    ],
    () => null,
    () => null,
  );
  assert.equal(patches.get(alpha.url), null);
  assert.equal(patches.get(beta.url)?.title, "Beta title");
});

test("applyXMatch validates confidence and handle, then maps company fields and YC from the list", () => {
  const existing = person("https://x.com/demo");
  const output = {
    x_handle: "demo",
    linkedin_url: "https://www.linkedin.com/in/demo/",
    current_title: "Staff Engineer",
    current_employer: "Sample Org",
    confidence: "high" as const,
    employer_domain: "https://www.sample.dev/about",
    employer_employee_count: "10,001+",
  };
  assert.equal(
    applyXMatch(
      existing,
      { ...output, confidence: "low" },
      () => 7,
      () => "W25",
    ),
    null,
  );
  assert.equal(
    applyXMatch(
      existing,
      { ...output, x_handle: "different" },
      () => 7,
      () => "W25",
    ),
    null,
  );
  assert.equal(
    applyXMatch(
      existing,
      { ...output, x_handle: null },
      () => 7,
      () => "W25",
    ),
    null,
  );
  assert.deepEqual(
    applyXMatch(
      existing,
      output,
      () => 7,
      (domain) => (domain === "sample.dev" ? "W25" : null),
    ),
    {
      linkedin_url: "https://www.linkedin.com/in/demo",
      title: "Staff Engineer",
      employer: "Sample Org",
      company_domain: "sample.dev",
      company_employees: 10_001,
      fortune500_rank: 7,
      yc_batch: "W25",
    },
  );
});

test("X batch outputs apply by normalized handle when Exa reorders them", () => {
  const alpha = person("https://x.com/alpha");
  const beta = person("https://x.com/beta");
  const patches = applyXMatchBatch(
    [alpha, beta],
    [
      {
        x_handle: "@beta",
        linkedin_url: "https://www.linkedin.com/in/beta",
        current_title: "Beta title",
        current_employer: "",
        confidence: "high",
      },
      {
        x_handle: "alpha",
        linkedin_url: "https://www.linkedin.com/in/alpha",
        current_title: "Alpha title",
        current_employer: "",
        confidence: "high",
      },
    ],
    () => null,
    () => null,
  );
  assert.equal(patches.get(alpha.url)?.linkedin_url, "https://www.linkedin.com/in/alpha");
  assert.equal(patches.get(alpha.url)?.title, "Alpha title");
  assert.equal(patches.get(beta.url)?.linkedin_url, "https://www.linkedin.com/in/beta");
  assert.equal(patches.get(beta.url)?.title, "Beta title");
});

test("X batch skips null handles and still applies valid outputs", () => {
  const alpha = person("https://x.com/alpha");
  const beta = person("https://x.com/beta");
  const patches = applyXMatchBatch(
    [alpha, beta],
    [
      {
        x_handle: null,
        linkedin_url: "https://www.linkedin.com/in/alpha",
        current_title: "Alpha title",
        current_employer: "",
        confidence: "high",
      },
      {
        x_handle: "@beta",
        linkedin_url: "https://www.linkedin.com/in/beta",
        current_title: "Beta title",
        current_employer: "",
        confidence: "high",
      },
    ],
    () => null,
    () => null,
  );
  assert.equal(patches.get(alpha.url), null);
  assert.equal(patches.get(beta.url)?.linkedin_url, "https://www.linkedin.com/in/beta");
});

test("parseEmployees reads the first numeric employee count", () => {
  assert.equal(parseEmployees("10,001+"), 10_001);
  assert.equal(parseEmployees("1001-5000"), 1001);
  assert.equal(parseEmployees(""), null);
  assert.equal(parseEmployees("unknown"), null);
});

test("exaAgentRun creates, polls and returns structured output with cost", async () => {
  const previousKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-key";
  const states = [
    { id: "run-1", status: "running" },
    { id: "run-1", status: "completed", output: { structured: { people: [] } }, costDollars: { total: 0.045 } },
  ];
  const fetchImpl = (async () => {
    const state = states.shift();
    return new Response(JSON.stringify(state ?? {}), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await exaAgentRun<{ people: unknown[] }>({ query: "test" }, { pollMs: 0, fetchImpl });
    assert.deepEqual(result, { structured: { people: [] }, costUsd: 0.045 });
  } finally {
    if (previousKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previousKey;
  }
});

test("exaAgentRun throws when a run fails", async () => {
  const previousKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-key";
  const states = [
    { id: "run-2", status: "running" },
    { id: "run-2", status: "failed", message: "provider failed" },
  ];
  const fetchImpl = (async () => new Response(JSON.stringify(states.shift() ?? {}), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(exaAgentRun({ query: "test" }, { pollMs: 0, fetchImpl }), /run run-2 failed: provider failed/);
  } finally {
    if (previousKey === undefined) delete process.env.EXA_API_KEY;
    else process.env.EXA_API_KEY = previousKey;
  }
});
