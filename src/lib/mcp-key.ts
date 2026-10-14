import { createHash, randomBytes } from "node:crypto";

/** A new agent key: `mf_` + 256 random bits. Shown once; only its hash is stored. */
export const newMcpKey = () => `mf_${randomBytes(32).toString("base64url")}`;

export const hashMcpKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** read = every read tool; research = also add competitor/inspiration sources and star items. Never ad-account writes. */
export const MCP_KEY_SCOPES = ["read", "research"] as const;
export type McpKeyScope = (typeof MCP_KEY_SCOPES)[number];
export const isMcpKeyScope = (v: unknown): v is McpKeyScope => (MCP_KEY_SCOPES as readonly unknown[]).includes(v);
