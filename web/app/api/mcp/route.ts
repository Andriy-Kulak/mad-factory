import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp/server";
import { findActiveMcpKey } from "../../../../src/db/index.ts";

export const dynamic = "force-dynamic";

/** MCP over Streamable HTTP, stateless: each request gets a fresh server. Auth is a per-agent bearer key; its scope decides whether research writes are offered. */
async function handle(req: Request): Promise<Response> {
  const key = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const row = key ? await findActiveMcpKey(key) : null;
  if (!row) {
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid key. Send Authorization: Bearer <key> (the owner creates one with `pnpm mcp-key create --name <agent>`)." }, id: null },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="mad-factory"' } },
    );
  }
  const server = buildMcpServer({ scope: row.scope === "research" ? "research" : "read", name: row.name });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
