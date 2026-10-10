-- mad-factory initial schema. (gen_random_uuid is core Postgres 13+, no extension needed.)
-- Product profiles, tracked ad-library sources, source-agnostic ads,
-- content-addressed creatives, and scrape run bookkeeping.


-- ---------------------------------------------------------------------------
-- Products: everything specific to a product/campaign lives here, never in code.
-- ---------------------------------------------------------------------------
create table if not exists products (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  description      text,
  customer_desires text[] not null default '{}',
  pain_points      text[] not null default '{}',
  target_audience  text,
  positioning      text,
  competitors      text[] not null default '{}',
  tone             text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tracked sources: what to scrape for a product. `source` names the platform
-- (meta, later apple_search_ads, ...); `kind` + `value` are source-specific
-- (meta: kind = page | keyword, value = page id | search phrase).
-- ---------------------------------------------------------------------------
create table if not exists tracked_sources (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  source          text not null,
  kind            text not null,
  value           text not null,
  country         text not null default 'ALL',
  label           text,
  enabled         boolean not null default true,
  config          jsonb not null default '{}'::jsonb,
  last_scraped_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (product_id, source, kind, value, country)
);
create index if not exists tracked_sources_product_idx on tracked_sources(product_id);

-- ---------------------------------------------------------------------------
-- Ads: one row per (source, external id). Shared across products.
-- ---------------------------------------------------------------------------
create table if not exists ads (
  id                uuid primary key default gen_random_uuid(),
  source            text not null,
  external_id       text not null,
  advertiser_id     text,
  advertiser_name   text,
  body_text         text,
  title             text,
  link_url          text,
  cta_text          text,
  start_date        timestamptz,
  end_date          timestamptz,
  is_active         boolean,
  platforms         text[] not null default '{}',
  collation_id      text,
  collation_count   integer,
  reach_estimate    jsonb,
  spend             jsonb,
  currency          text,
  total_active_time jsonb,
  raw               jsonb not null,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists ads_advertiser_idx on ads(source, advertiser_id);
create index if not exists ads_collation_idx on ads(collation_id);
create index if not exists ads_last_seen_idx on ads(last_seen_at);

-- ---------------------------------------------------------------------------
-- Creatives: content-addressed media, stored once regardless of source.
-- ---------------------------------------------------------------------------
create table if not exists creatives (
  sha256      text primary key,
  media_type  text not null default 'video',
  bytes       bigint not null,
  storage_key text not null,
  public_url  text,
  created_at  timestamptz not null default now()
);

create table if not exists ad_creatives (
  ad_id      uuid not null references ads(id) on delete cascade,
  sha256     text not null references creatives(sha256),
  position   integer not null,
  created_at timestamptz not null default now(),
  primary key (ad_id, position)
);
create index if not exists ad_creatives_sha_idx on ad_creatives(sha256);

-- ---------------------------------------------------------------------------
-- Product <-> ad membership: which tracked source surfaced which ad for which
-- product. The same ad can belong to several products.
-- ---------------------------------------------------------------------------
create table if not exists product_ads (
  product_id        uuid not null references products(id) on delete cascade,
  ad_id             uuid not null references ads(id) on delete cascade,
  tracked_source_id uuid references tracked_sources(id) on delete set null,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  primary key (product_id, ad_id)
);
create index if not exists product_ads_ad_idx on product_ads(ad_id);

-- ---------------------------------------------------------------------------
-- Scrape runs: one row per tracked source per invocation.
-- ---------------------------------------------------------------------------
create table if not exists scrape_runs (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,
  tracked_source_id uuid references tracked_sources(id) on delete set null,
  source            text not null,
  status            text not null default 'running',
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  ads_seen          integer not null default 0,
  ads_new           integer not null default 0,
  creatives_new     integer not null default 0,
  error             text
);

-- updated_at trigger for products
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();
