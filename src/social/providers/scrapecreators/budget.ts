import { scrapeCreatorsGet } from "../../../lib/scrapecreators.ts";
import type { SocialCollectOptions, SocialPlatform } from "../../types.ts";

export function createCreditBudget(
  platform: SocialPlatform,
  options: Pick<SocialCollectOptions, "maxCredits" | "onUsage">,
): {
  get(path: string, params: Record<string, string>): Promise<Record<string, unknown>>;
  readonly creditsUsed: number;
  readonly creditsRemaining: number | null;
} {
  if (!Number.isInteger(options.maxCredits) || options.maxCredits <= 0) {
    throw new Error("maxCredits must be a positive integer");
  }

  let creditsUsed = 0;
  let creditsRemaining: number | null = null;
  return {
    async get(path, params) {
      if (creditsUsed >= options.maxCredits) {
        throw new Error(`${platform} account reached the ${options.maxCredits}-credit limit; stopping before another request`);
      }
      const result = await scrapeCreatorsGet(path, params);
      creditsUsed += result.creditsCharged;
      if (typeof result.body.credits_remaining === "number" && Number.isFinite(result.body.credits_remaining)) {
        creditsRemaining = result.body.credits_remaining;
      }
      options.onUsage?.(result.creditsCharged);
      if (creditsUsed > options.maxCredits) {
        const remaining = creditsRemaining === null ? "" : `; API reports ${creditsRemaining} credits remaining`;
        throw new Error(`${platform} account exceeded the ${options.maxCredits}-credit limit after ${creditsUsed} credits${remaining}`);
      }
      return result.body;
    },
    get creditsUsed() {
      return creditsUsed;
    },
    get creditsRemaining() {
      return creditsRemaining;
    },
  };
}
