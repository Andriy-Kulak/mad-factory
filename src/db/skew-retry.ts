/**
 * fetch for supabase-js that retries a request Supabase rejected with "JWT issued at future". With the new
 * sb_secret_ keys the gateway mints a short-lived JWT per request; when its clock runs ahead of the database's,
 * the request fails for a moment. Waiting briefly and resending fixes it, so one blip doesn't fail a whole page or
 * CLI run. Every other response passes through untouched.
 */
export function skewRetryFetch(base: typeof fetch = fetch, { retries = 2, delayMs = 400 } = {}): typeof fetch {
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const res = await base(input, init);
      if (res.status !== 401 || attempt >= retries) return res;
      const body = await res
        .clone()
        .text()
        .catch(() => "");
      if (!body.includes("JWT issued at future")) return res;
      await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  };
}
