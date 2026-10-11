/** Schema behaviour tests against an in-memory PGlite database (no Supabase needed). */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const db = new PGlite();

before(async () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
});
after(() => db.close());

test("migrations are idempotent (re-applying is a no-op)", async () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
});

test("ads upsert keeps first_seen_at and bumps last_seen_at", async () => {
  const ins = await db.query<{ id: string; first_seen_at: string; last_seen_at: string }>(
    `insert into ads (source, external_id, raw, first_seen_at, last_seen_at)
     values ('meta', 'x1', '{}'::jsonb, now() - interval '1 day', now() - interval '1 day')
     returning id, first_seen_at, last_seen_at`,
  );
  const first = ins.rows[0]!;
  const up = await db.query<{ id: string; first_seen_at: string; last_seen_at: string; title: string }>(
    `insert into ads (source, external_id, raw, title, last_seen_at)
     values ('meta', 'x1', '{"v":2}'::jsonb, 'new title', now())
     on conflict (source, external_id) do update set raw = excluded.raw, title = excluded.title, last_seen_at = excluded.last_seen_at
     returning id, first_seen_at, last_seen_at, title`,
  );
  const second = up.rows[0]!;
  assert.equal(second.id, first.id);
  assert.equal(String(second.first_seen_at), String(first.first_seen_at));
  assert.ok(new Date(second.last_seen_at) > new Date(first.last_seen_at));
  assert.equal(second.title, "new title");
  const count = await db.query<{ n: number }>("select count(*)::int n from ads where external_id = 'x1'");
  assert.equal(count.rows[0]!.n, 1);
});

test("tracked_sources are unique per product/source/kind/value/country", async () => {
  const p = await db.query<{ id: string }>("insert into products (slug, name) values ('t1', 'T1') returning id");
  const pid = p.rows[0]!.id;
  const q = `insert into tracked_sources (product_id, source, kind, value, country) values ($1, 'meta', 'page', '1', 'US')`;
  await db.query(q, [pid]);
  await assert.rejects(db.query(q, [pid]), /duplicate key/);
  await db.query(`insert into tracked_sources (product_id, source, kind, value, country) values ($1, 'meta', 'page', '1', 'DE')`, [pid]);
});

test("deleting a product cascades to sources and product_ads but not ads/creatives", async () => {
  const p = await db.query<{ id: string }>("insert into products (slug, name) values ('t2', 'T2') returning id");
  const pid = p.rows[0]!.id;
  const ts = await db.query<{ id: string }>(`insert into tracked_sources (product_id, source, kind, value) values ($1, 'meta', 'keyword', 'k') returning id`, [pid]);
  const ad = await db.query<{ id: string }>(`insert into ads (source, external_id, raw) values ('meta', 'x2', '{}'::jsonb) returning id`);
  await db.query(`insert into creatives (sha256, bytes, storage_key) values ('abc', 10, 'videos/abc.mp4')`);
  await db.query(`insert into ad_creatives (ad_id, sha256, position) values ($1, 'abc', 0)`, [ad.rows[0]!.id]);
  await db.query(`insert into product_ads (product_id, ad_id, tracked_source_id) values ($1, $2, $3)`, [pid, ad.rows[0]!.id, ts.rows[0]!.id]);
  await db.query(`insert into scrape_runs (product_id, tracked_source_id, source) values ($1, $2, 'meta')`, [pid, ts.rows[0]!.id]);

  await db.query("delete from products where id = $1", [pid]);
  const n = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0]!.n;
  assert.equal(await n("select count(*)::int n from tracked_sources where value = 'k'"), 0);
  assert.equal(await n("select count(*)::int n from product_ads"), 0);
  assert.equal(await n("select count(*)::int n from scrape_runs"), 0);
  assert.equal(await n("select count(*)::int n from ads where external_id = 'x2'"), 1);
  assert.equal(await n("select count(*)::int n from creatives"), 1);
  assert.equal(await n("select count(*)::int n from ad_creatives"), 1);
});

test("products.updated_at is bumped by trigger", async () => {
  const p = await db.query<{ id: string; updated_at: string }>("insert into products (slug, name) values ('t3', 'T3') returning id, updated_at");
  await new Promise((r) => setTimeout(r, 5));
  const u = await db.query<{ updated_at: string }>("update products set tone = 'warm' where id = $1 returning updated_at", [p.rows[0]!.id]);
  assert.ok(new Date(u.rows[0]!.updated_at) > new Date(p.rows[0]!.updated_at));
});

