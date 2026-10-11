import { hashMcpKey, newMcpKey } from "../lib/mcp-key.ts";
import { getDb, unwrap } from "./client.ts";
import type { McpApiKeyRow } from "./types.ts";

/** Creates a key for an agent and returns it in plain text (the only time it exists outside the agent). */
export async function createMcpKey(name: string): Promise<{ row: McpApiKeyRow; key: string }> {
  const key = newMcpKey();
  const res = await getDb()
    .from("mcp_api_keys")
    .insert({ name, key_hash: hashMcpKey(key) })
    .select("*")
    .single();
  if (res.error?.code === "23505") throw new Error(`An active key named "${name}" exists; revoke it first or pick another name`);
  return { row: unwrap(res, "createMcpKey"), key };
}

export async function listMcpKeys(): Promise<McpApiKeyRow[]> {
  return unwrap(await getDb().from("mcp_api_keys").select("*").order("created_at"), "listMcpKeys");
}

export async function revokeMcpKey(name: string): Promise<McpApiKeyRow> {
  const res = await getDb().from("mcp_api_keys").update({ revoked_at: new Date().toISOString() }).eq("name", name).is("revoked_at", null).select("*").maybeSingle();
  if (res.error) throw new Error(`revokeMcpKey: ${res.error.message}`);
  if (!res.data) throw new Error(`No active key named "${name}"`);
  return res.data;
}

/** The active key row for a presented key (and stamps last_used_at), or null. */
export async function findActiveMcpKey(key: string): Promise<McpApiKeyRow | null> {
  const db = getDb();
  const res = await db.from("mcp_api_keys").select("*").eq("key_hash", hashMcpKey(key)).is("revoked_at", null).maybeSingle();
  if (res.error) throw new Error(`findActiveMcpKey: ${res.error.message}`);
  if (res.data) await db.from("mcp_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", res.data.id);
  return res.data;
}
