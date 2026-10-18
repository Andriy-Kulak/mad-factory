import { createHash } from "node:crypto";
import type { B2BCommentInsert, B2BPersonInsert, B2BPostInsert } from "../db/types.ts";
import { insertB2BComments, listB2BPosts, upsertB2BPeople, upsertB2BPosts, upsertB2BSource, type B2BGroup } from "./db.ts";

/** The local snapshot format the page used before the database (web/lib/b2b-social.ts, B2BSocialData). */
export interface Snapshot {
  capturedAt: string;
  accounts: { platform: "x" | "linkedin"; handle: string; name: string; url: string; group: B2BGroup; followers: number | null; employees?: number | null; sample: "recent" | "popular" }[];
  posts: {
    platform: "x" | "linkedin";
    id: string;
    handle: string;
    url: string;
    text: string;
    postedAt: string | null;
    format: "video" | "image" | "link" | "text";
    isReply?: boolean;
    views: number | null;
    likes: number | null;
    comments: number | null;
    reposts: number | null;
    quotes: number | null;
    bookmarks: number | null;
  }[];
  comments: { postId: string; authorName: string | null; authorUrl: string | null; text: string; url?: string | null; postedAt?: string | null }[];
  people: {
    url: string;
    found: boolean;
    location: string | null;
    followers: number | null;
    employer: string | null;
    employerUrl?: string | null;
    title?: string | null;
    linkedinUrl?: string | null;
    bio?: string | null;
  }[];
  companies?: { url: string; name: string; domain: string | null; size: string | null; employees: number | null; industry: string | null; fortune500: number | null; yc?: string | null }[];
}

const REPLY_DAYS = 7;

/** A comment's id: the reply id on X, else a hash of author and text (LinkedIn gives comments no id). */
export function commentExternalId(c: { authorUrl: string | null; authorName: string | null; text: string; url?: string | null }): string {
  const fromUrl = c.url?.match(/\/status\/(\d+)/)?.[1];
  return (
    fromUrl ??
    createHash("sha256")
      .update(`${c.authorUrl ?? c.authorName ?? ""}\u0000${c.text}`)
      .digest("hex")
      .slice(0, 32)
  );
}

export async function importSnapshot(productId: string, snap: Snapshot): Promise<{ accounts: number; posts: number; people: number; comments: number }> {
  const sourceIds = new Map<string, string>();
  const repliesOn = new Set(snap.comments.map((c) => c.postId));
  const postsWithReplies = new Set(snap.posts.filter((p) => repliesOn.has(p.id)).map((p) => `${p.platform}:${p.handle}`));
  for (const a of snap.accounts) {
    const row = await upsertB2BSource(productId, a.platform, a.handle, a.name, {
      group: a.group,
      url: a.url,
      followers: a.followers,
      employees: a.employees ?? null,
      sample: a.sample,
      replies: postsWithReplies.has(`${a.platform}:${a.handle}`),
    });
    sourceIds.set(`${a.platform}:${a.handle}`, row.id);
  }

  const capturedAt = new Date(snap.capturedAt).toISOString();
  const lastReply = new Map<string, string>();
  for (const c of snap.comments) {
    const id = c.url?.match(/\/status\/(\d+)/)?.[1];
    if (id && (!lastReply.get(c.postId) || BigInt(id) > BigInt(lastReply.get(c.postId)!))) lastReply.set(c.postId, id);
  }
  const posts: B2BPostInsert[] = snap.posts.map((p) => ({
    product_id: productId,
    tracked_source_id: sourceIds.get(`${p.platform}:${p.handle}`) ?? null,
    platform: p.platform,
    external_id: p.id,
    account_handle: p.handle,
    url: p.url,
    text: p.text ?? "",
    posted_at: p.postedAt,
    format: p.format,
    is_reply: !!p.isReply,
    views: p.views,
    likes: p.likes,
    comments: p.comments,
    reposts: p.reposts,
    quotes: p.quotes,
    bookmarks: p.bookmarks,
    replies_open_until: p.postedAt && p.platform === "x" ? new Date(Date.parse(p.postedAt) + REPLY_DAYS * 86_400_000).toISOString() : null,
    last_reply_id: lastReply.get(p.id) ?? null,
    replies_checked_at: repliesOn.has(p.id) ? capturedAt : null,
    comments_seen: repliesOn.has(p.id) ? p.comments : null,
  }));
  await upsertB2BPosts(posts);

  const companies = new Map((snap.companies ?? []).map((c) => [c.url, c]));
  const people: B2BPersonInsert[] = snap.people.map((p) => {
    const c = p.employerUrl ? companies.get(p.employerUrl) : undefined;
    return {
      product_id: productId,
      url: p.url,
      linkedin_url: p.linkedinUrl ?? null,
      location: p.location,
      bio: p.bio ?? null,
      followers: p.followers,
      found: p.found,
      title: p.title ?? null,
      employer: c?.name ?? p.employer,
      employer_url: p.employerUrl && !p.employerUrl.startsWith("company:") ? p.employerUrl : null,
      company_size: c?.size ?? null,
      company_employees: c?.employees ?? null,
      company_domain: c?.domain ?? null,
      industry: c?.industry ?? null,
      fortune500_rank: c?.fortune500 ?? null,
      yc_batch: c?.yc ?? null,
      enriched_at: capturedAt,
    };
  });
  const names = new Map(snap.comments.filter((c) => c.authorUrl).map((c) => [c.authorUrl!, c.authorName]));
  for (const p of people) p.name = names.get(p.url) ?? null;
  await upsertB2BPeople(people);

  const postIds = new Map((await listB2BPosts(productId)).map((p) => [p.external_id, p.id]));
  const comments: B2BCommentInsert[] = snap.comments.flatMap((c) => {
    const postId = postIds.get(c.postId);
    if (!postId) return [];
    return [
      {
        product_id: productId,
        post_id: postId,
        external_id: commentExternalId(c),
        author_url: c.authorUrl,
        author_name: c.authorName,
        text: c.text,
        url: c.url ?? null,
        posted_at: c.postedAt ?? null,
      },
    ];
  });
  await insertB2BComments(comments);
  return { accounts: snap.accounts.length, posts: posts.length, people: people.length, comments: comments.length };
}
