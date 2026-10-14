import "server-only";
import { cachedByProduct } from "./cache";
import { getDb } from "./db";
import { fetchAll } from "./apple-ads";
import { daysBetween } from "./format";
import { adSourceRelations } from "./tracked-sources";
import { mergeAdRelations, type AdRelation } from "../../src/lib/tracked-source-input.ts";
import type { CreativeFields, CreativeItem, RunBucket } from "./creative-groups.ts";

/** The parts of a creative_profiles.profile the Creatives tab reads (spec: docs/creative-profile.md). */
export interface ProfileView {
  hook: { spoken: string | null; onscreen_text: string | null; visual: string | null; type: string | null };
  script: { transcript: string | null; structure: string | null } | null;
  strategy: {
    awareness: string | null;
    strategic_response: string | null;
    claim_type: string | null;
    mechanism: string | null;
    identity: string | null;
    angle: string | null;
    angle_suggestion?: string | null;
    audience: string | null;
    pain_points: string[];
    desires: string[];
    features: string[];
    proof: string[];
  };
  production: { format: string | null; visual_style: string | null; setting: string | null; length_s: number | null };
  people: { role: string; gender: string | null; age_band: string | null; ethnicity: string | null }[];
}

const CHUNK = 100;

/** Just the profile fields the grid and breakdown table use; transcripts and the rest load on demand. */
const SLIM_PROFILE = [
  "sha256",
  "hook_spoken:profile->hook->>spoken",
  "hook_onscreen:profile->hook->>onscreen_text",
  "hook_visual:profile->hook->>visual",
  "hook_type:profile->hook->>type",
  "angle:profile->strategy->>angle",
  "angle_suggestion:profile->strategy->>angle_suggestion",
  "audience:profile->strategy->>audience",
  "awareness:profile->strategy->>awareness",
  "response:profile->strategy->>strategic_response",
  "format:profile->production->>format",
  "style:profile->production->>visual_style",
  "structure:profile->script->>structure",
].join(",");
type SlimProfile = CreativeFields & { sha256: string; hook_spoken: string | null; hook_onscreen: string | null; hook_visual: string | null };
const slim = (p: SlimProfile): Pick<CreativeItem, "hook" | "fields"> => ({
  hook: { spoken: p.hook_spoken, onscreen: p.hook_onscreen, visual: p.hook_visual },
  fields: {
    angle: p.angle,
    angle_suggestion: p.angle_suggestion,
    audience: p.audience,
    hook_type: p.hook_type,
    awareness: p.awareness,
    response: p.response,
    format: p.format,
    style: p.style,
    structure: p.structure,
  },
});

/** A media file's hook lines and groupable profile fields, as the Creatives grid and the Insights tables use them. */
export type SlimCreative = Pick<CreativeItem, "hook" | "fields">;

/** Slim profiles for these media files; files without a profile are left out of the map. */
export async function loadSlimProfiles(shas: string[]): Promise<Map<string, SlimCreative>> {
  const out = new Map<string, SlimCreative>();
  await Promise.all(
    chunks([...new Set(shas)]).map(async (part) => {
      const res = await getDb().from("creative_profiles").select(SLIM_PROFILE).in("sha256", part);
      if (res.error) throw new Error(`creative_profiles: ${res.error.message}`);
      for (const row of (res.data ?? []) as unknown as SlimProfile[]) out.set(row.sha256, slim(row));
    }),
  );
  return out;
}

function chunks<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += CHUNK) out.push(values.slice(i, i + CHUNK));
  return out;
}

function bucketOf(days: number | null, active: boolean | null): RunBucket | null {
  if (days == null) return null;
  if (days >= 30) return "long";
  if (active === false && days < 14) return "stopped";
  return "mid";
}

