import { requireEnv } from "../lib/env.ts";

/** X API v2, pay per use: about $0.005 per post and $0.01 per user returned. */
export const X_POST_USD = 0.005;
export const X_USER_USD = 0.01;

export interface XUser {
  id: string;
  username: string;
  name: string;
  description?: string;
  location?: string;
  public_metrics?: { followers_count?: number };
}

export interface XPost {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  attachments?: { media_keys?: string[] };
  entities?: { urls?: unknown[] };
  public_metrics?: { retweet_count?: number; reply_count?: number; like_count?: number; quote_count?: number; bookmark_count?: number; impression_count?: number };
}

export interface XPage {
  data?: XPost[];
  includes?: { users?: XUser[]; media?: { media_key: string; type: string }[] };
  meta?: { newest_id?: string; next_token?: string; result_count?: number };
}

export async function xGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, "https://api.x.com");
  url.search = new URLSearchParams(params).toString();
  const res = await fetch(url, { headers: { authorization: `Bearer ${requireEnv("X_BEARER_TOKEN")}` } });
  const body = (await res.json().catch(() => ({}))) as T & { detail?: string; title?: string };
  if (!res.ok) throw new Error(`X API ${res.status} on ${url.pathname}: ${body.detail ?? body.title ?? res.statusText}`);
  return body;
}

export const POST_FIELDS = "created_at,public_metrics,attachments,entities,author_id";

/** The post's format from its attached media and links. */
export function xFormat(post: XPost, media: Map<string, string>): "video" | "image" | "link" | "text" {
  const types = (post.attachments?.media_keys ?? []).map((k) => media.get(k));
  if (types.some((t) => t === "video" || t === "animated_gif")) return "video";
  if (types.length) return "image";
  return post.entities?.urls?.length ? "link" : "text";
}
