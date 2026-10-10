alter table product_docs add column if not exists kind text not null default 'brand';
alter table product_docs drop constraint if exists product_docs_kind_check;
alter table product_docs add constraint product_docs_kind_check check (kind in ('brand','research','plan','writeup'));
update product_docs set kind = 'research' where name like 'research-%' and kind = 'brand';
create index if not exists product_docs_kind_idx on product_docs (product_id, kind);
