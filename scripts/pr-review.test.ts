import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiff, reviewChanges, type ChangedFile } from "./pr-review.ts";

const file = (path: string, added: string[], status: ChangedFile["status"] = "added"): ChangedFile => ({ path, status, added, removed: 0 });
const levels = (files: ChangedFile[]) => reviewChanges(files).map((f) => `${f.level}:${f.path}`);

test("parseDiff reads status and added lines, including SQL comments that look like diff headers", () => {
  const diff = [
    "diff --git a/supabase/migrations/1_x.sql b/supabase/migrations/1_x.sql",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/supabase/migrations/1_x.sql",
    "@@ -0,0 +1,2 @@",
    "+-- a comment",
    "+create table t (id int);",
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1 @@",
    "--- removed sql comment",
    "+const x = 1;",
  ].join("\n");
  assert.deepEqual(parseDiff(diff), [
    { path: "supabase/migrations/1_x.sql", status: "added", added: ["-- a comment", "create table t (id int);"], removed: 0 },
    { path: "src/a.ts", status: "modified", added: ["const x = 1;"], removed: 1 },
  ]);
});

test("migrations: append-only, RLS required, destructive SQL needs the owner", () => {
  assert.deepEqual(levels([file("supabase/migrations/1_x.sql", ["alter table t add column c int;"], "modified")]), ["block:supabase/migrations/1_x.sql"]);
  assert.deepEqual(levels([file("supabase/migrations/2_x.sql", ["create table t (id int);"])]), ["block:supabase/migrations/2_x.sql"]);
  assert.deepEqual(levels([file("supabase/migrations/2_x.sql", ["create table t (id int);", "alter table t enable row level security;"])]), []);
  for (const sql of ["drop table t;", "alter table t drop column c;", "truncate t;", "delete from t where x;", "update t set a = 1;"]) {
    assert.deepEqual(levels([file("supabase/migrations/3_x.sql", [sql])]), ["owner:supabase/migrations/3_x.sql"], sql);
  }
  for (const sql of ["drop trigger if exists x on t;", "drop index if exists i;", "alter table t drop constraint c;", "-- drop table t"]) {
    assert.deepEqual(levels([file("supabase/migrations/3_x.sql", [sql])]), [], sql);
  }
});

test("migrations: destructive SQL is found past quoting, comments and schema-qualified names", () => {
  const owner = (sql: string) => assert.deepEqual(levels([file("supabase/migrations/3_x.sql", sql.split("\n"))]), ["owner:supabase/migrations/3_x.sql"], sql);
  const none = (sql: string) => assert.deepEqual(levels([file("supabase/migrations/3_x.sql", sql.split("\n"))]), [], sql);
  owner("update public.products set name = 'x';");
  owner('update "products" set name = 1;');
  owner('update public."Products" p set name = 1;');
  owner("update only t set a = 1;");
  owner("select '--'; drop table products;");
  owner("select 'it''s -- fine'; delete from t;");
  owner("select E'\\'--'; drop table t;");
  owner("set standard_conforming_strings = off; select '\\'--'; drop table t;");
  owner('select 1 as "--"; truncate t;');
  owner("drop/**/table t;");
  owner("/* a /* nested */ comment */ drop table t;");
  owner("do $$ begin drop table t; end $$;");
  owner("do $x$ begin execute 'drop table t'; end $x$;");
  owner("do 'begin delete from t; end';");
  owner("alter table t drop c;");
  owner("drop policy p on t;");
  owner("alter table t no force row level security;");
  owner("grant select on t to anon;");
  owner("create policy p on t for select using (true);");
  owner("merge into t using s on t.id = s.id when matched then delete;");
  none("select '-- drop table t';");
  none("/* drop table t */ select 1;");
  none("alter table t add constraint f foreign key (x) references u on update cascade on delete set null;");
  none("alter table t alter column c drop default, alter column d drop not null;");
});

