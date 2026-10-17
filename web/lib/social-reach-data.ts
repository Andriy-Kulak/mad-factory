import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SocialReachData } from "./social-reach";

/** local/<slug>/social-reach.json at the repo root: gitignored, so the snapshot never leaves this machine. */
export function socialReachPath(slug: string): string {
  return resolve(process.cwd(), "..", "local", slug, "social-reach.json");
}

/** Null when the product has no snapshot. */
export async function loadSocialReach(slug: string): Promise<SocialReachData | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    return JSON.parse(await readFile(socialReachPath(slug), "utf8")) as SocialReachData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
