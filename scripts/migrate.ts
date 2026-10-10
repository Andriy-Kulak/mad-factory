/**
 * Applies supabase/migrations/*.sql in order against SUPABASE_DB_URL without
 * requiring the Supabase CLI. Records applied versions in
 * supabase_migrations.schema_migrations, the same table the CLI uses, so the
 * two can be used interchangeably.
 */
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requireEnv } from "../src/lib/env.ts";
import { parseDbUrl } from "../src/lib/db-url.ts";

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const sql = postgres({ ...parseDbUrl(requireEnv("SUPABASE_DB_URL")), ssl: "require", max: 1, prepare: false, onnotice: () => {} });

try {
  await sql`create schema if not exists supabase_migrations`;
  await sql`create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text
  )`;
  const applied = new Set((await sql`select version from supabase_migrations.schema_migrations`).map((r) => r.version as string));

  let n = 0;
  for (const f of files) {
    const version = f.split("_")[0]!;
    const name = f.replace(/^\d+_/, "").replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const body = readFileSync(join(dir, f), "utf8");
    console.log(`applying ${f}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into supabase_migrations.schema_migrations (version, statements, name) values (${version}, ${[body]}, ${name})`;
    });
    n++;
  }
  console.log(n ? `applied ${n} migration(s)` : "up to date");
} finally {
  await sql.end();
}
