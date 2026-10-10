import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { getDb } from "../db/client.ts";
import { envHint, INTEGRATIONS, integrationStatus, type Integration } from "../lib/integrations.ts";

const HELP = `Usage: pnpm doctor [--json]

Which integrations this machine has keys for (.env), what each one enables, what is off without it, and whether the
database is reachable with its tables in place. Never prints a secret value. Read-only; no paid API calls.
`;

const { values } = parseArgs({
  options: {
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const rows = INTEGRATIONS.map((it) => ({ it, ...integrationStatus(it.key) }));

/** Reachable and migrated, or why not. Only touches the database when Supabase is configured. */
async function checkDatabase(): Promise<{ ok: boolean; detail: string }> {
  if (!integrationStatus("supabase").configured) return { ok: false, detail: "skipped: Supabase is not configured" };
  try {
    const res = await getDb().from("products").select("id", { count: "exact", head: true });
    if (res.error) {
      const missing = /relation .* does not exist|Could not find the table/i.test(res.error.message);
      return { ok: false, detail: missing ? "connected, but the tables are missing: run `pnpm db:migrate` (or `supabase db push`)" : res.error.message };
    }
    const n = res.count ?? 0;
    return { ok: true, detail: `connected, ${n} product(s)${n ? "" : ": create one with `pnpm product create --file examples/product.example.json`"}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

const db = await checkDatabase();

if (values.json) {
  console.log(JSON.stringify({
    envFile: existsSync(".env"),
    integrations: rows.map(({ it, configured, missing }) => ({ key: it.key, name: it.name, required: it.required, where: it.where, configured, missing })),
    database: db,
  }, null, 2));
  process.exit(rows.some((r) => r.it.required && !r.configured) || !db.ok ? 1 : 0);
}

const tick = (ok: boolean) => (ok ? "✓" : "✗");
const width = Math.max(...INTEGRATIONS.map((it) => it.name.length)) + 2;
const line = ({ it, configured }: { it: Integration; configured: boolean }) => {
  const head = `  ${configured ? "✓" : it.required ? "✗" : "·"} ${it.name.padEnd(width)}${it.summary}`;
  if (configured) return head;
  return [head, `      set ${envHint(it)}`, `      without it: ${it.without}`, `      get them: ${it.setup}`].join("\n");
};

console.log(existsSync(".env") ? "Reading .env in this folder.\n" : "No .env here yet: cp .env.example .env, then fill in Supabase.\n");
console.log("Required");
for (const r of rows.filter((r) => r.it.required)) console.log(line(r));
console.log("\nOptional (each one turns on a feature; nothing else breaks without it)");
for (const r of rows.filter((r) => !r.it.required && r.it.where !== "web")) console.log(line(r));
console.log("\nWeb app (set these on the web host too)");
for (const r of rows.filter((r) => r.it.where === "web")) console.log(line(r));
console.log(`\nDatabase\n  ${tick(db.ok)} ${db.detail}`);

const on = rows.filter((r) => r.configured).length;
console.log(`\n${on} of ${rows.length} integrations configured. Details: README.md → "Keys and integrations".`);
process.exit(rows.some((r) => r.it.required && !r.configured) || !db.ok ? 1 : 0);
