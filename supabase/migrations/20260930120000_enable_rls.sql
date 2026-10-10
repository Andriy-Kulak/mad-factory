-- Row level security on every table in public, with no policies: Supabase's anon and authenticated roles
-- (the public API key and signed-in users) can no longer read or write anything. Everything in this repo uses
-- the service-role key server-side, which bypasses RLS, so nothing else changes.
-- New tables must enable RLS in their own migration; this covers the tables that exist when it runs.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
