-- What an MCP key may do. read = every read tool; research = also follow competitor/inspiration Ad Library pages and
-- social accounts and star or unstar ads and posts. No scope can change an ad account or delete anything.
alter table mcp_api_keys add column if not exists scope text not null default 'read' check (scope in ('read', 'research'));
