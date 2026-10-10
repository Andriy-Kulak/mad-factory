import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// The web app (pages, server actions, /api/mcp) must never reach code that can change an ad account,
// so a stolen GitHub login or MCP key can read campaigns but not touch budgets, bids or status.
const ROOT = resolve(import.meta.dirname, "../..");
const READ_ONLY_AD_MODULES = new Set([
  "src/meta-ads/attributes.ts",
  "src/meta-ads/map.ts",
  "src/meta-ads/types.ts",
  "src/apple-ads/coverage.ts",
  "src/apple-ads/map.ts",
  "src/apple-ads/types.ts",
]);
// CLI-only packages that crash the hosted web app when a page imports them (Playwright needs a local browser).
const CLI_ONLY_PACKAGES = new Set(["playwright", "playwright-core"]);

function webFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) webFiles(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec);
  for (const p of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

const IMPORT = /(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

test("web/ never imports Apple Ads or Meta Ads write code or CLI-only packages, directly or indirectly", () => {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const queue = webFiles(join(ROOT, "web")).map((f) => ({ file: f, via: relative(ROOT, f) }));
  while (queue.length) {
    const { file, via } = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = relative(ROOT, file);
    if (/^src\/(meta-ads|apple-ads)\//.test(rel) && !READ_ONLY_AD_MODULES.has(rel)) {
      offenders.push(`${via} -> ${rel}`);
      continue;
    }
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (CLI_ONLY_PACKAGES.has(spec) && !m[0].startsWith("import type")) offenders.push(`${via} -> ${spec}`);
      const next = resolveImport(file, spec);
      if (next) queue.push({ file: next, via: `${via} -> ${relative(ROOT, next)}` });
    }
  }
  assert.ok(seen.size > 20, "import walk found too few files");
  assert.deepEqual(offenders, []);
});
