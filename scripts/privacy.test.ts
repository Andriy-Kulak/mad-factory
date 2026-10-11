import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { databaseValues, privateTerms, redact, runPrivacy, scanDiff, scanText, stripNote, termPattern, termsFrom } from "./privacy.ts";

const TERM = "acme-widget";
const gitEnv = {
  GIT_AUTHOR_NAME: "Privacy Test",
  GIT_AUTHOR_EMAIL: "privacy-test@example.test",
  GIT_COMMITTER_NAME: "Privacy Test",
  GIT_COMMITTER_EMAIL: "privacy-test@example.test",
};

// runPrivacy --fix commits with its own git calls; CI runners have no git identity.
Object.assign(process.env, gitEnv);

function git(root: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...gitEnv, ...env } }).trim();
}

function makeRepo(): { root: string; base: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "privacy-test-"));
  git(root, ["init", "--initial-branch=main"]);
  writeFileSync(join(root, "tracked.txt"), "baseline\n");
  git(root, ["add", "tracked.txt"]);
  git(root, ["commit", "-m", "baseline"]);
  const base = git(root, ["rev-parse", "HEAD"]);
  git(root, ["switch", "-c", "work"]);
  return { root, base, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function withNoExternalTerms<T>(run: () => Promise<T>): Promise<T> {
  const privateTerms = process.env.PRIVATE_TERMS;
  const supabaseUrl = process.env.SUPABASE_URL;
  delete process.env.PRIVATE_TERMS;
  delete process.env.SUPABASE_URL;
  return run().finally(() => {
    if (privateTerms === undefined) delete process.env.PRIVATE_TERMS;
    else process.env.PRIVATE_TERMS = privateTerms;
    if (supabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = supabaseUrl;
  });
}

function withPrivateTerm<T>(run: () => Promise<T>): Promise<T> {
  return withNoExternalTerms(() => {
    process.env.PRIVATE_TERMS = TERM;
    return run();
  });
}

test("stripNote removes parenthesized notes and falls back to the trimmed value", () => {
  assert.equal(stripNote("  Acme ($5/mo, note)  "), "Acme");
  assert.equal(stripNote("  (note) Acme  "), "(note) Acme");
  assert.equal(stripNote("  Sample Brand  "), "Sample Brand");
});

test("databaseValues keeps product and source values while stripping competitor and enabled-label notes", () => {
  assert.deepEqual(
    databaseValues({
      products: [
        { slug: "sample-product", name: "Sample Product", competitors: ["Acme ($5/mo, note)", "Plain competitor"] },
        { slug: "empty-product", name: "Empty Product", competitors: null },
      ],
      sources: [
        { value: "source-value-1", label: "Example Page (legacy name)", enabled: true },
        { value: "source-value-2", label: "Disabled Page (old name)", enabled: false },
        { value: "source-value-3", label: null, enabled: true },
      ],
      competitorKeywords: ["sample keyword"],
    }),
    ["sample-product", "Sample Product", "Acme", "Plain competitor", "empty-product", "Empty Product", "source-value-1", "Example Page", "source-value-2", "source-value-3", "sample keyword"],
  );
});

test("framework words are ignored while other database values remain private terms", () => {
  const values = databaseValues({
    products: [],
    sources: [],
    competitorKeywords: ["Vocabulary", "sample keyword"],
  });
  assert.deepEqual(termsFrom(values, new Set()), ["sample keyword"]);
});

test("the example placeholder label allowlists its note-stripped form", async () => {
  await withNoExternalTerms(async () => {
    const root = mkdtempSync(join(tmpdir(), "privacy-allowed-"));
    try {
      mkdirSync(join(root, "examples"), { recursive: true });
      writeFileSync(
        join(root, "examples/product.example.json"),
        JSON.stringify({
          tracked_sources: [{ label: "Example competitor page (placeholder id)" }],
        }),
      );
      process.env.PRIVATE_TERMS = "Example competitor page";
      const { terms, counts } = await privateTerms(root);
      assert.deepEqual(terms, []);
      assert.equal(counts.PRIVATE_TERMS, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("termPattern matches case and separator variants without longer-word or number matches", () => {
  const name = termPattern(TERM);
  for (const text of ["Acme Widget", "ACME-WIDGET", "acme_widget", "acmewidget"]) assert.equal(name.test(text), true, text);
  for (const text of ["superacmewidget", "acmewidgets", "acme-widgetized"]) assert.equal(name.test(text), false, text);
  const digits = termPattern("123456789");
  assert.equal(digits.test("account 123456789!"), true);
  assert.equal(digits.test("account 1234567890"), false);
  assert.equal(digits.test("account 0123456789"), false);
});

test("termsFrom normalizes URLs and account IDs, filters short and allowed terms, and deduplicates", () => {
  assert.deepEqual(termsFrom([" https://social.example/Globex/ ", "https://social.example/profile.php?id=123456789", "act_987654321", "globex", "xy", "Fictional"], new Set(["fictional"])), [
    "Globex",
    "123456789",
    "act_987654321",
    "987654321",
  ]);
});

test("scanDiff blocks current paths and content while ignoring deleted paths", () => {
  const terms = [TERM, "Globex", "123456789"];
  const files = [
    { path: "src/a.ts", status: "modified" as const, added: [`const secret = "Acme Widget";`], removed: 0 },
    { path: "scripts/a.ts", status: "added" as const, added: ["Globex"], removed: 0 },
    { path: "playbooks/a.md", status: "added" as const, added: ["123456789"], removed: 0 },
    { path: "CLAUDE.md", status: "modified" as const, added: ["Acme Widget"], removed: 0 },
    { path: `src/${TERM}.ts`, status: "added" as const, added: ["safe"], removed: 0 },
    { path: "products/acme-widget/README.md", status: "added" as const, added: ["Acme Widget"], removed: 0 },
    { path: `products/${TERM}/old.md`, status: "deleted" as const, added: [], removed: 1 },
    { path: "experiments/notes.md", status: "added" as const, added: ["Globex"], removed: 0 },
    { path: "docs/notes.md", status: "added" as const, added: ["123456789"], removed: 0 },
  ];
  const findings = scanDiff(files, terms, false);
  assert.ok(findings.some((finding) => finding.path === "src/a.ts"));
  assert.ok(findings.some((finding) => finding.path === "scripts/a.ts"));
  assert.ok(findings.some((finding) => finding.path === "playbooks/a.md"));
  assert.ok(findings.some((finding) => finding.path === "CLAUDE.md"));
  assert.ok(findings.some((finding) => finding.path === "src/[redacted].ts"));
  assert.ok(findings.some((finding) => finding.path === "products/[redacted]/README.md"));
  assert.ok(findings.every((finding) => finding.path !== "products/[redacted]/old.md"));
  assert.ok(findings.some((finding) => finding.path === "experiments/notes.md"));
  assert.ok(findings.some((finding) => finding.path === "docs/notes.md"));
  assert.ok(findings.every((finding) => !finding.message.includes("Acme Widget") && !finding.message.includes("const secret")));
  assert.ok(findings.every((finding) => finding.level === "block"));
});

test("--all scans full tracked text files and skips binaries", async () => {
  await withNoExternalTerms(async () => {
    const root = mkdtempSync(join(tmpdir(), "privacy-all-"));
    try {
      git(root, ["init", "--initial-branch=main"]);
      writeFileSync(join(root, "history.md"), "unchanged text\nAcme Widget\n");
      writeFileSync(join(root, "binary.dat"), Buffer.from(`binary\0Acme Widget`));
      writeFileSync(join(root, "Acme-Widget.md"), "safe content\n");
      git(root, ["add", "history.md", "binary.dat", "Acme-Widget.md"]);
      git(root, ["commit", "-m", "baseline"]);
      const base = git(root, ["rev-parse", "HEAD"]);
      git(root, ["switch", "-c", "work"]);
      process.env.PRIVATE_TERMS = TERM;

      const ordinary = await runPrivacy({ base, reveal: false, fix: false, root });
      assert.deepEqual(ordinary, []);
      git(root, ["rm", "Acme-Widget.md"]);
      const all = await runPrivacy({ base, all: true, reveal: false, fix: false, root });
      assert.ok(all.some((finding) => finding.path === "history.md" && finding.message.includes("added line 2")));
      assert.ok(all.every((finding) => finding.path !== "binary.dat"));
      assert.ok(all.every((finding) => finding.path !== "Acme-Widget.md"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test("scanText checks commit, branch and PR sources without revealing their text", () => {
  const findings = scanText(
    [
      { where: "commit 1a2b3c4 message", text: "Acme Widget is private" },
      { where: "branch name", text: "work-globex" },
      { where: "PR title", text: "123456789 release" },
      { where: "PR description", text: "Includes Acme Widget" },
      { where: "PR description", text: "Includes Acme\nWidget" },
    ],
    [TERM, "Globex", "123456789"],
    false,
  );
  assert.equal(findings.length, 5);
  assert.ok(findings.some((finding) => finding.path === "commit 1a2b3c4 message"));
  assert.ok(findings.some((finding) => finding.path === "branch name"));
  assert.ok(findings.some((finding) => finding.path === "PR title"));
  assert.ok(findings.some((finding) => finding.path === "PR description"));
  assert.ok(findings.every((finding) => !finding.message.includes("Acme") && !finding.message.includes("Globex") && !finding.message.includes("123456789")));
  assert.ok(findings.every((finding) => !finding.message.includes("is private") && !finding.message.includes("release")));
});

test("redact replaces each term across separator variants", () => {
  assert.equal(redact("Acme Widget, acme-widget and acmewidget", [TERM]), "[redacted], [redacted] and [redacted]");
});

test("--fix redacts the PR body file and prints a safe PR title replacement", async () => {
  await withPrivateTerm(async () => {
    const repo = makeRepo();
    const bodyDir = mkdtempSync(join(tmpdir(), "privacy-body-"));
    const bodyFile = join(bodyDir, "description.md");
    try {
      writeFileSync(bodyFile, "Details about Acme Widget.\n");
      const findings = await runPrivacy({
        base: repo.base,
        prTitle: "Acme Widget release",
        prBodyFile: bodyFile,
        fix: true,
        reveal: false,
        root: repo.root,
      });
      assert.equal(readFileSync(bodyFile, "utf8"), "Details about [redacted].\n");
      assert.ok(findings.some((finding) => finding.path === "PR title"));
      assert.ok(findings.every((finding) => !finding.message.includes("Acme Widget")));
    } finally {
      repo.cleanup();
      rmSync(bodyDir, { recursive: true, force: true });
    }
  });
});

test("--fix squashes unpushed commits, redacts messages and deduplicates trailers", async () => {
  await withPrivateTerm(async () => {
    const repo = makeRepo();
    try {
      writeFileSync(join(repo.root, "tracked.txt"), "first\n");
      git(repo.root, ["add", "tracked.txt"]);
      git(repo.root, ["commit", "-m", "Acme Widget: first", "-m", "Details Acme Widget", "-m", "Co-Authored-By: One <one@example.test>"]);
      writeFileSync(join(repo.root, "tracked.txt"), "second\n");
      git(repo.root, ["add", "tracked.txt"]);
      git(repo.root, ["commit", "-m", "Follow up", "-m", "Details acme-widget", "-m", "Co-Authored-By: One <one@example.test>", "-m", "Co-Authored-By: Two <two@example.test>"]);
      const findings = await runPrivacy({ base: repo.base, fix: true, reveal: false, root: repo.root });
      assert.deepEqual(findings, []);
      const message = git(repo.root, ["log", "--format=%B", `${repo.base}..HEAD`]);
      assert.equal(git(repo.root, ["rev-list", "--count", `${repo.base}..HEAD`]), "1");
      assert.match(message, /^\[redacted\]: first/m);
      assert.match(message, /Details \[redacted\]/);
      assert.equal((message.match(/Co-Authored-By: One/g) ?? []).length, 1);
      assert.equal((message.match(/Co-Authored-By: Two/g) ?? []).length, 1);
      assert.ok(message.endsWith("Co-Authored-By: Two <two@example.test>"));
      assert.equal(message.includes("Acme Widget"), false);
    } finally {
      repo.cleanup();
    }
  });
});

test("--fix leaves pushed commit messages unchanged and reports the history limitation", async () => {
  await withPrivateTerm(async () => {
    const repo = makeRepo();
    const bare = mkdtempSync(join(tmpdir(), "privacy-origin-"));
    try {
      git(bare, ["init", "--bare"]);
      git(repo.root, ["remote", "add", "origin", bare]);
      writeFileSync(join(repo.root, "tracked.txt"), "private message\n");
      git(repo.root, ["add", "tracked.txt"]);
      git(repo.root, ["commit", "-m", "Acme Widget release"]);
      git(repo.root, ["push", "--set-upstream", "origin", "work"]);
      const findings = await runPrivacy({ base: repo.base, fix: true, reveal: false, root: repo.root });
      const message = git(repo.root, ["log", "--format=%s", `${repo.base}..HEAD`]);
      assert.equal(message, "Acme Widget release");
      assert.ok(findings.some((finding) => finding.path.startsWith("commit ")));
      assert.ok(findings.some((finding) => finding.message.includes("Pushed commit messages stay in branch history")));
    } finally {
      repo.cleanup();
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

test("--fix renames a branch with a private term when it has no upstream", async () => {
  await withPrivateTerm(async () => {
    const repo = makeRepo();
    try {
      git(repo.root, ["switch", "-c", `work-${TERM}`]);
      const findings = await runPrivacy({ base: repo.base, fix: true, reveal: false, root: repo.root });
      assert.deepEqual(findings, []);
      assert.equal(git(repo.root, ["rev-parse", "--abbrev-ref", "HEAD"]), "work-redacted");
    } finally {
      repo.cleanup();
    }
  });
});
