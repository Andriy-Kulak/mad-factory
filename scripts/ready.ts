/**
 * The gate before a change counts as ready: verifies it, checks the diff against the hard rules, shows where the
 * product stands against its goal, and asks the Goal check questions the PR description answers.
 * Fails on a broken check, a hard-rule violation, or a change only the owner may approve (ad-account write guards,
 * destructive database changes) until it is rerun with --owner-approved after the owner said yes.
 *
 *   pnpm ready [--base <ref>] [--skip-checks] [--owner-approved] [--pr-title <text>] [--pr-body <file>] [--fix]
 */
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { GOAL_CHECK, collectChanges, formatFindings, goalCheckTemplate, reviewChanges } from "./pr-review.ts";
import { runPrivacy } from "./privacy.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    "skip-checks": { type: "boolean", default: false },
    "owner-approved": { type: "boolean", default: false },
    "pr-title": { type: "string" },
    "pr-body": { type: "string" },
    fix: { type: "boolean", default: false },
  },
});

let failed = false;

// 1. Verification.
const CHECKS: [string, string[]][] = [
  ["typecheck", ["typecheck"]],
  ["tests", ["test"]],
  ["db types up to date", ["db:types:check"]],
  ["web typecheck", ["--filter", "web", "typecheck"]],
];
console.log("== Checks");
if (values["skip-checks"]) console.log("  skipped (--skip-checks): not ready until they run");
else {
  for (const [name, args] of CHECKS) {
    const r = spawnSync("pnpm", ["-s", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const ok = r.status === 0;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) {
      failed = true;
      console.log(`${r.stdout}${r.stderr}`.trim().split("\n").slice(-25).map((l) => `       ${l}`).join("\n"));
    }
  }
}

// 2. The diff against the base branch, uncommitted and untracked files included.
const { base, files } = collectChanges(values.base);
const findings = reviewChanges(files);
const added = files.reduce((a, f) => a + f.added.length, 0);
const removed = files.reduce((a, f) => a + f.removed, 0);
console.log(`\n== Diff against ${base.slice(0, 10)}: ${files.length} file(s), +${added} −${removed}`);
console.log(findings.length ? formatFindings(findings).join("\n") : "  no rule violations");
if (findings.some((f) => f.level === "block")) failed = true;
if (findings.some((f) => f.level === "owner")) {
  if (values["owner-approved"]) console.log("  → Owner approval given (--owner-approved): say where in the PR's Risk answer.");
  else {
    failed = true;
    console.log("  → Only the owner can approve this. Ask them; once they say yes, rerun with --owner-approved (in CI the owner adds the `owner-approved` label).");
  }
}

// 3. Private product and client terms must not appear in git history or PR text.
const privacyFindings = await runPrivacy({
  base: values.base ?? base,
  prTitle: values["pr-title"] ?? process.env.PR_TITLE,
  prBodyFile: values["pr-body"],
  prBody: values["pr-body"] ? undefined : process.env.PR_BODY,
  branch: process.env.PR_BRANCH,
  fix: values.fix ?? false,
  reveal: !process.env.CI,
  root: process.cwd(),
});
if (privacyFindings.length) console.log(formatFindings(privacyFindings).join("\n"));
else console.log("  no private terms found");
if (privacyFindings.some((finding) => finding.level === "block")) failed = true;

// 4. Where each product stands against its goal (needs the database; skipped without credentials).
console.log("\n== Goal");
if (!process.env.SUPABASE_URL) console.log("  no database credentials here; run `pnpm scorecard --product <slug>` where .env exists");
else {
  try {
    const { getDb, listProductGoals } = await import("../src/db/index.ts");
    const { scorecardFor } = await import("../src/scorecard/load.ts");
    const { scorecardHeadline } = await import("../src/scorecard/scorecard.ts");
    const goals = await listProductGoals();
    if (!goals.length) console.log("  no product has a goal yet: pnpm scorecard goal --product <slug> --target <amount>");
    for (const g of goals) {
      const slug = (await getDb().from("products").select("slug").eq("id", g.product_id).single()).data?.slug ?? g.product_id;
      console.log(`  ${scorecardHeadline(await scorecardFor({ id: g.product_id, slug }))}`);
    }
  } catch (e) {
    console.log(`  scorecard unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// 5. The questions, answered in the PR description.
console.log("\n== Answer these honestly before calling it ready. If an answer is weak, fix the change, not the answer.");
for (const q of GOAL_CHECK) console.log(`  ${q.label}: ${q.question}`);
console.log(`\nPut your answers in the PR description:\n\n${goalCheckTemplate()}\n`);
console.log(failed ? "NOT READY: fix the failures above." : values["skip-checks"] ? "Checks skipped: not ready yet." : "Checks pass. Ready once the Goal check is answered.");
process.exit(failed || values["skip-checks"] ? 1 : 0);
