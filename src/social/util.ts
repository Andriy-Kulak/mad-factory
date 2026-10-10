import type { Json } from "./types.ts";

export type JsonRecord = Record<string, unknown>;

export function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function unixTimestamp(value: unknown): string | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = text(value);
    if (candidate !== null) return candidate;
  }
  return null;
}

export function hashtagsFromText(value: string | null): string[] {
  const hashtags: string[] = [];
  for (const match of value?.matchAll(/#([\p{L}\p{N}_]+)/gu) ?? []) {
    const hashtag = match[1]!.toLowerCase();
    if (!hashtags.includes(hashtag)) hashtags.push(hashtag);
  }
  return hashtags;
}

export function rawWithoutKeys(value: JsonRecord, keys: readonly string[]): Json {
  const raw = structuredClone(value);
  const prune = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const child of candidate) prune(child);
      return;
    }
    const object = record(candidate);
    if (!object) return;
    for (const [key, child] of Object.entries(object)) {
      if (keys.includes(key) || key === "dash_manifest") delete object[key];
      else prune(child);
    }
  };
  prune(raw);
  return raw as unknown as Json;
}