test("apple ads: a keyword and a negative can share an id; daily upsert overwrites", async () => {
  const p = await db.query<{ id: string }>("insert into products (slug, name) values ('t4', 'T4') returning id");
  const pid = p.rows[0]!.id;
  await db.query(
    `insert into apple_ads_campaigns (id, product_id, ad_account_id, app_store_id, name, status, raw)
     values (100, $1, 1, '1', 'c', 'ENABLED', '{}'::jsonb)`,
    [pid],
  );
  await db.query(
    `insert into apple_ads_keywords (id, is_negative, campaign_id, ad_group_id, text, match_type, status, raw)
     values (5, false, 100, 7, 'a', 'EXACT', 'ENABLED', '{}'::jsonb), (5, true, 100, 7, 'b', 'EXACT', 'ENABLED', '{}'::jsonb)`,
  );
  const upsert = (impressions: number) =>
    db.query(
      `insert into apple_ads_keyword_daily (date, keyword_id, country, campaign_id, impressions, currency)
       values ('2026-01-01', 5, 'US', 100, $1, 'USD')
       on conflict (date, keyword_id, country) do update set impressions = excluded.impressions`,
      [impressions],
    );
  await upsert(10);
  await upsert(12);
  const d = await db.query<{ n: number; impressions: number }>("select count(*)::int n, max(impressions)::int impressions from apple_ads_keyword_daily where campaign_id = 100");
  assert.deepEqual(d.rows[0], { n: 1, impressions: 12 });

  // Deleting the product removes its campaigns, keywords and daily rows.
  await db.query("delete from products where id = $1", [pid]);
  const n = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0]!.n;
  assert.equal(await n("select count(*)::int n from apple_ads_keywords where campaign_id = 100"), 0);
  assert.equal(await n("select count(*)::int n from apple_ads_keyword_daily where campaign_id = 100"), 0);
});

test("meta ads tables enable RLS without policies", async () => {
  const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(
    "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'meta_ads_%' order by c.relname",
  );
  assert.equal(tables.rows.length, 7);
  assert.ok(tables.rows.every((row) => row.relrowsecurity));
  const policies = await db.query<{ tablename: string }>("select tablename from pg_policies where schemaname = 'public' and tablename like 'meta_ads_%'");
  assert.deepEqual(policies.rows, []);
});

test("ad library observations record ranked ads and enable RLS", async () => {
  const p = await db.query<{ id: string }>("insert into products (slug, name) values ('t9', 'T9') returning id");
  const ts = await db.query<{ id: string }>("insert into tracked_sources (product_id, source, kind, value) values ($1, 'meta', 'page', '9') returning id", [p.rows[0]!.id]);
  const run = await db.query<{ id: string }>("insert into scrape_runs (product_id, tracked_source_id, source, collector, credits_used) values ($1, $2, 'meta', 'scrapecreators', 1) returning id", [
    p.rows[0]!.id,
    ts.rows[0]!.id,
  ]);
  const ad = await db.query<{ id: string }>("insert into ads (source, external_id, raw) values ('meta', 'x9', '{}'::jsonb) returning id");
  const observation = await db.query<{ rank: number; sort_mode: string; is_active: boolean | null; collation_count: number | null }>(
    `insert into ad_library_observations (scrape_run_id, ad_id, tracked_source_id, sort_mode, rank, is_active, collation_count)
     values ($1, $2, $3, 'total_impressions', 1, true, 3)
     returning rank, sort_mode, is_active, collation_count`,
    [run.rows[0]!.id, ad.rows[0]!.id, ts.rows[0]!.id],
  );
  assert.deepEqual(observation.rows[0], { rank: 1, sort_mode: "total_impressions", is_active: true, collation_count: 3 });
  const table = await db.query<{ rowsecurity: boolean }>("select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'ad_library_observations'");
  assert.equal(table.rows[0]!.rowsecurity, true);
});

test("meta ads daily upsert overwrites on (date, ad_id)", async () => {
  const p = await db.query<{ id: string }>("insert into products (slug, name) values ('t8', 'T8') returning id");
  const pid = p.rows[0]!.id;
  const upsert = (impressions: number) =>
    db.query(
      `insert into meta_ads_ad_daily (date, ad_id, product_id, campaign_id, adset_id, currency, impressions)
       values ('2026-01-01', 'act_123', $1, 'cmp_1', 'set_1', 'USD', $2)
       on conflict (date, ad_id) do update set impressions = excluded.impressions`,
      [pid, impressions],
    );
  await upsert(10);
  await upsert(12);
  const row = await db.query<{ count: number; impressions: number }>("select count(*)::int count, max(impressions)::int impressions from meta_ads_ad_daily where ad_id = 'act_123'");
  assert.deepEqual(row.rows[0], { count: 1, impressions: 12 });
});

