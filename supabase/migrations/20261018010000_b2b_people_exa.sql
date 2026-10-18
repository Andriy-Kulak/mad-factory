-- When Exa (Fiber people data) was asked who this person is; null means not asked yet.
alter table b2b_people add column if not exists exa_checked_at timestamptz;
