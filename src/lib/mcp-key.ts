import { createHash, randomBytes } from "node:crypto";

/** A new agent key: `mf_` + 256 random bits. Shown once; only its hash is stored. */
export const newMcpKey = () => `mf_${randomBytes(32).toString("base64url")}`;

export const hashMcpKey = (key: string) => createHash("sha256").update(key).digest("hex");
