-- RevenueCat outcomes per Apple Ads keyword, from RevenueCat Charts segmented by its Apple Ads attribution.
-- Which RevenueCat project belongs to which product is a tracked_sources row
-- (source = 'revenuecat', kind = 'project', value = RevenueCat project ID, config.currency).
--
-- RevenueCat attributes a customer (not each transaction) to the campaign and keyword Apple reports for the
-- install, so every trial, conversion and payment of that customer counts towards that keyword.
-- campaign/keyword are RevenueCat's names; '' = not attributed ("No campaign" / "No keyword").
-- apple_* ids are filled when the names match a synced Apple Ads campaign and keyword, for joining with
-- apple_ads_keyword_daily. Dates are RevenueCat chart days (UTC).
create table if not exists revenuecat_keyword_daily (
  tracked_source_id  uuid not null references tracked_sources(id) on delete cascade,
  product_id         uuid not null references products(id) on delete cascade,
  date               date not null,
  campaign           text not null default '',
  keyword            text not null default '',
  apple_campaign_id  bigint,
  apple_keyword_id   bigint,
  new_trials         integer not null default 0,
  trial_conversions  integer not null default 0,
  paid_subscriptions integer not null default 0,
  transactions       integer not null default 0,
  revenue            numeric(12,2) not null default 0,
  proceeds           numeric(12,2) not null default 0,
  currency           text not null,
  incomplete         boolean not null default false,
  synced_at          timestamptz not null default now(),
  primary key (tracked_source_id, date, campaign, keyword)
);
create index if not exists revenuecat_keyword_daily_product_idx on revenuecat_keyword_daily(product_id, date);
create index if not exists revenuecat_keyword_daily_apple_keyword_idx on revenuecat_keyword_daily(apple_keyword_id, date);
-- No policies: only the service-role key (server-side) reads or writes it.
alter table revenuecat_keyword_daily enable row level security;
