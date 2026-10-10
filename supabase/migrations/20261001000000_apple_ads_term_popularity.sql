-- Apple's relative keyword popularity (0-100, cross-storefront) per term, as returned by
-- POST /suggestions/keywords/query when seeded with that term alone. Written by `pnpm apple-ads research`.
-- popularity null = Apple returned nothing for the term. 5 is Apple's floor.
create table if not exists apple_ads_term_popularity (
  product_id  uuid not null references products(id) on delete cascade,
  country     text not null,
  term        text not null,
  popularity  integer,
  source      text not null default 'suggestions/keywords',
  pulled_at   timestamptz not null default now(),
  primary key (product_id, country, term)
);
-- No policies: only the service-role key (server-side) reads or writes it.
alter table apple_ads_term_popularity enable row level security;
