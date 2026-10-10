import type { TrackedSourceRow } from "../../db/types.ts";
import type { CollectedAd, CollectedMedia } from "../types.ts";

export const META_SOURCE = "meta";

export const META_KINDS = ["page", "keyword"] as const;
export type MetaKind = (typeof META_KINDS)[number];

/** Shared by both Meta collectors and the web's source form; kept here so neither needs Playwright to validate. */
export function validateMetaSource(ts: Pick<TrackedSourceRow, "id" | "source" | "kind" | "value">): void {
  if (ts.source !== META_SOURCE) throw new Error(`tracked source ${ts.id} is not a meta source`);
  if (!(META_KINDS as readonly string[]).includes(ts.kind)) {
    throw new Error(`meta tracked source ${ts.id}: kind must be one of ${META_KINDS.join(", ")}`);
  }
  if (!ts.value) throw new Error(`meta tracked source ${ts.id}: value is empty`);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function unixToDate(v: unknown): Date | null {
  return typeof v === "number" && v > 0 ? new Date(v * 1000) : null;
}

/** Recursively find every object that looks like an Ad Library result node. */
export function findAdNodes(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const v of value) findAdNodes(v, out);
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.ad_archive_id === "string" && obj.snapshot && typeof obj.snapshot === "object") {
      out.push(obj);
      return out;
    }
    for (const v of Object.values(obj)) findAdNodes(v, out);
  }
  return out;
}

function extractMedia(snapshot: Record<string, unknown>): CollectedMedia[] {
  const media: CollectedMedia[] = [];
  const image = (o: Record<string, unknown>) => {
    const hd = str(o.original_image_url);
    const sd = str(o.resized_image_url);
    if (hd || sd) media.push({ kind: "image", hdUrl: hd, sdUrl: sd, previewUrl: null });
  };
  if (Array.isArray(snapshot.videos)) {
    for (const c of snapshot.videos) {
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      const hd = str(o.video_hd_url);
      const sd = str(o.video_sd_url);
      if (hd || sd) media.push({ kind: "video", hdUrl: hd, sdUrl: sd, previewUrl: str(o.video_preview_image_url) });
    }
  }
  if (Array.isArray(snapshot.images)) {
    for (const c of snapshot.images) {
      if (!c || typeof c !== "object") continue;
      image(c as Record<string, unknown>);
    }
  }
  if (Array.isArray(snapshot.cards)) {
    for (const c of snapshot.cards) {
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      const hd = str(o.video_hd_url);
      const sd = str(o.video_sd_url);
      if (hd || sd) {
        media.push({ kind: "video", hdUrl: hd, sdUrl: sd, previewUrl: str(o.video_preview_image_url) });
      } else {
        image(o);
      }
    }
  }
  return media;
}

export function normalize(node: Record<string, unknown>): CollectedAd {
  const snap = node.snapshot as Record<string, unknown>;
  const body = snap.body as Record<string, unknown> | undefined;
  return {
    source: META_SOURCE,
    externalId: node.ad_archive_id as string,
    advertiserId: str(node.page_id) ?? str(snap.page_id),
    advertiserName: str(node.page_name) ?? str(snap.page_name),
    bodyText: body ? str(body.text) : null,
    title: str(snap.title),
    linkUrl: str(snap.link_url),
    ctaText: str(snap.cta_text),
    startDate: unixToDate(node.start_date),
    endDate: unixToDate(node.end_date),
    isActive: typeof node.is_active === "boolean" ? node.is_active : null,
    platforms: Array.isArray(node.publisher_platform)
      ? node.publisher_platform.filter((p): p is string => typeof p === "string")
      : [],
    collationId: str(node.collation_id),
    collationCount: num(node.collation_count),
    reachEstimate: node.reach_estimate ?? null,
    spend: node.spend ?? null,
    currency: str(node.currency),
    totalActiveTime: node.total_active_time ?? null,
    media: extractMedia(snap),
    raw: node,
  };
}

/** GraphQL responses may be several JSON documents separated by newlines. */
export function parseGraphqlBody(text: string): unknown[] {
  const docs: unknown[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      docs.push(JSON.parse(t));
    } catch {
      /* partial chunk, ignore */
    }
  }
  return docs;
}
