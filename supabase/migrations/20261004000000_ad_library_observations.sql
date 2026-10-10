alter table scrape_runs add column if not exists collector text;
alter table scrape_runs add column if not exists credits_used integer;

create table if not exists ad_library_observations (
  scrape_run_id     uuid not null references scrape_runs(id) on delete cascade,
  ad_id             uuid not null references ads(id) on delete cascade,
  tracked_source_id uuid references tracked_sources(id) on delete set null,
  observed_at       timestamptz not null default now(),
  sort_mode         text not null,
  rank              integer not null,
  is_active         boolean,
  collation_count   integer,
  primary key (scrape_run_id, ad_id)
);
create index if not exists ad_library_obs_ad_idx on ad_library_observations(ad_id, observed_at desc);
create index if not exists ad_library_obs_source_idx on ad_library_observations(tracked_source_id, observed_at desc);
alter table ad_library_observations enable row level security;
