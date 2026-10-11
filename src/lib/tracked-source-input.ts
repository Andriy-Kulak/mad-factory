import type { SocialPlatform } from "../social/types.ts";
import { getSocialCollector } from "../social/providers/index.ts";
import { validateMetaSource } from "../sources/meta/normalize.ts";

/** Turns what a user pastes (handle, @handle, or profile URL) into the tracked_sources.value the collector expects. Throws Error with a short user-readable message. */
export function parseSocialAccountInput(platform: SocialPlatform, input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error(`Enter a ${platform} handle or profile URL.`);

  const url = parseInputUrl(trimmed, `${platform} profile`);
  let value: string;

  if (url) {
    assertSocialHost(platform, url);
    switch (platform) {
      case "instagram":
        value = instagramHandle(url);
        break;
      case "tiktok":
        value = tiktokHandle(url);
        break;
      case "facebook":
        value = facebookPageUrl(url);
        break;
    }
  } else if (platform === "facebook") {
    if (!/^\d+$/.test(trimmed)) {
      throw new Error("Paste a Facebook profile URL or numeric page ID.");
    }
    value = `https://www.facebook.com/profile.php?id=${trimmed}`;
  } else {
    value = (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
  }

  return getSocialCollector(platform).validateValue(value);
}

/**
 * How an Ad Library source relates to the product: a direct competitor, or an adjacent niche tracked for
 * inspiration. Stored per product in tracked_sources.config.relation; unset means competitor.
 */
export const AD_RELATIONS = ["competitor", "inspiration"] as const;
export type AdRelation = (typeof AD_RELATIONS)[number];

export const isAdRelation = (v: unknown): v is AdRelation => (AD_RELATIONS as readonly unknown[]).includes(v);

export function adRelationOf(config: unknown): AdRelation {
  const relation = config && typeof config === "object" && !Array.isArray(config) ? (config as { relation?: unknown }).relation : undefined;
  return isAdRelation(relation) ? relation : "competitor";
}

/** An ad surfaced by several tracked sources counts as a competitor's if any of them is a competitor. */
export const mergeAdRelations = (a: AdRelation, b: AdRelation): AdRelation => (a === "competitor" || b === "competitor" ? "competitor" : "inspiration");

export interface AdLibrarySourceInput {
  kind: "page" | "keyword";
  value: string;
  country: string;
  config: { status?: "ACTIVE" | "INACTIVE" | "ALL"; relation?: AdRelation };
}

/** Accepts a numeric page id or a facebook.com/ads/library URL. Throws Error with a short user-readable message. */
export function parseAdLibraryInput(input: string): AdLibrarySourceInput {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Paste a Meta Ad Library URL or numeric page ID.");

  let parsed: AdLibrarySourceInput;
  if (/^\d+$/.test(trimmed)) {
    parsed = { kind: "page", value: trimmed, country: "US", config: {} };
  } else {
    const url = parseInputUrl(trimmed, "Meta Ad Library");
    if (!url) throw new Error("Paste a Meta Ad Library URL or numeric page ID.");
    if (!FACEBOOK_HOSTS.includes(url.hostname.toLowerCase())) {
      throw new Error("Ad Library URL must be on facebook.com.");
    }
    if (url.pathname.replace(/\/+$/, "") !== "/ads/library") {
      throw new Error("Paste a Meta Ad Library URL, not a Facebook profile or post link.");
    }

    const params = url.searchParams;
    const pageId = params.get("view_all_page_id");
    let kind: AdLibrarySourceInput["kind"];
    let value: string;
    if (pageId !== null) {
      if (!/^\d+$/.test(pageId)) throw new Error("Ad Library page ID must be numeric.");
      kind = "page";
      value = pageId;
    } else {
      const query = params.get("q");
      const searchType = params.get("search_type");
      if (query === null || !query.trim() || !searchType?.toLowerCase().startsWith("keyword_")) {
        throw new Error("Ad Library URL must contain a page ID or keyword search.");
      }
      kind = "keyword";
      value = query;
    }

    const rawCountry = params.get("country");
    const country = rawCountry === null ? "US" : rawCountry.trim().toUpperCase();
    if (!country) throw new Error("Ad Library country cannot be empty.");

    const config: AdLibrarySourceInput["config"] = {};
    const activeStatus = params.get("active_status");
    if (activeStatus !== null) {
      switch (activeStatus.trim().toLowerCase()) {
        case "active":
          config.status = "ACTIVE";
          break;
        case "inactive":
          config.status = "INACTIVE";
          break;
        case "all":
          config.status = "ALL";
          break;
        default:
          throw new Error("Ad Library status must be active, inactive, or all.");
      }
    }

    parsed = { kind, value, country, config };
  }

  validateAdLibrarySource(parsed);
  return parsed;
}

const FACEBOOK_HOSTS = ["facebook.com", "www.facebook.com", "m.facebook.com"];
const SOCIAL_HOSTS: Record<SocialPlatform, readonly string[]> = {
  instagram: ["instagram.com", "www.instagram.com"],
  tiktok: ["tiktok.com", "www.tiktok.com"],
  facebook: FACEBOOK_HOSTS,
};
const PROFILE_ROUTES = new Set(["p", "reel", "reels", "stories", "explore", "tv"]);

function parseInputUrl(input: string, label: string): URL | null {
  const isAbsolute = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  const isProtocolRelative = input.startsWith("//");
  const isPlatformDomain = /^(?:(?:www|m)\.)?(?:instagram|tiktok|facebook)\.com(?:[/?#]|$)/i.test(input);
  if (!isAbsolute && !isProtocolRelative && !input.includes("/") && !isPlatformDomain) return null;

  let url: URL;
  try {
    url = new URL(isAbsolute ? input : `https://${input.replace(/^\/\//, "")}`);
  } catch {
    throw new Error(`Enter a valid ${label} URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Use an HTTP or HTTPS ${label} URL.`);
  }
  if (url.username || url.password || url.port) {
    throw new Error(`Use a ${label} URL without login details or a custom port.`);
  }
  return url;
}

function assertSocialHost(platform: SocialPlatform, url: URL): void {
  const host = url.hostname.toLowerCase();
  const actualPlatform = (Object.keys(SOCIAL_HOSTS) as SocialPlatform[]).find((candidate) => SOCIAL_HOSTS[candidate].includes(host));
  if (actualPlatform !== platform) {
    const expectedArticle = platform === "instagram" ? "an" : "a";
    const actualArticle = actualPlatform === "instagram" ? "an" : "a";
    const expected = platformLabel(platform);
    const actual = actualPlatform ? `, not ${actualArticle} ${platformLabel(actualPlatform)} URL` : "";
    throw new Error(`Expected ${expectedArticle} ${expected} profile URL${actual}.`);
  }
}

function platformLabel(platform: SocialPlatform): string {
  return platform === "tiktok" ? "TikTok" : `${platform[0]!.toUpperCase()}${platform.slice(1)}`;
}

function instagramHandle(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (!first) throw new Error("Paste a profile link, not a post link.");
  if (PROFILE_ROUTES.has(first.toLowerCase())) {
    throw new Error("Paste a profile link, not a post link.");
  }
  if (segments.length > 2 || (segments.length === 2 && segments[1]?.toLowerCase() !== "reels")) {
    throw new Error("Paste an Instagram profile link, not a post link.");
  }
  return first.toLowerCase();
}

function tiktokHandle(url: URL): string {
  const first = url.pathname.split("/").filter(Boolean)[0];
  if (!first?.startsWith("@") || first.length === 1) {
    throw new Error("TikTok profile URLs must include an @handle.");
  }
  return first.slice(1).toLowerCase();
}

function facebookPageUrl(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (!first) throw new Error("Paste a Facebook profile URL, not a post link.");
  if (first.toLowerCase() === "profile.php") {
    const id = url.searchParams.get("id");
    if (segments.length !== 1 || !id || !/^\d+$/.test(id)) {
      throw new Error("Facebook profile links must include a numeric page ID.");
    }
    return `https://www.facebook.com/profile.php?id=${id}`;
  }
  if (segments.length > 2 || (segments.length === 2 && segments[1]?.toLowerCase() !== "reels")) {
    throw new Error("Paste a Facebook profile URL, not a post link.");
  }
  return `https://www.facebook.com/${first}`;
}

function validateAdLibrarySource(input: AdLibrarySourceInput): void {
  validateMetaSource({ id: "input", source: "meta", kind: input.kind, value: input.value });
}
