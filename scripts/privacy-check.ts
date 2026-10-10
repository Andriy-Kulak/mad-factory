/**
 * Checks changed files, history, branch name and PR text for private values.
 *   pnpm privacy [--all] [--base <ref>] [--pr-title <text>] [--pr-body <file>] [--fix]
 */
import { parseArgs } from "node:util";
import { formatFindings } from "./pr-review.ts";
import { runPrivacy } from "./privacy.ts";

const { values } = parseArgs({
  options: {
    all: { type: "boolean", default: false },
    base: { type: "string" },
    "pr-title": { type: "string" },
    "pr-body": { type: "string" },
    fix: { type: "boolean", default: false },
  },
});
const findings = await runPrivacy({
  base: values.base,
  all: values.all,
  prTitle: values["pr-title"] ?? process.env.PR_TITLE,
  prBodyFile: values["pr-body"],
  prBody: values["pr-body"] ? undefined : process.env.PR_BODY,
  branch: process.env.PR_BRANCH,
  fix: values.fix ?? false,
  reveal: !process.env.CI,
  root: process.cwd(),
});
if (findings.length) console.log(formatFindings(findings).join("\n"));
process.exit(findings.some((finding) => finding.level === "block") ? 1 : 0);
