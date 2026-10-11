import { chromium, type Browser, type Page } from "playwright";
import type { TrackedSourceRow } from "../../db/types.ts";
import type { AdSource, CollectOptions, CollectedAd } from "../types.ts";
import { META_SOURCE, findAdNodes, normalize, parseGraphqlBody, validateMetaSource } from "./normalize.ts";

/**
 * Meta Ad Library collector. Drives the public Ad Library UI with Playwright and
 * intercepts the /api/graphql responses the page makes while scrolling.
 *
 * Tracked source mapping:
 *   kind = "page"    -> value is a Meta page id
 *   kind = "keyword" -> value is a search phrase
 *   country          -> ISO code or ALL
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function buildUrl(ts: TrackedSourceRow): string {
  const p = new URLSearchParams({
    active_status: "all",
    ad_type: "all",
    country: ts.country || "ALL",
    media_type: "video",
    search_type: ts.kind === "page" ? "page" : "keyword_unordered",
  });
  if (ts.kind === "page") p.set("view_all_page_id", ts.value);
  else p.set("q", ts.value);
  return `https://www.facebook.com/ads/library/?${p.toString()}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

export const metaSource: AdSource = {
  name: META_SOURCE,
  collector: "playwright",
  sortMode: "meta_default",

  validate(ts) {
    validateMetaSource(ts);
  },

  async collect(ts, o: CollectOptions): Promise<CollectedAd[]> {
    metaSource.validate(ts);
    const log = o.log ?? (() => {});
    const seen = new Map<string, CollectedAd>();

    const browser: Browser = await chromium.launch({
      headless: o.headless,
      proxy: o.proxyUrl ? { server: o.proxyUrl } : undefined,
    });
    try {
      const ctx = await browser.newContext({
        userAgent: UA,
        viewport: { width: 1280, height: 900 },
        locale: "en-US",
      });
      const page: Page = await ctx.newPage();

      let pending: Promise<void>[] = [];
      page.on("response", (res) => {
        if (!res.url().includes("/api/graphql")) return;
        pending.push(
          (async () => {
            let text: string;
            try {
              text = await res.text();
            } catch {
              return;
            }
            const fresh: CollectedAd[] = [];
            for (const doc of parseGraphqlBody(text)) {
              for (const node of findAdNodes(doc)) {
                const ad = normalize(node);
                // Defensive: only keep the tracked page's own ads, so nothing Meta
                // injects into a page view (suggested/related modules) gets attributed.
                if (ts.kind === "page" && ad.advertiserId !== ts.value) continue;
                if (!seen.has(ad.externalId)) {
                  seen.set(ad.externalId, ad);
                  fresh.push(ad);
                }
              }
            }
            if (fresh.length && o.onBatch) await o.onBatch(fresh);
          })(),
        );
      });

      const url = buildUrl(ts);
      log(`open ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await sleep(jitter(2500, 4000));

      // Dismiss cookie banner if present.
      for (const label of ["Allow all cookies", "Decline optional cookies", "Only allow essential cookies"]) {
        const btn = page.getByRole("button", { name: label }).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click().catch(() => {});
          break;
        }
      }

      let stale = 0;
      let lastCount = 0;
      while (seen.size < o.maxAds && stale < 4) {
        await page.mouse.wheel(0, jitter(1500, 2500));
        await sleep(jitter(1200, 2500));
        await Promise.allSettled(pending);
        pending = [];
        if (seen.size === lastCount) stale++;
        else stale = 0;
        lastCount = seen.size;
      }

      await Promise.allSettled(pending);
    } finally {
      await browser.close();
    }
    return [...seen.values()].slice(0, o.maxAds);
  },
};
