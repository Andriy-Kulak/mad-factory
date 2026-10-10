/** Infrastructure-only environment access. Product data never comes from env. */
import { INTEGRATIONS, MissingConfigError, missingConfigMessage } from "./integrations.ts";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (v) return v;
  const it = INTEGRATIONS.find((i) => i.env.some((g) => g.includes(name)));
  throw new MissingConfigError(it ? missingConfigMessage(it.key) : `Missing environment variable ${name} (see .env.example)`);
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length ? v : undefined;
}
