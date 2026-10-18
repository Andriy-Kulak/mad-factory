import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { activityTime, bioJob, canonicalLinkedIn, commentsDue, fortune500Matcher, ycMatcher } from "./enrich.ts";

test("commentsDue: X is incremental; LinkedIn gets an early check and one 48-hour recheck", () => {
  const now = new Date("2026-01-10T12:00:00.000Z");
  const post = (postedAt: string, checked: string | null = null, platform: "x" | "linkedin" = "x") => ({ platform, posted_at: postedAt, replies_checked_at: checked });
  assert.equal(commentsDue(post("2026-01-10T11:00:00.000Z"), now), true, "fresh X post");
  assert.equal(commentsDue(post("2026-01-10T11:00:00.000Z", "2026-01-10T11:50:00.000Z"), now), true, "X checks use since_id");
  assert.equal(commentsDue(post("2026-01-02T12:00:00.000Z"), now), false, "past X's 7 days");
  assert.equal(commentsDue(post("2026-01-10T11:00:00.000Z", null, "linkedin"), now), true, "fresh LinkedIn post");
  assert.equal(commentsDue(post("2026-01-07T12:00:00.000Z", "2026-01-07T13:00:00.000Z", "linkedin"), now), true, "early check gets one recheck");
  assert.equal(commentsDue(post("2026-01-07T12:00:00.000Z", "2026-01-07T13:00:00.000Z", "linkedin"), new Date("2026-01-08T12:00:00.000Z")), false, "recheck waits until 48 hours");
  assert.equal(commentsDue(post("2026-01-07T12:00:00.000Z", "2026-01-09T13:00:00.000Z", "linkedin"), now), false, "checked after 48 hours");
  assert.equal(commentsDue(post("2025-12-26T12:00:00.000Z", null, "linkedin"), now), false, "past LinkedIn's 14 days");
});

test("bioJob reads a current job and skips former ones", () => {
  assert.deepEqual(bioJob("Head of Platform at Example Labs. Dad."), { title: "Head of Platform", company: "Example Labs" });
  assert.deepEqual(bioJob("AI Stuff @samplehq"), null);
  assert.deepEqual(bioJob("Staff engineer @Sample | runner"), { title: "Staff engineer", company: "Sample" });
  assert.equal(bioJob("ex-CTO at Sample"), null);
  assert.equal(bioJob(null), null);
});

test("fortune500Matcher and ycMatcher read the local lists, and are inert without them", () => {
  const dir = mkdtempSync(join(tmpdir(), "b2b-"));
  writeFileSync(join(dir, "f500.csv"), 'Rank,Company Name,Industry\n12,"Example Holdings, Inc.",Retail\n30,JPMorgan Chase,Banks\n');
  writeFileSync(join(dir, "yc.csv"), "domain,batch\nsample.dev,Winter 2026\n");
  const f500 = fortune500Matcher(join(dir, "f500.csv"));
  assert.equal(f500("Example"), 12);
  assert.equal(f500("JPMorgan"), 30);
  assert.equal(f500("Nobody"), null);
  assert.equal(fortune500Matcher(null)("Example"), null);
  const yc = ycMatcher(join(dir, "yc.csv"));
  assert.equal(yc("sample.dev"), "Winter 2026");
  assert.equal(yc("other.dev"), null);
});

test("activityTime and canonicalLinkedIn", () => {
  assert.equal(activityTime("7412281402982400000"), "2026-01-01T00:00:00.000Z");
  assert.equal(activityTime("abc"), null);
  assert.equal(canonicalLinkedIn("https://uk.linkedin.com/in/someone/?x=1"), "https://www.linkedin.com/in/someone");
  assert.equal(canonicalLinkedIn("https://example.com/in/x"), null);
});
