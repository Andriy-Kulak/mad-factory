import { scrapeCreatorsFacebookCollector } from "./scrapecreators/facebook/collect.ts";
import { scrapeCreatorsInstagramCollector } from "./scrapecreators/instagram/collect.ts";
import { scrapeCreatorsTikTokCollector } from "./scrapecreators/tiktok/collect.ts";
import { SOCIAL_PLATFORMS } from "../types.ts";
import type { SocialCollector, SocialPlatform } from "../types.ts";

const providers = {
  scrapecreators: {
    instagram: scrapeCreatorsInstagramCollector,
    tiktok: scrapeCreatorsTikTokCollector,
    facebook: scrapeCreatorsFacebookCollector,
  },
} satisfies Record<string, Record<SocialPlatform, SocialCollector>>;

export function knownSocialProviders(): string[] {
  return Object.keys(providers);
}

export function getSocialCollector(platform: SocialPlatform, provider = "scrapecreators"): SocialCollector {
  if (!(SOCIAL_PLATFORMS as readonly string[]).includes(platform)) {
    throw new Error(`Unsupported social platform "${platform}"`);
  }
  const collector = providers[provider as keyof typeof providers]?.[platform];
  if (!collector) {
    throw new Error(`Unsupported social provider "${provider}" for platform "${platform}"`);
  }
  return collector;
}