/** Every profiled media file for a product: own Meta creatives first, then Ad Library media by run length. */
export async function listCreativeItems(productId: string): Promise<CreativeItem[]> {
  const db = getDb();
  type LibraryRow = {
    tracked_source_id: string | null;
    ads: { advertiser_name: string | null; start_date: string | null; end_date: string | null; is_active: boolean | null; ad_creatives: { sha256: string }[] };
  };
  const [ownCreatives, library, relations] = await Promise.all([
    fetchAll<{ id: string; sha256: string | null }>(
      (a, b) => db.from("meta_ads_creatives").select("id, sha256").eq("product_id", productId).not("sha256", "is", null).order("id").range(a, b),
      "meta_ads_creatives",
    ),
    fetchAll<LibraryRow>(
      (a, b) =>
        db
          .from("product_ads")
          .select("tracked_source_id, ads!inner(advertiser_name, start_date, end_date, is_active, ad_creatives!inner(sha256))")
          .eq("product_id", productId)
          .order("ad_id")
          .range(a, b) as unknown as PromiseLike<{ data: LibraryRow[] | null; error: { message: string } | null }>,
      "product_ads",
    ),
    adSourceRelations(productId),
  ]);

  const ownNames = new Map<string, Set<string>>();
  const creativeIds = ownCreatives.map((c) => c.id);
  for (const ids of chunks(creativeIds)) {
    const res = await db.from("meta_ads_ads").select("name, creative_id").in("creative_id", ids);
    if (res.error) throw new Error(`meta_ads_ads: ${res.error.message}`);
    const shaById = new Map(ownCreatives.map((c) => [c.id, c.sha256!]));
    for (const ad of res.data ?? []) {
      const sha = ad.creative_id ? shaById.get(ad.creative_id) : undefined;
      if (sha) (ownNames.get(sha) ?? ownNames.set(sha, new Set()).get(sha)!).add(ad.name);
    }
  }
  for (const c of ownCreatives) if (!ownNames.has(c.sha256!)) ownNames.set(c.sha256!, new Set());

  // A media file can back several Ad Library ads; keep its longest run. It's a direct competitor's if any of those
  // ads came from a competitor source.
  const comp = new Map<string, { source: string; days: number | null; active: boolean | null; relation: AdRelation }>();
  for (const row of library) {
    const ad = row.ads;
    const days = daysBetween(ad.start_date, ad.is_active ? null : ad.end_date);
    const relation = relations.get(row.tracked_source_id ?? "") ?? "competitor";
    for (const { sha256 } of ad.ad_creatives ?? []) {
      if (ownNames.has(sha256)) continue;
      const prev = comp.get(sha256);
      if (!prev || (days ?? -1) > (prev.days ?? -1)) {
        comp.set(sha256, {
          source: ad.advertiser_name ?? "Unknown advertiser",
          days,
          active: ad.is_active || prev?.active === true,
          relation: prev ? mergeAdRelations(prev.relation, relation) : relation,
        });
      } else {
        if (ad.is_active) prev.active = true;
        prev.relation = mergeAdRelations(prev.relation, relation);
      }
    }
  }

  const shas = [...ownNames.keys(), ...comp.keys()];
  const media = new Map<string, { media_type: string; public_url: string | null }>();
  const [profiles] = await Promise.all([
    loadSlimProfiles(shas),
    ...chunks(shas).map(async (part) => {
      const m = await db.from("creatives").select("sha256, media_type, public_url").in("sha256", part);
      if (m.error) throw new Error(`creatives: ${m.error.message}`);
      for (const row of m.data ?? []) media.set(row.sha256, row);
    }),
  ]);

  const items: CreativeItem[] = [];
  for (const [sha256, names] of ownNames) {
    const profile = profiles.get(sha256);
    if (!profile) continue;
    items.push({
      sha256,
      mediaType: media.get(sha256)?.media_type ?? "video",
      url: media.get(sha256)?.public_url ?? null,
      owner: "own",
      source: [...names].sort().join(", ") || "Own creative",
      days: null,
      active: null,
      bucket: null,
      ...profile,
    });
  }
  const competitors: CreativeItem[] = [];
  for (const [sha256, c] of comp) {
    const profile = profiles.get(sha256);
    if (!profile) continue;
    competitors.push({
      sha256,
      mediaType: media.get(sha256)?.media_type ?? "video",
      url: media.get(sha256)?.public_url ?? null,
      owner: c.relation,
      source: c.source,
      days: c.days,
      active: c.active,
      bucket: bucketOf(c.days, c.active),
      ...profile,
    });
  }
  competitors.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  return [...items, ...competitors];
}

export const listCreativeItemsCached = cachedByProduct("creativeItems", listCreativeItems);

/** Full profile for one media file, for the creative preview (the list only loads SLIM_PROFILE). */
export async function getCreativeProfile(sha256: string): Promise<ProfileView | null> {
  const res = await getDb().from("creative_profiles").select("profile").eq("sha256", sha256).maybeSingle();
  if (res.error) throw new Error(`creative_profiles: ${res.error.message}`);
  return (res.data?.profile as unknown as ProfileView) ?? null;
}
