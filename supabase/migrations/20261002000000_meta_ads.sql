create table if not exists meta_ads_campaigns (
  id text primary key,
  product_id uuid not null references products(id) on delete cascade,
  tracked_source_id uuid references tracked_sources(id) on delete set null,
  ad_account_id text not null,
  name text not null,
  objective text,
  status text not null,
  effective_status text,
  daily_budget bigint,
  lifetime_budget bigint,
  currency text,
  bid_strategy text,
  meta_created_at timestamptz,
  meta_updated_at timestamptz,
  raw jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now()
);

create table if not exists meta_ads_adsets (
  id text primary key,
  campaign_id text not null references meta_ads_campaigns(id) on delete cascade,
  name text not null,
  status text not null,
  effective_status text,
  optimization_goal text,
  billing_event text,
  bid_amount bigint,
  daily_budget bigint,
  lifetime_budget bigint,
  targeting jsonb,
  promoted_object jsonb,
  learning_stage_info jsonb,
  is_skadnetwork_attribution boolean,
  raw jsonb not null,
  last_synced_at timestamptz not null default now()
);

create table if not exists meta_ads_creatives (
  id text primary key,
  product_id uuid not null references products(id) on delete cascade,
  ad_account_id text not null,
  video_id text,
  image_hash text,
  thumbnail_url text,
  body text,
  title text,
  call_to_action_type text,
  object_story_spec jsonb,
  asset_feed_spec jsonb,
  attributes jsonb not null default '{}'::jsonb,
  sha256 text references creatives(sha256),
  raw jsonb not null,
  last_synced_at timestamptz not null default now()
);

create table if not exists meta_ads_ads (
  id text primary key,
  adset_id text not null references meta_ads_adsets(id) on delete cascade,
  campaign_id text not null references meta_ads_campaigns(id) on delete cascade,
  creative_id text references meta_ads_creatives(id),
  name text not null,
  status text not null,
  effective_status text,
  issues_info jsonb,
  meta_created_at timestamptz,
  meta_updated_at timestamptz,
  raw jsonb not null,
  last_synced_at timestamptz not null default now()
);

create table if not exists meta_ads_ad_daily (
  date date not null,
  ad_id text not null,
  product_id uuid not null references products(id) on delete cascade,
  campaign_id text not null,
  adset_id text not null,
  impressions integer not null default 0,
  reach integer,
  clicks integer not null default 0,
  inline_link_clicks integer not null default 0,
  spend numeric(12,4) not null default 0,
  currency text not null,
  video_3s_views integer,
  video_p25 integer,
  video_p50 integer,
  video_p100 integer,
  thruplays integer,
  installs integer,
  trials integer,
  purchases integer,
  actions jsonb,
  cost_per_action_type jsonb,
  quality_ranking text,
  engagement_rate_ranking text,
  conversion_rate_ranking text,
  synced_at timestamptz not null default now(),
  primary key (date, ad_id)
);
create index if not exists meta_ads_ad_daily_product_date_idx on meta_ads_ad_daily(product_id, date);

create table if not exists meta_ads_ad_daily_breakdowns (
  date date not null,
  ad_id text not null,
  breakdown text not null,
  value text not null,
  product_id uuid not null references products(id) on delete cascade,
  campaign_id text not null,
  impressions integer not null default 0,
  clicks integer not null default 0,
  spend numeric(12,4) not null default 0,
  currency text not null,
  installs integer,
  trials integer,
  purchases integer,
  actions jsonb,
  synced_at timestamptz not null default now(),
  primary key (date, ad_id, breakdown, value)
);
create index if not exists meta_ads_ad_daily_breakdowns_product_date_idx on meta_ads_ad_daily_breakdowns(product_id, date);

create table if not exists meta_ads_changes (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null,
  actor text not null,
  ad_account_id text,
  product_id uuid references products(id) on delete set null,
  experiment_id uuid references experiments(id) on delete set null,
  object_type text,
  object_id text,
  method text not null,
  path text not null,
  is_write boolean not null,
  request jsonb,
  status integer,
  response jsonb,
  usage jsonb,
  plan_path text,
  note text
);
create index if not exists meta_ads_changes_at_idx on meta_ads_changes(at);

alter table meta_ads_campaigns enable row level security;
alter table meta_ads_adsets enable row level security;
alter table meta_ads_creatives enable row level security;
alter table meta_ads_ads enable row level security;
alter table meta_ads_ad_daily enable row level security;
alter table meta_ads_ad_daily_breakdowns enable row level security;
alter table meta_ads_changes enable row level security;
