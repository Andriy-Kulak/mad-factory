create table if not exists creative_profiles (
  sha256         text primary key references creatives(sha256) on delete cascade,
  schema_version integer not null,
  media_type     text not null check (media_type in ('video','image','carousel')),
  profile        jsonb not null,
  profiled_by    text not null check (profiled_by in ('llm','manual')),
  model          text,
  profiled_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table creative_profiles enable row level security;
