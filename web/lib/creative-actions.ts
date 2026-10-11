"use server";

import { requireOwner } from "./auth/server";
import { getCreativeProfile } from "./creatives";

/** The creative preview's breakdown (transcript, mechanism, people…), fetched when a creative is opened. */
export async function loadCreativeProfile(sha256: string) {
  await requireOwner();
  return getCreativeProfile(sha256);
}
