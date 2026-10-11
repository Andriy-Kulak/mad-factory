/**
 * What `pnpm ready` checks before a change counts as ready: the diff against the repo's hard rules, and the
 * Goal check questions the PR description answers. Node built-ins only.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  added: string[];
  removed: number;
}

/** block = `pnpm ready` fails; owner = fails until the owner says yes (`--owner-approved`); warn = answer it in the Goal check. */
export interface Finding {
  level: "block" | "owner" | "warn";
  path: string;
  message: string;
}

/** The questions an agent answers before calling a PR ready. Labels are what the PR description must contain. */
export const GOAL_CHECK = [
  {
    label: "Goal",
    question:
      "Which `pnpm brief` number does this move (profit, proceeds, ad spend, trials, cost per trial), or which bottleneck in the marketing loop does it remove (speed, safety, data freshness)? How will we see it?",
  },
  { label: "Smallest change", question: "Is this the smallest change that gets that effect? What did you deliberately leave out?" },
  {
    label: "Fits the codebase",
    question:
      "Which existing modules and patterns did you reuse? Did you add a second way to do something that already has one, an abstraction with a single caller, a new dependency, or a file nobody will find?",
  },
  {
    label: "Verification",
    question:
      "What did you run and what did it show (tests, a real CLI run against the database, `pnpm db:audit`)? Paste the evidence, not a claim. If anything visual changed (web/ pages, components, styles), embed before/after screenshots.",
  },
  {
    label: "Risk",
    question: `Does this write to an ad account, change the ad-account write guards, or delete/alter stored data? If yes, do not merge until the owner says yes. Otherwise say "None".`,
  },
  {
    label: "Privacy",
    question:
      "Did you read the whole diff, every commit message and the PR title and description, and remove anything specific to a product, client or campaign (names, keywords, bids, budgets, countries, results)?",
  },
  { label: "Lessons", question: 'Did the owner correct you along the way? Turn the correction into a test, a check in scripts/pr-review.ts, or a line in CLAUDE.md, and say which. Otherwise "None".' },
] as const;

export function goalCheckTemplate(): string {
  return ["## Goal check", "", ...GOAL_CHECK.flatMap((q) => [`**${q.label}:** <!-- ${q.question} -->`, ""])].join("\n").trimEnd();
}

const CODE_DIRS = /^(src|scripts|web|playbooks|examples|\.github)\//;
const GENERATED = /(^|\/)(database\.types\.ts|pnpm-lock\.yaml)$/;
const MIGRATION = /^supabase\/migrations\/.+\.sql$/;
/** Where the ad-account write allowlists live. Widening them widens what any agent can do to a live account. */
const AD_WRITE_GUARDS = ["src/meta-ads/client.ts", "src/apple-ads/client.ts"];
const DESTRUCTIVE_SQL =
  /\b(drop\s+(table|column|schema|view|materialized\s+view|function|type)|truncate|delete\s+from|disable\s+row\s+level\s+security)\b|\balter\s+table\b[^;]*\bdrop\b(?!\s+(constraint|default|not\s+null))|\bupdate\s+\w+\s+set\b/i;
const DELETE_CALL = /\.delete\(\s*\)/;
const LARGE_DIFF = 600;
const LARGE_NEW_FILE = 400;
const FEATURE_MAP = "docs/feature-map.md";

const isTest = (p: string) => /\.test\.ts$/.test(p);

