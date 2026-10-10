-- The number a product is working towards, so every agent can check its work against it (`pnpm scorecard`).
-- monthly_profit = RevenueCat proceeds (after store fees and taxes) − ad spend from every channel's daily table
--                  − monthly_fixed_costs (prorated by day; null = not set yet).
create table if not exists product_goals (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references products(id) on delete cascade,
  metric              text not null check (metric in ('monthly_profit')),
  target              numeric(12,2) not null,
  currency            text not null default 'USD',
  monthly_fixed_costs numeric(12,2),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (product_id, metric)
);

drop trigger if exists product_goals_set_updated_at on product_goals;
create trigger product_goals_set_updated_at
  before update on product_goals
  for each row execute function set_updated_at();

-- No policies: only the service-role key (server-side) reads or writes it.
alter table product_goals enable row level security;
