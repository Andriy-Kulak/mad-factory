import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChangedFile, Finding } from "./pr-review.ts";
import { collectChanges } from "./pr-review.ts";

const SOURCES = ["local file", "PRIVATE_TERMS", "database"] as const;

export const FRAMEWORK_WORDS = new Set([
  "vocabulary",
  "product",
  "brand",
  "angle",
  "angles",
  "audience",
  "audiences",
  "hook",
  "hooks",
  "format",
  "desire",
  "desires",
  "creative",
  "campaign",
  "campaigns",
  "keyword",
  "keywords",
  "discovery",
  "generic",
  "competitor",
  "competitors",
]);

/** Matches a private value without matching it inside a longer word or number. */
export function termPattern(term: string): RegExp {
  const trimmed = term.trim();
  if (/^\d+$/.test(trimmed)) return new RegExp(`(?<![0-9])${trimmed}(?![0-9])`, "i");
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-\s_]+/g, "[-\\s_]?");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
}

function termValue(value: string): string {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const id = url.searchParams.get("id");
    const lastSegment = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    return id ?? decodeURIComponent(lastSegment);
  } catch {
    return trimmed;
  }
}

export function stripNote(value: string): string {
  const trimmed = value.trim();
  const withoutNote = trimmed.split("(", 1)[0]?.trim() ?? "";
  return withoutNote || trimmed;
}

/** Extracts nontrivial terms, normalizing profile URLs and Meta ad-account IDs. */
export function termsFrom(values: string[], allowed: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const allowedLower = new Set([...allowed].map((term) => term.toLowerCase()));
  const add = (value: string) => {
    const term = value.trim();
    const key = term.toLowerCase();
    if (term.length < 3 || allowedLower.has(key) || FRAMEWORK_WORDS.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(term);
  };
  for (const value of values) {
    const term = termValue(value);
    add(term);
    const accountId = term.match(/^act_(\d+)$/i)?.[1];
    if (accountId) add(accountId);
  }
  return out;
}

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const entry of value) allStrings(entry, out);
  else if (value && typeof value === "object") for (const entry of Object.values(value)) allStrings(entry, out);
  return out;
}

function readAllowed(root: string): Set<string> {
  try {
    const allowed = new Set<string>();
    for (const value of allStrings(JSON.parse(readFileSync(join(root, "examples/product.example.json"), "utf8")))) {
      allowed.add(value.trim().toLowerCase());
      allowed.add(stripNote(value).toLowerCase());
    }
    return allowed;
  } catch {
    return new Set();
  }
}

function readLocalTerms(root: string): string[] {
  try {
    return readFileSync(join(root, "local/private-terms.txt"), "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trimStart().startsWith("#"));
  } catch {
    return [];
  }
}

function envTerms(): string[] {
  return (process.env.PRIVATE_TERMS ?? "")
    .split(/[\n,]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

export function databaseValues(input: {
  products: { slug: string; name: string; competitors: string[] | null }[];
  sources: { value: string; label: string | null; enabled: boolean }[];
  competitorKeywords: string[];
}): string[] {
  const products = input.products.flatMap(({ slug, name, competitors }) => [slug, name, ...(competitors ?? []).map(stripNote)]);
  const sources = input.sources.flatMap(({ value, label, enabled }) => [value, ...(enabled && label !== null ? [stripNote(label)] : [])]);
  return [...products, ...sources, ...input.competitorKeywords];
}

async function databaseTerms(): Promise<string[]> {
  if (!process.env.SUPABASE_URL) return [];
  try {
    const { getDb } = await import("../src/db/index.ts");
    const db = getDb();
    const [products, sources] = await Promise.all([db.from("products").select("slug,name,competitors"), db.from("tracked_sources").select("value,label,enabled")]);
    if (products.error || sources.error) throw new Error("query failed");
    const campaigns = await db.from("experiment_campaigns").select("external_campaign_id").eq("channel", "apple_ads").eq("role", "competitors");
    if (campaigns.error) throw new Error("query failed");
    const campaignIds = (campaigns.data ?? []).map((campaign) => Number(campaign.external_campaign_id));
    let competitorKeywords: string[] = [];
    if (campaignIds.length) {
      const keywords = await db.from("apple_ads_keywords").select("text").in("campaign_id", campaignIds).eq("is_negative", false);
      if (keywords.error) throw new Error("query failed");
      competitorKeywords = (keywords.data ?? []).map((keyword) => keyword.text);
    }
    return databaseValues({ products: products.data ?? [], sources: sources.data ?? [], competitorKeywords });
  } catch {
    console.warn("Warning: could not load database private terms; continuing.");
    return [];
  }
}

/** Loads private terms from ignored local data, the environment, and the database. */
export async function privateTerms(root = "."): Promise<{ terms: string[]; counts: Record<string, number> }> {
  const allowed = readAllowed(root);
  const database = await databaseTerms();
  const values = [
    [SOURCES[0], readLocalTerms(root)],
    [SOURCES[1], envTerms()],
    [SOURCES[2], database],
  ] as const;
  const terms: string[] = [];
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  for (const [source, sourceValues] of values) {
    const extracted = termsFrom([...sourceValues], allowed);
    counts[source] = extracted.length;
    for (const term of extracted) {
      const key = term.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        terms.push(term);
      }
    }
  }
  return { terms, counts };
}

function matcher(term: string): RegExp {
  const pattern = termPattern(term);
  return new RegExp(pattern.source, "gi");
}

function containsTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => matcher(term).test(text));
}

