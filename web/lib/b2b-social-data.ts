import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { B2BSocialData } from "./b2b-social";

/** local/<slug>/b2b-social.json at the repo root: gitignored, so the snapshot never leaves this machine. */
export function b2bSocialPath(slug: string): string {
  return resolve(process.cwd(), "..", "local", slug, "b2b-social.json");
}

/** Null when the product has no snapshot. */
export async function loadB2BSocial(slug: string): Promise<B2BSocialData | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    return JSON.parse(await readFile(b2bSocialPath(slug), "utf8")) as B2BSocialData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
