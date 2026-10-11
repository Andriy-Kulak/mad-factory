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
  /** Set when the diff for this file couldn't be read reliably; `reviewChanges` blocks it. */
  unreadable?: string;
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
const MIGRATION = /^supabase\/migrations\//;
/** What scripts/migrate.ts and the Supabase CLI expect; anything else under supabase/migrations/ is blocked. */
const MIGRATION_NAME = /^supabase\/migrations\/\d+_[a-z0-9_]+\.sql$/;
/** Where the ad-account write allowlists live. Widening them widens what any agent can do to a live account. */
const AD_WRITE_GUARDS = ["src/meta-ads/client.ts", "src/apple-ads/client.ts"];
const IDENT = String.raw`(?:"(?:[^"]|"")*"|[a-z_][\w$]*)`;
const NAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`;
const DESTRUCTIVE_SQL = new RegExp(
  [
    String.raw`\bdrop\s+(?!(?:trigger|index|constraint|default|not\s+null|identity|expression)\b)`,
    String.raw`\btruncate\b`,
    String.raw`\bdelete\s+from\b`,
    String.raw`\bupdate\s+(?:only\s+)?${NAME}\s*\*?(?:\s+(?:as\s+)?${IDENT})?\s+set\b`,
    String.raw`\bmerge\s+into\b`,
    String.raw`\b(?:disable|no\s+force)\s+row\s+level\s+security\b`,
    String.raw`\bgrant\b`,
    String.raw`\b(?:create|alter)\s+(?:or\s+replace\s+)?policy\b`,
  ].join("|"),
  "i",
);
const CREATE_TABLE = new RegExp(String.raw`\bcreate\s+(?:(?:global|local)\s+)?(?:(?:temp|temporary|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?(${NAME})`, "gi");
const ENABLE_RLS = new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${NAME})\s+enable\s+row\s+level\s+security\b`, "gi");
const LARGE_DIFF = 600;
const LARGE_NEW_FILE = 400;
const FEATURE_MAP = "docs/feature-map.md";

const isTest = (p: string) => /\.test\.ts$/.test(p);

/**
 * SQL with comments removed, read the way Postgres lexes it, so `--` or `/*` inside a string or quoted name is not a
 * comment. String and dollar-quoted bodies are either kept (themselves cleaned, since `do '...'`, `do $$...$$` and
 * `execute '...'` run them) or blanked. `backslash` reads `\'` as an escaped quote in every string, as Postgres does
 * with standard_conforming_strings off. Unterminated strings and comments are read as code.
 */
export function sqlCode(sql: string, opts: { strings: "keep" | "blank"; backslash: boolean }, depth = 0): string {
  const identChar = (c: string | undefined) => !!c && /[\w$]/.test(c);
  const body = (content: string) => (opts.strings === "blank" ? " " : ` ${depth < 8 ? sqlCode(content, opts, depth + 1) : content} `);
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      out += " ";
    } else if (c === "/" && next === "*") {
      let level = 0;
      let j = i;
      while (j < sql.length) {
        if (sql.startsWith("/*", j)) level++, (j += 2);
        else if (sql.startsWith("*/", j)) {
          level--;
          j += 2;
          if (level === 0) break;
        } else j++;
      }
      if (level > 0) (out += c), i++;
      else (out += " "), (i = j);
    } else if (c === "'") {
      const escapes = opts.backslash || (/[eE]/.test(sql[i - 1] ?? "") && !identChar(sql[i - 2]));
      let content = "";
      let j = i + 1;
      for (; j < sql.length; j++) {
        if (escapes && sql[j] === "\\") content += sql[++j] ?? "";
        else if (sql[j] === "'" && sql[j + 1] === "'") (content += "'"), j++;
        else if (sql[j] === "'") break;
        else content += sql[j];
      }
      out += body(content);
      i = j + 1;
    } else if (c === '"') {
      const m = /^"(?:[^"]|"")*"/.exec(sql.slice(i));
      const quoted = m ? m[0] : c;
      out += quoted;
      i += quoted.length;
    } else if (c === "$" && !identChar(sql[i - 1]) && /^\$(?:[A-Za-z_][\w]*)?\$/.test(sql.slice(i))) {
      const tag = /^\$(?:[A-Za-z_][\w]*)?\$/.exec(sql.slice(i))![0];
      const end = sql.indexOf(tag, i + tag.length);
      out += body(sql.slice(i + tag.length, end < 0 ? sql.length : end));
      i = end < 0 ? sql.length : end + tag.length;
    } else (out += c), i++;
  }
  return out;
}

