import { parseArgs } from "node:util";
import { createMcpKey, listMcpKeys, revokeMcpKey } from "../db/index.ts";

const HELP = `Usage: pnpm mcp-key <command> [options]

Keys for agents (Grok, Claude, scripts…) that call the read-only MCP endpoint at <web app>/api/mcp with
"Authorization: Bearer <key>". One key per agent, so one can be revoked without touching the others.

Commands:
  create --name <agent>   Create a key and print it once (only its SHA-256 is stored)
  list                    Keys with when they were created, last used and revoked
  revoke --name <agent>   Revoke the agent's active key (the row stays, for history)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { name: { type: "string" }, help: { type: "boolean", short: "h", default: false } },
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
    const { row, key } = await createMcpKey(name());
    console.log(`Key for "${row.name}" (${row.id}). Shown once; store it in the agent's secret settings:\n\n${key}\n`);
    break;
  }
  case "list": {
    const rows = await listMcpKeys();
    if (!rows.length) console.log("No keys yet: pnpm mcp-key create --name <agent>");
    for (const r of rows)
      console.log(
        `${r.name.padEnd(20)} created ${r.created_at.slice(0, 10)}  last used ${r.last_used_at?.slice(0, 16).replace("T", " ") ?? "never"}  ${r.revoked_at ? `REVOKED ${r.revoked_at.slice(0, 10)}` : "active"}`,
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
