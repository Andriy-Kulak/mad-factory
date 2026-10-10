-- A log entry with due_on is a follow-up: something an agent promised to come back to. The daily review lists
-- every open one (resolved_at null) whose day has come, so a promise outlives the chat session that made it.
alter table experiment_log add column if not exists due_on date;
alter table experiment_log add column if not exists resolved_at timestamptz;
create index if not exists experiment_log_open_follow_ups_idx on experiment_log(due_on) where due_on is not null and resolved_at is null;
