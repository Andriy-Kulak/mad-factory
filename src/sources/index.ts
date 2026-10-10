import type { AdSource } from "./types.ts";
import { metaSource } from "./meta/collector.ts";
import { scrapeCreatorsSource } from "./meta/scrapecreators.ts";

/** Registry of ad sources keyed by the `source` value used in the DB. Add new sources here. */
interface SourceRegistration {
  defaultCollector: string;
  collectors: Record<string, AdSource>;
}

const SOURCES: Record<string, SourceRegistration> = {
  [metaSource.name]: {
    defaultCollector: scrapeCreatorsSource.collector,
    collectors: {
      [scrapeCreatorsSource.collector]: scrapeCreatorsSource,
      [metaSource.collector]: metaSource,
    },
  },
};

export function getSource(name: string, collector?: string): AdSource {
  const registration = SOURCES[name];
  if (!registration) throw new Error(`Unknown ad source "${name}". Known: ${Object.keys(SOURCES).join(", ")}`);
  const selected = collector ?? registration.defaultCollector;
  const source = registration.collectors[selected];
  if (!source) {
    throw new Error(`Unknown collector "${selected}" for source "${name}". Known: ${knownCollectors(name).join(", ")}`);
  }
  return source;
}

export function knownSources(): string[] {
  return Object.keys(SOURCES);
}

export function knownCollectors(name: string): string[] {
  const registration = SOURCES[name];
  if (!registration) throw new Error(`Unknown ad source "${name}". Known: ${Object.keys(SOURCES).join(", ")}`);
  return Object.keys(registration.collectors);
}

export type { AdSource, CollectOptions, CollectedAd, CollectedMedia } from "./types.ts";