test("experiments: slug is unique per product and links are channel-agnostic", async () => {
  const p = await db.query<{ id: string }>("insert into products (slug, name) values ('t5', 'T5') returning id");
  const pid = p.rows[0]!.id;
  const e = await db.query<{ id: string }>("insert into experiments (product_id, channel, slug, name) values ($1, 'apple_ads', 'e1', 'E1') returning id", [pid]);
  await assert.rejects(db.query("insert into experiments (product_id, channel, slug, name) values ($1, 'meta', 'e1', 'dup')", [pid]));
  await db.query("insert into experiment_campaigns (experiment_id, channel, external_campaign_id, role, geo) values ($1, 'apple_ads', '100', 'generic', 'US'), ($1, 'meta', 'abc_1', null, null)", [
    e.rows[0]!.id,
  ]);
  await db.query("delete from products where id = $1", [pid]);
  const left = await db.query<{ n: number }>("select count(*)::int n from experiment_campaigns where experiment_id = $1", [e.rows[0]!.id]);
  assert.equal(left.rows[0]!.n, 0);
});

test("experiment_log: kind is constrained, at defaults to now, rows go with the experiment", async () => {
  const p = await db.query<{ id: string }>("insert into products (slug, name) values ('t7', 'T7') returning id");
  const e = await db.query<{ id: string }>("insert into experiments (product_id, channel, slug, name) values ($1, 'apple_ads', 'e1', 'E1') returning id", [p.rows[0]!.id]);
  const eid = e.rows[0]!.id;
  await assert.rejects(db.query("insert into experiment_log (experiment_id, actor, kind, body) values ($1, 'a', 'guess', 'x')", [eid]));
  const row = await db.query<{ at: string }>("insert into experiment_log (experiment_id, actor, kind, body) values ($1, 'a', 'decision', 'x') returning at", [eid]);
  assert.ok(row.rows[0]!.at);
  await db.query("delete from experiments where id = $1", [eid]);
  const left = await db.query<{ n: number }>("select count(*)::int n from experiment_log where experiment_id = $1", [eid]);
  assert.equal(left.rows[0]!.n, 0);
});

test("revenuecat: keyword rows upsert per source/day/campaign/keyword and go with the product", async () => {
  const p = await db.query<{ id: string }>("insert into products (slug, name) values ('t6', 'T6') returning id");
  const pid = p.rows[0]!.id;
  const ts = await db.query<{ id: string }>("insert into tracked_sources (product_id, source, kind, value) values ($1, 'revenuecat', 'project', 'proj1') returning id", [pid]);
  const upsert = (trials: number) =>
    db.query(
      `insert into revenuecat_keyword_daily (tracked_source_id, product_id, date, campaign, keyword, new_trials, currency)
       values ($1, $2, '2026-01-01', 'c', 'k', $3, 'USD')
       on conflict (tracked_source_id, date, campaign, keyword) do update set new_trials = excluded.new_trials`,
      [ts.rows[0]!.id, pid, trials],
    );
  await upsert(1);
  await upsert(3);
  await db.query("insert into revenuecat_keyword_daily (tracked_source_id, product_id, date, currency) values ($1, $2, '2026-01-01', 'USD')", [ts.rows[0]!.id, pid]);
  const n = async (sql: string) => (await db.query<{ n: number }>(sql, [pid])).rows[0]!.n;
  assert.equal(await n("select count(*)::int n from revenuecat_keyword_daily where product_id = $1"), 2);
  assert.equal(await n("select sum(new_trials)::int n from revenuecat_keyword_daily where product_id = $1"), 3);
  await db.query("delete from products where id = $1", [pid]);
  assert.equal(await n("select count(*)::int n from revenuecat_keyword_daily where product_id = $1"), 0);
});

