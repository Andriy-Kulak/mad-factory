-- Dated narrative history of an experiment: what was read, what was changed, what was decided and when.
-- The facts behind a change stay in the channel journal (e.g. apple_ads_changes); this table holds the
-- reasoning that used to live in the write-up's "## Log" section, so the web app and automations can read it.
create table if not exists experiment_log (
  id            uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references experiments(id) on delete cascade,
  at            timestamptz not null default now(),
  actor         text not null,
  kind          text not null check (kind in ('observation', 'change', 'decision', 'review', 'note')),
  body          text not null,
  plan_path     text,
  source_url    text,
  created_at    timestamptz not null default now()
);
create index if not exists experiment_log_experiment_idx on experiment_log(experiment_id, at);

alter table experiment_log enable row level security;
