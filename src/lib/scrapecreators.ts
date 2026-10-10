import { requireEnv } from "./env.ts";

const BASE_URL = "https://api.scrapecreators.com";

function messageFrom(body: Record<string, unknown>, fallback: string, apiKey: string): string {
  const error = body.error;
  const nestedError = error && typeof error === "object" && !Array.isArray(error)
    ? (error as Record<string, unknown>).message
    : undefined;
  const message = typeof body.message === "string"
    ? body.message
    : typeof error === "string"
      ? error
      : typeof nestedError === "string"
        ? nestedError
      : fallback;
  return apiKey ? message.split(apiKey).join("[redacted]") : message;
}

export async function scrapeCreatorsGet(
  path: string,
  params: Record<string, string>,
): Promise<{ body: Record<string, unknown>; creditsCharged: number }> {
  const apiKey = requireEnv("SCRAPECREATORS_API_KEY");
  const url = new URL(path, BASE_URL);
  url.search = new URLSearchParams(params).toString();

  const response = await fetch(url, { headers: { "x-api-key": apiKey } });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  const body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};

  if (!response.ok || body.success === false) {
    const message = messageFrom(body, text.trim() || response.statusText || "Unknown API error", apiKey);
    throw new Error(`ScrapeCreators request failed (HTTP ${response.status}): ${message}`);
  }

  return {
    body,
    creditsCharged: typeof body.credits_charged === "number" ? body.credits_charged : 0,
  };
}