/** Replaces every private term with a safe placeholder. */
export function redact(text: string, terms: string[]): string {
  return [...terms].sort((a, b) => b.length - a.length).reduce((value, term) => value.replace(matcher(term), "[redacted]"), text);
}

function location(where: string, reveal: boolean, terms: string[]): string {
  return reveal ? where : redact(where, terms);
}

function message(term: string, where: string, text: string, reveal: boolean, terms: string[]): string {
  const shownTerm = reveal ? term : "[masked]";
  const excerpt = reveal ? `: "${text.replace(/\s+/g, " ").trim().slice(0, 100)}"` : "";
  return `Private term "${shownTerm}" at ${where} belongs in the database; it must not appear in git or PR text${excerpt}.`;
}

/** Checks changed lines and file paths. */
export function scanDiff(files: ChangedFile[], terms: string[], reveal: boolean): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.status === "deleted") continue;
    for (const term of terms) {
      if (matcher(term).test(file.path)) {
        const where = "file path";
        findings.push({ level: "block", path: location(file.path, reveal, terms), message: message(term, where, file.path, reveal, terms) });
      }
      file.added.forEach((line, index) => {
        if (matcher(term).test(line)) {
          const where = `added line ${index + 1}`;
          findings.push({ level: "block", path: location(file.path, reveal, terms), message: message(term, where, line, reveal, terms) });
        }
      });
    }
  }
  return findings;
}

/** Checks commit messages, branch names and PR text without revealing matching text when requested. */
export function scanText(sources: { where: string; text: string }[], terms: string[], reveal: boolean): Finding[] {
  const findings: Finding[] = [];
  for (const source of sources) {
    for (const term of terms) {
      const pattern = matcher(term);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source.text))) {
        const lineNumber = source.text.slice(0, match.index).split("\n").length;
        const where = source.text.includes("\n") ? `${source.where}, line ${lineNumber}` : source.where;
        const excerpt = source.text.slice(Math.max(0, match.index - 40), Math.min(source.text.length, match.index + match[0].length + 60));
        findings.push({ level: "block", path: location(source.where, reveal, terms), message: message(term, where, excerpt, reveal, terms) });
      }
    }
  }
  return findings;
}

type CommitMessage = { hash: string; text: string };

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function commitsSince(base: string, root: string): CommitMessage[] {
  const output = git(root, "log", "--reverse", "--format=%h%x00%B%x1e", `${base}..HEAD`);
  const commits: CommitMessage[] = [];
  for (const record of output.split("\x1e")) {
    const clean = record.replace(/^\s+|\s+$/g, "");
    const separator = clean.indexOf("\0");
    if (separator < 0) continue;
    commits.push({ hash: clean.slice(0, separator), text: clean.slice(separator + 1).replace(/\n+$/, "") });
  }
  return commits;
}

function squashMessage(commits: CommitMessage[], terms: string[]): string {
  const parts = commits.map((commit) => redact(commit.text, terms).split(/\r?\n/));
  const subject = parts[0]?.[0]?.trim() ?? "Privacy-safe update";
  const bodies: string[] = [];
  const trailers: string[] = [];
  const seenTrailers = new Set<string>();
  for (const lines of parts) {
    const bodyLines = lines.slice(1);
    for (const line of bodyLines) {
      const trailer = line.match(/^Co-Authored-By:.*$/i)?.[0];
      if (trailer) {
        const key = trailer.toLowerCase();
        if (!seenTrailers.has(key)) {
          seenTrailers.add(key);
          trailers.push(trailer);
        }
      }
    }
    const body = bodyLines
      .filter((line) => !/^Co-Authored-By:.*$/i.test(line))
      .join("\n")
      .trim();
    if (body) bodies.push(body);
  }
  return [subject, ...bodies, ...(trailers.length ? ["", ...trailers] : [])].join("\n\n").trimEnd() + "\n";
}

function hasStagedChanges(root: string): boolean {
  const result = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  return result.status !== 0;
}

