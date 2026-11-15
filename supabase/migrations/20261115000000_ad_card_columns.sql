-- The fields an ad card shows from the Ad Library payload, as columns. Reading them out of `raw` made the card
-- query load every ad's full payload; these are filled by Postgres from `raw`, so they can't drift from it.
alter table ads
  add column if not exists page_avatar_url text generated always as (raw->'snapshot'->>'page_profile_picture_url') stored,
  add column if not exists caption         text generated always as (raw->'snapshot'->>'caption') stored,
  add column if not exists display_format  text generated always as (raw->'snapshot'->>'display_format') stored;
