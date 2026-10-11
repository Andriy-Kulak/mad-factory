/**
 * Applies supabase/migrations/*.sql to an embedded PGlite (WASM Postgres) database.
 * Useful to validate migrations without a Supabase project or Docker.
 * Data persists under data/pglite/ (git-ignored). Pass --memory for a throwaway run.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const memory = process.argv.includes("--memory");
const db = memory ? new PGlite() : new PGlite(join("data", "pglite"));

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

await db.exec(`create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
const applied = new Set((await db.query<{ version: string }>("select version from supabase_migrations.schema_migrations")).rows.map((r) => r.version));

let n = 0;
for (const f of files) {
  const version = f.split("_")[0]!;
  if (applied.has(version)) continue;
  const body = readFileSync(join(dir, f), "utf8");
  console.log(`applying ${f}`);
  await db.transaction(async (tx) => {
    await tx.exec(body);
    await tx.query("insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, $2, $3)", [version, [body], f.replace(/^\d+_/, "").replace(/\.sql$/, "")]);
  });
  n++;
}
console.log(n ? `applied ${n} migration(s)` : "up to date");

const tables = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' order by 1");
console.log("public tables:", tables.rows.map((r) => r.table_name).join(", "));
await db.close();