test("social tracking: accounts, posts, snapshots and media are stored with RLS enabled", async () => {
  const product = await db.query<{ id: string }>("insert into products (slug, name) values ('social-test', 'Social Test') returning id");
  const productId = product.rows[0]!.id;
  const trackedSource = await db.query<{ id: string }>(
    `insert into tracked_sources (product_id, source, kind, value, country, config)
     values ($1, 'instagram', 'account', 'test-account', 'ALL', '{"relation":"inspiration"}'::jsonb) returning id`,
    [productId],
  );
  const run = await db.query<{ id: string }>("insert into scrape_runs (product_id, tracked_source_id, source, collector) values ($1, $2, 'instagram', 'scrapecreators') returning id", [
    productId,
    trackedSource.rows[0]!.id,
  ]);
  const account = await db.query<{ id: string }>("insert into social_accounts (platform, external_id, handle) values ('instagram', 'social-test-id', 'test-account') returning id");
  const accountId = account.rows[0]!.id;
  await db.query(
    `insert into social_account_snapshots (account_id, captured_on, followers, following, posts_count, scrape_run_id)
     values ($1, '2026-10-05', 10, 20, 30, $2)`,
    [accountId, run.rows[0]!.id],
  );
  const post = await db.query<{ id: string }>("insert into social_posts (account_id, platform, external_id, kind) values ($1, 'instagram', 'social-post-id', 'reel') returning id", [accountId]);
  const postId = post.rows[0]!.id;
  await db.query(
    `insert into social_post_snapshots (post_id, captured_on, source, views, likes, comments, scrape_run_id)
     values ($1, '2026-10-05', 'scrape', 100, 10, 2, $2)`,
    [postId, run.rows[0]!.id],
  );
  await db.query("insert into creatives (sha256, bytes, storage_key) values ('social-test-sha', 1, 'images/social-test-sha.jpg')");
  await db.query("insert into social_post_media (post_id, sha256, position, role) values ($1, 'social-test-sha', 0, 'thumbnail')", [postId]);

  const tables = await db.query<{ tablename: string; rowsecurity: boolean }>(
    `select tablename, rowsecurity from pg_tables
     where schemaname = 'public' and tablename in (
       'social_accounts', 'social_account_snapshots', 'social_posts', 'social_post_media', 'social_post_snapshots'
     )
     order by tablename`,
  );
  assert.deepEqual(
    tables.rows.map((row) => row.tablename),
    ["social_account_snapshots", "social_accounts", "social_post_media", "social_post_snapshots", "social_posts"],
  );
  assert.ok(tables.rows.every((row) => row.rowsecurity));
});

test("creative_profiles: keyed by creative sha256 with RLS enabled", async () => {
  await db.query("insert into creatives (sha256, bytes, storage_key) values ('profile-sha', 1, 'videos/profile-sha.mp4')");
  const row = await db.query<{ sha256: string; schema_version: number; media_type: string; profiled_by: string }>(
    `insert into creative_profiles (sha256, schema_version, media_type, profile, profiled_by)
     values ('profile-sha', 1, 'video', '{}'::jsonb, 'manual')
     returning sha256, schema_version, media_type, profiled_by`,
  );
  assert.deepEqual(row.rows[0], { sha256: "profile-sha", schema_version: 1, media_type: "video", profiled_by: "manual" });
  await assert.rejects(
    db.query(`insert into creative_profiles (sha256, schema_version, media_type, profile, profiled_by)
              values ('profile-sha-orphan', 1, 'video', '{}'::jsonb, 'manual')`),
  );
  await assert.rejects(
    db.query(`insert into creative_profiles (sha256, schema_version, media_type, profile, profiled_by)
              values ('profile-sha', 1, 'podcast', '{}'::jsonb, 'manual')`),
  );
  await assert.rejects(
    db.query(`insert into creative_profiles (sha256, schema_version, media_type, profile, profiled_by)
              values ('profile-sha', 1, 'image', '{}'::jsonb, 'auto')`),
  );
  await db.query("delete from creatives where sha256 = 'profile-sha'");
  const left = await db.query<{ n: number }>("select count(*)::int n from creative_profiles where sha256 = 'profile-sha'");
  assert.equal(left.rows[0]!.n, 0);
  const table = await db.query<{ rowsecurity: boolean }>("select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'creative_profiles'");
  assert.equal(table.rows[0]!.rowsecurity, true);
});

test("rls: every public table has row level security enabled", async () => {
  const off = await db.query<{ relname: string }>(
    "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity",
  );
  assert.deepEqual(
    off.rows.map((r) => r.relname),
    [],
  );
});

test("product_docs are unique per product/name and cascade with the product", async () => {
  const product = await db.query<{ id: string }>("insert into products (slug, name) values ('doc-test', 'Doc Test') returning id");
  const productId = product.rows[0]!.id;
  const insert = "insert into product_docs (product_id, name, title, body_md) values ($1, 'readme', 'Overview', '# Overview')";
  const inserted = await db.query<{ kind: string }>("insert into product_docs (product_id, name, title, body_md) values ($1, 'readme', 'Overview', '# Overview') returning kind", [productId]);
  assert.equal(inserted.rows[0]!.kind, "brand");
  await assert.rejects(db.query(insert, [productId]), /duplicate key/);
  await assert.rejects(db.query("insert into product_docs (product_id, name, body_md, kind) values ($1, 'invalid', 'body', 'invalid')", [productId]), /product_docs_kind_check/);

  const beforeDelete = await db.query<{ n: number }>("select count(*)::int n from product_docs where product_id = $1", [productId]);
  assert.equal(beforeDelete.rows[0]!.n, 1);
  await db.query("delete from products where id = $1", [productId]);
  const afterDelete = await db.query<{ n: number }>("select count(*)::int n from product_docs where product_id = $1", [productId]);
  assert.equal(afterDelete.rows[0]!.n, 0);
});
