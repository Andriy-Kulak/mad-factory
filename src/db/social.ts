import { getDb, unwrap } from "./client.ts";
import type {
  SocialAccountInsert,
  SocialAccountRow,
  SocialAccountSnapshotInsert,
  SocialPostInsert,
  SocialPostMediaInsert,
  SocialPostSnapshotInsert,
} from "./types.ts";

export async function upsertSocialAccount(input: SocialAccountInsert): Promise<SocialAccountRow> {
  return unwrap(
    await getDb().from("social_accounts").upsert(input, { onConflict: "platform,handle" }).select("*").single(),
    "upsertSocialAccount",
  );
}

export async function updateSocialAccountAvatar(accountId: string, avatarSha256: string): Promise<void> {
  const res = await getDb().from("social_accounts").update({ avatar_sha256: avatarSha256 }).eq("id", accountId);
  if (res.error) throw new Error(`updateSocialAccountAvatar: ${res.error.message}`);
}

export async function upsertSocialAccountSnapshot(input: SocialAccountSnapshotInsert): Promise<void> {
  const res = await getDb()
    .from("social_account_snapshots")
    .upsert(input, { onConflict: "account_id,captured_on" });
  if (res.error) throw new Error(`upsertSocialAccountSnapshot: ${res.error.message}`);
}

export async function upsertSocialPost(input: SocialPostInsert): Promise<{ id: string; isNew: boolean }> {
  const db = getDb();
  const existing = await db
    .from("social_posts")
    .select("id")
    .eq("platform", input.platform)
    .eq("external_id", input.external_id)
    .maybeSingle();
  if (existing.error) throw new Error(`upsertSocialPost lookup: ${existing.error.message}`);

  const row = unwrap(
    await db
      .from("social_posts")
      .upsert(input, { onConflict: "platform,external_id" })
      .select("id")
      .single(),
    "upsertSocialPost",
  );
  return { id: row.id, isNew: !existing.data };
}

export async function upsertSocialPostSnapshot(input: SocialPostSnapshotInsert): Promise<void> {
  const res = await getDb()
    .from("social_post_snapshots")
    .upsert(input, { onConflict: "post_id,captured_on,source" });
  if (res.error) throw new Error(`upsertSocialPostSnapshot: ${res.error.message}`);
}

export async function hasSocialPostMedia(postId: string, role: "thumbnail" | "media"): Promise<boolean> {
  const res = await getDb()
    .from("social_post_media")
    .select("post_id", { count: "exact", head: true })
    .eq("post_id", postId)
    .eq("role", role);
  if (res.error) throw new Error(`hasSocialPostMedia: ${res.error.message}`);
  return (res.count ?? 0) > 0;
}

export async function upsertSocialPostMedia(input: SocialPostMediaInsert): Promise<void> {
  const res = await getDb()
    .from("social_post_media")
    .upsert(input, { onConflict: "post_id,role,position" });
  if (res.error) throw new Error(`upsertSocialPostMedia: ${res.error.message}`);
}
