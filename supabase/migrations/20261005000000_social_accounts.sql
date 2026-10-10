create table if not exists social_accounts (
  id             uuid primary key default gen_random_uuid(),
  platform       text not null,
  external_id    text,
  handle         text not null,
  display_name   text,
  bio            text,
  avatar_sha256  text references creatives(sha256),
  raw            jsonb not null default '{}',
  first_seen_at  timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (platform, handle)
);

create table if not exists social_account_snapshots (
  account_id   uuid not null references social_accounts(id) on delete cascade,
  captured_on  date not null,
  followers    integer,
  following    integer,
  posts_count  integer,
  total_likes  bigint,
  scrape_run_id uuid references scrape_runs(id) on delete set null,
  primary key (account_id, captured_on)
);

create table if not exists social_posts (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references social_accounts(id) on delete cascade,
  platform       text not null,
  external_id    text not null,
  url            text,
  kind           text not null,
  caption        text,
  posted_at      timestamptz,
  duration_s     numeric(8,2),
  audio_id       text,
  audio_title    text,
  hashtags       text[] not null default '{}',
  is_paid_partnership boolean,
  transcript     text,
  attributes     jsonb not null default '{}',
  raw            jsonb not null default '{}',
  first_seen_at  timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (platform, external_id)
);
create index if not exists social_posts_account_idx on social_posts(account_id, posted_at desc);

create table if not exists social_post_media (
  post_id  uuid not null references social_posts(id) on delete cascade,
  sha256   text not null references creatives(sha256),
  position integer not null,
  role     text not null default 'media',
  primary key (post_id, role, position)
);

create table if not exists social_post_snapshots (
  post_id      uuid not null references social_posts(id) on delete cascade,
  captured_on  date not null,
  source       text not null,
  views        bigint,
  likes        integer,
  comments     integer,
  shares       integer,
  saves        integer,
  reach        integer,
  avg_watch_ms integer,
  total_watch_ms bigint,
  skip_rate    numeric(5,2),
  follows      integer,
  profile_visits integer,
  metrics      jsonb not null default '{}',
  scrape_run_id uuid references scrape_runs(id) on delete set null,
  primary key (post_id, captured_on, source)
);

alter table social_accounts enable row level security;
alter table social_account_snapshots enable row level security;
alter table social_posts enable row level security;
alter table social_post_media enable row level security;
alter table social_post_snapshots enable row level security;
