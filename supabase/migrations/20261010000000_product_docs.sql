create table if not exists product_docs (
  product_id uuid not null references products(id) on delete cascade,
  name       text not null,
  title      text,
  body_md    text not null,
  sort       int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (product_id, name)
);

alter table product_docs enable row level security;

drop trigger if exists product_docs_set_updated_at on product_docs;
create trigger product_docs_set_updated_at before update on product_docs for each row execute function set_updated_at();
