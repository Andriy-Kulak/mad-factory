"use server";

import { getCreativeProfile } from "./creatives";

/** The creative preview's breakdown (transcript, mechanism, people…), fetched when a creative is opened. */
export async function loadCreativeProfile(sha256: string) {
  return getCreativeProfile(sha256);
}