test("migrations: every created table enables RLS itself", () => {
  const lv = (sql: string) => levels([file("supabase/migrations/4_x.sql", sql.split("\n"))]);
  const block = ["block:supabase/migrations/4_x.sql"];
  assert.deepEqual(lv("create table a (id int);\ncreate table b (id int);\nalter table a enable row level security;"), block);
  assert.deepEqual(lv("create table a (id int);\n/* alter table a enable row level security; */"), block);
  assert.deepEqual(lv("create table a (id int);\nselect 'alter table a enable row level security';"), block);
  assert.deepEqual(lv("create table a (id int);\n-- alter table a enable row level security;"), block);
  assert.deepEqual(lv("create unlogged table a (id int);"), block);
  assert.deepEqual(lv("create table if not exists public.a (id int);\nalter table b enable row level security;"), block);
  assert.deepEqual(lv("do $$ begin execute 'create table a (id int)'; end $$;"), block);
  assert.deepEqual(lv("create table if not exists public.a (id int);\nalter table a enable row level security;"), []);
  assert.deepEqual(lv('create table "A" (id int);\nalter table if exists only public."A" enable row level security;'), []);
  assert.deepEqual(lv('create table "A" (id int);\nalter table a enable row level security;'), block);
});

test("ad-account write guards and database deletes need the owner", () => {
  assert.deepEqual(levels([file("src/meta-ads/client.ts", ["x"], "modified")]), ["owner:src/meta-ads/client.ts"]);
  assert.deepEqual(levels([file("src/db/x.ts", ['await db.from("t").delete().eq("id", id);'])]), ["owner:src/db/x.ts"]);
  assert.deepEqual(levels([file("src/db/x.ts", ["seen.delete(key);"])]), []);
  assert.deepEqual(levels([file("src/db/x.test.ts", ['db.from("t").delete()'])]), []);
  for (const line of [
    'await db.from("t").delete({ count: "exact" }).eq("id", id);',
    "  .delete()",
    '  .delete({ count: "exact" })',
    "q.delete();",
    'q.delete({ count: "exact" });',
    'db.from("t")["delete"]();',
  ]) {
    assert.deepEqual(levels([file("src/db/x.ts", [line])]), ["owner:src/db/x.ts"], line);
  }
  for (const line of ["map.delete(id);", 'res.cookies.delete({ name: COOKIE, path: "/" });', "res.cookies.delete(COOKIE);"]) {
    assert.deepEqual(levels([file("web/app/x.ts", [line])]), [], line);
  }
});

test("large diffs, large new files and new dependencies are warnings", () => {
  const big = Array.from({ length: 700 }, (_, i) => `line ${i}`);
  assert.deepEqual(levels([file("src/big.ts", big)]), ["warn:src/big.ts", "warn:(diff)"]);
  assert.deepEqual(levels([file("src/db/database.types.ts", big)]), []);
  assert.deepEqual(levels([file("package.json", ['    "left-pad": "^1.3.0",'], "modified")]), ["warn:package.json"]);
});

test("cli and web-page changes warn when docs/feature-map.md is missing", () => {
  assert.deepEqual(levels([file("src/cli/meta-ads.ts", ["x"], "modified")]), ["warn:docs/feature-map.md"]);
  assert.deepEqual(levels([file("src/cli/new.ts", ["x"])]), ["warn:docs/feature-map.md"]);
  assert.deepEqual(levels([file("web/app/p/[slug]/new/page.tsx", ["x"])]), ["warn:docs/feature-map.md"]);
  assert.deepEqual(levels([file("src/cli/meta-ads.ts", ["x"], "modified"), file("docs/feature-map.md", ["x"], "modified")]), []);
  assert.deepEqual(levels([file("src/meta-ads/verify.ts", ["x"])]), []);
  assert.deepEqual(levels([file("web/app/p/[slug]/ads/page.tsx", ["x"], "modified")]), []);
});

test("the PR template asks every Goal check question", async () => {
  const { readFileSync } = await import("node:fs");
  const { GOAL_CHECK } = await import("./pr-review.ts");
  const template = readFileSync(new URL("../.github/pull_request_template.md", import.meta.url), "utf8");
  for (const q of GOAL_CHECK) assert.ok(template.includes(`**${q.label}:**`), q.label);
});
