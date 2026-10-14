import { parseArgs } from "node:util";
import { createMcpKey, listMcpKeys, revokeMcpKey } from "../db/index.ts";
import { isMcpKeyScope, MCP_KEY_SCOPES } from "../lib/mcp-key.ts";

const HELP = `Usage: pnpm mcp-key <command> [options]

Keys for agents (Grok, Claude, scripts…) that call the MCP endpoint at <web app>/api/mcp with
"Authorization: Bearer <key>". One key per agent, so one can be revoked without touching the others.
A key is read-only unless created with --scope research, which also lets the agent follow competitor and
inspiration Ad Library pages and social accounts and star or unstar ads and posts. No key can change an ad
account or delete anything.

Commands:
  create --name <agent> [--scope read|research]
                          Create a key and print it once (only its SHA-256 is stored); scope defaults to read
  list                    Keys with when they were created, last used and revoked
  revoke --name <agent>   Revoke the agent's active key (the row stays, for history)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { name: { type: "string" }, scope: { type: "string", default: "read" }, help: { type: "boolean", short: "h", default: false } },
});
const [cmd] = positionals;
if (values.help || !cmd) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}
const name = () => {
  const n = values.name?.trim();
  if (!n) throw new Error("--name <agent> is required");
  return n;
};

switch (cmd) {
  case "create": {
    if (!isMcpKeyScope(values.scope)) throw new Error(`--scope must be one of: ${MCP_KEY_SCOPES.join(", ")}`);
    const { row, key } = await createMcpKey(name(), values.scope);
    console.log(`${row.scope} key for "${row.name}" (${row.id}). Shown once; store it in the agent's secret settings:\n\n${key}\n`);
    break;
  }
  case "list": {
    const rows = await listMcpKeys();
    if (!rows.length) console.log("No keys yet: pnpm mcp-key create --name <agent>");
    for (const r of rows)
      console.log(
        `${r.name.padEnd(20)} ${r.scope.padEnd(8)} created ${r.created_at.slice(0, 10)}  last used ${r.last_used_at?.slice(0, 16).replace("T", " ") ?? "never"}  ${r.revoked_at ? `REVOKED ${r.revoked_at.slice(0, 10)}` : "active"}`,
      );
    break;
  }
  case "revoke": {
    const row = await revokeMcpKey(name());
    console.log(`Revoked "${row.name}" (${row.id})`);
    break;
  }
  default:
    console.error(`Unknown command "${cmd}"\n\n${HELP}`);
    process.exit(1);
}