/** Schema-qualified, case-folded table names captured by group 1 of a global regex. */
function tableNames(code: string, re: RegExp): string[] {
  return [...code.matchAll(re)].map((m) => {
    const parts = (m[1]!.match(/"(?:[^"]|"")*"|[^\s."]+/g) ?? []).map((p) => (p.startsWith('"') ? p.slice(1, -1).replace(/""/g, '"') : p.toLowerCase()));
    return (parts.length === 1 ? ["public", ...parts] : parts).join(".");
  });
}

/**
 * A supabase-js `.delete(...)` (any arguments, also `["delete"]`). A `name.delete(arg)` on a plain variable is a
 * Map/Set/cookie delete unless its argument is empty or an object literal (the supabase-js options form).
 */
function addsDbDelete(line: string): boolean {
  if (/\[\s*["'`]delete["'`]\s*\]/.test(line)) return true;
  for (const m of line.matchAll(/\.\s*delete\s*\(\s*(.?)/g)) {
    const receiver = line.slice(0, m.index).trimEnd();
    if (!receiver || /[)\]]$/.test(receiver)) return true;
    if (/(^|\.)cookies$/.test(receiver)) continue;
    if (m[1] === ")" || m[1] === "{" || m[1] === "") return true;
  }
  return false;
}

/** Checks a diff against the repo's hard rules. */
export function reviewChanges(files: ChangedFile[]): Finding[] {
  const out: Finding[] = [];
  let size = 0;

  for (const f of files) {
    if (!GENERATED.test(f.path)) size += f.added.length + f.removed;

    if (f.unreadable) out.push({ level: "block", path: f.path, message: `Couldn't read this file's diff (${f.unreadable}), so the rules weren't checked.` });

    if (MIGRATION.test(f.path)) {
      if (f.status !== "deleted" && !MIGRATION_NAME.test(f.path)) out.push({ level: "block", path: f.path, message: "Migration files must be named `<digits>_<lowercase_words>.sql`." });
      if (f.status !== "added") out.push({ level: "block", path: f.path, message: "Migrations are append-only once committed: add a new migration instead of editing or deleting this one." });
      const sql = f.added.join("\n");
      // Read both ways a string can end (standard_conforming_strings on or off), and flag what either reading finds.
      const code = [false, true].map((backslash) => sqlCode(sql, { strings: "keep", backslash }));
      if (code.some((c) => DESTRUCTIVE_SQL.test(c))) out.push({ level: "owner", path: f.path, message: "Destructive SQL (drop/truncate/delete/update/grant/policy): needs the owner's approval." });
      const enabled = [false, true].map((backslash) => tableNames(sqlCode(sql, { strings: "blank", backslash }), ENABLE_RLS));
      const missing = [...new Set(code.flatMap((c) => tableNames(c, CREATE_TABLE)))].filter((t) => !enabled.every((e) => e.includes(t)));
      if (missing.length) out.push({ level: "block", path: f.path, message: `Every new table must \`enable row level security\` in its migration (missing: ${missing.join(", ")}).` });
    }

    if (AD_WRITE_GUARDS.includes(f.path)) out.push({ level: "owner", path: f.path, message: "Changes the ad-account write guard: needs the owner's approval." });

    if (CODE_DIRS.test(f.path) && !isTest(f.path) && f.path !== "scripts/pr-review.ts" && f.added.some(addsDbDelete)) {
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

/** Reads one C-style quoted path as git writes it (`"a/x\\"y"`), returning it and the rest of the line. */
function readQuoted(s: string): [string, string] | null {
  if (!s.startsWith('"')) return null;
  const bytes: number[] = [];
  const simple: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  for (let i = 1; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"') return [Buffer.from(bytes).toString("utf8"), s.slice(i + 1)];
    if (c !== "\\") {
      bytes.push(...Buffer.from(c, "utf8"));
      continue;
    }
    const next = s[++i];
    if (next === undefined) return null;
    const octal = s.slice(i, i + 3);
    if (/^[0-3][0-7]{2}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 2;
    } else if (next in simple) bytes.push(simple[next]!);
    else return null;
  }
  return null;
}

/** The path in a `diff --git` header from a `--no-renames` diff (both sides are the same path), quoted or not. */
export function parseDiffHeader(line: string): string | null {
  if (!line.startsWith("diff --git ")) return null;
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const a = readQuoted(rest);
    if (!a || !a[1].startsWith(" ")) return null;
    const b = readQuoted(a[1].slice(1));
    if (!b || b[1] !== "" || !a[0].startsWith("a/") || !b[0].startsWith("b/")) return null;
    return a[0].slice(2) === b[0].slice(2) ? b[0].slice(2) : null;
  }
  const len = (rest.length - 5) / 2;
  if (!Number.isInteger(len) || len < 1) return null;
  const path = rest.slice(2, 2 + len);
  return rest === `a/${path} b/${path}` ? path : null;
}

/** Parses `git diff -U0 --no-renames` output. A header it can't read becomes an `unreadable` entry, never a skip. */
export function parseDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let cur: ChangedFile | null = null;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff ")) {
      const path = parseDiffHeader(line);
      cur = path === null ? { path: line, status: "modified", added: [], removed: 0, unreadable: "unrecognised diff header" } : { path, status: "modified", added: [], removed: 0 };
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

/** Parses `git diff --name-status -z --no-renames` output: NUL-separated, paths never quoted. */
export function parseNameStatus(out: string): { path: string; status: ChangedFile["status"] }[] {
  const parts = out.split("\0");
  const files: { path: string; status: ChangedFile["status"] }[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i]!;
    if (!code) break;
    files.push({ path: parts[i + 1]!, status: code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified" });
  }
  return files;
}

/** Joins the authoritative path list with the parsed diff; a path missing on either side is `unreadable`. */
export function mergeChanges(names: { path: string; status: ChangedFile["status"] }[], parsed: ChangedFile[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  const out: ChangedFile[] = [];
  for (const f of parsed) {
    if (f.unreadable || byPath.has(f.path)) out.push({ ...f, unreadable: f.unreadable ?? "listed twice in the diff" });
    else byPath.set(f.path, f);
  }
  for (const { path, status } of names) {
    const f = byPath.get(path);
    byPath.delete(path);
    out.push(f ? { ...f, status } : { path, status, added: [], removed: 0, unreadable: "missing from the diff" });
  }
  for (const f of byPath.values()) out.push({ ...f, unreadable: "not in git's list of changed files" });
  return out;
}

/** Collects the diff against a base, including untracked files and binary additions. */
export function collectChanges(base?: string, root = "."): { base: string; files: ChangedFile[] } {
  const run = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const git = (...args: string[]) => run(...args).trim();
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
  const names = parseNameStatus(run("diff", "--name-status", "-z", "--no-renames", resolvedBase));
  const parsed = parseDiff(run("-c", "core.quotePath=false", "diff", "--no-color", "--no-renames", "--no-ext-diff", "-U0", resolvedBase));
  const files = mergeChanges(names, parsed);
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
