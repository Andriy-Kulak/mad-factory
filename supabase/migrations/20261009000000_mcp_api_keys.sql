-- One key per agent (Grok, Claude, a script…) for the read-only MCP endpoint at /api/mcp. Only the SHA-256 of the
-- key is stored; the key itself is printed once by `pnpm mcp-key create`. Revoking sets revoked_at, so the name can
-- be reused and the history stays.
create table if not exists mcp_api_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  key_hash     text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create unique index if not exists mcp_api_keys_active_name_idx on mcp_api_keys(name) where revoked_at is null;

-- No policies: only the service-role key (server-side) reads or writes it.
alter table mcp_api_keys enable row level security;
