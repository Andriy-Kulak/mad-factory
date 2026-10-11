-- Starred competitor ads and organic posts, per product. Unstarring sets `favorited = false` so rows are never deleted.
create table if not exists favorites (
  product_id uuid not null references products(id) on delete cascade,
  kind       text not null check (kind in ('ad', 'post')),
  target_id  uuid not null,
  favorited  boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (product_id, kind, target_id)
);

alter table favorites enable row level security;

drop trigger if exists favorites_set_updated_at on favorites;
create trigger favorites_set_updated_at before update on favorites for each row execute function set_updated_at();
