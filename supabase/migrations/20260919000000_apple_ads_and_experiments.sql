-- Apple Ads campaign tracking and channel-agnostic experiments.
-- Which app belongs to which product is a tracked_sources row
-- (source = 'apple_ads', kind = 'app', value = App Store ID, config.ad_account_id).

-- ---------------------------------------------------------------------------
-- Experiments: numbers and pointers only; the reasoning lives in markdown.
-- ---------------------------------------------------------------------------
create table if not exists experiments (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references products(id) on delete cascade,
  channel          text not null,
  slug             text not null,
  name             text not null,
  hypothesis       text,
  status           text not null default 'planned',
  start_date       date,
  end_date         date,
  daily_budget     numeric(12,2),
  total_budget     numeric(12,2),
  currency         text,
  success_criteria text,
  rules            jsonb not null default '{}'::jsonb,
  verdict          text,
  writeup_path     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (product_id, slug)
);

drop trigger if exists experiments_set_updated_at on experiments;
create trigger experiments_set_updated_at
  before update on experiments
  for each row execute function set_updated_at();

create table if not exists experiment_campaigns (
  experiment_id        uuid not null references experiments(id) on delete cascade,
  channel              text not null,
  external_campaign_id text not null,
  role                 text,
  geo                  text,
  primary key (experiment_id, channel, external_campaign_id)
);
create index if not exists experiment_campaigns_external_idx
  on experiment_campaigns(channel, external_campaign_id);

-- ---------------------------------------------------------------------------
-- Apple Ads current state (overwritten on every sync).
-- ---------------------------------------------------------------------------
create table if not exists apple_ads_campaigns (
  id                bigint primary key,
  product_id        uuid not null references products(id) on delete cascade,
  tracked_source_id uuid references tracked_sources(id) on delete set null,
  ad_account_id     bigint not null,
  app_store_id      text not null,
  name              text not null,
  status            text not null,
  display_status    text,
  daily_budget      numeric(12,2),
  currency          text,
  countries         text[] not null default '{}',
  deleted           boolean not null default false,
  apple_created_at  timestamptz,
  apple_modified_at timestamptz,
  raw               jsonb not null,
  first_seen_at     timestamptz not null default now(),
  last_synced_at    timestamptz not null default now()
);
create index if not exists apple_ads_campaigns_product_idx on apple_ads_campaigns(product_id);

create table if not exists apple_ads_keywords (
  id                    bigint not null,
  is_negative           boolean not null default false,
  campaign_id           bigint not null references apple_ads_campaigns(id) on delete cascade,
  ad_group_id           bigint not null,
  text                  text not null,
  match_type            text not null,
  bid                   numeric(12,4),
  currency              text,
  status                text not null,
  display_status        text,
  deleted               boolean not null default false,
  bid_recommendation    jsonb,
  bid_recommendation_at timestamptz,
  apple_created_at      timestamptz,
  apple_modified_at     timestamptz,
  raw                   jsonb not null,
  last_synced_at        timestamptz not null default now(),
  primary key (id, is_negative)
);
create index if not exists apple_ads_keywords_campaign_idx on apple_ads_keywords(campaign_id);

-- ---------------------------------------------------------------------------
-- Apple Ads daily facts. Rows exist only where there was activity.
-- ---------------------------------------------------------------------------
create table if not exists apple_ads_keyword_daily (
  date          date not null,
  keyword_id    bigint not null,
  country       text not null,
  campaign_id   bigint not null references apple_ads_campaigns(id) on delete cascade,
  impressions   integer not null default 0,
  taps          integer not null default 0,
  tap_installs  integer not null default 0,
  view_installs integer not null default 0,
  new_downloads integer not null default 0,
  redownloads   integer not null default 0,
  spend         numeric(12,4) not null default 0,
  currency      text not null,
  synced_at     timestamptz not null default now(),
  primary key (date, keyword_id, country)
);
create index if not exists apple_ads_keyword_daily_campaign_idx
  on apple_ads_keyword_daily(campaign_id, date);

create table if not exists apple_ads_search_terms_daily (
  date          date not null,
  campaign_id   bigint not null references apple_ads_campaigns(id) on delete cascade,
  keyword_id    bigint not null default 0,    -- 0 = no keyword (Search Match)
  search_term   text not null default '',     -- '' = withheld by Apple (low volume)
  country       text not null,
  source        text,
  impressions   integer not null default 0,
  taps          integer not null default 0,
  tap_installs  integer not null default 0,
  view_installs integer not null default 0,
  new_downloads integer not null default 0,
  redownloads   integer not null default 0,
  spend         numeric(12,4) not null default 0,
  currency      text not null,
  synced_at     timestamptz not null default now(),
  primary key (date, campaign_id, keyword_id, search_term, country)
);

-- ---------------------------------------------------------------------------
-- Journal of calls to the ad account. The history of bids, budgets, statuses.
-- ---------------------------------------------------------------------------
create table if not exists apple_ads_changes (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null,
  actor         text not null,
  ad_account_id bigint,
  product_id    uuid references products(id) on delete set null,
  experiment_id uuid references experiments(id) on delete set null,
  campaign_id   bigint,
  keyword_id    bigint,
  method        text not null,
  path          text not null,
  is_write      boolean not null,
  request       jsonb,
  status        integer,
  response      jsonb,
  plan_path     text,
  note          text,
  unique (at, method, path)
);
create index if not exists apple_ads_changes_keyword_idx on apple_ads_changes(keyword_id, at);
create index if not exists apple_ads_changes_experiment_idx on apple_ads_changes(experiment_id, at);