/** Checks a diff against the repo's hard rules. */
export function reviewChanges(files: ChangedFile[]): Finding[] {
  const out: Finding[] = [];
  let size = 0;

  for (const f of files) {
    if (!GENERATED.test(f.path)) size += f.added.length + f.removed;

    if (MIGRATION.test(f.path)) {
      if (f.status !== "added") out.push({ level: "block", path: f.path, message: "Migrations are append-only once committed: add a new migration instead of editing or deleting this one." });
      const sql = f.added.map((l) => l.replace(/--.*$/, "")).join("\n");
      if (DESTRUCTIVE_SQL.test(sql)) out.push({ level: "owner", path: f.path, message: "Destructive SQL (drop/truncate/delete/update): needs the owner's approval." });
      if (/\bcreate\s+table\b/i.test(sql) && !/enable\s+row\s+level\s+security/i.test(sql))
        out.push({ level: "block", path: f.path, message: "Every new table must `enable row level security` in its migration." });
    }

    if (AD_WRITE_GUARDS.includes(f.path)) out.push({ level: "owner", path: f.path, message: "Changes the ad-account write guard: needs the owner's approval." });

    if (CODE_DIRS.test(f.path) && !isTest(f.path) && f.path !== "scripts/pr-review.ts" && f.added.some((l) => DELETE_CALL.test(l))) {
      out.push({ level: "owner", path: f.path, message: "Adds a database delete: needs the owner's approval." });
    }

    if (/(^|\/)package\.json$/.test(f.path) && f.added.some((l) => /^\s*"[^"]+":\s*"(\^|~|\d|workspace:|npm:|github:)/.test(l))) {
      out.push({ level: "warn", path: f.path, message: 'Adds or changes a dependency: say why in "Fits the codebase".' });
    }

    if (f.status === "added" && !GENERATED.test(f.path) && /\.(ts|tsx)$/.test(f.path) && !isTest(f.path) && f.added.length > LARGE_NEW_FILE) {
      out.push({ level: "warn", path: f.path, message: `New file with ${f.added.length} lines: could it be smaller or split by responsibility?` });
    }
  }
  if (size > LARGE_DIFF) out.push({ level: "warn", path: "(diff)", message: `${size} changed lines (generated files excluded): could this be several smaller PRs?` });

  const touchesCli = files.some((f) => /^src\/cli\//.test(f.path) && f.status !== "deleted");
  const addsPage = files.some((f) => f.status === "added" && /^web\/app\/.+\/page\.tsx$/.test(f.path));
  if ((touchesCli || addsPage) && !files.some((f) => f.path === FEATURE_MAP)) {
    out.push({ level: "warn", path: FEATURE_MAP, message: "update docs/feature-map.md" });
  }
  return out;
}

/** Parses `git diff -U0 --no-renames` output. */
export function parseDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let cur: ChangedFile | null = null;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const head = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (head) {
      cur = { path: head[2]!, status: "modified", added: [], removed: 0 };
      files.push(cur);
      inHunk = false;
    } else if (!cur) continue;
    else if (line.startsWith("@@")) inHunk = true;
    else if (!inHunk) {
      if (line.startsWith("new file mode")) cur.status = "added";
      else if (line.startsWith("deleted file mode")) cur.status = "deleted";
    } else if (line.startsWith("+")) cur.added.push(line.slice(1));
    else if (line.startsWith("-")) cur.removed++;
  }
  return files;
}

/** Collects the diff against a base, including untracked files and binary additions. */
export function collectChanges(base?: string, root = "."): { base: string; files: ChangedFile[] } {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  const resolvedBase =
    base ??
    (() => {
      for (const ref of ["origin/main", "main"]) {
        try {
          return git("merge-base", "HEAD", ref);
        } catch {}
      }
      throw new Error("No main or origin/main to compare against; pass --base <ref>");
    })();
  const files: ChangedFile[] = parseDiff(git("diff", "--no-color", "--no-renames", "-U0", resolvedBase));
  for (const path of git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean)) {
    let text = "";
    try {
      text = readFileSync(`${root}/${path}`, "utf8");
    } catch {}
    // Binary files (images, fonts) have no lines worth checking.
    files.push({ path, status: "added", added: text.includes("\0") ? [] : text.split("\n"), removed: 0 });
  }
  return { base: resolvedBase, files };
}

export function formatFindings(findings: Finding[]): string[] {
  const tag = { block: "BLOCKED", owner: "OWNER APPROVAL", warn: "warning" } as const;
  return findings.map((f) => `  [${tag[f.level]}] ${f.path}: ${f.message}`);
}
