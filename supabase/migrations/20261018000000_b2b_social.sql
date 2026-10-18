-- B2B Social (docs/B2B_SOCIAL_MVP.md): posts from watched X and LinkedIn accounts, the people who replied or commented,
-- and what they said. Watched accounts are tracked_sources rows with source 'b2b_social' (kind = platform). Short-lived:
-- everything B2B lives in these three b2b_ tables and those tracked_sources rows, so it can be removed in one step.

create table if not exists b2b_posts (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references products(id) on delete cascade,
  tracked_source_id  uuid references tracked_sources(id) on delete set null,
  platform           text not null check (platform in ('x', 'linkedin')),
  external_id        text not null,
  account_handle     text not null,
  url                text,
  text               text not null default '',
  posted_at          timestamptz,
  format             text not null default 'text' check (format in ('video', 'image', 'link', 'text')),
  is_reply           boolean not null default false,
  views              bigint,
  likes              integer,
  comments           integer,
  reposts            integer,
  quotes             integer,
  bookmarks          integer,
  -- Reply tracking: X only serves replies for 7 days; each run fetches replies newer than last_reply_id.
  replies_open_until timestamptz,
  last_reply_id      text,
  replies_checked_at timestamptz,
  comments_seen      integer,
  first_seen_at      timestamptz not null default now(),
  unique (product_id, platform, external_id)
);
create index if not exists b2b_posts_product_idx on b2b_posts(product_id, posted_at desc);

-- One row per person per product. url is the key: https://x.com/<handle> or https://www.linkedin.com/in/<slug>.
create table if not exists b2b_people (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,
  url               text not null,
  name              text,
  linkedin_url      text,
  location          text,
  bio               text,
  followers         integer,
  found             boolean not null default true,
  title             text,
  employer          text,
  employer_url      text,
  company_size      text,
  company_employees integer,
  company_domain    text,
  industry          text,
  fortune500_rank   integer,
  yc_batch          text,
  enriched_at       timestamptz,
  first_seen_at     timestamptz not null default now(),
  unique (product_id, url)
);

create table if not exists b2b_comments (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  post_id       uuid not null references b2b_posts(id) on delete cascade,
  -- The reply's id on X; a hash of author and text on LinkedIn, which gives comments no id.
  external_id   text not null,
  author_url    text,
  author_name   text,
  text          text not null,
  url           text,
  posted_at     timestamptz,
  first_seen_at timestamptz not null default now(),
  unique (post_id, external_id)
);
create index if not exists b2b_comments_product_idx on b2b_comments(product_id);

alter table b2b_posts enable row level security;
alter table b2b_people enable row level security;
alter table b2b_comments enable row level security;
