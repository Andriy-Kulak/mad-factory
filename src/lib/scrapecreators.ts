import { requireEnv } from "./env.ts";

const BASE_URL = "https://api.scrapecreators.com";

function messageFrom(body: Record<string, unknown>, fallback: string, apiKey: string): string {
  const error = body.error;
  const nestedError = error && typeof error === "object" && !Array.isArray(error) ? (error as Record<string, unknown>).message : undefined;
  const message = typeof body.message === "string" ? body.message : typeof error === "string" ? error : typeof nestedError === "string" ? nestedError : fallback;
  return apiKey ? message.split(apiKey).join("[redacted]") : message;
}

/** A dropped connection or a 5xx is usually a blip on the provider's side; the same request tends to work a moment later. */
async function fetchWithRetry(url: URL, apiKey: string, retries: number, delayMs: number): Promise<{ response: Response; text: string }> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= retries;
    try {
      const response = await fetch(url, { headers: { "x-api-key": apiKey } });
      const text = await response.text();
      if (response.status < 500 || last) return { response, text };
    } catch (err) {
      if (last) throw err;
    }
    await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
  }
}

/** GET a ScrapeCreators endpoint. Network errors and 5xx responses are retried (twice by default); other errors throw at once. */
export async function scrapeCreatorsGet(path: string, params: Record<string, string>, { retries = 2, delayMs = 1500 } = {}): Promise<{ body: Record<string, unknown>; creditsCharged: number }> {
  const apiKey = requireEnv("SCRAPECREATORS_API_KEY");
  const url = new URL(path, BASE_URL);
  url.search = new URLSearchParams(params).toString();

  const { response, text } = await fetchWithRetry(url, apiKey, retries, delayMs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  const body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};

  if (!response.ok || body.success === false) {
    const message = messageFrom(body, text.trim() || response.statusText || "Unknown API error", apiKey);
    throw new Error(`ScrapeCreators request failed (HTTP ${response.status}): ${message}`);
  }

  return {
    body,
    creditsCharged: typeof body.credits_charged === "number" ? body.credits_charged : 0,
  };
}
