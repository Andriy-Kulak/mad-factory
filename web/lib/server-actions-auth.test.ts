import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Every server action is a public POST endpoint, so each must check the session itself rather than rely on the proxy.
const ROOT = resolve(import.meta.dirname, "../..");

function webFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) webFiles(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

test("every exported server action calls requireOwner() first", () => {
  const offenders: string[] = [];
  let actions = 0;
  for (const file of webFiles(join(ROOT, "web"))) {
    const src = readFileSync(file, "utf8");
    const rel = relative(ROOT, file);
    if (/(^|\n)\s*["']use server["']/.test(src) && !/^\s*["']use server["']/.test(src)) offenders.push(`${rel}: inline "use server" (keep server actions in a "use server" module)`);
    if (!/^\s*["']use server["']/.test(src)) continue;
    for (const m of src.matchAll(/^export\s+(?!type\b|interface\b)(.*)$/gm)) {
      const fn = /^(?:default\s+)?async\s+function\s+(\w+)\s*\(/.exec(m[1]);
      if (!fn) {
        offenders.push(`${rel}: "${m[0].slice(0, 60)}" (export server actions as \`export async function\`)`);
        continue;
      }
      actions++;
      // The body opens at the first "{" that ends a line; a multi-line signature fails loudly here rather than passing.
      const open = src.indexOf("{\n", m.index);
      if (!/^\s*await requireOwner\(\);/.test(src.slice(open + 1))) offenders.push(`${rel}: ${fn[1]}`);
    }
  }
  assert.ok(actions > 0, "found no server actions; the scan is broken");
  assert.deepEqual(offenders, [], `server actions must start with \`await requireOwner();\`:\n${offenders.join("\n")}`);
});