function canRewriteCommits(base: string, root: string, commitCount: number): { safe: boolean; pushed: boolean } {
  const all = git(root, "rev-list", `${base}..HEAD`).split(/\r?\n/).filter(Boolean);
  const unpushed = git(root, "rev-list", `${base}..HEAD`, "--not", "--remotes").split(/\r?\n/).filter(Boolean);
  return { safe: all.length === commitCount && unpushed.length === all.length && !hasStagedChanges(root), pushed: unpushed.length !== all.length };
}

function rewriteCommitMessages(base: string, commits: CommitMessage[], terms: string[], root: string): void {
  const directory = mkdtempSync(join(tmpdir(), "privacy-check-"));
  const messageFile = join(directory, "message.txt");
  try {
    writeFileSync(messageFile, squashMessage(commits, terms));
    git(root, "reset", "--soft", base);
    git(root, "commit", "-F", messageFile);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function branchName(root: string): string {
  return git(root, "rev-parse", "--abbrev-ref", "HEAD").trim();
}

function hasUpstream(root: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "@{u}"], { cwd: root, encoding: "utf8" });
  return result.status === 0;
}

function allTrackedFiles(root: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const path of git(root, "ls-files", "-z").split("\0").filter(Boolean)) {
    try {
      const bytes = readFileSync(join(root, path));
      if (bytes.includes(0)) continue;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      files.push({ path, status: "modified", added: text.split(/\r?\n/), removed: 0 });
    } catch {
      // Missing or non-text tracked files are skipped.
    }
  }
  return files;
}

export interface PrivacyOptions {
  base?: string;
  all?: boolean;
  prTitle?: string;
  prBody?: string;
  prBodyFile?: string;
  branch?: string;
  fix: boolean;
  reveal: boolean;
  root: string;
}

/** Runs the full private-term gate, optionally applying safe local redactions before rescanning. */
export async function runPrivacy(options: PrivacyOptions): Promise<Finding[]> {
  const root = resolve(options.root);
  const { terms, counts } = await privateTerms(root);
  const countSummary = SOURCES.map((source) => `${source}: ${counts[source] ?? 0}`).join(", ");
  console.log(`== Privacy\n  ${terms.length} private terms (${countSummary})`);
  if (!terms.length) console.log("  Warning: no private terms loaded; check the database, local/private-terms.txt and PRIVATE_TERMS.");

  const bodyFile = options.prBodyFile ? resolve(root, options.prBodyFile) : undefined;
  const title = options.prTitle ?? "";
  const loadBody = () => (bodyFile ? readFileSync(bodyFile, "utf8") : (options.prBody ?? ""));
  const collect = () => {
    const { base, files } = collectChanges(options.base, root);
    const filesToScan = options.all ? allTrackedFiles(root) : files;
    const commits = commitsSince(base, root);
    const branch = options.branch ?? branchName(root);
    const texts = [
      ...commits.map((commit) => ({ where: `commit ${commit.hash} message`, text: commit.text })),
      { where: "branch name", text: branch },
      ...(title ? [{ where: "PR title", text: title }] : []),
      ...(loadBody() ? [{ where: "PR description", text: loadBody() }] : []),
    ];
    return { base, files, commits, branch, texts, findings: [...scanDiff(filesToScan, terms, options.reveal), ...scanText(texts, terms, options.reveal)] };
  };

  let initial = collect();
  const extra: Finding[] = [];
  if (options.fix) {
    if (bodyFile) {
      const body = loadBody();
      if (containsTerm(body, terms)) writeFileSync(bodyFile, redact(body, terms));
    }
    if (title && containsTerm(title, terms)) console.log(`  Redacted PR title to use: ${redact(title, terms)}`);

    const commitHits = initial.findings.some((finding) => finding.path.startsWith("commit "));
    if (commitHits && initial.commits.length) {
      const rewrite = canRewriteCommits(initial.base, root, initial.commits.length);
      if (rewrite.safe) rewriteCommitMessages(initial.base, initial.commits, terms, root);
      else if (rewrite.pushed) {
        extra.push({ level: "block", path: "commit messages", message: "Pushed commit messages stay in branch history; fix the PR title/description (the squash message) instead." });
      } else {
        extra.push({ level: "block", path: "commit messages", message: "Commit messages cannot be rewritten while staged changes exist." });
      }
    }

    const branchHit = initial.findings.some((finding) => finding.path === "branch name");
    if (branchHit) {
      if (hasUpstream(root)) extra.push({ level: "block", path: "branch name", message: "This branch is already pushed; its name cannot be safely rewritten." });
      else {
        const renamed = redact(initial.branch, terms).replace(/\[redacted\]/g, "redacted");
        git(root, "branch", "-m", renamed);
      }
    }
    initial = collect();
  }
  return [...initial.findings, ...extra];
}
