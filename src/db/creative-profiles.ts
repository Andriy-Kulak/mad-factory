import { getDb } from "./client.ts";
import type { CreativeProfileRow, Json } from "./types.ts";
import { parseCreativeProfile, type CreativeProfile } from "../creative-profiles/schema.ts";

/**
 * Store a validated creative profile for a media file. The profile's
 * schema_version, media_type and _meta.by/_meta.model fill the columns.
 */
export async function upsertCreativeProfile(sha256: string, input: unknown): Promise<CreativeProfile> {
  const profile = parseCreativeProfile(input);
  const res = await getDb()
    .from("creative_profiles")
    .upsert(
      {
        sha256,
        schema_version: profile.schema_version,
        media_type: profile.media_type,
        profile: profile as unknown as Json,
        profiled_by: profile._meta.by,
        model: profile._meta.model,
        profiled_at: profile._meta.at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sha256" },
    );
  if (res.error) throw new Error(`upsertCreativeProfile: ${res.error.message}`);
  return profile;
}

export async function getCreativeProfile(sha256: string): Promise<CreativeProfileRow | null> {
  const res = await getDb().from("creative_profiles").select("*").eq("sha256", sha256).maybeSingle();
  if (res.error) throw new Error(`getCreativeProfile: ${res.error.message}`);
  return res.data;
}
